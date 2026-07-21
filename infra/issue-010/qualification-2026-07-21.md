# Issue 010 qualification — 2026-07-21

Status: automated qualification passed; human product review pending.

An initial human launch exposed a duplicated API prefix: Desktop appends
`/v1/messages`, while the first managed base URL also ended in `/v1`. The
resulting `/v1/v1/messages` request was denied by the broker. The managed base
URL was corrected to the broker origin and a regression assertion was added.

The next human chat reached the broker successfully but exposed a second image
gap: Desktop's shell attempted to download its matching Claude Code engine from
Anthropic at runtime. The managed network correctly denied that direct route.
The exact engine version and checksum embedded in Desktop `1.22209.3` are now
preinstalled and seeded into Desktop's generated cache before launch.

A GLM human launch then exposed client-side model-name validation. Desktop
rejected `onecomputer-glm` before issuing an HTTP request. A subsequent smoke
test proved that an arbitrary `claude-onecomputer-glm` prefix is also rejected.
The policy alias now projects to the catalog-valid, client-only
`claude-sonnet-4-5` transport alias, which LiteLLM maps exclusively to
`zai/glm-5`. Provider-accurate policy and audit metadata remain
`onecomputer-glm`.

## Decision record

Claude Desktop Linux was selected because Anthropic now provides a supported,
signed Ubuntu/Debian package and a documented organization-managed LLM gateway
mode. The official Desktop path supports the Anthropic Messages API, streaming,
tool use, explicit model declarations, and root-managed policy without a
Claude.ai login or provider key in the workspace.

The candidate was rejected as a direct user-configured client. It qualified
only with `/etc/claude-desktop/managed-settings.json`, one explicit model alias,
and a root loopback credential broker. This prevents a workspace user from
editing the gateway destination or reading the scoped LiteLLM credential.

## Automated evidence

- Repository tests: 87 passed, 0 failed.
- TypeScript/Vite builds: passed.
- LiteLLM `POST /v1/messages`, non-streaming:
  - `onecomputer-claude`: passed
  - `onecomputer-openai`: passed
  - `onecomputer-glm`: passed
- Claude Desktop-compatible Anthropic Messages route:
  - requested alias: `claude-sonnet-4-5`
  - pinned deployment: `zai/glm-5`
  - model-restricted temporary key returned: `catalog GLM route ready`
  - response type: Anthropic `message`
  - stop reason: `end_turn`
  - streaming returned `content_block_delta` and `message_stop`
  - both temporary qualification keys were revoked after their checks
- Isolated Claude Desktop smoke test:
  - workspace image healthy
  - Desktop process running
  - managed model: `claude-sonnet-4-5`
  - visible label: `GLM — organization route`
  - gateway mode active
  - zero invalid managed-config log entries
  - all three catalog transport IDs started Desktop with zero invalid-config
    entries: `claude-sonnet-4-6`, `claude-opus-4-6`, and
    `claude-sonnet-4-5`
- LiteLLM `POST /v1/messages`, SSE streaming with
  `content_block_delta` and `message_stop`:
  - `onecomputer-claude`: passed
  - `onecomputer-openai`: passed
  - `onecomputer-glm`: passed
- Each route used a five-minute qualification key limited to that alias; each
  key was deleted after the check.
- Clean-container smoke test:
  - Kasm container healthy.
  - loopback broker healthy.
  - Claude Desktop `1.22209.3` auto-started.
  - Claude Code `2.1.215` is available from the immutable image.
  - Desktop's matching cache entry and checksum marker are seeded at startup.
  - managed gateway mode present.
  - only `onecomputer-claude` exposed in the test profile.
  - user MCP and Desktop extensions disabled.
- Final workspace image:
  `sha256:52e34e95b9b9eb76730da0ddee7f0acd298f5b7c7e2e5ef8d274d567ce1d8506`.
- Local immutable assignment advanced to policy version 5 with profile
  `claude-desktop-standard-v1`, agent profile
  `claude-desktop-managed-v1`, and the three approved aliases.

## Credential inspection

- Provider secrets enter only the LiteLLM service from the ignored `.env`.
- The image contains no provider key.
- The Desktop process receives only the loopback broker URL and its meaningless
  local key.
- The root broker receives one scoped, revocable LiteLLM key. The key is absent
  from the Kasm/Claude process environment and is not written to the persistent
  home volume.
- Docker, PostgreSQL, Control, OpenVTC, Microsoft, and LiteLLM master credentials
  are absent from the workspace.

## Human review still required

The existing local workspace was intentionally left running. Its lifecycle is
owned by the UI, so applying the new image requires the reviewer to stop it and
start it again. The review should confirm:

1. Sandbox shows the assigned Claude Desktop profile and three model choices.
2. A choice saves only while the workspace is stopped.
3. The new workspace opens with Claude Desktop already running.
4. A normal chat response visibly streams through the selected alias.
5. A harmless file created in the home directory survives UI stop/start.
6. Direct external/provider endpoints are unavailable from the workspace.

Issue 010 remains at the verification checkpoint until those product checks
are accepted.
