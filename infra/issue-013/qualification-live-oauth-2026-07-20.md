# Issue 013 live Microsoft OAuth qualification — 2026-07-20

## Result

The owned ONEComputer connection flow completed real delegated Microsoft OAuth
for `mike@metech.dev`. LiteLLM stored the per-user MCP credential and the
pinned Softeria connector successfully executed bounded read-only Mail,
Calendar, and OneDrive discovery through a temporary key mapped to the same
ONEComputer user. No mailbox, event, drive, file, or token content was retained
as evidence.

Issue 013 remains in verification because the persistent sandbox agent key has
not yet been assigned the qualified Microsoft 365 tools.

## Safe status and identity evidence

- ONEComputer safe status returned `connected` with connection time
  `2026-07-20T05:39:27.371269+00:00` and access-token expiry
  `2026-07-20T06:56:23.371256+00:00`.
- The Softeria audit stream identified the delegated Microsoft principal as
  `mike@metech.dev`.
- LiteLLM was restarted twice. The safe credential status remained connected,
  proving the credential record was loaded from its durable PostgreSQL store.
- After restart, scoped `tools/list` discovery restored the pinned server's
  runtime tool registry and exposed only the three assigned qualification
  tools.

## Bounded live reads

A three-minute qualification key used the same deterministic LiteLLM `user_id`
as the local ONEComputer identity and was limited to `onecomputer_ms365` plus
three exact tools. The key was deleted in a `finally` cleanup.

| Tool | Arguments retained | Result retained |
| --- | --- | --- |
| `list-mail-folders` | `top: 1`, `select: id` | HTTP 200, MCP success, 1 item |
| `list-calendars` | `top: 1`, `select: id` | HTTP 200, MCP success, 1 item |
| `list-drives` | `top: 1`, `select: id` | HTTP 200, MCP success, 0 items |

The connector audit recorded all three as successful Graph-backed `GET` tool
calls for `mike@metech.dev`.

## Callback-log hardening

The first real callback exposed a qualification defect: Uvicorn's generic
access logger recorded the callback request URL, including Microsoft's
short-lived authorization code. No access or refresh token was logged. The
LiteLLM deployment now uses `litellm-log-config.yaml` to disable only
`uvicorn.access`; LiteLLM operational and error logs remain enabled.

After recreating and restarting the gateway:

- a sentinel query parameter did not appear in logs;
- `/callback?code=` did not appear in logs;
- configured master, salt, credential-derivation, and Entra client-secret
  values did not appear in logs; and
- `access_token`, `refresh_token`, and `client_secret` fields did not appear in
  logs.

## Regression checks

- `npm run build`: passed for every workspace.
- `npm test`: passed 41/41 tests.
- Docker Compose configuration validation passed.
- LiteLLM, Softeria, and the owned safe status endpoint remained healthy after
  the logging change and gateway restarts.

## Remaining verification

- Assign the approved read-only Microsoft 365 server/tools to the persistent
  sandbox agent key without broadening any write permissions.
- Discover and invoke the same bounded tools from the running managed
  workspace, proving the sandbox receives only its LiteLLM key and never the
  Microsoft credential.
- Complete the remaining cross-workspace, cross-tenant, refresh/revocation,
  provider-error, and recovery matrix tracked by Issue 008.
