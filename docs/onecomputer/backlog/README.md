# Backlog — index (superseded)

> **SUPERSEDED.** The 9 backlog files that lived here were LLM-authored scout
> reports and status reports. They have been removed. **Ground truth is
> [`AUDIT.md`](../../../AUDIT.md).** This index preserves the items that are
> still genuinely worth doing, with the slop stripped.

## Still-valid backlog items

### Runtime partner / sandbox adapter (highest priority — this is the owner's goal)

The removed `runtime-partner-scout-report` recommended: **make OneComputer a
governed runtime-control plane, not a single sandbox vendor clone.** It surveyed
E2B / Daytona / AWS / Browserbase / DCV. Status then: docs-only, no adapter in
code. **This is still docs-only as of 2026-06-28** — there is no `RuntimeProvider`
abstraction. The proven reference implementation is the AppStream POC
(`../onecomputer-secure-claude-computer-poc/.../secure_computer_service.py:82`,
real `boto3.client("appstream")`). Build the Daytona/E2B adapter on that pattern.

### P9 — Guardrails Runtime Controls (the real next phase)

The removed `p9-guardrails-runtime-controls-vti-overhaul` correctly identified
that the policy engine felt like compliance-document generation, while real value
is **protective runtime controls**. This is still the right direction. The audit
confirms the gap: enforcement is `simulator_only_not_enforced` and never wired to
a request gate. P9 = wire it. See the TGW-recreation gap list in `AUDIT.md`.

### Storage-agnostic control plane

Real architectural concern: DynamoDB is the AWS-pilot backend, not the permanent
architecture. Multi-user/org RBAC and a review queue are not built.

### Agent mailroom + AI employee directory / M365 projection

Both were explicitly "do not build yet / research only" per the owner. Still
queued. The M365 projection in particular has no real implementation
(`graph_preview_only` string literal).

### Mobile VTA / 2FA fork

Studied lightly, parked. Relevant to the Outlook step-up goal — see AUDIT.md.

## What was slop and is gone

- `status-report-2026-06-21-2010.md` — self-narrated loop status.
- `post-95-personal-connectors-office-hours` — "post-95" framing built on the
  self-graded 95.
