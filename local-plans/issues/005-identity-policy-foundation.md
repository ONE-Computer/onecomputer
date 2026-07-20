# 005: establish real identity and durable policy assignments

Status: `ready`

Gate: D
Depends on: 004
Unblocks: 006

## Outcome

An authenticated ME TECH employee maps to one durable ONEComputer tenant/user,
owns explicit agent and workspace identities, and receives versioned workspace,
agent, model, network, and capability assignments from ONEComputer PostgreSQL.
Development headers and LiteLLM metadata are no longer product identity or
policy authority.

## Carried-forward baseline

- The owned PostgreSQL, canonical operation, approval, lease, receipt, and safe
  evidence foundations from Issues 003–004 remain authoritative.
- The local UI, Kasm lifecycle, LiteLLM user/agent key derivation, and real
  Microsoft OAuth for `mike@metech.dev` are working inputs, not work to repeat.

## In scope

- Add real Entra OIDC sign-in and a secure server session for ONEComputer Web
  and Control.
- Persist tenant, user, external identity, agent ownership, workspace
  assignment, vendor-user/key mapping, capability assignment, and versioned
  policy-bundle records in the owned database.
- Define one MVP employee role and one administrator role with server-enforced
  authorization.
- Add the smallest owned administrator API/UI needed to inspect, assign, revoke,
  and version the single MVP policy bundle; do not build a general policy editor.
- Define one explicit policy bundle containing workspace profile, agent
  profile, model alias assignment, network profile, MCP server/tool assignment,
  and protected-operation rules.
- Bind the existing Microsoft 365 connection to the authenticated owned user;
  preserve LiteLLM as token custodian. Reuse a verified durable vendor mapping
  when safe; otherwise require one explicit reconnect without exporting tokens.
- Retain a clearly isolated test-only identity mode for automated tests only.

## Out of scope

- Changing the Kasm image, adding a real model provider, enabling Microsoft
  write tools, implementing OpenVTC, or building a general policy language.

## Required verification

- [ ] `mike@metech.dev` signs in and resolves to one durable tenant/user across
  browser, Control, PostgreSQL, LiteLLM `user_id`, and Microsoft connection.
- [ ] Caller-supplied tenant, subject, role, agent, workspace, or policy headers
  cannot override the authenticated server session.
- [ ] Cross-tenant/user/role direct URL and API attempts deny.
- [ ] Agent ownership, workspace assignment, vendor mapping, capability
  assignment, and policy version survive Control and database restarts.
- [ ] Every effective workspace/agent grant references one immutable policy
  version and records who assigned it.
- [ ] An administrator can assign/revoke the MVP policy through the owned
  surface; an employee and a direct unauthenticated API caller cannot.
- [ ] Removing or changing an assignment revokes/renews downstream authority
  without deleting the persistent workspace.
- [ ] Browser storage, bundles, logs, database evidence, and API responses
  contain no Entra client secret, Microsoft token, LiteLLM master key, or
  workspace credential.

## Evidence required

Include schema/migration hashes, identity mapping, role/API matrix, effective
policy projection, restart and revocation probes, cross-tenant negatives, and a
credential/redaction scan.

## Stop conditions

- Development proxy headers remain accepted in the product runtime.
- Policy truth exists only in LiteLLM metadata, environment variables, or UI
  state.
- One authenticated user can resolve another user's delegated connection.

## Completion record

Not complete. This is the next active issue.
