# 09 — CEO Demo Plan

Date: 2026-07-04. Every "today" verdict below was verified against source this day (file-level evidence), not carried over from prior scorecards.

## The demo script (as specified)

1. **[Admin pre-setup]** Admin sets policy at the enterprise level.
2. **[Manager onboarding]** Manager sets policy at the manager/team level.
3. **[User onboarding]** Staff member is invited, spins up their own Claude sandbox, logs in with Microsoft SSO, installs/sets up the VTI 2FA app. Sandbox has a nice UI. User-level policy applies.
4. **[Live use]** User remotes into the sandbox (VNC-like) and does risky stuff. The risky action triggers 2FA to the user AND 2FA to the manager.
5. **[Ops/Audit]** Ops/audit persona sees the full audit trail.

## Beat-by-beat: verified today vs gap

| #   | Demo beat                             | Today (verified 2026-07-04)                                                                                                                                                                                                                                                                                  | Gap to demo-able                                                                                                                                                                  |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admin enterprise policy               | **PARTIAL.** `PolicyRule.scope` supports `"organization"` (schema.prisma:392); rules created via API work. No admin-grade policy UI — the approval policy builder is Phase 11.                                                                                                                               | Policy builder UI surfacing org scope                                                                                                                                             |
| 2   | Manager team-level policy             | **NO.** No Team/Department model exists in the schema at all (only Organization → Project → Agent). Strictest-wins hierarchical merge exists only in `protective-guardrails-service.ts`, which is stamped `simulator_only_not_enforced` — the Rust gateway does not fetch-and-merge org+project+agent rules. | Either add a Team model (heavy) or **treat Project as Team** (pragmatic — rename in UI copy) + wire hierarchical merge into the gateway rule fetch                                |
| 3a  | Staff invite/onboard                  | **IN FLIGHT.** Phase 9 workflow died mid-run (member-service.ts exists, no routes/UI). Phase 10 onboarding checklist not started.                                                                                                                                                                            | Resume Phase 9, then Phase 10                                                                                                                                                     |
| 3b  | Microsoft SSO                         | **NO.** NextAuth config has Google only (nextauth-config.ts:19–25). No Entra ID provider.                                                                                                                                                                                                                    | Add `microsoft-entra-id` NextAuth provider — small code change, but needs an Azure app registration in a real tenant                                                              |
| 3c  | VTI 2FA app install                   | **NO.** Delivery is `vti-outbox-local` simulation. There is no mobile app to install. Real VTA/mobile DIDComm is Phase 15 — the longest pole in the whole plan.                                                                                                                                              | For the demo: a "manager's phone" web view that renders the real VTI Trust Task envelope and lets the manager approve. Disclosed as simulation of the transport, not the envelope |
| 3d  | Sandbox nice UI                       | **PARTIAL.** List, create dialog, exec dialog, state badges exist. No sandbox detail page; exec is a text box + JSON output, **not a real terminal** (no xterm.js).                                                                                                                                          | Sandbox detail page + real in-browser terminal                                                                                                                                    |
| 3e  | User-level policy                     | **YES.** `PolicyRule.agentId` (schema.prisma:396) scopes a rule to one agent. Not surfaced well in UI.                                                                                                                                                                                                       | UI surfacing only                                                                                                                                                                 |
| 4a  | VNC into sandbox                      | **NO — and not in any existing phase.** No VNC/noVNC code anywhere. DCV/AppStream references are sibling-POC docs only. This is net-new scope.                                                                                                                                                               | See "The VNC question" below                                                                                                                                                      |
| 4b  | Risky action → user 2FA + manager 2FA | **PARTIAL.** ApprovalRequest + real VTI envelope + trigger are proven — but created via direct internal API call, not by the gateway intercepting a live request (Phase 14 gap). Also today only the **manager** gets a step-up envelope; the acting user does not.                                          | Phase 14 (live gateway hold→callback→resume) + add actor-side step-up notification                                                                                                |
| 5   | Ops/audit trail                       | **PARTIAL.** Console shows blocked-request violations from `RequestLog` (24h). The `AuditLog` table (state changes: create agent, update rule…) has **no viewer UI at all**.                                                                                                                                 | Audit trail viewer page joining RequestLog + AuditLog + ApprovalRequest into one timeline                                                                                         |

## The VNC question (net-new scope — decision needed)

"User remotes into sandbox" has two implementations with very different costs:

- **Option A — real in-browser terminal (recommended first):** xterm.js in the sandbox detail page, connected to Daytona's toolbox exec (or its PTY websocket if available). This is genuinely "the user is inside the sandbox doing funky stuff," demos well on a projector, and is days not weeks.
- **Option B — actual desktop VNC:** requires a desktop-capable sandbox image (Xvfb + noVNC or similar) in Daytona, port preview/proxy wiring, and a viewer page. Real but significantly more work, and the arm64-local/linux-prod image split adds risk. Treat as a stretch goal after Option A works.

The demo story is equally strong with A: the "risky action" that triggers 2FA can be fired from the terminal (e.g. Claude Code attempting an Outlook send through the gateway).

## What stays simulated in the CEO demo (disclose, don't hide)

1. **VTI mobile transport** — the Trust Task envelope is real; delivery to a phone is not. Demo uses a "manager device" browser tab. Real DIDComm/VTA is Phase 15.
2. **Microsoft SSO** — real only if we get an Entra app registration in time; otherwise AUTH_MODE=local with a scripted "SSO would sit here" beat. Decide one week before the demo.
3. **Outlook send** — no real Graph write connector exists. The risky action can be a real HTTP call to `graph.microsoft.com/v1.0/me/sendMail` that the gateway intercepts and holds — the _governance_ is real even though the mail account isn't.

## Re-sequenced plan (CEO-demo critical path)

Order chosen so every step makes the demo strictly more real, and slips degrade the demo gracefully rather than breaking it.

| Step | What                                                                                                      | Covers beat | Size                                        | Existing phase #           |
| ---- | --------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------- | -------------------------- |
| D1   | Resume/finish Phase 9 (members/roles UI)                                                                  | 3a          | in flight                                   | 9                          |
| D2   | Phase 10 onboarding checklist                                                                             | 3a          | S                                           | 10                         |
| D3   | Phase 11 policy builder + explainability                                                                  | 1, 3e       | M                                           | 11                         |
| D4   | Sandbox detail page + xterm.js terminal                                                                   | 3d, 4a(A)   | M                                           | **new — 12-demo**          |
| D5   | Live gateway hold → API callback → resume (the core "risky action pauses" moment)                         | 4b          | M–L                                         | 14                         |
| D6   | Dual step-up: actor notification + manager approval; "manager device" web view rendering the VTI envelope | 3c, 4b      | M                                           | **new — split from 15**    |
| D7   | Audit timeline viewer (RequestLog + AuditLog + approvals)                                                 | 5           | M                                           | **new — was buried in 23** |
| D8   | Project-as-Team policy hierarchy: gateway fetches org+project+agent rules, strictest wins                 | 2           | M                                           | **new**                    |
| D9   | Microsoft Entra SSO provider                                                                              | 3b          | S code + external dependency (Azure tenant) | **new**                    |
| D10  | Demo seed/reset (org, users, roles, policies, one violation)                                              | all         | S                                           | 19                         |
| —    | Stretch: noVNC desktop sandbox image                                                                      | 4a(B)       | L                                           | **new**                    |
| —    | Later: real VTA/mobile DIDComm (replaces D6 simulation)                                                   | 3c          | XL                                          | 15                         |

Rough calibration (based on how phases 1–8 actually went, not optimism): D1–D4 ≈ one focused week; D5–D7 ≈ one more; D8–D10 ≈ a few days. **A credible full run-through of the script is ~2.5–3 weeks of focused work**, with the mobile 2FA transport still simulated. That last part (real Phase 15) is the only piece that's months, and the demo doesn't need it if we're upfront that transport is the roadmap item.

## What we tell the CEO honestly

- The control plane, gateway enforcement, sandbox lifecycle, policy engine, and approval/evidence data model are real and tested (447 gateway unit tests, clean clippy/tsc, E2E proof script).
- The mobile 2FA transport and Microsoft connectors are the two things still simulated, and each has a concrete phase with a defined seam (VTI Trust Task envelope format is already final and real).
- Do not present the demo as production-ready — per `06-risk-register.md` R11, overstated readiness is this project's documented failure mode.
