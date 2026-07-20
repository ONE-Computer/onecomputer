# 008: qualify the O365 MCP capability provider

Status: `blocked`

Gate: F
Depends on: 007
Unblocks: 009

## Outcome

An evidence-backed decision selects a pinned Microsoft 365 MCP implementation
for Outlook Mail, Outlook Calendar, and OneDrive, or specifies the smallest
owned wrapper required for the golden paths.

## In scope

- Use the pinned Softeria `ms-365-mcp-server` as the first candidate for Outlook
  Mail, Outlook Calendar, and OneDrive; retain eligible Microsoft first-party
  remote MCPs and a narrow owned wrapper as fallbacks where Softeria fails the
  contract.
- Review source/release provenance, maintenance, license, transports, OAuth,
  delegated/application scopes, tenant controls, tool schemas, pagination,
  item/eTag identity, delete semantics, receipts, errors, rate limits, and drift.
- Run candidates in an isolated test tenant with a non-production account and
  least privilege.
- Map raw tools to bounded mail read/search, calendar read/availability, and
  OneDrive read/search capabilities. Separately classify send/reply, calendar
  mutation, and exact file delete as governed write operations.
- Verify LiteLLM registration, scoped discovery, pre-execution policy context,
  result metadata, and credential isolation.
- Qualify the identity and credential-custody decision in ADR-004: each agent
  has a unique virtual key/gateway principal while the associated LiteLLM
  `user_id` selects the owning user's delegated Microsoft credential.

## Out of scope

- Production rollout, destructive data outside disposable fixtures, physical
  approval, broad Microsoft 365 coverage, or accepting a candidate because it
  is the only available option.

## Required verification

- [x] Candidate identity, version/digest/commit, license, scopes, endpoint,
  schema snapshot, and requalification triggers are recorded.
- [ ] Workspace discovers only the mapped tools with a scoped non-master key.
- [ ] Control receives stable server/tool/schema identity and exact canonical
  arguments before provider execution.
- [ ] Read is bounded; delete binds item identity and version/eTag and returns a
  usable receipt or explicit limitation.
- [x] Deployment-level page/item caps are active and all Microsoft write tools
  remain absent from the qualified surface.
- [ ] Mail and calendar reads are bounded by user, time/query window, selected
  fields, page count, and item count; write tools remain absent until each has a
  typed governed-operation contract.
- [ ] OAuth tokens remain in the selected gateway/provider seam and are absent
  from workspace, browser, policy payloads, logs, and evidence.
- [x] LiteLLM uses a durable credential database and a dedicated stable
  encryption salt independent from its master key; process and database restart
  behavior passed.
- [ ] Backup/restore, database replacement, salt-loss recovery, and rotation
  procedures are recorded and tested.
- [x] Adapter-generated ONEComputer user -> LiteLLM `user_id` and
  agent/workspace -> virtual-key mappings are deterministic, unique where
  required, revocable, and visible in gateway audit metadata.
- [ ] Durable owned agent, delegation, and vendor-key mapping records exist in
  ONEComputer PostgreSQL rather than only gateway metadata.
- [x] Two agents belonging to one user can share the user's delegated OAuth
  connection while retaining different server/tool policies and distinct keys.
- [x] Synthetic cross-user, cross-agent, missing-credential, and revoked-key
  probes deny without returning or using the wrong credential.
- [ ] Real cross-workspace, cross-tenant, missing-identity, and deliberately
  mismatched-key probes deny through the complete Control -> gateway path.
- [x] OAuth refresh, expiry, user revoke, agent-key revoke, LiteLLM restart,
  database restart, and connector restart behavior is verified fail-closed with
  the synthetic OAuth provider.
- [ ] Real Microsoft disconnect, consent revocation, key rotation, and provider
  restart behavior is verified fail-closed.
- [ ] Authenticated tenant, user, agent, workspace, key, and operation identity
  reaches Control's policy/evidence seam without treating LiteLLM `user_id` as
  ONEComputer's policy authority.
- [ ] Wrong tenant, site/drive/item, scope, schema drift, stale eTag, timeout,
  throttling, and provider error behaviors are classified.
- [ ] A human accepts `candidate`, `narrow_wrapper`, or `decision_required`.

## Evidence required

Include candidate matrix, source/security review, OAuth scope ledger, schema
snapshots/hashes, isolated live probes, credential scan, decision ADR, and
wrapper contract if conditional.

## Stop conditions

- No candidate can satisfy tenant, scope, identity, argument, receipt, or drift
  requirements.
- Qualification would require production data or excessive privileges.
- The candidate can execute outside the qualified policy hook.

## Completion record

Not complete. The pinned LiteLLM per-user credential-custody mechanism received
a conditional synthetic pass on 2026-07-20. Evidence is in
`infra/issue-008/qualification-2026-07-20.md`. A real Entra reconnection under
the mapped ONEComputer user, bounded Graph probes, and the remaining
provider/error/isolation matrix still block completion. The owned connection
journey is now implemented and in pre-consent verification under Issue 013;
evidence is in `infra/issue-013/qualification-pre-oauth-2026-07-20.md`.

## Early candidate deployment

On 2026-07-19 the user selected Softeria as the first candidate and expanded
the desired connector surface to Outlook Mail and Calendar in addition to
OneDrive. A pinned, read-only `0.131.2` container is deployed privately through
`infra/issue-008/compose.yml`; its deployment record is in
`infra/issue-008/README.md`. This early bring-up does not satisfy the blocked
live-qualification criteria or change this issue's status.
