//! Poll the ONEComputer internal API for the status of a durable ApprovalRequest.
//!
//! While the gateway holds a request in-memory (via the `DecisionReceiver`
//! watch channel), it also polls `GET /v1/internal/approvals/:id/status` every
//! ~2 seconds.  When the API reports `approved` or `denied`/`expired`, the
//! gateway calls `ApprovalStore::submit_decision` to wake the held request.
//!
//! The existing watch-channel path (`submit_decision` via the SDK long-poll)
//! still works for in-process tests — polling is the production wake source.
//!
//! # Design
//!
//! ```text
//!  forward.rs
//!   ├── DecisionReceiver (watch channel — in-process wake, used in tests)
//!   └── poll_approval_status() loop (HTTP poll — production wake source)
//!       └── submit_decision() on approved/denied → wakes DecisionReceiver
//! ```
//!
//! The function returns the received `ApprovalDecision` (or `None` on timeout)
//! so `forward.rs` can handle it the same way regardless of which path fired.

use std::sync::Arc;
use std::time::{Duration, Instant};

use affinidi_secrets_resolver::secrets::Secret;
use tracing::{debug, info, warn};

use crate::approval::{ApprovalDecision, ApprovalStore};

/// How often the gateway polls the API for an approval status change.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Response shape returned by `GET /v1/internal/approvals/:id/status`.
///
/// `decisionVc` carries the signed eddsa-jcs-2022 decision VC persisted at
/// `context._vti.decision` (ONE-141/55/56). When present on an `approved`
/// status, the gateway verifies the signature against the gateway's own
/// did:web public key before releasing the held request (ONE-142) — the
/// signature is load-bearing, not decorative.
#[derive(Debug, serde::Deserialize)]
struct StatusResponse {
    status: String,
    #[serde(default, rename = "decisionVc")]
    decision_vc: Option<serde_json::Value>,
    #[serde(default, rename = "managerConfirmation")]
    manager_confirmation: Option<serde_json::Value>,
}

/// Verify a signed decision VC against the gateway's did:web public key.
///
/// Builds the issuer DID document from `signing_key` (same key the API-side
/// signer used to produce the VC, when `ONECLI_GATEWAY_SIGNING_KEY` is set to
/// the same seed on both processes) and delegates to
/// [`crate::vti_signer::verify_vc`]. Returns `true` only when the signature
/// verifies.
async fn verify_decision_vc(decision_vc: &serde_json::Value, signing_key: &Secret) -> bool {
    // Build the gateway did:web DID from the public URL, then the DID doc
    // exposing the signing key's public bytes as a Multikey verification method.
    let base_url =
        std::env::var("ONECLI_GATEWAY_PUBLIC_URL").unwrap_or_else(|_| "localhost".to_string());
    let issuer_did = crate::vti_signer::gateway_did(&base_url);
    let did_doc = match crate::vti_signer::build_did_doc(signing_key, &issuer_did) {
        Ok(doc) => doc,
        Err(e) => {
            warn!(
                error = %e,
                "VC verify: failed to build gateway DID doc — denying"
            );
            return false;
        }
    };

    match crate::vti_signer::verify_vc(decision_vc, &did_doc).await {
        Ok(payload) => {
            debug!(?payload, "VC verified, releasing");
            true
        }
        Err(e) => {
            warn!(
                error = %e,
                "VC verification failed, denying"
            );
            false
        }
    }
}

/// Verify the manager's OpenVTC `auth/step-up/approve-response/0.2` when the API row carries
/// the wallet document. The API-signed decision VC remains a second binding;
/// this check is the load-bearing proof that the independent wallet actually
/// approved the exact challenge represented by the row.
async fn verify_openvtc_confirmation(confirmation: &serde_json::Value) -> bool {
    if confirmation.get("protocol").and_then(|v| v.as_str())
        != Some("auth/step-up/approve-response/0.2")
    {
        return true; // legacy local/demo evidence is checked by the API VC path
    }
    let Some(document) = confirmation.get("document") else {
        warn!("OpenVTC confirmation has no signed document — denying");
        return false;
    };
    let Some(document_type) = document.get("type").and_then(|v| v.as_str()) else {
        warn!("OpenVTC confirmation document has no type — denying");
        return false;
    };
    if document_type != "https://trusttasks.org/spec/auth/step-up/approve-response/0.2" {
        warn!(
            document_type,
            "unexpected OpenVTC confirmation type — denying"
        );
        return false;
    }
    let Some(payload) = document.get("payload").and_then(|v| v.as_object()) else {
        warn!("OpenVTC confirmation document has no payload — denying");
        return false;
    };
    let expected_rp_did = std::env::var("OPENVTC_RP_DID").unwrap_or_else(|_| {
        let base_url =
            std::env::var("ONECLI_GATEWAY_PUBLIC_URL").unwrap_or_else(|_| "localhost".to_string());
        crate::vti_signer::gateway_did(&base_url)
    });
    if payload.get("decision").and_then(|v| v.as_str()) != Some("approved")
        || payload.get("subject") != confirmation.get("subjectDid")
        || payload.get("sessionId") != confirmation.get("approvalId")
        || payload.get("challenge") != confirmation.get("requestTaskHash")
        || document.get("recipient").and_then(|v| v.as_str()) != Some(expected_rp_did.as_str())
    {
        warn!("OpenVTC confirmation is not bound to the requested task — denying");
        return false;
    }
    let Some(expected_signer) = confirmation.get("approverDid").and_then(|v| v.as_str()) else {
        warn!("OpenVTC confirmation has no approver DID — denying");
        return false;
    };
    match crate::vti_signer::verify_trust_task_proof(document).await {
        Ok(signer)
            if signer == expected_signer
                && document.get("issuer").and_then(|v| v.as_str()) == Some(expected_signer) =>
        {
            info!(signer, "OpenVTC manager confirmation proof verified");
            true
        }
        Ok(signer) => {
            warn!(
                signer,
                expected_signer, "OpenVTC proof signer mismatch — denying"
            );
            false
        }
        Err(error) => {
            warn!(%error, "OpenVTC manager confirmation proof failed — denying");
            false
        }
    }
}

/// Map an API status string (plus the optional signed decision VC and the
/// gateway signing key) to an `ApprovalDecision`, or `None` when still pending.
///
/// `expired` is treated as a Deny: the durable record timed out on the API side,
/// so the gateway should also deny.
///
/// # ONE-142 — signature is load-bearing on `approved`
///
/// When `status == "approved"` AND a `decision_vc` is present AND a
/// `signing_key` is available, the VC's signature is verified against the
/// gateway's did:web public key. Only if verification passes does this return
/// `Approve` (release). If verification fails the request is fail-closed to
/// `Deny` — the held request is NOT released. When no VC is present (e.g. a
/// pending row, or a row decided under a build that did not persist a signed
/// VC) the gateway denies the request. Approval is a security boundary, so
/// backward compatibility must never release an unverified action.
///
/// `signing_key == None` cannot verify an approval and therefore denies it.
#[allow(dead_code)]
pub(crate) async fn map_status(
    status: &str,
    decision_vc: Option<&serde_json::Value>,
    signing_key: Option<&Secret>,
) -> Option<ApprovalDecision> {
    map_status_with_confirmation(status, decision_vc, None, signing_key).await
}

pub(crate) async fn map_status_with_confirmation(
    status: &str,
    decision_vc: Option<&serde_json::Value>,
    manager_confirmation: Option<&serde_json::Value>,
    signing_key: Option<&Secret>,
) -> Option<ApprovalDecision> {
    match status {
        "approved" => {
            if let Some(confirmation) = manager_confirmation {
                if !verify_openvtc_confirmation(confirmation).await {
                    return Some(ApprovalDecision::Deny);
                }
            }
            // No decision VC on the row: fail closed. A mutable database status
            // is not proof that the manager approved this exact action.
            let Some(vc) = decision_vc else {
                warn!(
                    "approved status without a signed decision VC — \
                     denying (cryptographic confirmation required)"
                );
                return Some(ApprovalDecision::Deny);
            };
            // No signing key available — cannot verify. Fail closed to Deny so
            // we never release on an unverified signature in production. (Unit
            // tests pass a key when they want the verify path; the None branch
            // is only reachable if the gateway started without a signing key.)
            let Some(key) = signing_key else {
                warn!(
                    "approved status with a decision VC but no gateway signing key — \
                     denying (cannot verify signature)"
                );
                return Some(ApprovalDecision::Deny);
            };
            info!("verifying decision VC before release");
            if verify_decision_vc(vc, key).await {
                info!("VC verified, releasing");
                Some(ApprovalDecision::Approve)
            } else {
                // verify_decision_vc already logged the failure reason.
                Some(ApprovalDecision::Deny)
            }
        }
        "denied" | "expired" => Some(ApprovalDecision::Deny),
        _ => None, // "pending" or any unrecognised value — keep waiting
    }
}

/// Poll `GET /v1/internal/approvals/:gateway_approval_id/status` until the
/// status changes from `pending`, the hard timeout elapses, or the
/// `DecisionReceiver` is woken in-process.
///
/// When a terminal status is received from the API, `submit_decision` is called
/// on the `approval_store` so the `DecisionReceiver` is also woken.  The caller
/// (`forward.rs`) can then `select!` on either path.
///
/// Returns the `ApprovalDecision` on a terminal status, or `None` on timeout.
pub(crate) async fn poll_for_decision(
    http_client: &reqwest::Client,
    gateway_approval_id: &str,
    org_id: &str,
    project_id: &str,
    approval_store: &Arc<dyn ApprovalStore>,
    signing_key: Option<&Secret>,
    hard_timeout: Duration,
) -> Option<ApprovalDecision> {
    let base = super::approval_notify::api_base_url();
    let secret = super::approval_notify::internal_secret_value();
    poll_for_decision_with_url(
        http_client,
        &base,
        &secret,
        gateway_approval_id,
        org_id,
        project_id,
        approval_store,
        signing_key,
        hard_timeout,
    )
    .await
}

/// Inner implementation — accepts `base_url` and `secret` directly so tests
/// can inject a local mock server URL without touching process env vars.
#[allow(clippy::too_many_arguments)]
async fn poll_for_decision_with_url(
    http_client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    gateway_approval_id: &str,
    org_id: &str,
    project_id: &str,
    approval_store: &Arc<dyn ApprovalStore>,
    signing_key: Option<&Secret>,
    hard_timeout: Duration,
) -> Option<ApprovalDecision> {
    let url =
        format!("{base_url}/v1/internal/approvals/{gateway_approval_id}/status?orgId={org_id}",);

    let deadline = Instant::now() + hard_timeout;

    loop {
        // Hard timeout check before sleeping — avoids an extra poll after expiry.
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            debug!(
                approval_id = %gateway_approval_id,
                "poll loop: hard timeout reached"
            );
            return None;
        }

        // Wait the lesser of POLL_INTERVAL and remaining time.
        tokio::time::sleep(POLL_INTERVAL.min(remaining)).await;

        // Re-check after sleep.
        if Instant::now() >= deadline {
            debug!(
                approval_id = %gateway_approval_id,
                "poll loop: hard timeout reached after sleep"
            );
            return None;
        }

        let result = http_client
            .get(&url)
            .header("X-Gateway-Secret", secret)
            .timeout(Duration::from_secs(5))
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<StatusResponse>().await {
                    Ok(body) => {
                        debug!(
                            approval_id = %gateway_approval_id,
                            status = %body.status,
                            has_decision_vc = body.decision_vc.is_some(),
                            "poll: received status"
                        );
                        if let Some(decision) = map_status_with_confirmation(
                            &body.status,
                            body.decision_vc.as_ref(),
                            body.manager_confirmation.as_ref(),
                            signing_key,
                        )
                        .await
                        {
                            // Wake the in-process watch channel too so any
                            // concurrent SDK waiter sees the same outcome.
                            approval_store
                                .submit_decision(org_id, project_id, gateway_approval_id, decision)
                                .await;
                            return Some(decision);
                        }
                        // Still pending — loop and poll again.
                    }
                    Err(e) => {
                        warn!(
                            approval_id = %gateway_approval_id,
                            error = %e,
                            "poll: failed to deserialise status response — retrying"
                        );
                    }
                }
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                warn!(
                    approval_id = %gateway_approval_id,
                    http_status = status,
                    "poll: non-2xx status from API — retrying"
                );
            }
            Err(e) => {
                warn!(
                    approval_id = %gateway_approval_id,
                    error = %e,
                    "poll: HTTP error — retrying"
                );
            }
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── map_status (fail closed without cryptographic proof) ────────────

    #[tokio::test]
    async fn approved_without_vc_denies() {
        // A row that flips to approved without signed evidence must not release.
        assert_eq!(
            map_status("approved", None, None).await,
            Some(ApprovalDecision::Deny)
        );
    }

    #[tokio::test]
    async fn denied_maps_to_deny() {
        assert_eq!(
            map_status("denied", None, None).await,
            Some(ApprovalDecision::Deny)
        );
    }

    #[tokio::test]
    async fn expired_maps_to_deny() {
        assert_eq!(
            map_status("expired", None, None).await,
            Some(ApprovalDecision::Deny)
        );
    }

    #[tokio::test]
    async fn pending_maps_to_none() {
        assert_eq!(map_status("pending", None, None).await, None);
    }

    #[tokio::test]
    async fn unknown_status_maps_to_none() {
        assert_eq!(map_status("unknown_value", None, None).await, None);
        assert_eq!(map_status("", None, None).await, None);
    }

    // ── map_status (ONE-142 — signature is load-bearing) ────────────────

    /// Build a gateway signing key + a signed decision VC for the given
    /// decision, using the real affinidi TDK sign path (same one the API uses).
    /// The gateway builds its DID from ONECLI_GATEWAY_PUBLIC_URL; we set it to
    /// "https://localhost" → did:web:localhost so the verifier resolves the
    /// right verification method from the test key.
    async fn sign_decision_vc(decision: &str) -> (Secret, serde_json::Value) {
        let secret = Secret::generate_ed25519(Some("did:web:localhost#key-1"), None);
        std::env::set_var("ONECLI_GATEWAY_PUBLIC_URL", "https://localhost");
        let issuer = "did:web:localhost";
        let payload = serde_json::json!({
            "approvalId": "ap-probe",
            "decision": decision,
            "decidedBy": "manager",
        });
        let signed = crate::vti_signer::sign_vc(&payload, &secret, issuer)
            .await
            .expect("sign_vc must succeed in test");
        (secret, signed)
    }

    #[tokio::test]
    async fn approved_with_verified_vc_releases() {
        let (secret, vc) = sign_decision_vc("approved").await;
        assert_eq!(
            map_status("approved", Some(&vc), Some(&secret)).await,
            Some(ApprovalDecision::Approve)
        );
    }

    #[tokio::test]
    async fn approved_with_tampered_vc_denies() {
        // Flip a byte in the proofValue so the signature no longer matches the
        // document. The gateway must fail-closed to Deny — NOT release.
        let (secret, mut vc) = sign_decision_vc("approved").await;
        let pv = vc["proof"]["proofValue"]
            .as_str()
            .expect("proofValue present")
            .to_owned();
        let mut bytes = pv.into_bytes();
        let idx = bytes.len().saturating_sub(4).max(2);
        bytes[idx] = match bytes[idx] {
            b'z' => b'y',
            c if c.is_ascii_alphanumeric() => c.wrapping_add(1),
            c => c ^ 0x01,
        };
        vc["proof"]["proofValue"] = serde_json::Value::String(String::from_utf8(bytes).unwrap());
        assert_eq!(
            map_status("approved", Some(&vc), Some(&secret)).await,
            Some(ApprovalDecision::Deny)
        );
    }

    #[tokio::test]
    async fn approved_with_vc_but_no_signing_key_denies() {
        // A signing key is required to verify. Without one we must NOT release
        // on an unverified signature — fail closed to Deny.
        let (_secret, vc) = sign_decision_vc("approved").await;
        assert_eq!(
            map_status("approved", Some(&vc), None).await,
            Some(ApprovalDecision::Deny)
        );
    }

    // ── poll_for_decision with mock server ───────────────────────────────

    use std::sync::atomic::{AtomicU32, Ordering};

    /// Spin up a minimal axum server and drive `poll_for_decision_with_url`
    /// against it, asserting it maps status strings to the correct decision.
    ///
    /// Each test gets its own bound port so parallel test execution is safe.
    /// `signing_key` is passed straight through to the poll loop so the
    /// verify-on-release path (ONE-142) can be exercised end-to-end against a
    /// mock that returns a real signed VC.
    async fn run_mock_poll(
        responses: Vec<serde_json::Value>,
        signing_key: Option<&Secret>,
    ) -> Option<ApprovalDecision> {
        use std::sync::{Arc, Mutex};

        let responses = Arc::new(Mutex::new(responses));
        let responses_clone = Arc::clone(&responses);
        let call_count = Arc::new(AtomicU32::new(0));
        let call_count_clone = Arc::clone(&call_count);

        // Bind a free port (tokio assigns it).
        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = server.local_addr().unwrap();

        // Build a minimal axum app that returns canned status responses.
        let app = {
            let responses = responses_clone;
            let count = call_count_clone;
            axum::Router::new().route(
                "/v1/internal/approvals/{id}/status",
                axum::routing::get(move || {
                    let responses = Arc::clone(&responses);
                    let count = Arc::clone(&count);
                    async move {
                        let idx = count.fetch_add(1, Ordering::SeqCst) as usize;
                        let lock = responses.lock().unwrap();
                        let body = if idx < lock.len() {
                            lock[idx].clone()
                        } else {
                            lock.last()
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({ "status": "approved" }))
                        };
                        axum::Json(body)
                    }
                }),
            )
        };

        tokio::spawn(async move {
            axum::serve(server, app).await.unwrap();
        });

        let base_url = format!("http://{addr}");
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        let store = crate::approval::create_store().await.unwrap();

        poll_for_decision_with_url(
            &http_client,
            &base_url,
            "test-secret",
            "gw-approval-id",
            "org-1",
            "proj-1",
            &store,
            signing_key,
            Duration::from_secs(30),
        )
        .await
    }

    #[tokio::test]
    async fn poll_denies_approved_status_without_proof() {
        // A mutable status string is not sufficient proof of manager approval.
        let decision = run_mock_poll(vec![serde_json::json!({ "status": "approved" })], None).await;
        assert_eq!(decision, Some(ApprovalDecision::Deny));
    }

    #[tokio::test]
    async fn poll_returns_deny_on_denied_status() {
        let decision = run_mock_poll(vec![serde_json::json!({ "status": "denied" })], None).await;
        assert_eq!(decision, Some(ApprovalDecision::Deny));
    }

    #[tokio::test]
    async fn poll_returns_deny_on_expired_status() {
        let decision = run_mock_poll(vec![serde_json::json!({ "status": "expired" })], None).await;
        assert_eq!(decision, Some(ApprovalDecision::Deny));
    }

    #[tokio::test]
    async fn poll_skips_pending_and_denies_unproved_approval() {
        // First two calls return pending, third returns an unsigned approval.
        let decision = run_mock_poll(
            vec![
                serde_json::json!({ "status": "pending" }),
                serde_json::json!({ "status": "pending" }),
                serde_json::json!({ "status": "approved" }),
            ],
            None,
        )
        .await;
        assert_eq!(decision, Some(ApprovalDecision::Deny));
    }

    #[tokio::test]
    async fn poll_releases_when_decision_vc_verifies() {
        // End-to-end: the mock returns a real signed decision VC alongside the
        // approved status, and the poll loop verifies it before releasing.
        let (secret, vc) = sign_decision_vc("approved").await;
        let body = serde_json::json!({ "status": "approved", "decisionVc": vc });
        let decision = run_mock_poll(vec![body], Some(&secret)).await;
        assert_eq!(decision, Some(ApprovalDecision::Approve));
    }

    #[tokio::test]
    async fn poll_denies_when_decision_vc_is_tampered() {
        // End-to-end fail-closed: a tampered VC must NOT release, even though
        // the status string says "approved".
        let (secret, mut vc) = sign_decision_vc("approved").await;
        let pv = vc["proof"]["proofValue"]
            .as_str()
            .expect("proofValue present")
            .to_owned();
        let mut bytes = pv.into_bytes();
        let idx = bytes.len().saturating_sub(4).max(2);
        bytes[idx] = match bytes[idx] {
            b'z' => b'y',
            c if c.is_ascii_alphanumeric() => c.wrapping_add(1),
            c => c ^ 0x01,
        };
        vc["proof"]["proofValue"] = serde_json::Value::String(String::from_utf8(bytes).unwrap());
        let body = serde_json::json!({ "status": "approved", "decisionVc": vc });
        let decision = run_mock_poll(vec![body], Some(&secret)).await;
        assert_eq!(decision, Some(ApprovalDecision::Deny));
    }
}
