# 009: integrate OpenVTC device-backed approval and durable evidence

Status: `verification` (remaining denial/restart checks paused by product owner)

Gate: H
Depends on: 008
Unblocks: 010 implementation checkpoint; final verification unblocks 013

## Outcome

A device-verified OpenVTC browser agent can approve or deny the exact governed
Microsoft operation, while ONEComputer Control verifies the signed decision,
owns durable operation truth, issues at most one execution lease, and records a
redacted audit/evidence timeline. The same task and decision documents remain
transportable to the official iOS/VTA profile in a later issue.

## In scope

- Version the OpenVTC task and signed-decision envelopes, configured issuer/key
  trust, audience, nonce, expiry, and safe browser summary.
- Implement the OpenVTC adapter/verifier behind the existing approval contract.
- Add a durable delivery outbox and idempotent HTTPS polling/decision handling.
- Persist safe task, delivery, verified decision, operation, lease, receipt, and
  evidence references in ONEComputer PostgreSQL.
- Exercise physical approve and deny with the user's WebAuthn-capable browser
  and platform authenticator.
- Surface delivery, approval, denial, expiry, execution, and receipt states in
  the owned UI.
- Keep the HMAC fixture explicitly test-only; the deployed browser profile uses
  a stable Control Ed25519 executor key and a distinct device approver key.

## Out of scope

- Giving OpenVTC audit authority, storing device private material in Control,
  sending raw Microsoft content to the approval surface, broad mobile/VTA
  deployment, or adding new Microsoft operations.

## Required verification

- [ ] Browser approve and deny produce server-received, cryptographically
  valid decisions bound to the exact existing operation digest.
- [ ] Wrong issuer/key/version/audience/tenant/subject/digest/decision/nonce,
  expiry, replay, duplicate, out-of-order delivery, and operation mutation issue
  zero leases.
- [ ] Browser reload/reconnect, duplicate delivery, Control restart, and adapter
  restart preserve one durable legal terminal path.
- [ ] One valid physical approval can issue at most one exact execution lease.
- [ ] Browser, API, database edits, LiteLLM, and OpenVTC transport status cannot
  substitute for a verified decision.
- [ ] Browser display, logs, screenshots, and evidence contain no private device
  material, tokens, or unrestricted sensitive payload.

## Evidence required

Include protocol/version record, device/app build, safe task examples, signed
decision verification matrix, outbox/delivery/restart matrix, operation/lease
correlation, redacted UI timeline, and cleanup result.

## Stop conditions

- The partner contract, stable executor key, WebAuthn PRF, or device verifier
  required for signed proof is unavailable.
- Passing would require trusting a user assertion or mutable approval status.
- OpenVTC must become the source of truth for ONEComputer audit or execution.

## Completion record

Issue 008 completed human review on 2026-07-21. Upstream qualification began on
2026-07-21 and is recorded in
`infra/issue-009/upstream-qualification-2026-07-21.md` and ADR-005.

The qualification selected Trust Tasks `task-consent` rather than VTA AAL
step-up. It also found that the stock iOS agent posts decisions to a VTA that
owns and executes VTA-native tasks; an unmodified VTA is not a generic external
approval service and cannot replace Control's signed-decision verification.

The first common adapter slice now implements the upstream salted/type-bound
payload digest, recipient-specific signed request construction, strict
`did:key` Ed25519 `eddsa-jcs-2022` decision verification, live enrollment and
requester-exclusion checks, and negative binding/time/proof tests. At that
qualification checkpoint it deliberately stopped before delivery or lease
issuance, pending an explicit browser-versus-iOS surface choice.

The browser agent was selected as the first physical surface. ADR-006 defines
the bounded Trust Tasks HTTPS external-executor profile. PostgreSQL and the
memory qualification store now persist one active approver, hashed transport
mapping, signed task, delivery outbox/attempts, expiry/revocation, verified
decision evidence, and the operation approval in one transaction. The browser
enrollment ceremony, session-bound enrollment APIs, hashed bearer inbox,
standard `/trust-tasks` decision endpoint, signed request verification, WebAuthn
PRF-wrapped approver key, and device-bound approve/deny UI are now implemented.
Automated qualification covers valid approval, denial, tampering, bearer-only
forgery, enrollment ownership, expiry, revocation, redelivery, and atomic
evidence. The legacy HMAC fixture is rejected for Microsoft 365 operations and
is not rendered as an available decision route for them. The physical Chrome
approval pass completed on 2026-07-21 and deleted the exact bound OneDrive
item. Review found avoidable friction in the first UI: viewing the signed task
and signing the decision each required a device prompt on separate pages. The
revised flow loads the signed safe task through the authenticated ONEComputer
session and performs approval or denial in the governed-operation drawer with
one WebAuthn signing gesture. Physical denial and restart checks remain open.

On 2026-07-21 the product owner explicitly paused those remaining checks so the
team can replace the temporary CLI test surface with a realistic conversational
agent journey. This is a sequencing exception, not acceptance: Issue 010 may
begin from the working implementation checkpoint, but the open denial and
restart checks must pass before Issue 013 can close.

On 2026-07-22 the product owner repeated the physical approval through the real
Claude Desktop agent rather than the qualification CLI. Control received and
verified the device-signed decision, issued one lease, deleted the exact bound
OneDrive item once, and exposed the correlated audit trail. During the pass the
browser lacked the local IndexedDB key matching the server-side approver DID,
so it correctly required replacement enrollment and rebound the pending task.
The enrollment flow now rolls back the server record if local key persistence
fails, preventing a half-enrolled device. A same-profile reload/restart pass and
the physical denial path remain required before this issue can close.
