# 009: integrate physical OpenVTC and VTA Mobile Agent

Status: `blocked`

Gate: F
Depends on: 008
Unblocks: 010

## Outcome

A real Affinidi VTA Mobile Agent on the user's iPhone approves and denies a
fixture governed operation through the production-shaped adapter, with the
server verifying the exact signed decision and preserving durable truth.

## In scope

- Reconcile and version the partner task/decision envelope, issuer/key model,
  audience, nonce, expiry, callback/poll/mediator transport, safe display, and
  push/background behavior.
- Implement the OpenVTC adapter and durable delivery outbox without exposing
  signing or transport secrets to browser/workspace.
- Use the existing Issue 004 operation and decision contracts; physical
  transport must not redefine governance state.
- Automate server prerequisites, disposable challenge creation, correlation,
  cryptographic verification, retries, cleanup, and evidence.
- Conduct bounded human-assisted iOS approve and deny cases.

## Out of scope

- Treating the local signer as physical proof, requesting private device
  material, broad mobile UI work, or executing real OneDrive delete in this
  issue.

## Required verification

- [ ] Physical approve and deny each produce a server-received, valid, bound
  signed decision for the exact fixture operation.
- [ ] Wrong issuer/key/version/audience/tenant/subject/digest/decision/nonce,
  expiry, replay, duplicate, out-of-order, and operation mutation issue zero
  leases.
- [ ] Offline/background/reconnect, duplicate delivery, callback outage,
  mediator/push failure, Control restart, and adapter restart preserve one
  durable terminal result.
- [ ] The mobile display is safe and sufficiently specific for informed action.
- [ ] Browser/API/database/native gateway cannot substitute for physical
  authority.
- [ ] Task, transport, logs, screenshots, and artifacts contain no prohibited
  private material or unrestricted sensitive payload.
- [ ] Fixture signer remains test-only and cannot be enabled in production.

## Evidence required

Include protocol/version record, physical test case IDs, app/build version,
safe challenge suffixes, server timestamps/results, cryptographic verification
matrix, transport lifecycle matrix, redaction scan, and cleanup result.

## Stop conditions

- Partner contract, public callback/mediator, push entitlement, device app, or
  trusted key material is unavailable.
- Physical proof cannot bind the existing canonical operation.
- Passing would require accepting a user assertion without server verification.

## Completion record

Not complete.
