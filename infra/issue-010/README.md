# Issue 010 governed Claude Desktop workspace

Issue 010 replaces the qualification CLI as the primary workspace experience
with Anthropic's supported Claude Desktop Linux client. ONEComputer owns the
sandbox selection and lifecycle; Claude Desktop is a managed client of the
workspace-scoped LiteLLM gateway.

## Selected client

- Claude Desktop Linux `1.22209.3` (`amd64` Debian package)
- package SHA-256:
  `d427f46ac9233dbc4d8a441a602f09f750b8a5f05d1fc7a00285d7a6ce07655c`
- Kasm Ubuntu Jammy base:
  `sha256:58b0710b320b99ab7e352342d7ec3a25b09740c523b75d794c5f7476910da580`
- resulting local workspace image:
  `sha256:1dcbf5cbf97d4f0a2fee33a26d918176bdd7f6c490aa3813790ef9cc18bbfaef`

This follows Anthropic's supported Linux and gateway paths:

- <https://code.claude.com/docs/en/desktop-linux>
- <https://code.claude.com/docs/en/llm-gateway-connect>
- <https://claude.com/docs/third-party/claude-desktop/gateway>
- <https://claude.com/docs/third-party/claude-desktop/configuration>

Desktop does not consume Claude Code's user `settings.json`. The image writes
the organization-owned policy to
`/etc/claude-desktop/managed-settings.json` at launch.

## Runtime boundary

The selected model is one immutable LiteLLM alias:

- `onecomputer-claude` -> `anthropic/claude-sonnet-4-6`
- `onecomputer-openai` -> `openai/gpt-5.6-luna`
- `onecomputer-glm` -> `zai/glm-5`

Only LiteLLM contains provider API keys. Control mints one expiring key bound
to the workspace, agent, user, model alias, policy hash, budget, and limits.
A root-owned loopback broker holds that scoped key and forwards only
`/v1/messages` and `/v1/models`. Claude Desktop receives a meaningless local
broker key. The user process receives no provider key, LiteLLM master key, or
Control credential.

The workspace network is an internal Docker network containing only the
workspace and LiteLLM. Direct provider, Graph, MCP, PostgreSQL, Docker, Control,
and OpenVTC routes therefore have no path. MCP remains disabled in Desktop for
Issue 010; Issue 011 will add policy-scoped Microsoft 365 tools.

## Managed profile

`claude-desktop-standard-v1`:

- Chat enabled; Code and Cowork disabled.
- Deployment/model chooser disabled.
- Exactly one assigned model alias declared explicitly.
- User MCP, development MCP, extensions, automatic mode, tool search, and
  bundled skills disabled.
- Persistent `/home/kasm-user` volume retained across UI stop/start and service
  restart.
- Claude Desktop auto-starts as the primary application.

The Sandbox page persists the approved profile/model choice per user and grant.
Changes are rejected while the workspace is running and any choice outside the
user's immutable policy assignment fails closed.

## Build and start

```bash
./infra/issue-010/build-workspace.sh

docker compose \
  --env-file .env \
  -f infra/issue-002/compose.yml \
  -f infra/issue-008/compose.yml \
  up -d --build
```

Set `ONECOMPUTER_WORKSPACE_IMAGE` in the ignored `.env` to the image digest
printed by the build script. Never commit provider keys or workspace grants.

The live qualification record is
`qualification-2026-07-21.md`.
