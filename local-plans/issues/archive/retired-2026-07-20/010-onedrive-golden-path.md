# 010: prove governed OneDrive read and approval-bound delete

Status: `blocked`

Gate: G
Depends on: 009
Unblocks: 011

## Outcome

The selected O365 MCP implementation completes the MVP capability proof: a
bounded read and a physical-approval-gated delete of a disposable OneDrive item,
with at-most-once execution and end-to-end evidence.

## In scope

- Provision uniquely named disposable test data in the isolated tenant.
- Implement typed capability policies and canonical resource identity for read
  and delete.
- Bind delete approval to tenant, user, workspace, capability, MCP identity,
  exact drive/item, version/eTag, arguments, decision, nonce, and expiry.
- Execute only through the qualified LiteLLM/MCP path using one execution lease.
- Record safe request/decision/execution/receipt evidence and clean fixtures
  through supported provider APIs.
- Surface operation status and redacted evidence in the owned UI.

## Out of scope

- Broad O365 tools, production documents, recursive/bulk deletion, permanent
  broad consent, or bypass through a direct Graph/OneCLI lane.

## Required verification

- [ ] Assigned bounded read succeeds; cross-tenant, unassigned, over-broad, and
  direct provider/MCP attempts fail.
- [ ] Delete reaches provider zero times before approval and once after a valid
  physical bound approval.
- [ ] Deny, expiry, cancellation, wrong tenant/user/workspace/capability,
  wrong server/tool/schema, argument/item/eTag mutation, stale eTag, replay,
  duplicate callback, concurrent retry, and restart execute zero times.
- [ ] Provider success/failure/unknown outcomes produce honest receipts and do
  not silently retry a potentially completed delete.
- [ ] Workspace/browser/Control logs and evidence contain no OAuth token or
  unrestricted document content.
- [ ] Clean-state rerun with new disposable data reproduces the result.

## Evidence required

Include canonical operation projection/hash, authorization and mutation matrix,
gateway/MCP/provider counters, physical decision reference, receipt projection,
UI journey evidence, clean-state rerun, and provider cleanup inventory.

## Stop conditions

- Resource version cannot be bound or checked.
- Provider result ambiguity could cause an unsafe automatic retry.
- Execution can occur through a path that does not consume the exact lease.

## Completion record

Not complete.
