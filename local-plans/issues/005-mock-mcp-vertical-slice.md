# 005: prove the governed mock MCP vertical slice

Status: `verification`

Gate: C
Depends on: 004
Unblocks: 006

## Outcome

An owned Control API and the qualified gateway complete one read and one
approval-gated destructive mock MCP operation end to end using the fixture
approval adapter.

## In scope

- Build an unprivileged `apps/control-api` over owned domain/repositories.
- Implement authenticated identity context and the qualified LiteLLM policy
  callback/adapter contract.
- Deploy the pinned LiteLLM topology and mock MCP server from Issue 002.
- Implement capability assignment and policy for read allow, destructive deny,
  and destructive approval-required.
- Return stable operation status to the client and resume only the bound
  approved operation.
- Correlate gateway request, operation, policy, approval, lease, upstream
  invocation, receipt, and evidence without full sensitive payload logging.

## Out of scope

- Kasm, public production auth, product UI, physical OpenVTC, real O365, broad
  policy language, or arbitrary connectors.

## Required verification

- [ ] Assigned read executes once; unassigned read and destructive deny execute
  zero times.
- [ ] Destructive approval-required executes zero times before approval and
  once after a valid bound fixture decision.
- [ ] Portal/API/database/native-gateway decisions cannot substitute for signed
  approval.
- [ ] Wrong tenant/workspace/user/capability/server/tool/schema/arguments,
  expiry, deny, replay, callback outage, gateway restart, and Control restart
  execute zero times.
- [ ] Concurrent approved retries execute upstream once.
- [ ] A non-master scoped key is used; provider/MCP secrets stay outside client
  and Control logs.
- [ ] Clean volumes reproduce the full result.

## Evidence required

Include end-to-end sequence, upstream counters, authorization matrix,
correlation graph, API schemas, effective gateway config, restart/concurrency
results, and secret/log scan.

## Stop conditions

- Approval requires client-side provider execution.
- Stable operation correlation differs from the reviewed gateway decision.
- Control must read LiteLLM's database or hold its master key on a public path.

## Completion record

The mock destructive vertical slice is implemented and verified on 2026-07-19.
Before approval the fixture upstream counter is zero; denial, malformed input,
cross-tenant access, and direct database status mutation remain zero. A valid
bound fixture approval creates a one-time exact-tool LiteLLM key, resolves the
authorized MCP server ID, executes `delete_file` once, revokes the key, and
persists a receipt. Concurrent approvals return the same successful operation
and increment the upstream counter once. The real UI displays pending,
completed, denied, failed, and receipt states from Control.

This issue remains in verification until capability assignments are
data-driven and the full callback outage/gateway restart/clean-volume matrix is
captured in the Gate C evidence bundle.

### Human product acceptance

Accepted by the product owner on 2026-07-20 with visual evidence from the live
product. The workspace was open with Identity, Network, Models, and Tools ready;
the recent destructive operation was completed; and its drawer showed the
bound file/location plus the execution receipt. This sign-off is complete and
does not need to be repeated. Remaining verification is automated Gate C
evidence, not another manual UX pass.
