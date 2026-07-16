# OneComputer VTI / Affinidi integration seam

Date: 2026-06-21  
Phase: P5 — VTI/Affinidi integration seam  
Status: implemented for controlled-pilot mock sidecar; ready for Affinidi SDK/sidecar handoff

## Executive summary

P5 adds a narrow trust-verifier seam to the OneComputer Access Gateway. The gateway can now delegate grant verification to an external verifier backend using `ONECOMPUTER_VERIFIER_BACKEND=affinidi-vti` and `ONECOMPUTER_EXTERNAL_VERIFIER_URL`.

This is intentionally **not** a DIY VTI implementation. OneComputer keeps the gateway lean: it routes requests, enforces app registry state, checks normalized grant constraints, injects origin tokens, and writes audit/evidence events. Affinidi/VTI or a sidecar owns DID, VC, DIDComm, policy signature, selective disclosure, and cryptographic verification.

## Why this seam matters

Before P5, OneComputer could only validate local HMAC grants. That was enough for a sandbox proof but not enough for a CISO-grade governed AI computer platform. P5 creates the replaceable boundary where an enterprise trust fabric can answer:

- Which DID / user / agent / runtime is requesting access?
- Which VTC / policy community authorized the request?
- Which signed policy artifact was used?
- Which app, runtime, data class, method, and purpose are allowed?
- Was the proof checked by a trusted VTA / verifier rather than by gateway-local mock crypto?

## Runtime configuration

The Access Gateway now supports these verifier backends:

| Backend                  | Intended use                            | Crypto owner          |
| ------------------------ | --------------------------------------- | --------------------- |
| `local-hmac`             | Local smoke tests and developer sandbox | OneComputer mock only |
| `http` / `external-http` | Generic verifier service contract       | External verifier     |
| `affinidi-vti`           | Affinidi/VTI sidecar or SDK service     | Affinidi/VTI sidecar  |

Environment variables:

```bash
ONECOMPUTER_VERIFIER_BACKEND=affinidi-vti
ONECOMPUTER_EXTERNAL_VERIFIER_URL=http://127.0.0.1:45998/verify
ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN=<sidecar-auth-token>
ONECOMPUTER_EXTERNAL_VERIFIER_TIMEOUT_MS=2500
```

`ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN` is optional but recommended for any non-local sidecar. It is sent as a bearer token to the verifier. Secrets must be supplied by a secret manager / gateway injection path, not committed to docs or repo.

## External verifier request contract

The gateway sends a single POST to the configured verifier URL.

```json
{
  "schema": "onecomputer.verifier.request.v1",
  "token": "<opaque grant or presentation token>",
  "audience": "onecomputer.access-gateway",
  "appId": "p5-external-verifier-smoke",
  "request": {
    "method": "GET",
    "path": "/app/p5-external-verifier-smoke/",
    "requestId": "<gateway-correlation-id>"
  }
}
```

Headers:

```http
content-type: application/json
x-onecomputer-request-id: <gateway-correlation-id>
authorization: Bearer <ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN>   # if configured
```

## External verifier response contract

The external verifier must return a normalized OneComputer access grant after it verifies any Affinidi/VTI proof. The gateway does not need to know whether the original input was a VC presentation, DIDComm task, signed policy artifact, or bridge-delivered handle.

Allow response:

```json
{
  "ok": true,
  "payload": {
    "schema": "onecomputer.access.grant.v1",
    "iss": "did:example:onecomputer:vta:local",
    "sub": "terence",
    "aud": "onecomputer.access-gateway",
    "appId": "p5-external-verifier-smoke",
    "apps": ["p5-external-verifier-smoke"],
    "policyHash": "sha256:p5-policy-hash",
    "purpose": "governed-app-access",
    "constraints": {
      "apps": ["p5-external-verifier-smoke"],
      "methods": ["GET", "POST", "HEAD"]
    },
    "iat": 1782048000,
    "nbf": 1782048000,
    "exp": 1782051600,
    "nonce": "<unique-proof-or-grant-nonce>"
  }
}
```

Deny response:

```json
{
  "ok": false,
  "reason": "grant_bad_signature"
}
```

Gateway-side validation still checks:

- normalized schema is `onecomputer.access.grant.v1` for external verifier responses;
- audience matches the gateway;
- issuer, subject, purpose, nonce exist;
- expiry and not-before timestamps are valid;
- target app is allowed by the grant;
- policy hash matches the App Passport / registry policy hash;
- method constraints allow the requested HTTP method;
- app is active and user is not revoked.

## Affinidi / VTI sidecar responsibilities

The sidecar or SDK adapter should own these responsibilities:

1. Verify DID / VTA / VTC trust chain.
2. Validate credential presentation and policy signature.
3. Resolve opaque connector handles without exposing raw IDs to OneComputer.
4. Check default-deny consent and policy state.
5. Normalize allowed proof into `onecomputer.access.grant.v1`.
6. Return only non-secret, non-PII, policy-relevant fields to the gateway.
7. Emit its own signed evidence or Trust Task references for deeper audit.

OneComputer should not duplicate the sidecar’s crypto. The gateway only validates the normalized gateway contract and records its access decision.

## DIDComm / message-bridge integration pattern

For future DIDComm / message bridge integrations:

```text
External platform connector
  -> raw platform ID / phone / email / tenant credential stays here
  -> mints or resolves opaque handle
  -> emits DIDComm / Trust Task / consent proof
  -> Affinidi/VTI sidecar verifies proof and policy
  -> OneComputer verifier contract returns normalized access grant
  -> Access Gateway enforces app policy and writes evidence chain
```

The connector bridge should never pass raw phone numbers, Slack IDs, Teams IDs, mailbox IDs, or platform OAuth credentials through the OneComputer app registry or gateway logs. The gateway should see opaque subject handles, DIDs, grant purposes, app IDs, policy hashes, and evidence references only.

## Opaque-handle connector custody model

| Layer                                          |      May hold raw connector secrets / IDs? | What OneComputer sees                                               |
| ---------------------------------------------- | -----------------------------------------: | ------------------------------------------------------------------- |
| Platform connector / mailroom / message bridge |                        Yes, tightly scoped | Opaque handle + evidence reference                                  |
| Affinidi/VTI sidecar                           | Maybe, only if needed for proof resolution | Normalized verified grant                                           |
| OneComputer control plane                      |                                         No | App Passport, DID/handle, policy hash, risk tier                    |
| Access Gateway                                 |                                         No | Normalized grant claims, target app, method, request ID             |
| App runtime                                    |                                         No | `x-onecomputer-user`, `x-onecomputer-app-id`, scoped origin request |

This reduces exfiltration blast radius and makes CISO review simpler: raw identifiers and credentials remain in the connector custody zone, not in arbitrary app runtimes.

## Failure modes

| Failure                                 | Gateway result | Reason code                         |
| --------------------------------------- | -------------: | ----------------------------------- |
| Verifier URL missing                    |            403 | `external_verifier_url_missing`     |
| Verifier unreachable / timeout          |            403 | `external_verifier_unreachable`     |
| Verifier HTTP error                     |            403 | `external_verifier_http_error`      |
| Verifier deny                           |            403 | verifier-provided reason            |
| Verifier returns no payload             |            403 | `external_verifier_payload_missing` |
| Verifier returns non-normalized payload |            403 | `grant_schema_required`             |
| Grant policy does not match app policy  |            403 | `grant_policy_hash_mismatch`        |

Timeout default is 2.5 seconds. For production, the verifier should be close to the gateway network path and expose health/latency metrics.

## Smoke proof

Command:

```bash
./examples/node/access-gateway/scripts/smoke-external-verifier.sh
```

Observed result:

```text
external_verifier_smoke_passed appId=p5-external-verifier-smoke good=200 wrong_policy=403 verifier_deny=403 passport=200 backend=affinidi-vti
```

## Review-gate conclusion

P5 is enough to lift OneComputer from “local mocked auth” to “trust fabric ready.” It is still a controlled-pilot seam, not full production Affinidi integration. The next phase should make this visible in the CISO console: app passports, grants, risk tiers, verifier backend, policy hashes, audit chains, pause/revoke, and evidence export.
