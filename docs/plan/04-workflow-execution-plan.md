# 04 — Workflow Execution Plan

## Purpose

Which `.workflows/*.js` agents to run, in what order, and how to verify each one actually shipped working code rather than a self-graded scorecard. Every workflow completion must be followed by the verification commands in [`05-e2e-and-readiness-gates.md`](./05-e2e-and-readiness-gates.md), not just the workflow's own internal "Verify" phase.

## Ground rule

A workflow is a code generator, not a proof. After any `/workflow .workflows/<name>.js` run:

1. `npx tsc --noEmit` in `apps/web` must be clean.
2. `cargo test` + `cargo clippy -- -D warnings` in `apps/gateway` must be clean (only if the workflow touched Rust).
3. The specific new UI/route must be hit manually (curl or browser) — not assumed from the workflow's own log.
4. Commit only after 1–3 pass.

## Already run

| Workflow                                          | Status       | Verified how                           |
| ------------------------------------------------- | ------------ | -------------------------------------- |
| `sprint-1-gateway.js`                             | done         | gateway tests                          |
| `sprint-2-identity.js`                            | done         | vti_signer tests                       |
| `sprint-3-sandbox.js`                             | done         | e2e-goal-proof.mjs                     |
| `phase-1-sandbox-wiring.js`                       | done         | `/v1/sandboxes` real Daytona create    |
| `phase-2-gateway-enforcement.js`                  | done         | policy.rs + condition_match.rs tests   |
| `phase-3-identity.js`                             | done         | vti_signer + identity_injection tests  |
| `phase-4-package-gate.js`                         | done         | Verdaccio :4873 live                   |
| `phase-i-identity-wire.js`                        | done         | Phase I clippy clean                   |
| `sprint-e-gateway-sequential.js`                  | done         | G1–G4 verified                         |
| `sprint-a-ic-cockpit.js` / `sprint-a-complete.js` | done         | tsc clean, sandboxes nav               |
| `sprint-b-cyber-console.js`                       | done         | `/console` route                       |
| `sprint-c-manager-approvals.js`                   | done         | approvals route + VTI envelope         |
| `sprint-f-rbac.js`                                | done         | `ability.test.ts`                      |
| `sprint-g-package-gate.js`                        | done         | blocklist extended                     |
| `phase-6-nav-first-impressions.js`                | partial      | needs final visual pass                |
| `phase-7-persona-polish.js`                       | partial      | created; output not re-verified        |
| `phase-8-coherence.js`                            | not verified | run after Phase 7 confirmed            |
| `phase-e2e-system-tests.js`                       | done         | `e2e-goal-proof.mjs` is the artifact   |
| `goal-close-vti-2fa.js`                           | done         | this is the goal-proof script's origin |

## Next in sequence

### Phase 9 — `.workflows/phase-9-enterprise-admin-rbac.js`

Scope (from the script itself):

- Members API: `packages/api/src/routes/members.ts`, `member-service.ts`, mounted at `/v1/members`
- Members UI: `/settings/members` — invite, role assignment, disable/remove
- Roles UX: `/settings/roles` role matrix + role badge in sidebar/header
- Built-in verify phase: tsc + route smoke + UI HTTP checks
- Built-in commit phase

Roles: `owner | admin | manager | member` mapped to UI labels Owner/Platform, Cyber Admin, Manager, Employee. Must not replace NextAuth — RBAC UX sits on top of `ability.ts`.

Post-run verification (in addition to the workflow's own):

```bash
curl -s http://127.0.0.1:10254/v1/members | jq .
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:10254/settings/members
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:10254/settings/roles
```

### Phase 10 — `.workflows/phase-10-enterprise-onboarding.js`

Scope: replace the OneCLI developer-first "Get Started" modal with an enterprise checklist (invite users, assign roles, configure package gate, create approval policy, boot sandbox, view Cyber console). Run only after Phase 9's members/roles pages exist, since the checklist links to them.

### Phase 11 — `.workflows/phase-11-rbac-explainability.js`

Scope: `PermissionGate` component, disabled-action reasons, RBAC audit panel, approval policy builder. Depends on Phase 9's role model being visible in the UI — run last of the three.

## Sequencing constraint

Phase 9 → Phase 10 → Phase 11, strictly in that order. Phase 10's onboarding checklist references Phase 9's settings pages; Phase 11's explainability surfaces reference both. Do not parallelize these three.

## Not yet scripted (need a new `.workflows/*.js` before running)

These phases from [`03-phase-roadmap.md`](./03-phase-roadmap.md) have no workflow script yet:

- Phase 13 — approval summaries (`summary.rs`, Gmail/Calendar preview)
- Phase 14 — live gateway → API manual-approval bridge
- Phase 15 — real VTA/mobile DIDComm delivery
- Phase 16 — SharePoint read-only connector
- Phase 17 — Outlook send with approval
- Phase 19 — demo mode / seed data
- Phase 22 — CI/E2E automation (Playwright + GitHub Actions Postgres service)

Write these as workflow scripts only once Phase 9–11 are verified and committed — don't stack unverified workflow output.
