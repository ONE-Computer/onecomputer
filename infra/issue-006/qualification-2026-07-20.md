# Issue 006 qualification — 2026-07-20

## Result

Automated and live qualification passed. Human visual and UI lifecycle review
remain before the issue can close.

## Image and application inventory

- Workspace image ID:
  `sha256:28db2aa17b8e246e7843f80649c2c3d616b5eb42b995f987a39a26b5568e0da0`
- Size: 3,334,776,532 bytes.
- Base image is pinned by digest in `Dockerfile.workspace`.
- Desktop launcher inventory: `ONEComputer-Agent.desktop` only.
- Client path: `/usr/local/bin/onecomputer-agent`.
- Removed product applications include Firefox, Chrome, Thunderbird, Signal,
  Telegram, Remmina, OBS, VS Code, Sublime Text, ONLYOFFICE, Nextcloud, Zoom,
  Slack, and GIMP.

## Effective runtime projection

The qualification workspace received one immutable Control projection:

- workspace profile: `kasm-persistent-standard`;
- agent profile: `onecomputer-default-agent`;
- network profile: `controlled-egress-v1`;
- model alias: `onecomputer-assistant`;
- MCP server: `onecomputer_ms365`; and
- exact tools: `list-mail-folders`, `list-calendars`, `list-drives`.

The LiteLLM grant was bound to the persisted agent identity and included the
policy version ID and hash. A policy projection change bypassed the grant cache
in automated tests.

## Tool transcript

The preconfigured client reported the assigned model and exactly three tools.
The following bounded calls completed through LiteLLM as the owning Microsoft
user; response content was intentionally not recorded:

| Probe | Shape | Redacted response size |
| --- | --- | ---: |
| Outlook mail folders | object | 4,728 bytes |
| Calendar list | object | 2,682 bytes |
| OneDrive drives | object | 1,343 bytes |

Revoking the workspace key blocked the still-running client. Renewing the same
scoped grant restored only the three assigned tools.

## Network denial matrix

| Target | Result |
| --- | --- |
| Microsoft Graph TCP 443 | blocked |
| Public model provider TCP 443 | blocked |
| Public IP TCP 443 | blocked |
| Link-local metadata TCP 80 | blocked |
| PostgreSQL TCP 5432 | blocked |
| Upstream Microsoft 365 MCP TCP 3000 | blocked |
| Workspace-network host gateway ports 22, 2375, 4100, 5432 | blocked |
| Alternate DNS over UDP 53 | blocked |
| QUIC-style UDP 443 | blocked |
| Docker socket | absent |

The desktop and relay ran with `no-new-privileges`; the desktop additionally
dropped `NET_ADMIN`, `NET_RAW`, and `SYS_ADMIN`. Recreating the trusted LiteLLM
service and polling workspace status restored its dynamic attachment to the
workspace network without recreating the workspace.

During human review, the local Docker daemon returned HTTP 403 when a status
poll attempted to connect an already-attached LiteLLM container. The workspace
itself was healthy. Network attachment now inspects membership first and is
idempotent across daemon-specific duplicate-connect status codes; the
regression is covered by the Kasm adapter test.

## Secret boundary

Container configuration and the owned client were scanned for Microsoft OAuth
tokens, LiteLLM master-key names, Entra client-secret names, database URLs, and
Docker authority. None were present. The only credential in the workspace was
the renewable scoped workspace/agent key.

## Persistence and cleanup

A qualification marker written under `/home/kasm-user` survived runtime
teardown and recreation. Stop-style teardown returned HTTP 204, removed the
sandbox, relay, and per-workspace network, and retained the named home volume.
Explicit storage deletion returned HTTP 204 and removed the volume. The
temporary qualification resources were absent afterward.

## Automated checks

- `npm test`: 51 passed, 0 failed.
- `npm run build`: passed for every workspace package.
- Compose configuration validation: passed.
- Workspace client Python compilation: passed.
- Git whitespace validation: passed before review handoff.
