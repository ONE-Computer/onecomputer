# OneComputer Gateway Hardening Runbook

Date: 2026-06-21
Phase: P4

## What is hardened now

The Access Gateway now has controlled-pilot hardening for:

- correlation/request IDs;
- security headers;
- request body size limits;
- in-process gateway/admin rate limits;
- body-parser error handling;
- request IDs in error responses and audit/evidence events;
- `x-powered-by` disabled.

## Runtime knobs

```text
ONECOMPUTER_BODY_LIMIT=256kb
ONECOMPUTER_RATE_LIMIT_WINDOW_MS=60000
ONECOMPUTER_RATE_LIMIT_MAX=120
ONECOMPUTER_ADMIN_RATE_LIMIT_MAX=30
ONECOMPUTER_GATEWAY_ADMIN_TOKEN=<runtime secret>
ONECOMPUTER_GATEWAY_GRANT_SECRET=<runtime secret>
```

## Headers

The gateway sets:

- `x-onecomputer-request-id`
- `x-content-type-options: nosniff`
- `referrer-policy: no-referrer`
- `x-frame-options: DENY`
- `permissions-policy: camera=(), microphone=(), geolocation=()`
- `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`
- `cache-control: no-store` for `/admin` and `/app` routes

## Admin auth path

Current controlled-pilot path:

- static admin token header: `x-onecomputer-admin-token`
- token must be injected at runtime only;
- never commit or screenshot the token.

Selected production path:

1. Short term: AWS Secrets Manager/KMS or OneComputer managed secret injection for admin and origin secrets.
2. Next: signed admin grants or enterprise OIDC/IAM identity at the gateway.
3. Later: VTI/Affinidi admin capability credential from a VTA.

Static token remains acceptable only for sandbox/control-plane proof. It is not production CISO approval.

## Secrets path

Current controlled-pilot path:

- gateway secrets are env vars at runtime;
- origin tokens are still in app metadata for POC simplicity.

Selected production path:

- move admin/grant/origin secrets to AWS Secrets Manager or OneComputer managed secret injection;
- app registry should hold a secret reference, not the secret value;
- access gateway resolves secret references server-side;
- evidence and audit only record secret reference IDs or hashes, never plaintext.

## Failure and rollback

If rate limits are too strict:

1. Increase `ONECOMPUTER_RATE_LIMIT_MAX` or `ONECOMPUTER_ADMIN_RATE_LIMIT_MAX`.
2. Restart gateway.
3. Keep `ONECOMPUTER_RATE_LIMIT_WINDOW_MS` stable unless there is a measured reason.

If body limit blocks legitimate payloads:

1. Increase `ONECOMPUTER_BODY_LIMIT` from `256kb` to a bounded value.
2. Do not allow arbitrary large uploads through the gateway without a separate upload policy.

If admin token leaks:

1. Rotate runtime secret immediately.
2. Revoke sessions/grants that used it.
3. Export audit chain for affected window.
4. Mark incident in evidence pack.

If gateway misroutes or fails closed:

1. Set target app status to `paused`.
2. Restart gateway with previous image/build.
3. Verify `/health`.
4. Verify deny path and one known-good grant.

## Smoke test

```bash
cd examples/node/access-gateway
./scripts/smoke-gateway-hardening.sh
```

Expected:

```text
gateway_hardening_smoke_passed headers=ok rate_limit=429 body_limit=413 request_id=ok
```
