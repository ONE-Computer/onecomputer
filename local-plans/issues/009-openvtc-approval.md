# 009: integrate OpenVTC physical approval and durable evidence

Status: `blocked`

Gate: H
Depends on: 008
Unblocks: 010

## Outcome

A real Affinidi VTA Mobile Agent can approve or deny the exact governed
Microsoft operation, while ONEComputer Control verifies the signed decision,
owns durable operation truth, issues at most one execution lease, and records a
redacted audit/evidence timeline.

## In scope

- Version the OpenVTC task and signed-decision envelopes, configured issuer/key
  trust, audience, nonce, expiry, and safe mobile summary.
- Implement the OpenVTC adapter/verifier behind the existing approval contract.
- Add a durable delivery outbox and idempotent callback/poll/mediator handling.
- Persist safe task, delivery, verified decision, operation, lease, receipt, and
  evidence references in ONEComputer PostgreSQL.
- Exercise physical approve and deny with the user's iPhone VTA Mobile Agent.
- Surface delivery, approval, denial, expiry, execution, and receipt states in
  the owned UI.
- Keep the local signer explicitly test-only and unavailable in the deployed
  physical-approval profile.

## Out of scope

- Giving OpenVTC audit authority, storing device private material, sending raw
  Microsoft content to the phone, broad mobile UI work, or adding new Microsoft
  operations.

## Required verification

- [ ] Physical approve and deny produce server-received, cryptographically
  valid decisions bound to the exact existing operation digest.
- [ ] Wrong issuer/key/version/audience/tenant/subject/digest/decision/nonce,
  expiry, replay, duplicate, out-of-order delivery, and operation mutation issue
  zero leases.
- [ ] Offline/background/reconnect, duplicate delivery, callback outage,
  mediator/push failure, Control restart, and adapter restart preserve one
  durable legal terminal path.
- [ ] One valid physical approval can issue at most one exact execution lease.
- [ ] Browser, API, database edits, LiteLLM, and OpenVTC transport status cannot
  substitute for a verified decision.
- [ ] Mobile display, logs, screenshots, and evidence contain no private device
  material, tokens, or unrestricted sensitive payload.

## Evidence required

Include protocol/version record, device/app build, safe task examples, signed
decision verification matrix, outbox/delivery/restart matrix, operation/lease
correlation, redacted UI timeline, and cleanup result.

## Stop conditions

- The partner contract, trusted key material, callback/mediator, push path, or
  physical device app required for signed proof is unavailable.
- Passing would require trusting a user assertion or mutable approval status.
- OpenVTC must become the source of truth for ONEComputer audit or execution.

## Completion record

Not complete. Blocked on Issue 008.
