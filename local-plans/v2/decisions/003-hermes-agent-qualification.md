# Issue 003 Hermes Agent qualification

Date: 2026-07-23

Decision: ship the upstream product named **Hermes Agent** under the
ONEComputer catalog label **Hermes Claw**. It is an approved, policy-selected
client alongside Claude Desktop, not a replacement network or policy boundary.

## Pinned upstream

- Repository: `https://github.com/NousResearch/hermes-agent`
- Release: `v0.19.0`
- Tag: `v2026.7.20`
- Peeled source commit: `3ef6bbd201263d354fd83ec55b3c306ded2eb72a`
- Source archive:
  `https://github.com/NousResearch/hermes-agent/archive/refs/tags/v2026.7.20.tar.gz`
- Source archive SHA-256:
  `285f3fc134ff466a90065e1517801a68993733b807158ee8f32aa01613786990`
- License: MIT
- Python: CPython `3.13.5`, installed by pinned uv `0.11.6`
- Upstream uv image:
  `ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b`
- Dependency resolution: upstream `uv.lock`, installed with `uv sync --frozen
  --no-dev --no-editable`; 60 packages in the qualified base install.

## Governed configuration

Hermes is generated with an OpenAI-compatible base URL of
`http://127.0.0.1:4314/v1`. The loopback broker holds the Hermes-specific
LiteLLM key and Control bridge token and permits only model, MCP, and governed
operation paths. Hermes receives no provider, Microsoft, LiteLLM master,
database, Docker, or Control credential.

All native Hermes toolsets are disabled. The only resolved CLI toolset in the
qualified Hermes-only container is `onecomputer_ms365`, whose stdio process is
bound to the Hermes broker on port 4314. Claude Desktop uses its own broker on
port 4312 and a separately derived agent identity and grant.

The image is intentionally a fixed, reviewed two-client image. Policy controls
which launchers and grants exist:

- Claude-only: Hermes launcher and executable entry point are disabled; only
  broker 4312 listens.
- Hermes-only: Claude launcher/autostart are absent and its executable target
  is root-only; only broker 4314 listens.
- Both: both launchers exist and distinct brokers listen without PID or port
  collision.

The external workspace egress firewall remains workspace-scoped. Per-client
model and MCP identity is distinct; public destination enforcement continues
at the Issue 002 proxy boundary.

## Qualification results

- Repository build and typecheck passed.
- Automated test suite passed: 118/118.
- Reproducible workspace image build passed.
- Image inspection reported Hermes Agent `0.19.0`, Python `3.13.5`, OpenAI SDK
  `2.24.0`, and the pinned source lockfile.
- Claude-only, Hermes-only, and dual-agent containers reached healthy state.
- Disabled launcher checks, executable-mode checks, both broker health checks,
  and collision checks passed.
- Hermes resolved exactly one toolset: `onecomputer_ms365`.

## Remaining deployment verification

The local control runtime has been rebuilt, migration 011 is applied, and the
controller now points at immutable workspace image
`sha256:c64bfdd34d3cd7eea187bb19716f777ba9dee49aa76b86d341e4b4a6439e980e`.
The existing active workspace was deliberately left running on its prior image
to avoid interrupting the user.

Before marking the issue complete, stop and rebuild that workspace, then inspect
one real chat plus governed MCP discovery for each selected client. This
validates the deployed LiteLLM and Control bindings without changing the
firewall acceptance record.
