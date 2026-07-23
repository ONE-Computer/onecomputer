# ADR-005: Use OpenVTC Task Consent without transferring execution authority

Status: proposed after upstream qualification

Date: 2026-07-21

## Decision

Use the upstream Trust Tasks `task-consent/request/0.1` and
`task-consent/decision/0.1` contract for physical approval. Do not use
`auth/step-up` as the authorization for a governed Microsoft operation.

ONEComputer Control remains the executor in the Trust Tasks sense:

- Control creates and durably stores the exact governed operation.
- Control derives the approval payload digest from the exact operation it may
  execute and authors the safe effects shown to the person.
- An enrolled OpenVTC approver signs an explicit `approve` or `deny` decision
  with an `eddsa-jcs-2022` Data Integrity proof.
- Control verifies that proof, resolves the proven signer, checks current
  enrollment and ownership policy, and binds the echoed challenge and payload
  digest to the live operation.
- Only Control consumes the one-time challenge and creates the exact execution
  lease. OpenVTC transport, a browser, LiteLLM, and the Microsoft connector
  cannot change operation truth or issue a lease.

The request and decision use the upstream framework `0.2` envelope with the
published task-consent `0.1` type URIs. They are version-pinned because the
task-consent specifications are currently Draft.

## Why task consent, not AAL step-up

OpenVTC `auth/step-up` proves that a VTA session reached a higher authentication
assurance level. Its response binds a subject, session, challenge, and granted
ACR. It does not bind the exact Microsoft tool arguments, resource version, or
ONEComputer operation digest.

Task consent is explicitly an authorization for one pending task. Its decision
echoes a challenge and payload digest, requires a proof, treats timeout or
dismissal as non-approval, and requires the executor to re-derive the digest,
check the prior-state pin, and consume a one-use grant at execution. Those are
the semantics Issue 009 needs.

## Upstream implementation constraint

The official VTA service already implements task consent for tasks dispatched
and executed by that VTA. The official iOS agent receives VTA-pushed requests
through a mediator and posts its signed decision to the configured VTA's
`/api/trust-tasks` endpoint. The VTA then stores the approval and issues its own
single-use grant.

The VTA dispatcher is a compiled registry of VTA-native task handlers. It does
not currently expose an external-executor API through which ONEComputer can
submit an arbitrary operation, receive the original signed decision, and retain
grant authority. Deploying an unmodified VTA as a generic approval service
would therefore violate the ownership boundary above.

The transport integration must consequently do one of the following without
changing the signed task-consent contract:

1. add an upstream-compatible external-executor profile to the official mobile
   agent and deliver decisions directly to Control; or
2. make the ONEComputer OpenVTC adapter implement the subset of executor,
   enrollment, HTTPS Trust Tasks, and mediator behavior the official mobile
   agent expects.

This choice is separate from proof verification and durable operation truth.
The verifier, task/outbox schema, replay rules, and evidence model are common to
both.

## Rejected shortcuts

- Treating a VTA AAL2 session or mutable approval status as authorization.
- Polling a VTA's task status and trusting `granted` without receiving and
  verifying the signed decision in Control.
- Using the current browser fixture button or local HMAC as physical evidence.
- Letting the phone, browser extension, VTA, mediator, LiteLLM, or MCP server
  issue the ONEComputer execution lease.
- Sending raw Microsoft content, access tokens, device private keys, or an APNs
  token in the approval payload.

## Qualification gate

Before physical acceptance, pin the exact upstream revisions, establish the
approver DID enrollment ceremony, prove request delivery and signed decision
return across restart/reconnect, and run the negative verification matrix from
Issue 009. If the stock mobile app cannot support an external executor without
a bespoke fork, the product owner must explicitly choose an upstream
contribution, a bounded adapter compatibility layer, or the official browser
agent as the first physical surface.
