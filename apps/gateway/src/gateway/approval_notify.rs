//! Notify the ONEComputer internal API when the gateway starts holding a request.
//!
//! When a `ManualApproval` policy fires the gateway creates an in-memory
//! [`PendingApproval`] and holds the request.  This module POSTs the same
//! metadata to the API (`POST /v1/internal/approvals`) so a durable
//! `ApprovalRequest` row exists — managers can see it in the queue before the
//! gateway times out or the agent disconnects.
//!
//! Design contract (14-A):
//! - Call is awaited **before** `decision_rx.wait()` so the durable record
//!   exists the moment the hold starts.
//! - Fail-closed-with-log: any HTTP error logs a warning and the in-memory hold
//!   continues normally.  The gateway never crashes on a notify failure.
//! - No DIY crypto — the shared secret is a plain env var; no new auth scheme.
//!
//! # Environment variables
//!
//! | Variable                  | Default                   | Notes                              |
//! |---------------------------|---------------------------|------------------------------------|
//! | `ONECOMPUTER_API_BASE`    | `http://127.0.0.1:10254`  | Base URL of the ONEComputer API    |
//! | `GATEWAY_INTERNAL_SECRET` | *(required in prod)*      | Shared secret (`X-Gateway-Secret`) |

use serde::Serialize;
use serde_json::Value;

use crate::approval::PendingApproval;

// ── Request body ────────────────────────────────────────────────────────

/// Body sent to `POST /v1/internal/approvals`.
///
/// Matches `internalApprovalSchema` in
/// `packages/api/src/validations/internal.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InternalApprovalBody {
    pub organization_id: String,
    pub project_id: String,
    pub agent_id: String,
    /// Human-readable agent name, placed in context by the API.
    pub agent_name: String,
    /// Short action label, e.g. `"outlook.send_email"` derived from host + path.
    pub action: String,
    /// Who initiated the request — the agent identifier or agent_id.
    pub requested_by: String,
    /// Freeform context the manager sees in the approval queue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
    /// The gateway's in-memory approval id — stashed in `context.gatewayApprovalId`
    /// by the API so the future unblock path can correlate both records.
    pub gateway_approval_id: String,
    /// Unix seconds expiry — the API defaults to its own 24 h TTL when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_unix: Option<u64>,
}

/// Build the `InternalApprovalBody` from a [`PendingApproval`] and the
/// matched `rule_id`.
///
/// This is a pure function — easy to unit-test without network.
pub(crate) fn build_notify_body(approval: &PendingApproval, rule_id: &str) -> InternalApprovalBody {
    // Derive a short action label: strip the port, split on '/', take the
    // first two path segments (e.g. `/v1/messages` → `api.host.send`).
    let host_label = approval
        .host
        .split(':')
        .next()
        .unwrap_or(&approval.host)
        // Turn dots into underscores for the first segment only so the label
        // stays readable ("graph.microsoft.com" → "graph_microsoft_com" is
        // noisy; we just use the TLD-stripped apex if we can).
        .to_string();

    let path_label = approval
        .path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join(".");

    let action = if path_label.is_empty() {
        format!("{host_label}.request")
    } else {
        format!("{host_label}.{path_label}")
    };

    let requested_by = approval
        .agent_identifier
        .clone()
        .unwrap_or_else(|| approval.agent_id.clone());

    let context = Some(serde_json::json!({
        "host":         approval.host,
        "path":         approval.path,
        "method":       approval.method,
        "ruleId":       rule_id,
        "bodyPreview":  approval.body_preview,
    }));

    InternalApprovalBody {
        organization_id: approval.organization_id.clone(),
        project_id: approval.project_id.clone(),
        agent_id: approval.agent_id.clone(),
        agent_name: approval.agent_name.clone(),
        action,
        requested_by,
        context,
        gateway_approval_id: approval.id.clone(),
        expires_at_unix: Some(approval.expires_at),
    }
}

// ── HTTP call ────────────────────────────────────────────────────────────

/// Read the API base URL from `ONECOMPUTER_API_BASE`, falling back to the
/// local dev default.
///
/// Exposed as `pub(super)` so `approval_poll` can reuse it without duplicating
/// the env-var name.
pub(super) fn api_base_url() -> String {
    std::env::var("ONECOMPUTER_API_BASE").unwrap_or_else(|_| "http://127.0.0.1:10254".to_string())
}

/// Read the internal shared secret from `GATEWAY_INTERNAL_SECRET`.
/// Returns an empty string when unset (the API will reject with 401, which
/// is caught and logged by the fail-closed path).
///
/// Exposed as `pub(super)` so `approval_poll` can reuse it without duplicating
/// the env-var name.
pub(super) fn internal_secret_value() -> String {
    std::env::var("GATEWAY_INTERNAL_SECRET").unwrap_or_default()
}

/// POST the durable `ApprovalRequest` to the ONEComputer API.
///
/// Awaited before `decision_rx.wait()` in `forward.rs` so the manager can
/// see the record immediately.  Any error is logged as a warning; the
/// in-memory hold continues regardless.
pub(crate) async fn notify_api(
    http_client: &reqwest::Client,
    approval: &PendingApproval,
    rule_id: &str,
) {
    let base = api_base_url();
    let url = format!("{base}/v1/internal/approvals");
    let secret = internal_secret_value();
    let body = build_notify_body(approval, rule_id);

    let result = http_client
        .post(&url)
        .header("X-Gateway-Secret", &secret)
        .json(&body)
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(
                approval_id = %approval.id,
                status = resp.status().as_u16(),
                "durable ApprovalRequest created via internal API"
            );
        }
        Ok(resp) => {
            tracing::warn!(
                approval_id = %approval.id,
                status = resp.status().as_u16(),
                url = %url,
                "internal API returned error for ApprovalRequest — hold continues in-memory"
            );
        }
        Err(e) => {
            tracing::warn!(
                approval_id = %approval.id,
                error = %e,
                url = %url,
                "failed to POST ApprovalRequest to internal API — hold continues in-memory"
            );
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_approval(host: &str, path: &str) -> PendingApproval {
        let now = 1_700_000_000u64;
        PendingApproval {
            id: "test-approval-id".to_string(),
            organization_id: "org-1".to_string(),
            project_id: "proj-1".to_string(),
            agent_id: "agent-1".to_string(),
            agent_name: "Test Agent".to_string(),
            agent_identifier: Some("test-agent-identifier".to_string()),
            method: "POST".to_string(),
            scheme: "https".to_string(),
            host: host.to_string(),
            path: path.to_string(),
            headers: HashMap::new(),
            body_preview: Some("{}".to_string()),
            created_at: now,
            expires_at: now + 180,
        }
    }

    #[test]
    fn build_body_scalar_fields() {
        let approval = make_approval("graph.microsoft.com", "/v1.0/me/sendMail");
        let body = build_notify_body(&approval, "rule-send-mail");

        assert_eq!(body.organization_id, "org-1");
        assert_eq!(body.project_id, "proj-1");
        assert_eq!(body.agent_id, "agent-1");
        assert_eq!(body.agent_name, "Test Agent");
        assert_eq!(body.gateway_approval_id, "test-approval-id");
        assert_eq!(body.requested_by, "test-agent-identifier");
        assert_eq!(body.expires_at_unix, Some(1_700_000_180));
    }

    #[test]
    fn build_body_action_derived_from_host_and_path() {
        let approval = make_approval("graph.microsoft.com", "/v1.0/me/sendMail");
        let body = build_notify_body(&approval, "r1");
        // action = "<host>.<first-segment>.<second-segment>"
        // path segments: ["v1.0", "me", "sendMail"] — take(2) gives "v1.0.me"
        assert_eq!(body.action, "graph.microsoft.com.v1.0.me");
    }

    #[test]
    fn build_body_action_with_port_stripped() {
        let approval = make_approval("outlook.office365.com:443", "/v1/messages");
        let body = build_notify_body(&approval, "r1");
        assert!(
            body.action.starts_with("outlook.office365.com."),
            "action should start with host without port, got: {}",
            body.action
        );
    }

    #[test]
    fn build_body_action_empty_path() {
        let approval = make_approval("api.example.com", "/");
        let body = build_notify_body(&approval, "r1");
        assert_eq!(body.action, "api.example.com.request");
    }

    #[test]
    fn build_body_action_bare_root_path() {
        let approval = make_approval("api.example.com", "");
        let body = build_notify_body(&approval, "r1");
        assert_eq!(body.action, "api.example.com.request");
    }

    #[test]
    fn build_body_requested_by_falls_back_to_agent_id() {
        let mut approval = make_approval("api.example.com", "/v1/send");
        approval.agent_identifier = None;
        let body = build_notify_body(&approval, "r1");
        assert_eq!(body.requested_by, "agent-1");
    }

    #[test]
    fn build_body_context_contains_required_fields() {
        let approval = make_approval("graph.microsoft.com", "/v1.0/me/sendMail");
        let body = build_notify_body(&approval, "rule-42");
        let ctx = body.context.expect("context must be present");

        assert_eq!(ctx["host"], "graph.microsoft.com");
        assert_eq!(ctx["path"], "/v1.0/me/sendMail");
        assert_eq!(ctx["method"], "POST");
        assert_eq!(ctx["ruleId"], "rule-42");
        assert_eq!(ctx["bodyPreview"], "{}");
    }

    #[test]
    fn build_body_context_body_preview_null_when_absent() {
        let mut approval = make_approval("api.example.com", "/v1/data");
        approval.body_preview = None;
        let body = build_notify_body(&approval, "r1");
        let ctx = body.context.unwrap();
        assert!(ctx["bodyPreview"].is_null());
    }

    #[test]
    fn build_body_serializes_to_camel_case() {
        let approval = make_approval("api.example.com", "/v1/send");
        let body = build_notify_body(&approval, "r1");
        let json = serde_json::to_value(&body).expect("serialization should not fail");

        // The internalApprovalSchema expects camelCase keys.
        assert!(
            json.get("organizationId").is_some(),
            "organizationId missing"
        );
        assert!(json.get("projectId").is_some(), "projectId missing");
        assert!(json.get("agentId").is_some(), "agentId missing");
        assert!(json.get("agentName").is_some(), "agentName missing");
        assert!(json.get("requestedBy").is_some(), "requestedBy missing");
        assert!(
            json.get("gatewayApprovalId").is_some(),
            "gatewayApprovalId missing"
        );
        assert!(json.get("expiresAtUnix").is_some(), "expiresAtUnix missing");
    }
}
