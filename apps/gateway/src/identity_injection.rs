// identity_injection.rs — build + inject an AgentIdentityCredential VP
//
// Phase 3 (G3): after the gateway forwards a request to an upstream MCP
// connector, it may attach a signed Verifiable Presentation describing the
// agent identity (issuer DID, channel name, issuance time) to the JSON-RPC
// response under `result._meta.agentIdentity`.
//
// All cryptography is delegated to the affinidi TDK via `vti_signer::sign_vc`
// (eddsa-jcs-2022 Data Integrity proof over an Ed25519 key held in an
// affinidi `Secret`). No raw Ed25519 math, custom DIDComm, custom JWS, or
// createSign/createVerify is performed in this file.

use serde_json::{json, Value};

/// Credential subject describing the agent whose request the gateway just
/// forwarded. This is the `credentialSubject` of the signed VC embedded in
/// the VP that `build_agent_vp` produces.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct AgentIdentityCredential {
    /// DID of the credential issuer (the gateway, `did:web:<host>`).
    ///
    /// Stored on the credential for provenance; `build_agent_vp` takes the
    /// issuer DID as a separate arg so callers need not parse it back out.
    pub issuer_did: String,
    /// Name of the channel that matched the inbound path (e.g. "sharepoint").
    pub channel_name: String,
    /// Issuance timestamp in RFC 3339 / ISO 8601 (UTC).
    pub issued_at: String,
}

/// Build and sign a Verifiable Presentation containing an
/// [`AgentIdentityCredential`].
///
/// The credential subject is wrapped in a W3C VCDM 2.0 credential envelope
/// and signed with `vti_signer::sign_vc` (eddsa-jcs-2022 Data Integrity proof
/// via the affinidi TDK — no direct crypto here). The signed VC is then
/// embedded as the sole `verifiableCredential` of a Verifiable Presentation
/// envelope, which is returned as a `serde_json::Value` ready for injection.
///
/// `secret` is the gateway's Ed25519 signing key (see `vti_signer::load_signing_key`).
/// `issuer_did` is the gateway DID (`did:web:<host>`); it is passed separately
/// so callers do not have to parse it back out of the secret's key id.
pub(crate) async fn build_agent_vp(
    credential: &AgentIdentityCredential,
    secret: &affinidi_secrets_resolver::secrets::Secret,
    issuer_did: &str,
) -> anyhow::Result<Value> {
    // credentialSubject — the agent-identity claims.
    let subject = json!({
        "id": issuer_did,
        "channelName": credential.channel_name,
        "issuedAt": credential.issued_at,
    });

    // Sign the credentialSubject as a VC via the affinidi SDK. No DIY crypto.
    let signed_vc = crate::vti_signer::sign_vc(&subject, secret, issuer_did).await?;

    // Wrap the signed VC in a Verifiable Presentation envelope (W3C VCDM 2.0).
    // The holder is the gateway (issuer), since the gateway both issues and
    // presents the credential.
    let vp = json!({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "type": ["VerifiablePresentation"],
        "holder": issuer_did,
        "verifiableCredential": [signed_vc],
    });

    Ok(vp)
}

/// Inject a VP into a JSON-RPC 2.0 response at `result._meta.agentIdentity`.
///
/// A JSON-RPC 2.0 response is recognized by the presence of a top-level
/// `result` key. If the body is not JSON-RPC (no `result` key) this is a no-op
/// and `response_body` is left unchanged.
///
/// The `_meta` object is created if absent; if present, `agentIdentity` is
/// added/overwritten within it. This follows the MCP spec convention for
/// response-level metadata.
pub(crate) fn inject_vp_into_response(response_body: &mut Value, vp: Value) {
    // Only JSON-RPC 2.0 responses carry a `result` member. Anything else
    // (e.g. a plain {"status":"ok"} REST body, a JSON-RPC error) is left alone.
    let result = match response_body.get_mut("result") {
        Some(r) => r,
        None => return,
    };

    // Ensure `result` is an object so `_meta` can be attached.
    if !result.is_object() {
        // A non-object result (e.g. a bare string/number) cannot carry _meta;
        // leave the response unchanged rather than corrupting it.
        return;
    }

    // Get or insert the `_meta` object on the result.
    if result.get("_meta").is_none() {
        result["_meta"] = json!({});
    }

    // Attach the VP under the agent-identity key.
    result["_meta"]["agentIdentity"] = vp;
}

#[cfg(test)]
mod tests {
    use super::*;
    use affinidi_secrets_resolver::secrets::Secret;

    /// JSON-RPC 2.0 success response → `result._meta.agentIdentity` present.
    #[test]
    fn inject_adds_meta() {
        let mut body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": []
            }
        });
        let vp = json!({"type": "VerifiablePresentation"});
        inject_vp_into_response(&mut body, vp);
        assert!(
            body["result"]["_meta"]["agentIdentity"].is_object(),
            "agentIdentity should be present under result._meta"
        );
        assert_eq!(
            body["result"]["_meta"]["agentIdentity"]["type"],
            "VerifiablePresentation"
        );
        // Original result contents are preserved.
        assert_eq!(body["result"]["tools"], json!([]));
    }

    /// A non-JSON-RPC body (`{"status":"ok"}`) is left unchanged.
    #[test]
    fn no_inject_non_jsonrpc() {
        let mut body = json!({"status": "ok"});
        let original = body.clone();
        let vp = json!({"type": "VerifiablePresentation"});
        inject_vp_into_response(&mut body, vp);
        assert_eq!(body, original, "non-JSON-RPC body must be unchanged");
    }

    /// `build_agent_vp` output contains a `proof` key (carried by the embedded
    /// signed VC). Uses an ephemeral Ed25519 key generated via the affinidi SDK.
    #[tokio::test]
    async fn vp_has_proof() {
        let secret = Secret::generate_ed25519(Some("did:web:gw.example.com#key-1"), None);
        let issuer = "did:web:gw.example.com";
        let credential = AgentIdentityCredential {
            issuer_did: issuer.to_string(),
            channel_name: "sharepoint".to_string(),
            issued_at: "2026-06-28T00:00:00Z".to_string(),
        };

        let vp = build_agent_vp(&credential, &secret, issuer)
            .await
            .expect("build_agent_vp should succeed");

        // The VP embeds the signed VC; the VC carries the proof from sign_vc.
        let creds = vp["verifiableCredential"]
            .as_array()
            .expect("verifiableCredential should be an array");
        assert!(!creds.is_empty(), "VP should embed at least one VC");
        assert!(
            creds[0].get("proof").is_some(),
            "embedded VC must carry a proof (signed via affinidi SDK)"
        );

        // VP envelope sanity.
        assert_eq!(vp["type"], json!(["VerifiablePresentation"]));
        assert_eq!(vp["holder"], issuer);
    }
}
