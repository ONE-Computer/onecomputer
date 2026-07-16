export const meta = {
  name: "phase-20-cleanup-refactor",
  description:
    "Cleanup/refactor: archive completed .workflows/*.js scripts, consolidate the 4 competing state docs, delete CI-unreachable validator scripts, and close the audit-logging gap on mutation routes. Scoped by docs/plan/11-cleanup-refactor.md. Does NOT include Phase 9 resolution (separate, blocking, tracked as its own resume), god-file splits, or guardrail/policy consolidation (folded into phase-17).",
  phases: [
    {
      title: "Workflow archive",
      detail: "Move completed scripts to .workflows/archive/",
    },
    {
      title: "Doc consolidation",
      detail: "STATE.md -> redirect stub, AUDIT.md banner",
    },
    {
      title: "Dead script removal",
      detail: "Delete CI-unreachable validate-*.mjs + their sole caller",
    },
    {
      title: "Audit logging gap",
      detail: "Wrap remaining mutation routes in withAudit, one file at a time",
    },
    {
      title: "Verify+Commit",
      detail: "tsc + targeted tests + separate commits per chunk",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const API = `${REPO}/packages/api/src`;

// VERIFIED SEAMS (Explore-agent audit, 2026-07-04) — see docs/plan/11-cleanup-refactor.md:
// - .workflows/ has 30 files: sprint-1..g, phase-1..8, phase-i-identity-wire,
//   phase-e2e-system-tests, goal-close-vti-2fa are all shipped (committed in git log). phase-9..19
//   are active/pending — must stay at .workflows/ root.
// - STATE.md, AUDIT.md, docs/plan/00-current-state.md, .workflows/NORTH-STAR.md all claim to be
//   "current state." docs/plan/00-current-state.md is canonical (newest).
// - 18 scripts/onecomputer/validate-*.mjs have zero matches in .github/workflows/ (confirmed via
//   negative grep). personal-connectors-pilot-closeout-service.ts:198's
//   buildPersonalConnectorsPilotCloseoutPack() has exactly one caller, one of those scripts.
// - 21 of 26 mutation routes skip withAudit: approvals.ts, apps.ts, deploy.ts, guardrails.ts,
//   internal.ts, migrate.ts, secrets.ts (lines 42,63,76), rules.ts, sandboxes.ts, user.ts.
//   agents.ts is the reference pattern for correct usage.
const CTX = `
Repo: ${REPO}
API: ${API}

HARD FACTS (verified 2026-07-04 — do not contradict):
- This is a LOW-RISK mechanical cleanup pass. No behavior changes to working features.
- Do NOT touch: condition_match.rs stub, protective-guardrails-service.ts enforcement wiring, the
  HMAC-mock VTI verifier, any "preview_only_*" or "graph_preview_only" marker. Those are known
  scaffold-vs-real gaps tracked separately in AUDIT.md/risk register — cleanup must not blur the
  line between "reorganized" and "now secretly claims to be real."
- Do NOT touch packages/api/src/services/member-service.ts or validations/member.ts (untracked,
  Phase 9's orphaned files) — that's a separate blocking task, not part of this phase.
- Do NOT attempt god-file splits (apps.rs, invgini-agent-registry.ts,
  personal-connector-broker-service.ts, agent-service.ts, vti-consent-service.ts) or the
  guardrail/policy-rule/policy-artifact service consolidation — both explicitly deferred (see
  docs/plan/11-cleanup-refactor.md "Defer past the demo").
`;

phase("Workflow archive");
const archive = await agent(
  `${CTX}
## Agent 20-A: Archive completed .workflows/*.js scripts

1. Run: cd ${REPO} && git log --oneline | head -60   (to confirm which phases actually shipped)
2. mkdir -p .workflows/archive
3. Move these files into .workflows/archive/ (git mv, so history follows):
   sprint-1-gateway.js, sprint-2-identity.js, sprint-3-sandbox.js, sprint-a-complete.js,
   sprint-a-ic-cockpit.js, sprint-b-cyber-console.js, sprint-c-manager-approvals.js,
   sprint-d-platform-deploy.js, sprint-e-gateway-sequential.js, sprint-f-rbac.js,
   sprint-g-package-gate.js, phase-1-sandbox-wiring.js, phase-2-gateway-enforcement.js,
   phase-3-identity.js, phase-4-package-gate.js, phase-5-connectors.js,
   phase-6-nav-first-impressions.js, phase-6a-sandbox-ui.js, phase-7-persona-polish.js,
   phase-8-coherence.js, phase-i-identity-wire.js, phase-e2e-system-tests.js,
   goal-close-vti-2fa.js
4. Leave phase-9 through phase-19 (and this file, phase-20-cleanup-refactor.js) at .workflows/ root
   — they are active/pending, not shipped.
5. Verify: ls .workflows/*.js should now show only phase-9 through phase-20 plus any new files;
   ls .workflows/archive/*.js should show the 22 moved files.
6. Update .workflows/NORTH-STAR.md: add a short section noting the archive convention — completed
   phases move to .workflows/archive/ once shipped, so future phases follow the same pattern
   instead of inventing a 4th naming style.

Return: git status output showing the renames, final ls of both directories, confirmation
NORTH-STAR.md was updated.
`,
  { label: "20-A:workflow-archive", phase: "Workflow archive" },
);

phase("Doc consolidation");
const docs = await agent(
  `${CTX}
## Agent 20-B: Consolidate the 4 competing "current state" docs

Four files claim to be authoritative: STATE.md, AUDIT.md, docs/plan/00-current-state.md,
.workflows/NORTH-STAR.md. docs/plan/00-current-state.md is the canonical one (newest).

1. Read STATE.md and docs/plan/00-current-state.md. Identify anything in STATE.md that is still
   true and NOT already reflected in 00-current-state.md. Fold only that delta into
   00-current-state.md (do not duplicate what's already there).
2. Replace STATE.md's content with a short redirect stub:
   "# Superseded\n\nThis file is superseded by [docs/plan/00-current-state.md](docs/plan/00-current-state.md).\nKept for history; do not update."
3. Add a one-line banner to the top of AUDIT.md (do not rewrite its findings — it's a
   point-in-time audit, the receipts matter):
   "> Findings below verified 2026-06-28. For current phase status, see [docs/plan/00-current-state.md](./docs/plan/00-current-state.md)."
4. Add a cross-link from docs/plan/00-current-state.md to .workflows/NORTH-STAR.md (different
   audience — governs how workflow scripts are authored — so it stays a separate file, just
   linked).

Return: diff summary of all 4 files, confirming nothing that was true got deleted (only
relocated/banner-added).
`,
  { label: "20-B:doc-consolidation", phase: "Doc consolidation" },
);

phase("Dead script removal");
const deadCode = await agent(
  `${CTX}
## Agent 20-C: Remove CI-unreachable validator scripts

1. Confirm via: grep -rn "validate-" .github/workflows/ 2>/dev/null || echo "no matches (expected)"
2. List scripts/onecomputer/validate-*.mjs and confirm none appear in any CI workflow file, any
   package.json script, or any other .mjs/.ts file's imports (grep for each filename across the
   repo, not just CI, in case something else invokes them via child_process).
3. For any that are genuinely unreferenced anywhere: git rm them.
4. Check packages/api/src/services/personal-connectors-pilot-closeout-service.ts:198's
   buildPersonalConnectorsPilotCloseoutPack() — confirm its only caller is one of the scripts
   being removed (grep for the function name across the repo). If so, remove the function too
   (and its now-unused imports/types in that file, nothing else in the file).
5. Run: cd ${REPO}/packages/api && npx tsc --noEmit   (confirm nothing else referenced the removed
   function or scripts)

Return: exact list of files removed, grep output proving no other caller, tsc result.
`,
  { label: "20-C:dead-script-removal", phase: "Dead script removal" },
);

phase("Audit logging gap");
const auditGap = await agent(
  `${CTX}
## Agent 20-D: Close the audit-logging gap on mutation routes

CLAUDE.md's own rule: "All state-changing operations (create, update, delete, regenerate) must be
audited. Use the withAudit wrapper." 21 of 26 mutation routes currently skip it. Fix the clearest,
lowest-risk subset first — real persisted mutations, not the ones already marked preview-only.

Routes to fix (skip personal-connectors.ts and m365-agent-directory.ts — those are marked
preview_only_* and lower priority, not part of this pass):
  secrets.ts (createSecret, updateSecret, deleteSecret — lines ~42, ~63, ~76)
  rules.ts (policy rule CRUD)
  sandboxes.ts (create/update)
  apps.ts (create/update/delete)
  deploy.ts (deployment mutations)
  guardrails.ts (guardrail create/update)
  user.ts (profile mutations)
  approvals.ts (decide — note: audit may already happen inside decideApproval() service; check
    before double-wrapping — if the service already emits an audit record, leave the route as-is
    and note why instead of wrapping again)
  internal.ts, migrate.ts (check these are genuinely user-triggered mutations, not internal-only
    ops that don't warrant per-request audit — use judgment, note your reasoning either way)

For each: follow the exact pattern in packages/api/src/routes/agents.ts (import withAudit,
AUDIT_ACTIONS, AUDIT_SERVICES from lib/services/audit-service or wherever agents.ts imports them
from; wrap the service call; metadata includes resource IDs, never secret values).

Run: cd ${REPO}/packages/api && npx tsc --noEmit
If tests exist for these routes, run them.

Return: file-by-file list of what was wrapped vs. skipped-with-reason, tsc result, test result if
applicable.
`,
  {
    label: "20-D:audit-logging-gap",
    phase: "Audit logging gap",
    effort: "high",
  },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 20-E: Verify + commit as separate chunks (per docs/plan/11-cleanup-refactor.md)

PASTE real output before each commit:
  cd ${REPO}/packages/api && npx tsc --noEmit
  cd ${REPO}/apps/web && npx tsc --noEmit

Do NOT commit if either tsc is red. Commit as 4 SEPARATE commits, in this order:

1. cd ${REPO} && git add .workflows/ && git commit -m "chore(workflows): archive completed .workflows/*.js scripts

Move 22 shipped sprint-*/phase-1..8 scripts to .workflows/archive/; leave phase-9..20
active at root. Document the archive convention in NORTH-STAR.md so future phases
follow it instead of a 4th naming style."

2. git add STATE.md AUDIT.md docs/plan/00-current-state.md .workflows/NORTH-STAR.md && git commit -m "docs(plan): consolidate state docs, point STATE.md at 00-current-state.md

Four files claimed to be 'current state'; 00-current-state.md is now canonical.
STATE.md is a redirect stub, AUDIT.md gets a banner (findings unchanged — still a
point-in-time audit), NORTH-STAR.md cross-linked."

3. git add -A scripts/ packages/api/src/services/personal-connectors-pilot-closeout-service.ts && git commit -m "chore(scripts): remove CI-unreachable validator scripts

18 scripts/onecomputer/validate-*.mjs had zero CI invocations and no other callers.
Removed alongside their sole real-code dependency,
buildPersonalConnectorsPilotCloseoutPack(). tsc clean."

4. git add -A packages/api/src/routes/ && git commit -m "fix(audit): wrap remaining mutation routes in withAudit

secrets/rules/sandboxes/apps/deploy/guardrails/user mutations now emit audit records,
matching the pattern in agents.ts and CLAUDE.md's own audit-logging rule. tsc clean."

If any commit would be empty (e.g. no doc changes needed), skip that commit and say so — don't
force an empty commit.

Append a dated result to gbrain ~/brain/projects/onecomputer-workflows.md (do NOT run gbrain
import — key still broken). Return all 4 (or fewer) commit hashes + pasted tsc output.
`,
  { label: "20-E:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { archive, docs, deadCode, auditGap, commit };
