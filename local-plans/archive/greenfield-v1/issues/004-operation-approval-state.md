# 004: implement durable operations and fixture approval

Status: `complete`

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

- [x] Valid allow and signed bound approve can issue one lease.
- [x] Deny, expiry, wrong issuer/key/audience/tenant/subject,
  wrong digest/decision/nonce, mutation, malformed proof, and replay issue zero
  leases.
- [x] Concurrent approve/deny/expire/lease attempts produce one legal
  terminal path and at most one lease.
- [x] Expiry and abandoned-lease recovery preserve durable truth across the
  synchronous fixture lifecycle.
- [x] Direct database status mutation without verified proof cannot issue a
  lease.
- [x] Logs and evidence exclude signing seeds, full proofs, secrets, and raw
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

The product-visible fixture lifecycle is implemented on 2026-07-19. It binds a
signed decision to issuer, key, tenant, subject, audience, operation digest,
decision, nonce, and expiry; compare-and-swap lease issuance limits concurrent
approval retries to one execution; receipts are unique; direct status mutation
without a verified approval record cannot issue a lease; expiry and abandoned
leases recover fail closed.

This issue is complete for the accepted synchronous signed-fixture approval
contract. General cancellation for a real Microsoft operation is explicit in
replacement Issue 008; durable physical task delivery/outbox/retry is explicit
in Issue 009. Those are product integrations over this contract, not reasons to
keep the foundational fixture issue indefinitely open.

### Human product acceptance

Accepted by the product owner on 2026-07-20. The user completed the approval
journey and verified that the bound operation reached `completed`, displayed
the expected execution receipt, and stated that it was approved, executed once,
and recorded. This sign-off is complete and does not need to be repeated.
