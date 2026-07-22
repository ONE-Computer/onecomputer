# 011: connect the real agent to governed Microsoft 365 tools

Status: `verification` (expanded governed Microsoft surface is active; cross-service action checks remain)

Gate: J
Depends on: 010
Unblocks: 012

## Outcome

The real in-workspace agent discovers only its assigned Microsoft 365 tools and
can use natural-language chat for a bounded, useful Mail, Calendar, OneDrive,
and Teams work surface. Reads may run immediately. Every write is governed by
the effective per-tool policy and defaults to signed approval.

## In scope

- Attach the existing LiteLLM MCP server/toolset to the agent identity and
  workspace assignment created in Issue 010.
- Expose approved tool descriptions and schemas to the selected agent client.
- Carry user, tenant, workspace, agent, model, connection, toolset, and request
  identity from chat through Control to the Microsoft MCP adapter.
- Use the user's existing ONEComputer Microsoft 365 connection without copying
  OAuth tokens into the workspace or agent client.
- Support bounded Mail list/read, draft, send, reply, forward, move, update,
  and delete actions.
- Support bounded Calendar event list/read/create/update/delete actions.
- Support bounded OneDrive list/search/read, folder creation, upload,
  move/rename, copy, and delete actions. Qualify Softeria's path-based
  create-file behavior before claiming new-file creation.
- Support bounded Teams discovery and interaction: list the signed-in user's
  chats and joined teams, read chat/channel messages, and send or reply to
  chat/channel messages.
- Convert every policy-protected write into the existing durable governed
  operation and return a clear pending-approval result to the agent.
- Resume or report the result to the same conversation after terminal state,
  without reissuing the provider mutation.

## Out of scope

- Policy authoring UI, additional connectors, recursive/bulk operations,
  autonomous background runs, Teams administration, channel creation/deletion,
  membership changes, or arbitrary edit/delete of Teams messages.

## Required implementation

- Agent-to-MCP discovery and invocation contract through the governed gateway.
- Identity/toolset binding and fail-closed schema validation in Control.
- Connection-status and OAuth-custody adapter that reveals no token material.
- Durable correlation between chat turn, MCP call, governed operation, and
  eventual result.
- Agent-visible pending, denied, expired, failed, unknown, and completed states.
- A pinned capability manifest for the selected Softeria 0.131.2 tools and the
  exact delegated Graph scope set. The initial expansion target is:
  `Files.ReadWrite`, `Calendars.ReadWrite`, `Mail.ReadWrite`, `Mail.Send`,
  `Chat.Read`, `ChatMessage.Read`, `ChatMessage.Send`, `Team.ReadBasic.All`,
  `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, and
  `ChannelMessage.Send`, plus `User.Read` and `offline_access`.

## Required verification

- [ ] Natural-language prompts in the real agent complete bounded Mail,
  Calendar, OneDrive, and Teams reads through the assigned MCP tools.
- [ ] A disposable draft/email, calendar event, OneDrive item, chat message,
  and channel reply exercise the selected create/update/delete-or-send paths;
  no unreviewed Softeria tool is discoverable.
- [ ] The Entra application and connector request exactly the pinned delegated
  scope set, tenant admin consent is visible, and a fresh ONEComputer reconnect
  receives the expanded grant without exposing tokens.
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
pass. The rebuilt workspace image is ready for the remaining human Mail,
Calendar, and negative/restart checks.

On 2026-07-22 the product owner completed the human real-agent OneDrive pass.
Claude Desktop discovered the assigned Microsoft tools, found the disposable
file, fetched the item state needed by policy, requested the protected delete,
waited on the durable governed operation, observed the approved terminal
receipt, and confirmed deletion. The workspace never received the Microsoft
OAuth credential. Human Outlook Mail and Calendar reads, plus the remaining
negative/restart checks in this issue, are still open; therefore Issue 011 is
not yet marked complete.

Later on 2026-07-22 the product owner expanded the required MVP surface to
basic governed Mail, Calendar, OneDrive, and Teams interaction. Local
inspection of the pinned Softeria 0.131.2 endpoint catalog and its own
`--list-permissions` output confirmed support for the requested Mail/Calendar/
OneDrive tools and for Teams chat/channel read, send, and reply. The pinned
package calculated the exact delegated scope set recorded above. Full CRUD of
arbitrary Teams messages is not a supported Microsoft Graph promise; the MVP
uses the useful read/send/reply boundary instead. This scope change returns the
issue to implementation until the curated manifest, schemas, policy defaults,
Entra consent, and human checks are complete.

The expanded implementation was then deployed and activated on 2026-07-22.
The administrator saved the reviewed 37-tool Mail, Calendar, OneDrive, and
Teams policy, reconnected Microsoft 365 with the expanded admin-consented
delegated scopes, and stopped and started the sandbox so the new immutable
policy assignment was projected into the agent workspace. The product owner
confirmed that Claude Desktop now receives the expanded governed surface. The
curated manifest, strict schemas, safe defaults, connection grant, and real
sandbox projection are therefore accepted implementation evidence. Issue 011
moves to verification; natural-language cross-service actions and the listed
negative, credential-custody, and restart checks remain open.

During natural-language verification on 2026-07-22, `list-calendar-events`
returned historical series because it has no implicit from-now window. The
curated surface now also includes Softeria's `get-calendar-view`, with required
ISO start/end values, a maximum 93-day window, normal 25-item pagination
bounds, and explicit agent guidance to use it for next/upcoming/today/week
queries. No additional Entra scope is required. The same verification exposed
LiteLLM's four-request workspace concurrency ceiling as the source of agent
retry storms; the workspace grant now permits 30 parallel requests while
retaining the existing 30 RPM, token, and budget limits. Automated build and
all 102 tests pass. The deployed LiteLLM registration advertises 38 governed
tools including `get-calendar-view`, and the live workspace key reports 30
parallel requests. A new administrator policy save and sandbox stop/start are
still required to project tool 38 into the immutable workspace assignment.
