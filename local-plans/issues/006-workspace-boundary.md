# 006: harden and connect the Kasm workspace boundary

Status: `blocked`

Gate: D
Depends on: 005
Unblocks: 007

## Outcome

The working Kasm sandbox lifecycle from Issue 001 receives a short-lived,
audience-bound gateway grant and enforced network profiles that make the
governed model and MCP path from Issue 005 unavoidable.

## In scope

- Harden the private `apps/workspace-controller` and `packages/kasm-adapter`
  created in Issue 001 without broadening their lifecycle authority.
- Extend the existing per-workspace network and readiness model with controlled
  DNS, scoped gateway grants, and governed capability readiness.
- Define `restricted-standard` and bounded `developer` egress profiles.
- Bake and pin the agent tooling added to the existing workspace image; no
  dynamic privileged bootstrap from mutable sources.
- Connect the real workspace to the Issue 005 model/MCP path.

## Out of scope

- Claims of VM/microVM isolation, MDM/EDR, production autoscaling, physical
  OpenVTC, OneDrive, or broad web egress.

## Required verification

- [ ] Public web/control containers have no Docker socket or host-control token.
- [ ] Workspace can reach only its allowed gateway, controlled DNS, session
  support, and profile-specific destinations.
- [ ] Direct hostname/IP model provider, MCP, metadata/link-local, database,
  Docker, alternate DNS, UDP/QUIC, host gateway, other workspace, and other
  Docker network probes fail.
- [ ] Removing proxy variables or changing client configuration does not bypass
  enforcement.
- [ ] Cross-tenant/workspace/audience grant reuse and expired/revoked grants
  fail before upstream.
- [ ] Gateway, Control, DNS, and egress-policy outage fail closed.
- [ ] Create/retry/restart/delete/recreate leaves no port, relay, container,
  network, grant, or ownership leak.
- [ ] Desktop, tooling, governance, model, and capability readiness remain
  separate and honest.
- [ ] Governed read/approval flow remains green from inside the workspace.

## Evidence required

Include network diagram, route/firewall/DNS inspection, clean-environment probe
matrix, grant claims, container privilege inventory, lifecycle leak inventory,
image digests, and residual isolation language.

## Stop conditions

- Containment relies on environment variables or cooperative clients.
- The public API requires Docker authority.
- Network identity cannot distinguish workspaces.
- Passing requires unrestricted egress or shared credentials.

## Completion record

Not complete.
