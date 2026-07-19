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

The service has no host port. Its internal MCP URL is:

```text
http://ms365-mcp:3000/mcp
```

Only services on `gateway-private`, including LiteLLM, can reach it. It is not
yet registered in LiteLLM: that registration is intentionally held until the
dedicated Entra client and per-user authorization-code flow can be verified, so
no temporary no-auth or shared-token mode becomes part of the product path.

## Current deployed checks

- container health endpoint returned 200;
- OAuth protected-resource metadata advertised exactly the four scopes above;
- unauthenticated MCP discovery returned exactly the 33 expected read tools;
- an unauthenticated tool call returned 401 before Microsoft Graph execution;
- no host port was published;
- the process runs as UID 1000 with a read-only root filesystem, all Linux
  capabilities dropped, and `no-new-privileges` enabled;
- the locked production dependency tree reported zero npm audit findings.

Live Entra consent, per-user OAuth through LiteLLM, wrong-tenant behavior,
Graph throttling/errors, data bounding, and credential-leak scans remain
unverified.
