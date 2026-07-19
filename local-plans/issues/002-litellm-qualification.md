# 002: qualify and integrate the LiteLLM gateway slice

Status: `complete`

Gate: B
Depends on: 001
Unblocks: 003

## Outcome

The running product now routes model and MCP traffic through a pinned LiteLLM
gateway. Control creates and revokes a short-lived workspace key, Kasm receives
only that scoped key, and the owned UI reports real model/tool readiness and can
run a visible connection test.

The qualification decision is `partial`: adopt LiteLLM as the model/MCP data
plane with the narrow owned adapter in `packages/litellm-adapter`; never make it
the ONEComputer policy, approval, or evidence authority.

## In scope

- Select a stable LiteLLM release and pin version and image digest.
- Use disposable storage, a mock model endpoint, and a mock MCP server exposing
  one read tool and one destructive tool with upstream invocation counters.
- Create a non-master, workspace-scoped virtual key with deny-by-default MCP
  discovery and a bounded server/tool assignment.
- Record the exact pre-execution policy and durable approval seams that remain
  for the governed operation slice rather than pretending key permissions are
  equivalent to ONEComputer policy.
- Test selected Anthropic/Claude Code and OpenAI-compatible routes, including
  streaming if required by the MVP client.
- Measure tool-schema prompt overhead and prove bounded discovery.
- Determine whether gateway-side execution, stable operation references,
  approved retry/resume, and post-execution receipt metadata are possible.
- Map each gateway invariant and client route to evidence and classify the
  result as `pass`, `partial`, or `fail`.
- For `partial`, specify only the smallest version-tested plugin or wrapper and
  the exact requalification cases. For `fail`, write a replacement-gateway
  issue rather than inferring a broad custom proxy.
- Record the supported routes, hook schema, identity claims, operation-reference
  behavior, evidence seam, release pin, residual risks, and upgrade triggers in
  the closing ADR.

## Out of scope

- A general custom gateway, production Control API, real providers, OpenVTC,
  OneDrive, or changes to the Issue 001 Kasm lifecycle slice.
- Use of the LiteLLM master key by a client or workspace.
- Vendor source forks or silently dropping a failed route.

## Required verification

- [x] Unassigned keys discover and execute zero MCP tools.
- [x] Assigned keys see only their server/tool subset and model alias.
- [ ] Policy receives authenticated tenant/subject/workspace/audience plus exact
  server, endpoint identity, tool, schema identity, and canonical arguments.
- [ ] The full deny, timeout, outage, malformed, mismatch, and mutation matrix
  reaches the mock MCP upstream zero times. This remains Issue 005 work; Issue
  002 proved unassigned tool and unknown-model denial before upstream.
- [x] Allow reaches the expected upstream exactly once.
- [x] Approval-required returns a stable operation reference or documents the
  exact missing seam without client/provider execution.
- [ ] Approved resume/retry cannot mutate arguments or execute twice.
- [x] OAuth/provider credentials, master key, arguments, and results are absent
  from prohibited logs and client responses.
- [x] Behavior is repeated after LiteLLM restart from disposable state.
- [x] Every Gate B criterion has direct evidence or an explicit failure.
- [x] No accepted design places approval authority in a client, LiteLLM UI, or
  MCP server.
- [x] The closing decision identifies unsupported routes, residual-risk owners,
  upgrade/drift tests, and requalification triggers.
- [x] A human records approval of the pass, partial, or fail decision.

## Delivered vertical slice

- LiteLLM `v1.93.0` is pinned by OCI index digest
  `sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e`.
- LiteLLM uses its own disposable PostgreSQL and a private fixture network.
- The fixture supplies an OpenAI-compatible model, `search_files`, and the
  deliberately unassigned destructive `delete_file` tool with counters.
- Control derives a workspace-specific key, creates/updates its LiteLLM virtual
  key record, and revokes it on stop, delete, expiry, or failed provisioning.
- The key is limited to `onecomputer-assistant`, MCP server
  `onecomputer_fixture`, and `search_files`.
- Kasm can resolve LiteLLM but cannot resolve the fixture, either database,
  Control API, workspace controller, or external model providers.
- The UI displays real Models/Tools readiness and a server-mediated connection
  test without returning the scoped key to the browser.

## Route and capability decision

| Route/capability | Result | Evidence |
| --- | --- | --- |
| OpenAI chat completions | pass | Fixture response returned through scoped alias |
| OpenAI streaming | pass | Streamed fixture text returned through scoped alias |
| Anthropic `/v1/messages` | pass | LiteLLM translated via the Responses upstream route |
| Anthropic streaming | pass | Anthropic event stream contained the fixture response |
| Scoped model discovery | pass | Only `onecomputer-assistant` is available |
| Unassigned model | pass | 403 and model upstream counter unchanged |
| Scoped MCP discovery | pass | Only `search_files`; serialized schema is 244 bytes |
| Assigned tool call | pass | 200 and `searchFiles=1` |
| Destructive tool call | pass | 403 and `deleteFile=0` |
| Unassigned key MCP discovery | pass | HTTP 200 with zero tools |
| Stop/revoke | pass | Sandbox removed; prior key returned 401 |
| Immediate ONEComputer policy callback | not proven | Exact authenticated callback contract remains required before Issue 005 closes |
| Stable approval reference and safe resume | missing | Must be owned by Control operations and execution leases in Issues 003–005 |

## Closing decision

Use LiteLLM for aliases, protocol translation, scoped keys, model routing, MCP
discovery/execution, rate/budget primitives, and usage telemetry. Use the narrow
owned adapter for key lifecycle, readiness, and normalized product errors.

Do not use LiteLLM UI approvals, client-side tool approval, or MCP-server logic
as enterprise authority. Before the governed MCP slice can close, Issue 005 must
prove an immediate fail-closed Control decision containing canonical identity,
server/tool/schema/arguments and a stable operation reference. If the pinned
LiteLLM hook cannot provide that contract, add only a version-tested execution
adapter around the MCP call; do not replace the whole model gateway.

Requalify on a LiteLLM version/digest change, MCP permission schema change,
Anthropic route translation change, virtual-key cache behavior change, access
log format change, or any new route used by an MVP client.

## Evidence required

Include the route/capability matrix, upstream counters, normalized hook
envelopes, version/digest, supported API evidence, schema/tool budget,
log-redaction scan, exact deficiencies, closing ADR, residual-risk register,
and accepted release/contract pin.

## Stop conditions

- Any client route bypasses the pre-execution decision.
- Protected failure can reach upstream.
- A workspace requires the master key.
- Safe operation correlation/resume cannot be demonstrated.
- Evidence is incomplete or contradictory.
- A proposed partial solution expands into a general custom gateway.

## Completion record

Implementation and machine verification completed on 2026-07-19. Evidence is
under `.artifacts/v4/issues/002/20260719T090000Z/`; the visual proof is
`gateway-ready.png`. The user accepted the partial gateway decision and
authorized proceeding to the governed-operation feature on 2026-07-19.
