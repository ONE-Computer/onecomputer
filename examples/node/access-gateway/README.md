# OneComputer Access Gateway

Minimal CISO-readiness gateway proof.

Responsibilities:

- validate a signed OneComputer grant token;
- check app registry status and expiry;
- proxy allowed traffic to the origin app;
- inject `X-OneComputer-Origin-Token` so direct origin URLs can be blocked;
- emit access-decision audit logs.

This is a proof gateway. Replace the HMAC grant with enterprise OIDC/IAM/VTI before production.

## Registry backends

The gateway supports two registry backends:

- `ONECOMPUTER_REGISTRY_BACKEND=env` (default): reads `ONECOMPUTER_REGISTRY_JSON` and mutates state in memory. This is only for local demos.
- `ONECOMPUTER_REGISTRY_BACKEND=dynamodb`: reads and writes app metadata plus audit events in `ONECOMPUTER_CONTROL_TABLE`. This is the P1 durable-control-plane path.

DynamoDB table shape for the current POC:

```text
App metadata:
  pk = APP#<appId>
  sk = METADATA

Audit event:
  pk = AUDIT#<appId-or-GLOBAL>
  sk = <ISO timestamp>#<uuid>
```

Required app metadata fields: `appId`, `originUrl`, `originToken`, `status`, `allowedUsers`, and `revokedUsers`. Do not store raw user secrets, grant tokens, or origin credentials in audit details. The gateway scrubs obvious secret-like fields before writing audit entries, but callers should still avoid sending secrets in event detail.

## App Passport and VTI-shaped grants

The gateway accepts two grant payloads:

- Legacy HMAC payload: `{ "sub": "user", "apps": ["app"], "exp": 123 }`.
- VTI-shaped local mock payload: `schema=onecomputer.access.grant.v1` with issuer, subject, audience, app, policy hash, purpose, constraints, nonce, and expiry.

Generate a VTI-shaped local grant for the mock verifier:

```bash
ONECOMPUTER_GATEWAY_GRANT_SECRET=dev-secret \
ONECOMPUTER_GRANT_SCHEMA=vti \
ONECOMPUTER_POLICY_HASH=sha256:policy-hash \
node ../../../scripts/onecomputer/generate-gateway-grant.mjs terence my-app 3600
```

Create an App Passport draft:

```bash
node ../../../scripts/onecomputer/create-app-passport.mjs \
  --app-id=my-app \
  --owner-did=did:example:onecomputer:user:terence \
  --app-did=did:example:onecomputer:app:my-app \
  --runtime=node \
  --data-classification=confidential \
  --risk-tier=medium \
  --allowed-users=terence
```

Local negative-path smoke:

```bash
./scripts/smoke-vti-grants.sh
```

The current verifier backend is `ONECOMPUTER_VERIFIER_BACKEND=local-hmac`. This is deliberately a mock seam for the POC, not DIY VTI cryptography. A future Affinidi/VTI verifier should replace this backend without changing app proxy policy semantics.
