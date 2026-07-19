# Issue 008 early Microsoft 365 connector bring-up

This overlay adds Softeria's Microsoft 365 MCP server to the existing Issue 002
stack as the private `ms365-mcp` service. It is an early, reversible candidate
deployment; it does not close Issue 008 or claim live Microsoft qualification.

The service covers three product capability families:

- Outlook Mail read and search;
- Outlook Calendar read, calendar view, and availability lookup; and
- OneDrive file/folder browse, metadata, and search.

The initial surface is intentionally read-only. `send-mail`, event creation or
mutation, and OneDrive mutation/deletion are not discoverable. Later work must
enable individual write tools only through ONEComputer's governed-operation and
execution-lease path.

## Pin and supply-chain record

- npm package: `@softeria/ms-365-mcp-server@0.131.2`
- npm integrity:
  `sha512-gX2pDV12LDtwRaKBqLUPwLZTEHAFIp/uETfwVhuFnC0PM/Cygu0YvYJaAbTK3g3dkGjuPHKbTVJi7fXmDUegTg==`
- upstream source tag: `v0.131.2`
- upstream source commit: `0dd76d275dbf58366a8f349c7cc86bf0b970bdc3`
- license: MIT
- base image: `node:24-alpine` at OCI digest
  `sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`
- first qualified local image:
  `onecomputer/softeria-ms365-mcp@sha256:1f24a474e7f0605ec55e621f4b2273ac79bd040c6a8a87ff41ea3335266437bb`

The committed npm lockfile pins the full dependency graph and registry
integrities. Rebuilds must re-run the tests below and record the resulting local
image digest instead of assuming it remains identical.

## Effective permission boundary

The server advertises only these delegated Microsoft Graph scopes:

```text
User.Read Mail.Read Calendars.Read Files.Read
```

The `mail,calendar,files` presets are further restricted by `--read-only` and
the explicit scope allowlist. Pagination is capped at 4 pages / 100 accumulated
items, and `$top` is capped at 25.

The currently pinned deployment exposes 33 tools, recorded in
`tool-surface-readonly.json`. Any tool-name or input-schema change is a
requalification trigger.

## Start

Run the overlay with the existing stack definition:

```bash
docker compose \
  -f infra/issue-002/compose.yml \
  -f infra/issue-008/compose.yml \
  build ms365-mcp

docker compose \
  -f infra/issue-002/compose.yml \
  -f infra/issue-008/compose.yml \
  up -d --no-deps ms365-mcp
```

Before real OAuth, set `ONECOMPUTER_MS365_CLIENT_ID` and
`ONECOMPUTER_MS365_TENANT_ID` to the dedicated single-tenant Entra app values.
The default all-zero client ID makes authentication fail closed and avoids
silently using Softeria's shared application. If the Entra app is confidential,
provide its secret through an approved runtime secret mechanism as
`ONECOMPUTER_MS365_CLIENT_SECRET`; do not commit it.

Its internal MCP URL is:

```text
http://ms365-mcp:3000/mcp
```

Only services on `gateway-private`, including LiteLLM, can reach that URL. The
separate `ms365-egress` network gives only the trusted connector the outbound
lane required for Microsoft login and Graph calls; workspaces do not join it.
Production must constrain that lane to the approved Microsoft endpoints.

For local browser consent only, the connector is bound to host loopback and
advertised as `http://localhost:3001`; it is not reachable from the LAN or a
sandbox. Its redirect allowlist contains only LiteLLM's local OAuth callback at
`http://localhost:4000/callback`. Entra permits local HTTP web callbacks only
with the literal `localhost`, so open the LiteLLM UI through
`http://localhost:4000/ui` during consent. Replace this development exception
with an authenticated HTTPS authorization route before production.

The Issue 008 LiteLLM overlay registers the server as `onecomputer_ms365` with
an interactive per-user authorization-code flow. LiteLLM is configured to
retain each user's OAuth tokens; the connector receives a bearer token only for
that user's tool call. The server is not assigned to existing workspace keys,
so registration does not grant a sandbox access.

The gateway can discover the read-only tool catalog before Microsoft consent,
but real tool execution requires the dedicated Entra client ID/tenant ID and a
user-completed browser consent flow. No OAuth token or Microsoft password should
be pasted into chat, committed, or passed to a workspace.

## Current deployed checks

- container health endpoint returned 200;
- OAuth protected-resource metadata advertised exactly the four scopes above;
- unauthenticated MCP discovery returned exactly the 33 expected read tools;
- LiteLLM loaded `onecomputer_ms365` and the same 33-tool allowlist while the
  existing workspace grant remained unassigned;
- the local OAuth bridge redirected LiteLLM -> loopback connector -> the
  tenant-scoped Microsoft authorization endpoint with only the four allowed
  Graph scopes plus `offline_access`;
- the connector-only egress lane reached Microsoft login and Graph metadata;
- an unauthenticated tool call returned 401 before Microsoft Graph execution;
- no non-loopback host port was published; local port 3001 exists only for the
  browser leg of OAuth;
- the process runs as UID 1000 with a read-only root filesystem, all Linux
  capabilities dropped, and `no-new-privileges` enabled;
- the locked production dependency tree reported zero npm audit findings.

Live Entra consent, per-user OAuth through LiteLLM, wrong-tenant behavior,
Graph throttling/errors, data bounding, and credential-leak scans remain
unverified.
