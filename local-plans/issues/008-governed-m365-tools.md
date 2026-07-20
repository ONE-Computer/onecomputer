# 008: govern the Microsoft 365 MCP capability surface

Status: `ready`

Gate: G
Depends on: 007
Unblocks: 009

## Outcome

ONEComputer policy—not the agent, LiteLLM UI, or MCP server—decides which
Microsoft 365 tools an agent may discover and whether an exact call is allowed,
denied, or requires approval immediately before execution.

## Carried-forward baseline

- Softeria `ms-365-mcp-server` `0.131.2` is pinned privately behind LiteLLM.
- Real OAuth and bounded Mail, Calendar, and OneDrive reads passed for
  `mike@metech.dev`; tokens remain in the gateway/provider seam.
- The fixture governed-operation path already proves canonical binding,
  signed local approval, one execution lease, exact-tool execution, and receipt.

## In scope

- Create owned, versioned capability definitions for bounded Mail, Calendar,
  and OneDrive reads plus one protected disposable OneDrive delete.
- Pin exact MCP server, tool names, schema hashes, argument projections, result
  limits, and requalification triggers.
- Feed authenticated tenant/user/agent/workspace/capability/policy context and
  canonical arguments to Control immediately before execution.
- Auto-allow assigned bounded reads, deny unassigned/over-broad calls, and turn
  the exact delete into a durable approval-required operation.
- Bind delete to drive, item, version/eTag where supported, arguments, policy,
  tool/schema identity, nonce, and expiry.
- Use the existing test signer only until Issue 009 replaces its transport.
- Keep every other Microsoft write tool undiscoverable/denied for this MVP.

## Out of scope

- Physical approval, production documents, bulk/recursive deletion, sending
  mail, calendar mutation, arbitrary Graph calls, or a generic connector policy
  language.

## Required verification

- [ ] Assigned bounded reads succeed; unassigned, cross-user/tenant/workspace,
  over-limit, wrong-server/tool/schema, and direct MCP/Graph attempts deny.
- [ ] Control receives and validates the exact authenticated identity and
  canonical arguments before any upstream connection.
- [ ] The protected delete reaches Microsoft zero times before approval and
  once after one valid exact bound fixture decision.
- [ ] Deny, expiry, cancellation, stale eTag/version, argument/item mutation,
  replay, concurrency, gateway/Control outage, malformed/unknown policy result,
  and restart yield zero unsafe executions.
- [ ] The provider result becomes an honest safe receipt; ambiguous completion
  is not automatically retried.
- [ ] Workspace, browser, Control policy payloads, logs, and evidence contain no
  OAuth token or unrestricted Microsoft content.

## Evidence required

Include capability/policy records, schema hashes, canonical operation digest,
tool discovery matrix, pre-execution context, Microsoft invocation counters,
negative/mutation/restart matrix, receipt projection, and credential scan.

## Stop conditions

- LiteLLM cannot invoke an owned fail-closed policy decision with exact call
  context before upstream execution.
- Resource identity/version cannot be bound safely enough for deletion.
- An agent can invoke a write through another gateway or direct route.

## Completion record

Not complete. Issue 007 was accepted on 2026-07-20; this is the next ready
issue.
