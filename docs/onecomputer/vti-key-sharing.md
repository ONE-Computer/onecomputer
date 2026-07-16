# VTI decision-VC key sharing (ONE-56 / ONE-58)

## What

`decideApproval` (`packages/api/src/services/approval-service.ts`) signs the
manager's approve/deny decision as a W3C VC 2.0 with an `eddsa-jcs-2022` Data
Integrity proof (`packages/api/src/lib/vti-credential-signer.ts`). The signed
VC is persisted on `approval_requests.context._vti.decision`.

ONE-56 adds two verification gates that re-derive the issuer public key from
the same seed:

1. **Verify-on-write** — `decideApproval` re-verifies the just-signed VC before
   persisting it. Failure is fail-closed (throw, no broken signature stored).
2. **Verify-on-read** — `GET /v1/approvals/:id` (and the cross-org
   `GET /v1/internal/approvals/:id`) re-verify the persisted VC and return a
   `vtiVerified` flag. A tampered row reads `vtiVerified=false`.

## Key sharing requirement

Both gates call `loadSigningKey()`, which reads:

- `ONECLI_GATEWAY_SIGNING_KEY` — base64 of a 32-byte Ed25519 seed.
- `ONECLI_GATEWAY_PUBLIC_URL` — base URL; the host becomes the `did:web:<host>`
  issuer id.

**These MUST be set identically on the API process and the gateway process**
for verify-on-read to resolve the same public key the signer used. When
`ONECLI_GATEWAY_SIGNING_KEY` is unset, `loadSigningKey()` generates an
**ephemeral** key per call — a VC signed under one ephemeral key cannot be
re-verified later (the row reads `vtiVerified=false` with a key-mismatch
reason). This is correct fail-closed behavior, but it means verifiability is
not durable across restarts unless the seed is pinned.

## Local dev

`.env` pins a stable `ONECLI_GATEWAY_SIGNING_KEY` + `ONECLI_GATEWAY_PUBLIC_URL`
so the API signs and re-verifies with the same key across restarts. The
gateway must be started with the same env vars (or read the same `.env`) for
cross-process verification to hold — though ONE-56's verify-on-read runs
entirely on the API side, so for the API-only proof the gateway key is not
exercised.

## Caveats

- The verify-on-read key is loaded fresh per request. With a pinned seed this
  is deterministic and cheap (one base64 decode + Ed25519 public-key derive).
- The Rust gateway's `vti_signer::verify_vc` is **not** wired into the
  approval-poll path (`approval_poll.rs` reads only the DB status). Wiring
  gateway-side verification of the API-signed VC is a follow-up — the
  signature is produced and verified on the API side today.

## Fail-closed on unset key in non-dev (ONE-58)

The ephemeral fallback is **dev-only**. In non-dev environments an unset
`ONECLI_GATEWAY_SIGNING_KEY` is a fatal misconfiguration: signatures would not
persist across restarts, so every restart rotates the key and all
previously-signed VCs read `vtiVerified=false`. The gateway panics at startup
(`vti_signer::load_signing_key` via `is_dev_environment()`); the API signer
throws at call time (`loadSigningKey` via `isDevEnvironment()`). Both gate on
either a debug build / `NODE_ENV=development`, OR `ONECOMPUTER_ENV` being
unset / `dev` / `local` / `development`.

**Acceptance criteria (from ONE-58):**

1. In production/staging builds, startup panics if
   `ONECLI_GATEWAY_SIGNING_KEY` is unset. ✓ (Rust `panic!` + TS `throw`)
2. Dev builds still allow the ephemeral fallback with a visible warning. ✓
3. Deployment docs state the key must be sourced from KMS / sealed-secret. ✓
4. Test: unset key in prod-mode build, assert process exits non-zero with a
   clear message. ✓ (`is_dev_environment_debug_build_is_dev`,
   `load_signing_key_unset_falls_back_in_dev` in Rust;
   `loadSigningKey fail-closed gate` suite in TS.)

### Generating the key

Generate once, store in a secret manager / KMS / sealed-secret, and inject
identically into both the API and gateway process environments:

```bash
head -c 32 /dev/urandom | base64
```

The output is a base64-encoded 32-byte Ed25519 seed. Set it as
`ONECLI_GATEWAY_SIGNING_KEY` and pair it with
`ONECLI_GATEWAY_PUBLIC_URL` (the host becomes the `did:web:<host>` issuer id).
**Never commit the key.** Rotate by generating a new seed, updating both
processes, and re-signing outstanding VCs (or accepting that pre-rotation VCs
will read `vtiVerified=false` until re-signed).

### Verifying the gate locally

```bash
# Dev build: ephemeral fallback allowed (warning logged).
unset ONECLI_GATEWAY_SIGNING_KEY
cargo test -p gateway load_signing_key_unset_falls_back_in_dev

# Simulate prod in a release build: ONECOMPUTER_ENV=production makes
# is_dev_environment() false even in a debug build.
ONECOMPUTER_ENV=production cargo run -p gateway   # panics at startup
```
