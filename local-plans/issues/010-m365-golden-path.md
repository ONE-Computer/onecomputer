# 010: complete the end-to-end Microsoft 365 MVP journey

Status: `blocked`

Gate: I
Depends on: 009
Unblocks: 011

## Outcome

From the managed Kasm agent, one authenticated employee uses the real model and
assigned Microsoft tools, completes bounded Mail/Calendar/OneDrive reads, and
deletes one disposable OneDrive item only after physical approval, with
at-most-once execution and a visible redacted receipt.

## In scope

- Provision uniquely named disposable tenant data for the golden path.
- Drive the journey from the preconfigured in-workspace agent, not an
  administrator script or LiteLLM UI.
- Demonstrate bounded Outlook Mail, Calendar, and OneDrive reads.
- Request the one protected OneDrive delete, approve and deny separate attempts
  through the physical VTA flow, and show operation/evidence status in Web.
- Correlate authenticated identity, policy, workspace, agent, model, MCP call,
  operation digest, physical decision, lease, provider result, and receipt.
- Clean disposable data and temporary grants through supported APIs.

## Out of scope

- Production user data, broad Microsoft write coverage, recursive/bulk delete,
  additional models/connectors, or production rollout.

## Required verification

- [ ] The complete read journey succeeds only for the assigned agent and user.
- [ ] Delete reaches Microsoft zero times before approval, once after one valid
  physical approval, and zero times for the physical deny case.
- [ ] Wrong identity/policy/workspace/agent/key/server/tool/schema/item/eTag,
  mutation, expiry, replay, duplicate callback, concurrent retry, outage, and
  restart variants yield zero unsafe executions.
- [ ] Provider success, failure, and unknown outcomes produce honest UI states
  and receipts without unsafe automatic retry.
- [ ] The workspace cannot obtain provider credentials or bypass the governed
  route during the successful journey.
- [ ] A second run with fresh disposable data reproduces the result and cleanup
  leaves no grants, tasks, leases, containers, or provider fixtures behind.

## Evidence required

Include end-to-end sequence, safe screenshots, canonical binding, physical
decision references, provider counters, receipt/evidence timeline, bypass and
failure matrix, rerun result, and cleanup inventory.

## Stop conditions

- Any successful step depends on an administrator tool, fixture provider,
  direct Graph call, mutable database state, or undeclared host configuration.
- One approval can execute more than one provider action.

## Completion record

Not complete. Blocked on Issue 009.
