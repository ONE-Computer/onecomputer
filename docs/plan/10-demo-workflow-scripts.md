# 10 — Demo Workflow Scripts (D4–D10) — For Review

These are the new `.workflows/*.js` scripts that implement the CEO-demo critical path from [`09-ceo-demo-plan.md`](./09-ceo-demo-plan.md). Each is grounded in seams verified against source on 2026-07-04 (not prior scorecards). Review the scripts themselves; this doc is the map.

## The scripts

| Step | File                                             | Demo beat(s)                                  | Touches                        | Risk                                    |
| ---- | ------------------------------------------------ | --------------------------------------------- | ------------------------------ | --------------------------------------- |
| D4   | `.workflows/phase-12-sandbox-terminal.js`        | 3d nice sandbox UI, 4a "remote in" (Option A) | web + api                      | Low                                     |
| D5   | `.workflows/phase-14-gateway-approval-bridge.js` | 4b risky action → hold → approve              | **gateway (Rust) + api**       | **High — core moment**                  |
| D6   | `.workflows/phase-15a-dual-stepup.js`            | 3c 2FA app, 4b user+manager 2FA               | web + api                      | Medium                                  |
| D7   | `.workflows/phase-16-audit-timeline.js`          | 5 ops/audit trail                             | web + api                      | Low                                     |
| D8   | `.workflows/phase-17-policy-hierarchy.js`        | 1 enterprise policy, 2 team policy            | **gateway (Rust) + api + web** | **High**                                |
| D9   | `.workflows/phase-18-entra-sso.js`               | 3b Microsoft SSO                              | web                            | Low — Azure app reg already provisioned |
| D10  | `.workflows/phase-19-demo-seed.js`               | all (removes live-state luck)                 | api + web                      | Low                                     |

Plus the three already-scripted UX phases that come first: `phase-9-enterprise-admin-rbac.js` (needs resuming — it died mid-run), `phase-10-enterprise-onboarding.js`, `phase-11-rbac-explainability.js`.

## Recommended run order and why

```
phase-9  (resume)  ── members/roles UI          (in flight — resume dead run, do first)
phase-20-A         ── resolve phase-9 orphans    (same step as above; see 11-cleanup-refactor.md)
phase-10           ── onboarding checklist       (links to 9's pages)
phase-11           ── policy builder + explain   (uses 9's role model)
phase-20-B/C/D     ── cleanup/refactor            (parallel with 12/17/18; NOT blocking)
phase-12  (D4)     ── sandbox terminal           (independent; can run early/in parallel)
phase-14  (D5)     ── gateway approval bridge    (the core; do NOT skip or fake)
phase-15a (D6)     ── dual step-up + device page (needs 14's held-approval to be real)
phase-16  (D7)     ── audit timeline             (richer once 14/15a produce real events)
phase-17  (D8)     ── policy hierarchy           (independent of 14; folds in guardrail/policy
                                                   service consolidation from 20-D.4)
phase-18  (D9)     ── Entra SSO                   (Azure app reg DONE — no longer blocked)
phase-19  (D10)    ── demo seed                   (LAST — seeds data the others produce/consume)
```

**Phase 20 (cleanup/refactor)** — see [`11-cleanup-refactor.md`](./11-cleanup-refactor.md). 20-A
(resolve phase-9's orphaned `member-service.ts`) is a blocking part of the phase-9 resume, not
optional. 20-B/C/D (workflow script archival, doc consolidation, audit-logging gaps, dead-script
removal) are real but non-blocking — safe to run in parallel with 12/17/18, or slot in whenever
there's a gap. God-file splits and the guardrail/policy triplication are explicitly deferred past
the demo (the latter folds into phase-17 instead of a separate pass).

Hard dependencies:

- **15a depends on 14** — the manager device page approves a real held request; without 14 the approval isn't wired to anything live.
- **19 should be last** — it seeds approvals/violations that assume 14/15a/16 shapes exist.
- **18's Azure registration is DONE** (provisioned 2026-07-04 via az CLI, single-tenant giniresearch tenant; IDs + secret already in gitignored `.env`; see `docs/plan/runbooks/entra-sso-setup.md`). No longer a blocker — phase-18 now just wires the provider code and verifies the OIDC round-trip.
- **12, 17, 18 are otherwise independent** and can run in parallel with the 9→10→11 chain if you have the appetite.

## The load-bearing correction that shaped D5 (phase-14)

My first demo-plan draft assumed the gateway just returns 403 on a risky action. **That's wrong** — verified in `apps/gateway/src/gateway/forward.rs:447-568`: the gateway _already holds_ the request on a `watch` channel for 180s and only 403s on deny/timeout. The real gap is narrower and precise:

1. The gateway holds **in-memory only** — it never creates the durable `ApprovalRequest` (no HTTP call from `forward.rs` to the API). Today's `e2e-goal-proof.mjs` creates that record _separately_, so the held path and the visible-approval path have never been proven together.
2. `approval-service.decideApproval()` writes the decision but **never calls the gateway's `submit_decision()`** to wake the held request.

So phase-14 bridges **both directions**: gateway → API on hold (create durable record), and API → gateway on decision (wake the held request). The script's phase 14-A forces a design-lock agent to choose **poll vs push** before any code is written — I've recommended **poll** (gateway polls `GET /v1/internal/approvals/:id/status`) as fewer moving parts for the demo, with push noted as the production follow-up. **This is the one decision I'd most like your input on.**

## Decisions baked into the scripts (flag if you disagree)

1. **"VNC" = in-browser terminal, not desktop VNC** (phase-12). xterm.js over the existing one-shot exec (no PTY/websocket added, because none exists). Real desktop noVNC is deferred as a stretch goal. If you specifically need a _graphical_ desktop in the demo, say so — that's a much bigger phase.
2. **"Team" = Project** (phase-17). No new Team model; Project is relabeled "Team" in UI. Cheapest path to a real manager/team policy level. Alternative (real Team model) is heavier — flag if the org structure genuinely needs teams distinct from projects.
3. **2FA transport stays simulated** (phase-15a). The Trust Task envelope is cryptographically real; delivery is a web "manager device" page, openly labeled as simulated. Real mobile DIDComm is Phase 15 (months, not this cycle). Every surface says so honestly.
4. **Poll over push for the approval callback** (phase-14) — see above.
5. **gbrain import is NOT run inside these workflows** — the OpenAI embedding key is currently broken (your action item). Each script appends to the gbrain markdown files but skips `gbrain import`, so nothing fails on the broken key. Reconcile once the key is fixed.
6. **Every verify+commit phase pastes real output and refuses to commit red** — and cargo test is always run WITH `DATABASE_URL`/`SECRET_ENCRYPTION_KEY` set, per the [`05`](./05-e2e-and-readiness-gates.md) rule, so "passed" isn't hollow.

## What these scripts deliberately do NOT do

- No real Microsoft Graph mail send (no write connector exists; the risky action is a real gateway-intercepted call, the mail account is not real).
- No real mobile app / DIDComm.
- No new crypto anywhere (no-DIY-crypto rule).
- No Team/Department schema model.
- No wholesale upstream merge.

## How to review

Read the scripts in this order: `phase-14` first (it's the crux and carries the most verified-seam commentary), then `phase-12`, `phase-15a`, `phase-16`, `phase-17`, `phase-18`, `phase-19`. Each script's top-of-file comment block lists the exact file:line seams it relies on, so you can spot-check my assumptions. Tell me which decisions above to change, and I'll revise the scripts before any of them run.
