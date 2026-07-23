# ADR-004: Separate agent identity from delegated OAuth ownership

Status: accepted for qualification

Date: 2026-07-20

## Decision

For the first Microsoft 365 slice, LiteLLM is both the MCP data plane and the
custodian of encrypted per-user delegated OAuth credentials. This is a bounded
extension of ADR-002, not a transfer of identity or policy authority to
LiteLLM.

Model three distinct principals:

- the **user** owns the Microsoft OAuth grant and provider data;
- the **agent** is the actor to which capabilities and policies are assigned;
- the **workspace** is the execution environment in which the agent runs.

Every independently governed agent receives its own LiteLLM virtual key. A key
for delegated Microsoft access is associated with the owning user's LiteLLM
`user_id` so LiteLLM can select that user's OAuth credential. The key must also
be mapped to stable ONEComputer tenant, user, agent, and workspace identifiers.
Multiple agents may use the same user's delegated connection, but they must not
share a virtual key or inherit one another's capability assignments.

LiteLLM `user_id` is only a vendor credential-lookup dimension. It is not the
universal ONEComputer subject, an agent identity, or policy authority.
ONEComputer PostgreSQL remains authoritative for user and Entra mappings,
agents, ownership/delegation, workspaces, gateway-key mappings, capabilities,
policies, governed operations, approvals, and evidence.

The effective permission is the intersection of organization policy, user
delegation, agent policy, workspace policy, LiteLLM key/server/tool scope, and
any operation-specific approval. An agent receives only a non-master gateway
key; Microsoft access and refresh tokens never enter the workspace.

Governed writes use a short-lived exact execution key carrying the same user,
agent, workspace, and operation context. Control remains the authority that
binds, approves, leases, and evidences the operation. Non-human automation must
use an explicitly governed service or shared connection rather than borrowing
a person's delegated identity.

## Why

The pinned Softeria authorization-code flow returns Microsoft tokens to its
OAuth client, which is LiteLLM in the current deployment. LiteLLM's pinned
per-user MCP OAuth implementation stores and resolves those credentials by
`user_id`. Using that native seam is the smallest coherent MVP path while still
allowing ONEComputer to assign different policies to several agents belonging
to the same user.

Routing and credential custody remain separate architectural decisions. If the
credential-custody qualification fails, LiteLLM may remain the MCP router while
a dedicated connector/vault such as a qualified OneCLI path owns OAuth and
injects credentials. Two systems must never retain the same refresh token as a
normal operating design.

## Required qualification

This decision is not production-qualified until Issue 008 proves:

- a durable LiteLLM credential database and a dedicated stable encryption salt
  independent from the gateway master key;
- deterministic ONEComputer user to LiteLLM `user_id` mapping and unique
  agent/workspace virtual-key mappings;
- propagation of authenticated tenant, user, agent, workspace, key, and
  operation context into the policy and evidence seams;
- deny-by-default key scopes and cross-user, cross-agent, cross-workspace, and
  cross-tenant isolation, including deliberately mismatched identifiers;
- refresh, expiry, revoke, disconnect, key rotation, process restart, and
  database replacement/recovery behavior;
- absence of OAuth tokens and provider credentials from the workspace,
  browser-visible application state, policy payloads, logs, traces, errors, and
  evidence;
- read-only workspace tool exposure and exact governed execution for every
  enabled write tool.

Failure of any identity, isolation, durability, or credential-leak test blocks
agent access to Microsoft 365 and triggers a separate credential-vault adapter
decision.

