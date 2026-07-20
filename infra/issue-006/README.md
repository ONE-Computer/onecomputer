# Issue 006 managed workspace image

This directory owns the local qualification image for a policy-built
ONEComputer workspace. It deliberately contains one desktop entry: the
preconfigured ONEComputer Agent client.

## Build

```bash
./infra/issue-006/build-workspace.sh
```

The script prints the immutable image ID. Put that exact `sha256:` value in
`ONECOMPUTER_WORKSPACE_IMAGE`; do not use a mutable tag for provisioning.

## Runtime boundary

Control projects the effective policy into the workspace controller. The
controller creates:

- one internal Docker network per workspace;
- one persistent home volume per workspace, mounted at `/home/kasm-user`;
- one hardened Kasm desktop from the pinned image; and
- one loopback relay used only to open the desktop from the ONEComputer UI.

Only the trusted LiteLLM container joins the workspace network, under the
`litellm` alias. The desktop receives a renewable workspace/agent key limited
to the effective policy's model alias, MCP server, and exact tools. It does not
receive Microsoft OAuth tokens, the LiteLLM master key, Entra client secrets,
database credentials, or Docker authority.

Stop and Restart remove the runtime and network but retain the workspace home
volume. Product-level Delete additionally purges that volume. LiteLLM grant
expiry and renewal do not control workspace lifetime.

## Local review

1. Restart the workspace from `http://localhost:4174` so the current policy and
   image are materialized.
2. Open the desktop and confirm the only product launcher is ONEComputer Agent.
3. Run `status` in the agent and confirm the assigned model and exact tools.
4. Run `mail`, `calendar`, and `drives`; do not capture sensitive returned
   content in evidence.
5. Create a harmless file in the home directory, Restart from the UI, and
   confirm the file remains.
6. Stop and Start from the UI and confirm the same workspace returns.

This is local Docker/KasmVNC containment for the qualification slice. It is not
a claim of VM-grade isolation.
