# 11 — Cleanup / Refactor Phase

Triggered by: the repo is accumulating mess faster than it's being resolved — 30 `.workflows/*.js`
scripts across 3 naming generations, 4 competing "current state" docs, and (per a fresh
Explore-agent audit on 2026-07-04) real duplication/dead-code/enforcement gaps in the application
code itself. This phase pays down that debt **before** phase-12 onward add more surface area.

Slots into the run order from [`10-demo-workflow-scripts.md`](./10-demo-workflow-scripts.md)
as **phase-20**, but 20-A (Phase 9 resolution) is a hard blocker for phase-10/11 and should run
first; the rest is parallelizable with phase-12/17/18.

## 20-A — Resolve Phase 9's orphaned files (BLOCKING)

`packages/api/src/services/member-service.ts` (181 lines) and `validations/member.ts` are
untracked, feature-complete (invite/update-role/remove-member with last-owner guards), and
**wired to nothing** — no route imports them, no UI calls them. The phase-9 workflow died before
reaching routes/UI.

Decision needed: finish wiring (routes + `/settings/members` UI, per phase-9's original scope) or
discard and let a redone phase-9 start clean. Given the code audited as architecturally sound,
**recommend finishing it** — resume `Workflow({scriptPath: ".workflows/phase-9-enterprise-admin-rbac.js", resumeFromRunId: "wf_e242d15c-b39"})` rather than restarting. This is tracked separately as
task #8; do it first, since phase-10 and phase-11 both depend on phase-9's pages/role model.

## 20-B — Workflow script archival

30 files in `.workflows/`, three naming generations (`sprint-*`, `phase-N`, `phase-N-name`), no
marker for what's done vs. active.

- Move completed scripts to `.workflows/archive/`: `sprint-1` through `sprint-g` (8 files),
  `phase-1` through `phase-8`, `phase-i-identity-wire`, `phase-e2e-system-tests`,
  `goal-close-vti-2fa` — all correspond to committed, shipped work per `git log`.
- Leave active/pending in `.workflows/` root: `phase-9` through `phase-19` (10 files).
- Update `.workflows/NORTH-STAR.md` to point at the archive convention so future phases follow it
  instead of adding a 4th naming style.

## 20-C — Doc/state consolidation

Four files currently claim to be "the" current state: `STATE.md`, `AUDIT.md`,
`docs/plan/00-current-state.md`, `.workflows/NORTH-STAR.md`. A reader (human or agent) has no way
to know which is fresh without reading all four.

- `docs/plan/00-current-state.md` becomes canonical (it's the newest, dated 2026-07-04 series).
- `AUDIT.md` stays as-is but gets a one-line banner: "Findings below verified 2026-06-28 — for
  current phase status see `docs/plan/00-current-state.md`." Don't merge it; it's a point-in-time
  audit, not a living doc, and rewriting it risks losing the receipts.
- `STATE.md` — fold its still-true content into `00-current-state.md`, then replace `STATE.md`
  with a redirect stub (one line: "superseded by docs/plan/00-current-state.md").
- `.workflows/NORTH-STAR.md` stays (different audience — governs how workflow scripts are
  written), but cross-link it from `00-current-state.md`.

## 20-D — Codebase findings (from Explore-agent audit, 2026-07-04)

Full findings below; prioritized into what's worth doing now vs. deferring past the demo.

### Do now (cheap, high-value, low risk of breaking the demo)

1. **Delete 18 orphaned validator scripts** — `scripts/onecomputer/validate-*.mjs`, zero CI
   invocations (confirmed via negative grep on `.github/workflows/`). They import real services but
   nothing consumes their output. Pure deletion, no behavior change.
2. **Delete `buildPersonalConnectorsPilotCloseoutPack()`** (`personal-connectors-pilot-closeout-service.ts:198`) — only caller is one of the scripts being deleted in (1).
3. **Audit logging gap** — 21 of 26 mutation routes skip `withAudit`: `approvals.ts`, `apps.ts`,
   `deploy.ts`, `guardrails.ts`, `internal.ts`, `migrate.ts`, `secrets.ts` (lines 42, 63, 76),
   `rules.ts`, `sandboxes.ts`, `user.ts` (`personal-connectors.ts` and `m365-agent-directory.ts`
   are marked preview-only, lower priority). This is a real gap against CLAUDE.md's own rule
   ("All state-changing operations ... must be audited"). Fix by wrapping each mutation in
   `withAudit`, following the `agents.ts` pattern already established. Mechanical, one route file
   at a time, each independently verifiable and committable.

### Defer past the demo (real but not demo-blocking; needs design, not just typing)

4. **Guardrail/policy service triplication** — `protective-guardrails-service.ts` (never wired to
   any request gate, stamped `simulator_only_not_enforced`), `policy-artifact-service.ts` (static
   contracts, no engine), and `policy-rule-service.ts` (the actual runtime enforcement model,
   direct-Prisma) overlap conceptually but aren't consolidated. **Phase-17 (policy hierarchy)
   already touches this exact seam** — do the consolidation as part of phase-17's design-lock step
   rather than as a separate pass, since phase-17 needs to decide which of these is authoritative
   anyway.
5. **God-files** — `apps/gateway/src/apps.rs` (3054 lines, 100+ host-pattern registry),
   `invgini-agent-registry.ts` (774), `personal-connector-broker-service.ts` (564),
   `agent-service.ts` (552), `vti-consent-service.ts` (499). Splitting these is real refactor work
   with real regression risk — not worth doing under demo time pressure. Track as a post-demo
   phase-21 candidate, one file at a time, each with its own test-pass-before-and-after gate.
6. **Naming inconsistency (member vs user vs organization-member)** — `user-service.ts` (User),
   `member-service.ts` (OrganizationMember, once wired), and `organization-service.ts:64`'s
   `bootstrapOrganization()` all touch membership with no single owner. Resolve once phase-9 is
   wired (20-A) — don't restructure ownership boundaries before that lands, or the two efforts will
   conflict on the same files.

### Explicitly not doing

- Not touching `condition_match.rs` stub, `protective-guardrails-service` enforcement wiring, or
  the HMAC-mock VTI verifier as "cleanup" — those are known scaffold-vs-real gaps already tracked
  in AUDIT.md and the risk register; conflating them with cleanup risks understating how much real
  engineering they need.
- Not touching `preview_only_not_persisted` / `graph_preview_only` markers — those are honest
  labels on intentionally-simulated surfaces, not bugs.

## Verify + commit

Same discipline as every other phase: real `tsc`/`cargo test` output pasted (with
`DATABASE_URL`/`SECRET_ENCRYPTION_KEY` set per [`05`](./05-e2e-and-readiness-gates.md)), no commit
on red, gbrain updated (markdown only, no `gbrain import` until the embedding key is fixed).

Split into separately-committable chunks — do not land this as one giant commit:

1. `chore(workflows): archive completed .workflows/*.js scripts` (20-B)
2. `docs(plan): consolidate state docs, point STATE.md at 00-current-state.md` (20-C)
3. `chore(scripts): remove orphaned CI-unreachable validator scripts` (20-D.1, 20-D.2)
4. `fix(audit): wrap remaining mutation routes in withAudit` (20-D.3) — can itself be several
   commits, one or two route files at a time
5. Phase 9 resolution (20-A) is already tracked as its own task/commit, not part of this phase's
   commits.

## What this phase deliberately does not include

- No god-file splits (item 5) — deferred, tracked as phase-21 candidate.
- No guardrail/policy consolidation (item 4) — folded into phase-17 instead of duplicated here.
- No new abstractions, no renames beyond what 20-D.6 unblocks after phase-9 lands.
