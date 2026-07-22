# 012: manage workspace, agent, model, and tool policy in ONEComputer

Status: `verification` (expanded grouped policy UI is active; three-effect behavior review remains)

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
  and all other Microsoft writes require approval; unlisted operations denied.
- Present the selected Mail, Calendar, OneDrive, and Teams tools in service
  groups so an administrator can review the larger surface without treating a
  raw vendor catalog as policy.
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

- [x] An administrator can configure and preview the MVP workspace, model,
  toolset, and approval policies without editing files or vendor databases.
- [ ] Read=`allow`, write=`require_approval`, explicit deny, and unlisted deny
  produce the correct agent-visible behavior on the next action for each of
  Mail, Calendar, OneDrive, and Teams.
- [x] A normal user and workspace agent cannot create, edit, assign, or bypass
  policy.
- [ ] Wrong tenant/role/subject/workspace/agent/tool/schema, conflicting rules,
  missing assignment, stale version, and database outage fail closed.
- [x] A policy edit does not mutate the digest, effect, approver requirements,
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

Implementation completed on 2026-07-22 for the Microsoft 365 demo slice. The
administrator can set every exposed tool to Allow, Require approval, or Block
from ONEComputer. Saving creates or reuses an immutable owned policy version,
reassigns the effective user/workspace/agent binding, and never mutates an
already-created operation. Control evaluates the effective policy on every new
tool call; LiteLLM and Claude Desktop do not become policy authorities.
Automated allow/approval/deny and binding tests pass. Broader workspace/model
policy authoring remains represented by the existing Sandbox and identity
assignment surfaces; the tool-policy UI awaits human review.

The 2026-07-22 real-agent journey confirmed that the currently assigned policy
was enforced: OneDrive discovery/read was allowed and deletion was held for a
device-backed approval. It did not yet constitute the required administrator
UI review of changing a tool among Allow, Require approval, and Block, nor the
proof that a policy edit affects only new calls. Those checks remain open.

The later Microsoft 365 scope expansion reopens implementation for this issue.
The existing per-tool policy mechanism remains the authority, but the UI and
policy document must now carry the reviewed Mail, Calendar, OneDrive, and Teams
manifest. Safe defaults are reads=`allow`, writes=`require_approval`, and
unlisted=`deny`; an administrator may explicitly change an individual tool to
Allow or Block. Existing bound operations must retain their original policy
version when the expanded policy is saved.

On 2026-07-22 the expanded grouped policy editor was deployed and reviewed in
the real product. It presents all 37 curated tools under Mail, Calendar,
OneDrive, and Teams, with reads defaulting to Allow and mutations defaulting to
Require approval. The administrator successfully saved the policy and, after
a Microsoft reconnect and sandbox stop/start, the real Claude Desktop agent
received the expanded assignment. Issue 012 therefore moves to verification.
The next review must deliberately exercise Allow, Require approval, and Block
on new agent actions and prove that an already-bound operation retains its
original policy version and effect.

Automated verification was strengthened on 2026-07-22. Control now has
regression coverage proving that employee sessions receive `403` for both
policy reads and writes, administrators must submit a complete 37-tool policy,
and an incomplete policy is rejected without reaching persistence. A second
regression creates an approval-required operation under one policy version,
changes the effective policy so the same new action is blocked, and proves the
existing operation retains its original policy version, hash, state, and agent
binding. The full build and all 100 tests pass. Live read-only inspection found
active policy version 7 with 37 tools (16 Allow, 21 Require approval, 0 Block),
and the running sandbox has the identical 37-tool projection. The deliberate
live Allow/Block/Require-approval behavior review remains the gate-closing
human check.

The product owner explicitly deferred that small live UI matrix on 2026-07-22
so work could continue. The automated checks are retained and the unchecked
human proof is not waived; it must be completed before the final golden-path
acceptance.
