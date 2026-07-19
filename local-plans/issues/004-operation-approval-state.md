# 004: implement durable operations and fixture approval

Status: `blocked`

Gate: C
Depends on: 003
Unblocks: 005

## Outcome

The owned domain persists a governed operation before returning, evaluates a
typed policy result, verifies a locally signed approval decision, and issues at
most one exact execution lease.

## In scope

- Implement operation lifecycle, policy decision records, expiry, cancellation,
  compare-and-swap transitions, execution leases, receipts, and outbox.
- Implement a test-only signing/verifying adapter using the same versioned
  decision envelope expected from OpenVTC.
- Bind issuer/key, tenant, subject, audience, operation digest, decision, nonce,
  issued/expiry time, and replay identity.
- Store proof references/hashes and safe summaries rather than private material
  or unrestricted payloads.
- Add deterministic recovery workers for expired operations, outbox retries,
  and abandoned leases.

## Out of scope

- Physical VTA transport, real provider calls, LiteLLM integration, public API,
  UI, or manual database decisions.

## Required verification

- [ ] Valid allow and signed bound approve can issue one lease.
- [ ] Deny, expiry, cancellation, wrong issuer/key/audience/tenant/subject,
  wrong digest/decision/nonce, mutation, malformed proof, and replay issue zero
  leases.
- [ ] Concurrent approve/deny/expire/cancel/lease attempts produce one legal
  terminal path and at most one lease.
- [ ] Restart at each state and outbox boundary recovers durable truth.
- [ ] Direct database status mutation without verified proof cannot issue a
  lease.
- [ ] Logs and evidence exclude signing seeds, full proofs, secrets, and raw
  sensitive payloads.

## Evidence required

Include state-transition table, authorization matrix, concurrency results,
restart matrix, replay store inspection, proof redaction scan, and migration
revision.

## Stop conditions

- Approval can be represented as a mutable status without verified proof.
- A duplicate path can issue a second execution lease.
- Recovery requires manual database edits.

## Completion record

Not complete.
