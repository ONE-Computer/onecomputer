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

Only six tools are registered in LiteLLM for `onecomputer_ms365`:

- `list-mail-folders`, `list-calendars`, and `list-drives` are automatically
  allowed only with `{}` or `{ "top": 1..25 }`;
- `search-onedrive-files` is limited to one drive, a 128-character query, and
  at most 10 results; its only permitted field projection is the fixed
  `id,name,eTag,parentReference` set used to discover the item ID;
- `get-drive-item` requires an exact drive/item ID and the same fixed
  projection with response headers so the current eTag can be bound;
- `delete-onedrive-file` requires `driveId`, `driveItemId`, and `If-Match` and
  never reaches Microsoft on the initial agent call;
- every other argument and Microsoft tool is undiscoverable or denied.

Control persists a delete request with the exact tenant/user/workspace,
capability, server/tool/schema identity, drive/item/eTag, policy version/hash,
nonce, and expiry. Approval creates one short execution lease. Control adds
`confirm: true` and `excludeResponse: true`; the callback atomically consumes
the exact dispatch binding before Softeria receives it. Replay or mutation is
denied. Ambiguous completion is not retried.

The complete IDs, hashes, and requalification triggers are pinned in
`tool-surface-governed.json`.

## Credentials and delegated scopes

OAuth tokens remain in LiteLLM's per-user credential store and are sent only
to Softeria for that user's call. They are never returned to Control or the
workspace. The connector requests exactly:

```text
User.Read Mail.Read Calendars.Read Files.ReadWrite
```

`Files.ReadWrite` is required for the single protected delete capability. It
does not grant the workspace unrestricted writes: LiteLLM exposes only the
six pinned tools and Control denies every delete until an exact approval
lease exists. Existing users connected under the earlier `Files.Read` slice
must disconnect and reconnect once to consent to the new scope.

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
