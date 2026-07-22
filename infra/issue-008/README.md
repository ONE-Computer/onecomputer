# Issue 008 governed Microsoft 365 tools

This overlay keeps Softeria's pinned Microsoft 365 MCP server private behind
LiteLLM while making ONEComputer Control the decision authority immediately
before each Microsoft tool execution.

The workspace receives one LiteLLM key bound to its owned tenant, user, agent,
workspace, and immutable policy version. LiteLLM resolves that key and the
exact MCP tool, then the mounted `onecomputer_policy_callback.py` sends the
authenticated binding and exact arguments to Control. Missing context,
unknown/malformed decisions, timeout, or Control outage deny the call.

## Qualified capability surface

Exactly 37 curated tools are registered for Outlook Mail, Calendar, OneDrive,
and Teams. List/get/search tools default to `allow`. Every create, update,
move, copy, upload, send, reply, forward, or delete tool defaults to
`approval_required`. The Admin UI can version any individual decision as
Allow, Require approval, or Block. Tools outside the curated list remain
undiscoverable.

Control validates each call against an owned strict schema and persists every
protected request with the exact tenant/user/workspace, capability,
server/tool/schema identity, arguments, policy version/hash, nonce, and
expiry. Approval creates one short execution lease. Only Control adds
`confirm: true`; the callback atomically consumes the exact dispatch binding
before Softeria receives it. Replay or mutation is denied.

The complete catalog, strict schema IDs/hashes, and requalification triggers
are pinned by `m365ToolCatalog`, `mcp-policy.ts`, and
`tool-surface-governed.json`.

## Credentials and delegated scopes

OAuth tokens remain in LiteLLM's per-user credential store and are sent only
to Softeria for that user's call. They are never returned to Control or the
workspace. The connector requests exactly:

```text
User.Read offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite
Chat.Read ChatMessage.Read ChatMessage.Send Team.ReadBasic.All Channel.ReadBasic.All
ChannelMessage.Read.All ChannelMessage.Send
```

These delegated permissions do not grant the workspace unrestricted writes:
LiteLLM exposes only the pinned tools and Control applies the immutable
per-tool policy immediately before execution. Existing connections must be
disconnected and reconnected once to receive the expanded token scopes.

## Pin and network record

- LiteLLM: `v1.93.0` at the digest in `infra/issue-002/compose.yml`
- Softeria package: `@softeria/ms-365-mcp-server@0.131.2`
- upstream tag/commit: `v0.131.2` / `0dd76d275dbf58366a8f349c7cc86bf0b970bdc3`
- license: MIT
- stable LiteLLM server ID: `9885e7f76089931fc5365104183af8ea`

The connector is reachable only from `gateway-private`; only the connector
joins `ms365-egress`. Workspaces can reach LiteLLM but cannot reach Softeria,
Graph, PostgreSQL, Docker, or Control directly. Port 4311 is a loopback-only
local OAuth browser bridge. Replace it with authenticated HTTPS before
production.

## Start

```bash
docker compose \
  --env-file .env \
  -f infra/issue-002/compose.yml \
  -f infra/issue-008/compose.yml \
  up -d --build
```

The dedicated Entra application values stay in the ignored `.env`. Never paste
OAuth tokens or provider secrets into chat or commit them.

## Verification

Automated tests cover exact identity/policy binding, bounded reads, over-broad
arguments, protected-operation persistence, mutation, exact lease dispatch,
and replay. The live qualification record is
`governed-policy-qualification-2026-07-20.md`.

Human review completed on 2026-07-21 with one disposable file: the request
remained pending before approval, executed once after the UI decision, deleted
the bound Microsoft item, and produced a durable successful receipt.
