# OneComputer App Passport and VTI-Shaped Grant Schema

Date: 2026-06-21
Phase: P2

## Why this exists

P1 made gateway state durable. P2 makes app access accountable: the gateway should not only ask “is this token signed?” It should ask:

- Which app/runtime is this?
- Who owns it?
- Which VTA/VTC is expected to govern it later?
- What policy hash does the grant bind to?
- What purpose and constraints were delegated?
- Is the grant scoped to the correct app and method?

This is still a local mock. It is shaped so Affinidi/VTI can replace the verifier later. We are not implementing DIDComm, VCs, or cryptographic VTA signing ourselves.

## App Passport

Schema: `onecomputer.app.passport.v1`

Fields:

```json
{
  "schema": "onecomputer.app.passport.v1",
  "appId": "task-tracker",
  "appDid": "did:example:onecomputer:app:task-tracker",
  "ownerDid": "did:example:onecomputer:user:terence",
  "vtaDid": "did:example:onecomputer:vta:local",
  "vtcId": "vtc:onecomputer:sandbox",
  "runtimeKind": "node",
  "dataClassification": "confidential",
  "riskTier": "medium",
  "allowedUsers": ["terence"],
  "policyHash": "sha256:...",
  "evidenceHash": "sha256:...",
  "passportHash": "sha256:...",
  "awsResourceArns": [],
  "status": "active"
}
```

`originToken` is intentionally not part of the safe passport response.

## VTI-shaped grant

Schema: `onecomputer.access.grant.v1`

Fields:

```json
{
  "schema": "onecomputer.access.grant.v1",
  "iss": "did:example:onecomputer:vta:local",
  "sub": "terence",
  "aud": "onecomputer.access-gateway",
  "appId": "task-tracker",
  "apps": ["task-tracker"],
  "policyHash": "sha256:...",
  "purpose": "governed-app-access",
  "constraints": {
    "apps": ["task-tracker"],
    "methods": ["GET", "POST"]
  },
  "iat": 1782040000,
  "nbf": 1782040000,
  "exp": 1782068800,
  "nonce": "uuid"
}
```

## Gateway checks

The local mock verifier currently checks:

- HMAC signature;
- expiry;
- not-before;
- audience;
- issuer present;
- subject present;
- purpose present;
- nonce present;
- app scope;
- policy hash match if the target app has a `policyHash`;
- method constraints if present;
- persistent registry status, allowed users, and revoked users.

## Verifier seam

Current backend:

```text
ONECOMPUTER_VERIFIER_BACKEND=local-hmac
```

Future backend:

```text
ONECOMPUTER_VERIFIER_BACKEND=affinidi-vti
```

The future backend should verify real VTI/Affinidi credentials and policy signatures, but return the same normalized grant decision shape to the gateway.

## Commands

Create passport:

```bash
node scripts/onecomputer/create-app-passport.mjs --app-id=task-tracker --runtime=node --allowed-users=terence
```

Create VTI-shaped local grant:

```bash
ONECOMPUTER_GATEWAY_GRANT_SECRET=... \
ONECOMPUTER_GRANT_SCHEMA=vti \
ONECOMPUTER_POLICY_HASH=sha256:... \
node scripts/onecomputer/generate-gateway-grant.mjs terence task-tracker 3600
```

Run local negative-path smoke:

```bash
cd examples/node/access-gateway
./scripts/smoke-vti-grants.sh
```
