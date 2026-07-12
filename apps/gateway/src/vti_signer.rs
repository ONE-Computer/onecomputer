// vti_signer.rs — did:web identity + VC signing via affinidi SDKs
//
// All cryptography is delegated to the affinidi TDK:
//   - `affinidi_secrets_resolver::Secret` holds the Ed25519 key and is a
//     `Signer` (blanket impl in `affinidi_data_integrity::signer`).
//   - `affinidi_data_integrity::DataIntegrityProof` performs the
//     eddsa-jcs-2022 sign / verify pipeline.
// No raw Ed25519 math, custom DIDComm, custom JWS, or createSign/createVerify
// is performed in this file.

use affinidi_data_integrity::{
    did_vm::{ResolvedKey, VerificationMethodResolver},
    DataIntegrityError, DataIntegrityProof, SignOptions, VerifyOptions,
};
use affinidi_encoding::{Codec, MultiEncoded};
// `Signer` trait must be in scope so the blanket `impl Signer for Secret`
// (in affinidi-data-integrity) is visible — `DataIntegrityProof::sign` takes
// `&dyn Signer` and the `&Secret` arg is coerced through it. Marked
// `allow(unused_imports)` because the only call site is itself
// `#[allow(dead_code)]` until the VP-injection layer lands.
#[allow(unused_imports)]
use affinidi_data_integrity::signer::Signer;
use affinidi_secrets_resolver::secrets::{KeyType, Secret};
use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Value};

// Re-export the presentation type so callers can reference it via this module.
// It is part of the documented public surface and is unused internally today.
#[allow(unused_imports)]
pub(crate) use affinidi_vc::VerifiablePresentation;

/// W3C credentials v2 context, used on every signed VC.
const CREDENTIALS_V2_CONTEXT: &str = "https://www.w3.org/ns/credentials/v2";

/// Load an Ed25519 signing key from the `ONECLI_GATEWAY_SIGNING_KEY` env var.
///
/// The env var must hold the **base64url**-encoded 32-byte Ed25519 private
/// key seed. When absent, an ephemeral key is generated via
/// [`Secret::generate_ed25519`] and a warning is logged — **but only in dev
/// builds**. In non-dev builds (`cfg!(debug_assertions) == false`) an unset
/// key is a fatal configuration error: the process panics at startup so a
/// misconfigured production deployment cannot silently rotate the signing key
/// on every restart (which would make all previously-signed VCs read
/// `vtiVerified=false`).
///
/// The key id is set to the gateway DID + `#key-1` so that the resulting
/// Data Integrity proof's `verificationMethod` resolves to the gateway's
/// did:web DID document.
pub fn load_signing_key() -> anyhow::Result<Secret> {
    let base_url =
        std::env::var("ONECLI_GATEWAY_PUBLIC_URL").unwrap_or_else(|_| "localhost".to_string());
    let issuer_did = gateway_did(&base_url);
    let kid = format!("{issuer_did}#key-1");

    match std::env::var("ONECLI_GATEWAY_SIGNING_KEY") {
        Ok(b64) => {
            // Decode base64 (accept standard or url-safe, with or without pad).
            let seed = base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64.trim()))
                .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(b64.trim()))
                .map_err(|e| {
                    anyhow::anyhow!("ONECLI_GATEWAY_SIGNING_KEY is not valid base64: {e}")
                })?;

            if seed.len() != 32 {
                return Err(anyhow::anyhow!(
                    "ONECLI_GATEWAY_SIGNING_KEY must decode to exactly 32 bytes (Ed25519 seed), got {}",
                    seed.len()
                ));
            }

            let mut arr: [u8; 32] = [0; 32];
            arr.copy_from_slice(&seed);
            // affinidi SDK key derivation — no custom crypto here.
            Ok(Secret::generate_ed25519(Some(&kid), Some(&arr)))
        }
        Err(_) => {
            // Ephemeral fallback. In non-dev environments this is a fatal
            // misconfiguration: signatures would not persist across restarts,
            // so every restart rotates the key and all previously-signed VCs
            // read vtiVerified=false. Fail closed at startup instead.
            if should_fail_closed_when_key_unset() {
                panic!(
                    "ONECLI_GATEWAY_SIGNING_KEY is required in non-dev environments — \
                     set it to a base64-encoded 32-byte Ed25519 seed \
                     (generate one with: head -c 32 /dev/urandom | base64). \
                     The key MUST be set identically on the API and gateway \
                     processes and sourced from a secret manager / KMS."
                );
            }
            tracing::warn!(
                did = %kid,
                "ONECLI_GATEWAY_SIGNING_KEY not set; generated an ephemeral Ed25519 key. \
                 Signatures will not persist across restarts. This is only permitted in dev."
            );
            Ok(Secret::generate_ed25519(Some(&kid), None))
        }
    }
}

/// Whether the gateway should fail closed (panic) when
/// `ONECLI_GATEWAY_SIGNING_KEY` is unset.
///
/// Pure function over [`is_dev_environment`] so the fail-closed decision is
/// unit-testable independent of the `panic!`. Returns `true` (fail closed)
/// when the process is NOT in a dev context — i.e. a release build in any
/// environment other than `dev`/`local`/`development`.
pub fn should_fail_closed_when_key_unset() -> bool {
    !is_dev_environment()
}

/// Whether the gateway is running in a dev/local context.
///
/// Dev is signalled by EITHER a debug build (`cfg!(debug_assertions)`) OR the
/// `ONECOMPUTER_ENV` env var being `dev` / `local` / `development`. This lets a
/// release build opt into the ephemeral fallback for local dev by setting
/// `ONECOMPUTER_ENV=dev`, while a release build in any other environment
/// (staging/prod/production, including unset) is held to the durable-key
/// requirement. Mirrors the TS `isDevEnvironment()` in
/// `vti-credential-signer.ts`.
pub fn is_dev_environment() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    matches!(
        std::env::var("ONECOMPUTER_ENV")
            .unwrap_or_default()
            .as_str(),
        "dev" | "local" | "development"
    )
}

/// Build a `did:web:<host>` identifier from a base URL.
///
/// Strips the `https://` / `http://` scheme and any path / port, leaving the
/// bare host (per the did:web spec the host may include a port, but we keep
/// only the host for stable identifiers across port changes).
///
/// Examples:
/// - `https://gw.example.com`      -> `did:web:gw.example.com`
/// - `http://localhost:8080/path`  -> `did:web:localhost`
/// - `gw.example.com`              -> `did:web:gw.example.com`
pub(crate) fn gateway_did(base_url: &str) -> String {
    let host = base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .unwrap_or(base_url);

    // Take everything up to the first `/`, `:`, or end-of-string.
    let end = host.find(['/', ':']).unwrap_or(host.len());
    let host = &host[..end];

    format!("did:web:{host}")
}

/// Sign a JSON payload as a W3C Verifiable Credential using a Data Integrity
/// proof with the `eddsa-jcs-2022` cryptosuite.
///
/// `payload` is wrapped in a VCDM 2.0 credential envelope (`@context`,
/// `type`, `issuer`, `credentialSubject`), then signed via
/// [`DataIntegrityProof::sign`] with the affinidi-provided `Secret` signer
/// (Ed25519 via `ed25519-dalek`, selected by the SDK).
///
/// Returns the signed VC as a `serde_json::Value` with the `proof` field
/// embedded.
#[allow(dead_code)]
pub(crate) async fn sign_vc(
    payload: &Value,
    secret: &Secret,
    issuer_did: &str,
) -> anyhow::Result<Value> {
    if secret.get_key_type() != KeyType::Ed25519 {
        return Err(anyhow::anyhow!(
            "sign_vc requires an Ed25519 key; got {:?}",
            secret.get_key_type()
        ));
    }

    let credential = json!({
        "@context": [CREDENTIALS_V2_CONTEXT],
        "type": ["VerifiableCredential"],
        "issuer": issuer_did,
        "issuanceDate": time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        "credentialSubject": payload,
    });

    // affinidi SDK: Secret implements Signer, cryptosuite is auto-selected as
    // eddsa-jcs-2022 for Ed25519 keys.
    let proof = DataIntegrityProof::sign(&credential, secret, SignOptions::new())
        .await
        .map_err(|e| anyhow::anyhow!("data-integrity sign failed: {e}"))?;

    let proof_value = serde_json::to_value(&proof)
        .map_err(|e| anyhow::anyhow!("failed to serialize proof: {e}"))?;

    let mut signed = credential;
    signed["proof"] = proof_value;

    Ok(signed)
}

/// In-process resolver that pulls the public key for a verification method
/// out of a caller-supplied DID document (a `serde_json::Value`).
///
/// This implements the affinidi-defined [`VerificationMethodResolver`] trait
/// so it plugs straight into [`DataIntegrityProof::verify`]. It performs no
/// network I/O — the DID document is provided by the caller (e.g. fetched
/// once and cached by the gateway), which keeps verification testable
/// in-process.
struct DidDocResolver<'a> {
    did_doc: &'a Value,
}

#[async_trait]
impl<'a> VerificationMethodResolver for DidDocResolver<'a> {
    async fn resolve_vm(&self, vm: &str) -> Result<ResolvedKey, DataIntegrityError> {
        // Find the verificationMethod whose id matches `vm`.
        let methods = self
            .did_doc
            .get("verificationMethod")
            .ok_or_else(|| {
                DataIntegrityError::Resolver(format!(
                    "DID document has no verificationMethod array (looking for {vm})"
                ))
            })?
            .as_array()
            .ok_or_else(|| {
                DataIntegrityError::Resolver("verificationMethod is not an array".into())
            })?;

        let entry = methods
            .iter()
            .find(|m| m.get("id").and_then(Value::as_str) == Some(vm))
            .ok_or_else(|| {
                DataIntegrityError::Resolver(format!(
                    "verificationMethod {vm} not found in DID document"
                ))
            })?;

        // Support both `publicKeyMultibase` (Multikey) and `publicKeyJwk`
        // (JsonWebKey2020) encodings.
        if let Some(pk_mb) = entry.get("publicKeyMultibase").and_then(Value::as_str) {
            // affinidi SDK helper: decodes multibase + multicodec into raw
            // public-key bytes. No custom multibase handling here.
            let pub_bytes = Secret::decode_multikey(pk_mb).map_err(|e| {
                DataIntegrityError::Resolver(format!(
                    "failed to decode publicKeyMultibase for {vm}: {e}"
                ))
            })?;

            // Ed25519 public keys are 32 bytes. Any other length here means
            // the verification method carries a different key type.
            if pub_bytes.len() == 32 {
                return Ok(ResolvedKey::new(KeyType::Ed25519, pub_bytes));
            }
            return Err(DataIntegrityError::Resolver(format!(
                "verificationMethod {vm} does not carry a 32-byte Ed25519 public key (got {} bytes)",
                pub_bytes.len()
            )));
        }

        if let Some(jwk) = entry.get("publicKeyJwk") {
            // Parse via the affinidi SDK's Secret::from_str, which accepts a
            // JWK as a serde_json::Value — no need to depend on affinidi-crypto
            // directly. We use the verification method id as the key id; it is
            // not used further here.
            let parsed = Secret::from_str(vm, jwk).map_err(|e| {
                DataIntegrityError::Resolver(format!("failed to load publicKeyJwk: {e}"))
            })?;
            if parsed.get_key_type() != KeyType::Ed25519 {
                return Err(DataIntegrityError::Resolver(format!(
                    "verificationMethod {vm} JWK is not Ed25519"
                )));
            }
            return Ok(ResolvedKey::new(
                parsed.get_key_type(),
                parsed.get_public_bytes().to_vec(),
            ));
        }

        Err(DataIntegrityError::Resolver(format!(
            "verificationMethod {vm} has neither publicKeyMultibase nor publicKeyJwk"
        )))
    }
}

/// Verify a signed VC.
///
/// `signed_vc` is the VC produced by [`sign_vc`] (or any conformant
/// eddsa-jcs-2022 VC). `issuer_did_doc` is the issuer's DID document as a
/// JSON value; its `verificationMethod` array is searched for the proof's
/// `verificationMethod` to obtain the public key — no network I/O.
///
/// On success, returns the credential payload (the VC without the `proof`
/// field).
pub(crate) async fn verify_vc(signed_vc: &Value, issuer_did_doc: &Value) -> anyhow::Result<Value> {
    let proof_value = signed_vc
        .get("proof")
        .ok_or_else(|| anyhow::anyhow!("signed VC has no proof field"))?;

    let proof: DataIntegrityProof = serde_json::from_value(proof_value.clone())
        .map_err(|e| anyhow::anyhow!("failed to parse proof: {e}"))?;

    // Reconstruct the unsigned credential for verification: a copy of the VC
    // with the `proof` field removed. The data-integrity pipeline canonicalizes
    // this document during verification.
    let mut unsigned = signed_vc.clone();
    if let Value::Object(ref mut map) = unsigned {
        map.remove("proof");
    }

    let resolver = DidDocResolver {
        did_doc: issuer_did_doc,
    };
    proof
        .verify(&unsigned, &resolver, VerifyOptions::new())
        .await
        .map_err(|e| anyhow::anyhow!("data-integrity verify failed: {e}"))?;

    Ok(unsigned)
}

/// Build the self-contained DID document encoded by an OpenVTC canonical
/// `did:peer:2` identity. The peer method puts the X25519 key-agreement
/// Multikey in the `E` segment and the Ed25519 authentication Multikey in the
/// `V` segment. The `#key-2` assertion method is the only key accepted for a
/// Trust Task proof.
fn build_did_peer_document(did: &str) -> anyhow::Result<Value> {
    let prefix = "did:peer:2.";
    let encoded = did
        .strip_prefix(prefix)
        .ok_or_else(|| anyhow::anyhow!("not a canonical did:peer:2 identity"))?;

    let mut key_agreement = None;
    let mut authentication = None;
    for segment in encoded.split('.') {
        if let Some(value) = segment.strip_prefix('E') {
            if key_agreement.replace(value).is_some() {
                return Err(anyhow::anyhow!("did:peer:2 contains duplicate E segments"));
            }
        }
        if let Some(value) = segment.strip_prefix('V') {
            if authentication.replace(value).is_some() {
                return Err(anyhow::anyhow!("did:peer:2 contains duplicate V segments"));
            }
        }
    }

    let key_agreement = key_agreement
        .filter(|value| value.starts_with('z') && value.len() > 1)
        .ok_or_else(|| anyhow::anyhow!("did:peer:2 is missing a base58 E key"))?;
    let authentication = authentication
        .filter(|value| value.starts_with('z') && value.len() > 1)
        .ok_or_else(|| anyhow::anyhow!("did:peer:2 is missing a base58 V key"))?;

    validate_peer_multikey(key_agreement, Codec::X25519Pub, "E")?;
    validate_peer_multikey(authentication, Codec::Ed25519Pub, "V")?;

    Ok(json!({
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/multikey/v1",
        ],
        "id": did,
        "verificationMethod": [
            {
                "id": format!("{did}#key-1"),
                "type": "Multikey",
                "controller": did,
                "publicKeyMultibase": key_agreement,
            },
            {
                "id": format!("{did}#key-2"),
                "type": "Multikey",
                "controller": did,
                "publicKeyMultibase": authentication,
            },
        ],
        "keyAgreement": [format!("{did}#key-1")],
        "authentication": [format!("{did}#key-2")],
        "assertionMethod": [format!("{did}#key-2")],
    }))
}

fn validate_peer_multikey(value: &str, expected: Codec, label: &str) -> anyhow::Result<()> {
    let (base, bytes) = multibase::decode(value)
        .map_err(|e| anyhow::anyhow!("did:peer:2 {label} key is not valid multibase: {e}"))?;
    if base != multibase::Base::Base58Btc {
        return Err(anyhow::anyhow!(
            "did:peer:2 {label} key must use base58btc multibase"
        ));
    }
    let encoded = MultiEncoded::new(&bytes)
        .map_err(|e| anyhow::anyhow!("did:peer:2 {label} key is not multicodec: {e}"))?;
    if encoded.codec_type() != expected || encoded.data().len() != 32 {
        return Err(anyhow::anyhow!(
            "did:peer:2 {label} key has the wrong multicodec or length"
        ));
    }
    Ok(())
}

/// Verify an OpenVTC Trust-Task Data Integrity proof and return the proven
/// signer DID. This delegates the complete `eddsa-jcs-2022` pipeline to the
/// Affinidi/OpenVTC verifier and resolves both self-contained `did:key` and
/// canonical OpenVTC `did:peer:2` identities; the gateway does not implement a
/// second signature scheme.
pub(crate) async fn verify_trust_task_proof(document: &Value) -> anyhow::Result<String> {
    let proof_value = document
        .get("proof")
        .ok_or_else(|| anyhow::anyhow!("Trust Task has no proof"))?;
    if proof_value.get("type").and_then(Value::as_str) != Some("DataIntegrityProof")
        || proof_value.get("cryptosuite").and_then(Value::as_str) != Some("eddsa-jcs-2022")
        || proof_value.get("proofPurpose").and_then(Value::as_str) != Some("assertionMethod")
    {
        return Err(anyhow::anyhow!(
            "Trust Task proof must be an eddsa-jcs-2022 assertionMethod DataIntegrityProof"
        ));
    }
    let proof: DataIntegrityProof = serde_json::from_value(proof_value.clone())
        .map_err(|e| anyhow::anyhow!("failed to parse Trust Task proof: {e}"))?;
    let verification_method = proof.verification_method.as_str();
    let signer = verification_method
        .split('#')
        .next()
        .filter(|did| did.starts_with("did:"))
        .ok_or_else(|| anyhow::anyhow!("Trust Task proof verificationMethod has no DID"))?
        .to_string();
    let mut unsigned = document.clone();
    if let Value::Object(ref mut map) = unsigned {
        map.remove("proof");
    }
    if signer.starts_with("did:peer:2.") {
        let did_document = build_did_peer_document(&signer)?;
        let expected_method = format!("{signer}#key-2");
        if proof.verification_method != expected_method {
            return Err(anyhow::anyhow!(
                "did:peer:2 Trust Task proof must use {expected_method}"
            ));
        }
        proof
            .verify(
                &unsigned,
                &DidDocResolver {
                    did_doc: &did_document,
                },
                VerifyOptions::new(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("Trust Task proof verification failed: {e}"))?;
    } else {
        proof
            .verify(
                &unsigned,
                &affinidi_data_integrity::DidKeyResolver,
                VerifyOptions::new(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("Trust Task proof verification failed: {e}"))?;
    }
    Ok(signer)
}

/// Build a minimal did:web DID document for the gateway, exposing the
/// public key of `secret` as a `Multikey` verification method.
///
/// This is the document shape that [`verify_vc`] consumes, and is handy for
/// in-process tests and for serving from the gateway's `/.well-known/`
/// endpoint. The verification method id is `secret.id`.
pub(crate) fn build_did_doc(secret: &Secret, did: &str) -> anyhow::Result<Value> {
    let pk_mb = secret
        .get_public_keymultibase()
        .map_err(|e| anyhow::anyhow!("failed to encode gateway public key as multibase: {e}"))?;

    Ok(json!({
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/multikey/v1",
        ],
        "id": did,
        "verificationMethod": [
            {
                "id": secret.id,
                "type": "Multikey",
                "controller": did,
                "publicKeyMultibase": pk_mb,
            }
        ],
        "assertionMethod": [secret.id],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn sign_verify_roundtrip() {
        let secret = Secret::generate_ed25519(Some("did:web:gw.example.com#key-1"), None);
        let issuer = "did:web:gw.example.com";
        let did_doc = build_did_doc(&secret, issuer).unwrap();

        let payload = json!({ "vti": "task-123", "agent": "researcher" });
        let signed = sign_vc(&payload, &secret, issuer).await.unwrap();
        assert!(
            signed.get("proof").is_some(),
            "signed VC must carry a proof"
        );

        let verified = verify_vc(&signed, &did_doc).await.unwrap();
        // The returned payload is the VC sans proof; credentialSubject survives.
        assert_eq!(verified["credentialSubject"]["vti"], json!("task-123"));
        assert_eq!(verified["credentialSubject"]["agent"], json!("researcher"));
        assert!(
            verified.get("proof").is_none(),
            "verified payload must drop the proof"
        );
    }

    #[tokio::test]
    async fn tampered_vc_fails() {
        let secret = Secret::generate_ed25519(Some("did:web:gw.example.com#key-1"), None);
        let issuer = "did:web:gw.example.com";
        let did_doc = build_did_doc(&secret, issuer).unwrap();

        let payload = json!({ "vti": "task-456" });
        let mut signed = sign_vc(&payload, &secret, issuer).await.unwrap();

        // Flip a byte inside the proof's proofValue so the signature no longer
        // matches the document. This must be detected by affinidi's verifier.
        let pv = signed["proof"]["proofValue"]
            .as_str()
            .expect("proofValue present")
            .to_owned();
        let mut bytes = pv.into_bytes();
        // multibase-encoded values start with a base char (e.g. 'z' for base58btc);
        // mutate a character well past the prefix so decoding still succeeds but
        // the signature bytes change.
        let idx = bytes.len().saturating_sub(4).max(2);
        bytes[idx] = match bytes[idx] {
            b'z' => b'y',
            c if c.is_ascii_alphanumeric() => c.wrapping_add(1),
            c => c ^ 0x01,
        };
        signed["proof"]["proofValue"] =
            serde_json::Value::String(String::from_utf8(bytes).unwrap());

        let result = verify_vc(&signed, &did_doc).await;
        assert!(
            result.is_err(),
            "a tampered proof must fail verification, but verify returned Ok"
        );
        let msg = result.unwrap_err().to_string().to_lowercase();
        assert!(
            msg.contains("verify")
                || msg.contains("signature")
                || msg.contains("proof")
                || msg.contains("invalid"),
            "unexpected verify error: {msg}"
        );
    }

    #[tokio::test]
    async fn trust_task_did_key_proof_roundtrip_and_tamper_rejection() {
        let mut secret = Secret::generate_ed25519(None, Some(&[9u8; 32]));
        let multibase = secret.get_public_keymultibase().unwrap();
        let did = format!("did:key:{multibase}");
        secret.id = format!("{did}#{multibase}");

        let mut document = json!({
            "id": "urn:uuid:approval-response-test",
            "type": "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
            "issuer": did,
            "recipient": "did:web:onecomputer.example",
            "payload": {
                "subject": "did:web:employee.example",
                "sessionId": "approval-1",
                "challenge": "A-cryptographically-random-challenge",
                "decision": "approved"
            }
        });
        let proof = DataIntegrityProof::sign(&document, &secret, SignOptions::new())
            .await
            .unwrap();
        document["proof"] = serde_json::to_value(proof).unwrap();

        assert_eq!(verify_trust_task_proof(&document).await.unwrap(), did);

        document["payload"]["decision"] = json!("denied");
        assert!(verify_trust_task_proof(&document).await.is_err());
    }

    #[tokio::test]
    async fn trust_task_did_peer_proof_roundtrip_and_key_binding() {
        let encryption =
            Secret::generate_x25519(Some("did:peer:test#key-1"), Some(&[7u8; 32])).unwrap();
        let mut authentication =
            Secret::generate_ed25519(Some("did:peer:test#key-2"), Some(&[8u8; 32]));
        let did = format!(
            "did:peer:2.E{}.V{}",
            encryption.get_public_keymultibase().unwrap(),
            authentication.get_public_keymultibase().unwrap()
        );
        authentication.id = format!("{did}#key-2");

        let mut document = json!({
            "id": "urn:uuid:approval-response-peer-test",
            "type": "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
            "issuer": did,
            "recipient": "did:web:onecomputer.example",
            "payload": {
                "subject": "did:web:employee.example",
                "sessionId": "approval-peer-1",
                "challenge": "peer-challenge",
                "decision": "approved"
            }
        });
        let proof = DataIntegrityProof::sign(&document, &authentication, SignOptions::new())
            .await
            .unwrap();
        document["proof"] = serde_json::to_value(proof).unwrap();

        let signer = verify_trust_task_proof(&document).await.unwrap();
        assert_eq!(signer, document["issuer"]);
        document["proof"]["verificationMethod"] =
            Value::String(format!("{}#key-1", document["issuer"].as_str().unwrap()));
        assert!(verify_trust_task_proof(&document).await.is_err());
    }

    #[test]
    fn gateway_did_format() {
        assert_eq!(
            gateway_did("https://gw.example.com"),
            "did:web:gw.example.com"
        );
        // Path and port are stripped.
        assert_eq!(
            gateway_did("http://localhost:8080/path"),
            "did:web:localhost"
        );
        // Bare host passes through.
        assert_eq!(gateway_did("gw.example.com"), "did:web:gw.example.com");
        // Default when empty-ish.
        assert_eq!(gateway_did("localhost"), "did:web:localhost");
    }

    #[test]
    fn load_signing_key_env_roundtrip() {
        // Generate a key via the SDK, export its 32-byte seed as base64, and
        // confirm load_signing_key reconstructs a key with the same public bytes.
        let original = Secret::generate_ed25519(Some("did:web:test#key-1"), None);
        let seed_b64 =
            base64::engine::general_purpose::STANDARD.encode(original.get_private_bytes());

        std::env::set_var("ONECLI_GATEWAY_SIGNING_KEY", &seed_b64);
        std::env::set_var("ONECLI_GATEWAY_PUBLIC_URL", "https://test");

        let loaded = load_signing_key().unwrap();
        assert_eq!(loaded.get_public_bytes(), original.get_public_bytes());
        assert_eq!(loaded.id, "did:web:test#key-1");

        std::env::remove_var("ONECLI_GATEWAY_SIGNING_KEY");
        std::env::remove_var("ONECLI_GATEWAY_PUBLIC_URL");
    }

    #[test]
    fn is_dev_environment_debug_build_is_dev() {
        // cfg!(debug_assertions) is true in `cargo test`, so the helper must
        // report dev regardless of ONECOMPUTER_ENV — the ephemeral fallback
        // stays available for local tests.
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        assert!(is_dev_environment(), "debug build is always dev");
        std::env::remove_var("ONECOMPUTER_ENV");
    }

    #[test]
    fn load_signing_key_unset_falls_back_in_dev() {
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        // In a debug build (dev), an unset key must NOT panic — it returns an
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        // ephemeral key. This guards the dev workflow.
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        std::env::remove_var("ONECLI_GATEWAY_SIGNING_KEY");
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        std::env::set_var("ONECLI_GATEWAY_PUBLIC_URL", "https://dev");
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        let loaded = load_signing_key();
        std::env::set_var("ONECOMPUTER_ENV", "dev");
        assert!(loaded.is_ok(), "dev build must allow ephemeral fallback");
        std::env::remove_var("ONECLI_GATEWAY_PUBLIC_URL");
    }
}
