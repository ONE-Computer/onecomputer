export const meta = {
  name: "phase-19-demo-seed",
  description:
    "Demo mode: a seed script + reset that creates a believable org (Owner/Cyber/Manager/Employee users, a team/project, enterprise+team policies, one blocked violation, one pending approval, one sandbox record) so the CEO run-through never depends on live luck. Underpins all demo beats.",
  phases: [
    {
      title: "Seed data model",
      detail: "Deterministic seed: org, users, roles, project/team, policies",
    },
    {
      title: "Seed events",
      detail:
        "Seed a violation, a pending approval (with real VTI envelope), a sandbox",
    },
    {
      title: "Reset control",
      detail: "Idempotent reseed + a guarded 'Reset demo' action",
    },
    {
      title: "Verify+Commit",
      detail: "run seed, verify surfaces populate, commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const API = `${REPO}/packages/api/src`;
const WEB = `${REPO}/apps/web/src`;

// VERIFIED SEAMS (2026-07-04):
// - NO prisma/seed.ts exists. No default org/user/project created at startup.
// - RBAC roles: owner | admin | manager | member (UI: Owner/Platform, Cyber Admin, Manager,
//   Employee). OrganizationMember.role is a string.
// - ApprovalRequest + _vti envelope builder are real (vti-consent-service.ts).
// - RequestLog stores gateway decisions incl. decision="blocked".
const CTX = `
Repo: ${REPO}
API: ${API}
Web: ${WEB}
DB: Prisma; local Postgres postgresql://onecomputer:onecomputer@localhost:5433/onecomputer
Web app http://127.0.0.1:10254, AUTH_MODE=local.

HARD FACTS (verified — do not contradict):
- There is NO seed script today. You are creating the first one.
- Roles are strings: owner|admin|manager|member. Map to Owner/Cyber Admin/Manager/Employee copy.
- Reuse existing SERVICES to create data (agent-service, policy-rule-service, approval-service,
  member-service if phase-9 landed) so seeded rows go through the same validation/audit paths.
  Do NOT hand-write raw Prisma inserts that bypass required fields/audit — prefer services.
- The seed must be IDEMPOTENT (safe to run repeatedly) and clearly namespaced (e.g. a
  "Demo Corp" org with a stable id) so reset only touches demo data, never real data.
- Do NOT seed real secrets/tokens.
`;

phase("Seed data model");
const model = await agent(
  `${CTX}
## Agent 19-A: Core seed (org, users, roles, team, policies)

Create packages/api/src/scripts/seed-demo.ts (or prisma/seed.ts if that's the project
convention — check package.json for a prisma.seed hook first) that idempotently creates:
1. Organization "Demo Corp" (stable well-known id so reseed/reset is safe).
2. OrganizationMembers: owner@demo, cyber@demo (admin), manager@demo (manager),
   alex@demo (member/Employee). Use member-service if it exists; else the minimal safe path.
3. A Project "Field Sales Team" (this is the "Team" per phase-17 project-as-team).
4. Policies via policy-rule-service:
   - Enterprise (org scope): block direct public npm/pypi (reuse existing blocklist pattern).
   - Team (project scope): manual_approval for Outlook send (graph.microsoft.com /v1.0/me/sendMail POST).
   - User (agent scope): a rate_limit example on the seeded agent (optional but nice).
5. One Agent for alex@demo (agent-service mints its token/DID fields).

Make it runnable: add an npm/pnpm script "seed:demo". Run it against local DB and PASTE output.
Return: file(s), the script command, and real run output (ids created).
`,
  { label: "19-A:seed-model", phase: "Seed data model", effort: "high" },
);

phase("Seed events");
const events = await agent(
  `${CTX}
## Agent 19-B: Seed the "story" events

Extend the seed to also create the events the demo narrates:
1. A blocked RequestLog row: agent attempted a blocked public-registry install -> decision
   "blocked" -> shows up in the Cyber console violations feed and the /audit timeline.
2. A PENDING ApprovalRequest for an Outlook send by alex@demo's agent, created through
   approval-service so it carries a REAL _vti.stepUpRequest (manager) and, if phase-15a
   landed, _vti.actorStepUp (actor). This makes /approvals, /device/approvals/:id, and the
   audit timeline all populated on demo day.
3. A sandbox record for alex@demo (if the sandbox model persists rows; if sandboxes are only
   live-Daytona, seed a lightweight placeholder or skip with a clear note — do NOT fake a
   running Daytona sandbox).

Keep idempotent (upsert by stable ids). Run the seed and PASTE output showing the approval id
+ that GET /v1/approvals returns it and GET /v1/approvals/:id/vti-notification returns a real
envelope.
Return files changed + real output.
`,
  { label: "19-B:seed-events", phase: "Seed events", effort: "high" },
);

phase("Reset control");
const reset = await agent(
  `${CTX}
## Agent 19-C: Reset demo (idempotent reseed + guarded UI action)

1. Add a "reset" mode to the seed: delete-then-recreate ONLY the Demo Corp namespace (by its
   stable org id and related rows), then reseed. It must NOT touch any non-demo org. Guard with
   an explicit flag (e.g. SEED_DEMO_RESET=1) so it can't wipe data accidentally.
2. Optional UI: a "Reset demo data" button visible only in local/demo mode (gate on AUTH_MODE
   or a DEMO_MODE flag), Owner-only, with a confirm dialog, that calls a guarded internal route
   POST /v1/internal/demo/reset (internalAuth). If time is short, the CLI reset is sufficient —
   note the tradeoff.
3. Document usage in docs/plan/runbooks/demo-mode.md: how to seed, reset, and what the demo
   data represents.

Run the reset once, then reseed, PASTE output proving idempotency (same ids, no dupes).
Return files changed + real output + runbook path.
`,
  { label: "19-C:reset-control", phase: "Reset control" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 19-D: Verify + commit

PASTE real output:
  cd ${REPO} && pnpm seed:demo   # or the actual script name
  curl -s http://127.0.0.1:10254/v1/approvals | head -c 600
  curl -s "http://127.0.0.1:10254/v1/audit/timeline?limit=5" | head -c 600   # if phase-16 landed
  cd ${REPO}/apps/web && npx tsc --noEmit

Only commit if the seed runs cleanly, the approval + violation are queryable, and tsc is clean:
  cd ${REPO}
  git add -A packages/api/ apps/web/ docs/plan/
  git commit -m "feat(demo): deterministic demo seed + reset (Demo Corp)

Idempotent seed of an org with Owner/Cyber/Manager/Employee members, a
project-as-team, enterprise+team+user policies, a blocked violation, and a
pending approval carrying a real VTI envelope; guarded reset that only touches
the demo namespace. Removes live-state luck from the CEO run-through.

seed:demo: runs clean; approval + violation queryable; tsc clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-enterprise-ux-gap.md (do NOT run
gbrain import — key broken). Update docs/plan/00-current-state.md (STATE.md is now a
redirect stub — do not edit it).
Return commit hash + pasted output.
`,
  { label: "19-D:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { model, events, reset, commit };
