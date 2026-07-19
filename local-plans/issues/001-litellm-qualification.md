# 001: qualify LiteLLM as the model and MCP data plane

Status: `blocked`

Gate: B
Depends on: 000
Unblocks: 002

## Outcome

An isolated, pinned LiteLLM harness proves or disproves the exact V4 gateway
contract without creating ONEComputer product services.

## In scope

- Select a stable LiteLLM release and pin version and image digest.
- Use disposable storage, a mock model endpoint, and a mock MCP server exposing
  one read tool and one destructive tool with upstream invocation counters.
- Create a non-master, workspace-scoped virtual key with deny-by-default MCP
  discovery and a bounded server/tool assignment.
- Implement a fixture pre-execution policy endpoint that records a redacted
  normalized request and returns allow, deny, approval-required, malformed,
  timeout, or unavailable.
- Test selected Anthropic/Claude Code and OpenAI-compatible routes, including
  streaming if required by the MVP client.
- Measure tool-schema prompt overhead and prove bounded discovery.
- Determine whether gateway-side execution, stable operation references,
  approved retry/resume, and post-execution receipt metadata are possible.

## Out of scope

- A custom gateway, production Control API, real providers, OpenVTC, OneDrive,
  Kasm, or product UI.
- Use of the LiteLLM master key by a client or workspace.

## Required verification

- [ ] Unassigned keys discover and execute zero MCP tools.
- [ ] Assigned keys see only their server/tool subset and model alias.
- [ ] Policy receives authenticated tenant/subject/workspace/audience plus exact
  server, endpoint identity, tool, schema identity, and canonical arguments.
- [ ] Deny, timeout, outage, malformed, unknown, mismatch, and mutation reach
  the mock MCP upstream zero times.
- [ ] Allow reaches the expected upstream exactly once.
- [ ] Approval-required returns a stable operation reference or documents the
  exact missing seam without client/provider execution.
- [ ] Approved resume/retry cannot mutate arguments or execute twice.
- [ ] OAuth/provider credentials, master key, arguments, and results are absent
  from prohibited logs and client responses.
- [ ] Behavior is repeated after LiteLLM restart from clean disposable state.

## Evidence required

Include route/capability matrix, upstream counters, normalized hook envelopes,
version/digest, supported API evidence, schema/tool budget, log-redaction scan,
and exact deficiencies.

## Stop conditions

- Any client route bypasses the pre-execution decision.
- Protected failure can reach upstream.
- A workspace requires the master key.
- Safe operation correlation/resume cannot be demonstrated.

## Completion record

Not complete.
