# 013: complete agent-triggered OpenVTC approval and audit UX

Status: `verification` (human approve/resume/audit path accepted; denial and restart remain)

Gate: L
Depends on: 012 and completion of 009 verification
Unblocks: 014

## Outcome

When the real agent proposes a protected Microsoft action, the user sees one
clear pending request in ONEComputer, verifies and approves or denies it with a
single device-backed gesture, and can inspect an understandable end-to-end
audit trail from chat intent to provider receipt.

## In scope

- Close the deferred Issue 009 physical denial and restart checks.
- Apply the same OpenVTC path to selected Mail, Calendar, OneDrive, and Teams
  writes rather than special-casing OneDrive deletion.
- Notify and deep-link the user from the agent/ONEComputer UI to the exact
  pending governed operation.
- Present a safe human summary with action, target, requester agent/workspace,
  policy reason, expiry, and operation binding before the signing gesture.
- Use one WebAuthn/OpenVTC device prompt for approve or deny; passive viewing
  must not prompt or authorize.
- Resume the originating chat with approved, denied, expired, failed, unknown,
  or completed status.
- Add an owned activity/audit view correlating identity, agent, policy version,
  MCP tool, operation digest, signed decision, lease, provider result, and
  receipt without exposing secrets or unrestricted Microsoft content.
- Preserve at-most-once execution and honest unknown outcomes across retries
  and restart.

## Out of scope

- Mobile push delivery, production SIEM export, a second approval factor,
  multi-approver quorum, or broad evidence-retention administration.

## Required implementation

- Pending-operation notification/deep-link and chat correlation contract.
- One-gesture device-backed decision flow using the Issue 009 verifier.
- Human-readable audit projection over Control-owned immutable records.
- Terminal-state callback/polling behavior that never repeats the mutation.
- Explicit retention/redaction rules for the MVP evidence view.

## Required verification

- [ ] Physical approve and deny each require one signing prompt and bind to the
  exact agent-requested operation; passive view or bearer/session access cannot
  authorize it.
- [ ] Microsoft is called zero times before approval, once after one valid
  approval, and zero times after denial, expiry, invalid signature, or replay.
- [ ] The originating conversation and activity view show the same honest
  terminal state and correlated redacted evidence.
- [ ] Browser refresh/reconnect, workspace restart, Control/adapter restart,
  duplicate delivery/callback, concurrent retry, and provider unknown outcome
  preserve one durable legal path.
- [ ] Wrong issuer/key/version/audience/tenant/subject/agent/policy/digest/nonce
  or mutated operation produces zero leases.
- [ ] UI, logs, screenshots, prompts, and evidence reveal no approver private
  material, bearer/OAuth/provider credentials, or unrestricted payload.

## Evidence required

Include approve/deny screen recordings or safe screenshots, signed-decision
matrix, operation/lease/provider counters, chat and activity correlation,
restart/replay/concurrency results, redaction inspection, and cleanup.

## Stop conditions

- Approval requires trusting the agent client, LiteLLM, a browser session, or a
  mutable vendor status instead of the verified signed decision.
- The audit view would become an execution authority or claim an unknown
  provider outcome as success/failure.

## Completion record

Implementation completed on 2026-07-22 for the demo path. Agent-originated MCP
calls wait on the Control-owned operation while the existing OpenVTC browser
approver signs the exact digest. Approval executes through the one-time lease;
denial, expiry, or failure returns a terminal tool error without retrying the
provider mutation. Activity now lists durable operation history and the
operation drawer projects the correlated redacted event trail, policy binding,
decision, lease, and receipt. Automated wait/resume and existing OpenVTC
signature/replay/concurrency suites pass. Human denial, restart, and
same-browser single-gesture durability verification remain open. Replacement
enrollment is expected to require a setup gesture plus the decision gesture;
an already-enrolled matching browser must require only the decision gesture.

The Microsoft 365 surface expansion also requires proving that the generic
operation binding, safe summary, signed decision, one-time lease, provider
receipt, and audit projection work for at least one non-OneDrive protected
write (preferably a disposable Calendar event or Teams reply). Sensitive email
or message bodies must not be copied into the audit view.

The product owner completed the real-agent approval path on 2026-07-22. The
agent proposed the protected OneDrive deletion, Control created one pending
operation, ONEComputer surfaced the request, the browser device signed the
exact approval, the provider mutation executed once, the waiting agent observed
the completed result, and the owned UI showed the correlated audit trail. This
closes the human positive-path portion of this issue. Physical denial, a
same-browser approval after reload/reconnect, workspace and Control/adapter
restart durability, and confirmation that those paths retain a single signing
gesture remain required before Issue 013 can close.

Automated verification on 2026-07-22 extended the accepted OneDrive path to a
generic protected Calendar write. Before approval the connector call count is
zero; the signed OpenVTC request contains only the safe action summary and
operation binding, not the event subject or body. One valid approval executes
the exact Calendar tool once, a concurrent replay returns the same terminal
operation without a second connector call, and the owned audit projection
remains redacted. The full human denial and same-profile/restart durability
checks remain deferred rather than waived.
