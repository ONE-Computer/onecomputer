# 012: manage workspace, agent, model, and tool policy in ONEComputer

Status: `blocked`

Gate: K
Depends on: 011
Unblocks: 013

## Outcome

An authorized administrator configures the effective sandbox, agent, model,
Microsoft tool, and approval policy in ONEComputer, and the next agent action is
allowed, denied, or held for approval according to that durable policy.

## In scope

- Add an owned **Policies** administration page with effective-policy preview.
- Assign versioned policies to users, workspaces, and agent identities.
- Configure workspace profile, model aliases/budget/rate limits, MCP toolsets,
  and per-operation effects: `allow`, `deny`, or `require_approval`.
- Seed a safe MVP policy: bounded Microsoft reads allowed; OneDrive delete
  requires approval; unlisted operations denied.
- Validate conflicts and show why a specific agent/tool action received its
  effect.
- Persist policy version and decision inputs on every governed operation.
- Apply policy changes to new actions without silently changing already-bound
  operations.

## Out of scope

- A general-purpose policy language editor, arbitrary code rules, cross-tenant
  delegation, approval-group orchestration, or production RBAC completeness.

## Required implementation

- Versioned owned policy schema, assignments, migrations, and API contracts.
- Role-gated policy read/write/preview endpoints and UI states.
- Deterministic precedence and deny-by-default conflict behavior.
- Agent/workspace/tool decision-point integration and reason codes.
- Immutable operation binding to the evaluated policy version and effect.

## Required verification

- [ ] An administrator can configure and preview the MVP workspace, model,
  toolset, and approval policies without editing files or vendor databases.
- [ ] Read=`allow`, delete=`require_approval`, explicit deny, and unlisted deny
  produce the correct agent-visible behavior on the next action.
- [ ] A normal user and workspace agent cannot create, edit, assign, or bypass
  policy.
- [ ] Wrong tenant/role/subject/workspace/agent/tool/schema, conflicting rules,
  missing assignment, stale version, and database outage fail closed.
- [ ] A policy edit does not mutate the digest, effect, approver requirements,
  or legal path of an already-bound operation.
- [ ] Policy and secret data are redacted appropriately in UI, logs, and
  evidence.

## Evidence required

Include schema/version records, role matrix, effective-policy screenshots,
decision traces for all three effects, conflict/mutation tests, restart result,
and cleanup.

## Stop conditions

- Policy truth must be split with LiteLLM, the agent client, or OpenVTC.
- An action without a complete owned policy decision would be allowed.

## Completion record

Not complete. Blocked on Issue 011.
