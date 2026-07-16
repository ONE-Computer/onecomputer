# 07 — Investor Readiness Plan (YC / Khosla)

## What must be true before pitching

This is a checklist, not a narrative. Each row needs a real artifact, not a claim.

| Requirement                                                               | Status (2026-07-04)                                                                                                                                          | Blocking phase           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Live demo that doesn't depend on lucky state                              | Not done — no seeded/reset-able org                                                                                                                          | Phase 19                 |
| One coherent 5-minute story: sandbox → risky action → approval → evidence | Proven at the API layer (`e2e-goal-proof.mjs`), not yet as a click-through UI demo                                                                           | Phase 20                 |
| Enterprise-credible RBAC UI (who can invite/approve/see what)             | Missing — no `/settings/members` or `/settings/roles`                                                                                                        | Phase 9 (next)           |
| A real risky connector to gate (Outlook send)                             | Not built in this repo; only a read-only Graph client exists in a sibling POC                                                                                | Phase 16/17              |
| One-page architecture diagram                                             | Not built                                                                                                                                                    | Phase 8 (Graphify) below |
| 1-liner / wedge / why-now / buyer / moat / pricing hypothesis             | Not written                                                                                                                                                  | Phase 21                 |
| Security story that survives a technical diligence question               | Partial — real MITM proxy + policy engine is genuine; VTI signer is not yet a real external verifier (see [`06-risk-register.md`](./06-risk-register.md) R2) | Phase 15/23              |
| Deployment story (can a buyer actually run this)                          | Not built — local Docker Compose only                                                                                                                        | Phase 24                 |

## Honest positioning for this stage

Say this, not more:

- "We have a real Rust MITM policy gateway and a working sandbox-to-approval-to-VTI-envelope path, proven end to end locally, with 447 passing gateway unit tests and a clean TypeScript build."
- "The mobile approval delivery is currently a local simulation of the VTI outbox — the envelope format is real, the DIDComm delivery to a phone is the next milestone."
- "RBAC exists at the API/ability layer today; the admin UI to manage it is in progress (Phase 9)."

Do not say "95% ready," "enterprise-grade," or "production" until Phase 14/15/22/23 close — those specific words previously caused a documented credibility problem (`AUDIT.md`, the self-graded 95/100 scorecard).

## Sequencing to a pitch-ready state

1. Phase 9/10/11 (RBAC UX + onboarding) — makes the product look like something an enterprise buyer, not a solo developer, would use.
2. Phase 19 (demo mode) — removes live-state risk from the pitch meeting itself.
3. Phase 17 (Outlook send + approval) — gives the pitch a real, relatable "risky action" instead of a synthetic one.
4. Phase 20 (demo script + video) — package the above into the actual 5-minute story.
5. Phase 21 (narrative) — write the 1-liner/wedge/moat only after 1–4 exist, so the narrative describes something real.
6. Phase 8/graphify (architecture graph) — use the generated system graph (see [`08-graphify-plan.md`](./08-graphify-plan.md)) as the one-page architecture diagram; don't hand-draw one that drifts from the real code.

## What NOT to build for the pitch

- Do not build a second, prettier "demo-only" version of the product that diverges from what's in this repo — diligence will find the gap.
- Do not fabricate metrics/usage dashboards (Phase 25) before there's a single real pilot user generating that data.
- Do not promise a deployment architecture (Phase 24) more specific than "self-hosted Docker Compose today; AWS reference architecture is designed but not deployed" until Phase 24 actually ships something.
