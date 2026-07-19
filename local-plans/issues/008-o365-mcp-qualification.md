# 008: qualify the O365 MCP capability provider

Status: `blocked`

Gate: F
Depends on: 007
Unblocks: 009

## Outcome

An evidence-backed decision selects a pinned O365/OneDrive MCP implementation
or specifies the smallest owned wrapper required for the golden path.

## In scope

- Evaluate, in order, an eligible Microsoft first-party OneDrive/Work IQ remote
  MCP, the pinned Softeria `ms-365-mcp-server`, then a narrow owned wrapper.
- Review source/release provenance, maintenance, license, transports, OAuth,
  delegated/application scopes, tenant controls, tool schemas, pagination,
  item/eTag identity, delete semantics, receipts, errors, rate limits, and drift.
- Run candidates in an isolated test tenant with a non-production account and
  least privilege.
- Map raw tools to the two typed capabilities: bounded read and exact delete.
- Verify LiteLLM registration, scoped discovery, pre-execution policy context,
  result metadata, and credential isolation.

## Out of scope

- Production rollout, destructive data outside disposable fixtures, physical
  approval, broad Microsoft 365 coverage, or accepting a candidate because it
  is the only available option.

## Required verification

- [ ] Candidate identity, version/digest/commit, license, scopes, endpoint,
  schema snapshot, and requalification triggers are recorded.
- [ ] Workspace discovers only the mapped tools with a scoped non-master key.
- [ ] Control receives stable server/tool/schema identity and exact canonical
  arguments before provider execution.
- [ ] Read is bounded; delete binds item identity and version/eTag and returns a
  usable receipt or explicit limitation.
- [ ] OAuth tokens remain in the selected gateway/provider seam and are absent
  from workspace, browser, policy payloads, logs, and evidence.
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

Not complete.
