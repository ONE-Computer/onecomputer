# 011: connect the real agent to governed Microsoft 365 tools

Status: `verification`

Gate: J
Depends on: 010
Unblocks: 012

## Outcome

The real in-workspace agent discovers only its assigned Microsoft 365 tools and
can use natural-language chat to read Outlook Mail, Calendar, and OneDrive and
to request—but not independently execute—a protected OneDrive deletion.

## In scope

- Attach the existing LiteLLM MCP server/toolset to the agent identity and
  workspace assignment created in Issue 010.
- Expose approved tool descriptions and schemas to the selected agent client.
- Carry user, tenant, workspace, agent, model, connection, toolset, and request
  identity from chat through Control to the Microsoft MCP adapter.
- Use the user's existing ONEComputer Microsoft 365 connection without copying
  OAuth tokens into the workspace or agent client.
- Support bounded Mail, Calendar, and OneDrive reads through natural-language
  conversation.
- Convert a protected delete tool call into the existing durable governed
  operation and return a clear pending-approval result to the agent.
- Resume or report the result to the same conversation after terminal state,
  without reissuing the provider mutation.

## Out of scope

- Policy authoring UI, additional connectors, broad Microsoft write coverage,
  recursive/bulk operations, autonomous background runs, or OpenVTC UX changes.

## Required implementation

- Agent-to-MCP discovery and invocation contract through the governed gateway.
- Identity/toolset binding and fail-closed schema validation in Control.
- Connection-status and OAuth-custody adapter that reveals no token material.
- Durable correlation between chat turn, MCP call, governed operation, and
  eventual result.
- Agent-visible pending, denied, expired, failed, unknown, and completed states.

## Required verification

- [ ] Natural-language prompts in the real agent complete bounded Mail,
  Calendar, and OneDrive reads through the assigned MCP tools.
- [ ] The agent sees only assigned tools; an unassigned tool name or direct MCP
  call is rejected before the provider.
- [ ] A protected delete reaches Microsoft zero times and returns a durable
  pending operation until a valid approval exists.
- [ ] Microsoft OAuth/access/refresh tokens and provider credentials never enter
  the workspace, model prompt, tool result, logs, screenshots, or evidence.
- [ ] Wrong user/tenant/workspace/agent/connection/tool/schema/item/eTag and
  mutated or replayed calls yield zero unsafe provider executions.
- [ ] Conversation refresh, workspace restart, duplicate model tool calls, and
  gateway/connector outage preserve one honest operation state.

## Evidence required

Include the exposed tool manifest, chat/tool traces, identity correlation,
credential-custody inspection, positive read results, pending-delete record,
negative matrix, and safe screenshots.

## Stop conditions

- The selected client requires a direct upstream MCP connection that bypasses
  Control or requires OAuth/provider credentials in the workspace.
- Tool calls cannot be bound to a unique agent and workspace identity.

## Completion record

Implementation completed on 2026-07-22. Claude Desktop receives a managed,
credentialless stdio MCP server containing only the policy-assigned Microsoft
365 tools. Its loopback broker holds the scoped LiteLLM and Control bridge
grants, so neither Microsoft OAuth material nor a gateway credential enters
the agent process. A protected call remains open while the connector polls the
exact governed operation and returns only its terminal execution receipt.
Automated identity, tool-policy, mutation, lease, replay, and wait/resume tests
pass. Awaiting the human natural-language Mail/Calendar/OneDrive and protected
delete pass in the rebuilt workspace image.
