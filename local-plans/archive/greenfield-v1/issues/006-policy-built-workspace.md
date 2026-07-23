# 006: launch a policy-built managed agent workspace

Status: `complete`

Gate: E
Depends on: 005
Unblocks: 007

## Outcome

Starting a workspace applies the assigned workspace and agent policy to a
persistent Kasm desktop: a pinned minimal image, preconfigured agent client,
renewable scoped LiteLLM key, assigned Microsoft read tools, and enforced
network profile. The workspace remains wholly managed by the ONEComputer UI.

## Carried-forward baseline

- Kasm create/open/restart/stop lifecycle and persistent product identity work.
- LiteLLM holds the real `mike@metech.dev` delegated Microsoft credential and
  has successfully executed bounded Mail, Calendar, and OneDrive reads through
  a temporary same-user key.

## In scope

- Build and pin one streamlined Kasm image with the selected agent client and
  only the tools required by the MVP.
- Materialize the effective workspace/agent policy during provisioning.
- Issue a renewable workspace/agent LiteLLM key mapped to the owning user and
  limited to the assigned model alias, MCP server, and exact tools.
- Assign bounded read-only Outlook Mail, Calendar, and OneDrive tools to the
  persistent sandbox agent key.
- Enforce controlled DNS and a `restricted-standard` egress profile outside
  the workspace process.
- Keep workspace lifetime independent from short-lived grant renewal; only UI
  lifecycle actions stop, restart, or delete it.
- Report identity, network, model, and tool readiness separately and honestly.

## Out of scope

- A real paid model route, Microsoft write tools, OpenVTC, multiple workspace
  profiles, arbitrary package egress, or claims of VM-grade isolation.

## Required verification

- [x] A newly started Kasm workspace contains the pinned agent client already
  configured for ONEComputer's LiteLLM endpoint; no user secret setup is needed.
- [x] The persistent agent key discovers only its assigned Microsoft read tools
  and completes bounded Mail, Calendar, and OneDrive reads as the owning user.
- [x] The workspace never receives the Microsoft token, LiteLLM master key,
  Entra client secret, Docker authority, or PostgreSQL credentials.
- [x] Direct model provider, Microsoft Graph, upstream MCP, PostgreSQL, Docker,
  metadata/link-local, host gateway, alternate DNS/QUIC, other workspace, and
  unapproved public egress probes fail.
- [x] Proxy removal, client reconfiguration, raw hostname/IP use, and expired,
  revoked, cross-user, cross-workspace, or wrong-audience keys cannot bypass the
  boundary.
- [x] Grant renewal and full service restart preserve the workspace; Stop and
  Restart from the UI remain authoritative and leave no resource leak.
- [x] The desktop application set is deliberately minimal and the deferred
  Issue 001 application-streamlining note is resolved.

## Evidence required

Include image digest and package inventory, effective policy/grant projection,
inside-workspace tool transcript with content redacted, network-denial matrix,
container/network inspection, lifecycle/restart inventory, and secret scan.

## Stop conditions

- Containment relies only on proxy environment variables or cooperative agent
  configuration.
- The public Web/Control path receives Docker authority or provider secrets.
- Passing requires a shared user/agent key or unrestricted egress.

## Completion record

Completed and accepted on 2026-07-20. The product owner verified the minimal
desktop, assigned agent policy, real Microsoft Mail/Calendar/OneDrive reads,
and persistent home data across UI Restart and Stop/Start. Automated and live
evidence is recorded in `infra/issue-006/qualification-2026-07-20.md`.
