export const meta = {
  name: "phase-10-enterprise-onboarding",
  description:
    "Rewrite Get Started from OneCLI developer setup into enterprise onboarding checklist",
  phases: [
    {
      title: "Audit",
      detail: "Find current Get Started modal and onboarding state",
    },
    { title: "Rewrite modal", detail: "Enterprise checklist and persona CTAs" },
    {
      title: "Persistence",
      detail: "Persist onboarding progress in localStorage",
    },
    { title: "Verify", detail: "Browser and tsc checks" },
    { title: "Commit", detail: "Commit and gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = REPO + "/apps/web/src";

const CTX = [
  "Repo: " + REPO,
  "Web: " + WEB,
  "Current issue: Get Started modal still says OneCLI and is coding-agent/CLI oriented.",
  "Enterprise target: first-run checklist for org setup, RBAC, package gate, connectors, sandbox, approvals, Cyber console.",
  "Personas: Cyber Admin, Manager, Employee, Platform Owner.",
].join("\n");

phase("Audit");
const audit = await agent(
  CTX +
    "\n\nFind current Get Started implementation. Likely files: apps/web/src/app/(dashboard)/_components/get-started-dialog.tsx and dashboard header. Report paths and structure. No edits.",
  { label: "10-A:audit", phase: "Audit", model: "haiku" },
);

phase("Rewrite modal");
const modal = await agent(
  CTX +
    "\n\nRewrite Get Started into enterprise onboarding. Requirements: title Set up ONEComputer; subtitle Govern AI sandboxes, agents, approvals, and enterprise connectors. Checklist cards: Invite users and assign roles -> /settings/members; Review role permissions -> /settings/roles; Configure package gate -> /settings/policy or connections; Boot first governed sandbox -> /sandboxes; Create manager approval policy -> /rules; Review Cyber console -> /console. Persona quick starts: Cyber Admin -> /console, Manager -> /approvals, Employee -> /sandboxes, Platform Owner -> /apps. Keep Developer CLI as small advanced section only. Use existing shadcn styling. Run tsc and report files changed.",
  { label: "10-B:modal", phase: "Rewrite modal" },
);

phase("Persistence");
const persistence = await agent(
  CTX +
    "\n\nAdd lightweight onboarding progress persistence. Create apps/web/src/lib/onboarding-progress.ts. Store completion flags in localStorage key oc_onboarding_progress. Export getProgress(), markStepComplete(step), resetProgress(). In Get Started modal mark a step complete when user clicks checklist item. Show progress text 3 of 6 completed and a Progress bar. If all complete, change header button text to Setup Complete or show a check icon. Do not add DB schema. Run tsc and report.",
  { label: "10-C:persistence", phase: "Persistence" },
);

phase("Verify");
const verify = await agent(
  CTX +
    "\n\nVerify Phase 10. Run cd " +
    REPO +
    "/apps/web && npx tsc --noEmit. Check browser routes 200: /overview, /settings/members, /settings/roles, /sandboxes, /console. Grep UI text: ensure Choose how you want to use OneCLI is gone or legacy only, and Set up ONEComputer exists. Return pass/fail.",
  { label: "10-D:verify", phase: "Verify", model: "haiku" },
);

phase("Commit");
const commit = await agent(
  CTX +
    "\n\nCommit Phase 10. cd " +
    REPO +
    '; git add -A apps/web/src/; git commit -m "feat(onboarding): Phase 10 enterprise Get Started checklist\n\n- Replaces developer-first OneCLI modal with enterprise ONEComputer onboarding\n- Checklist: users/roles, package gate, first sandbox, approval policy, Cyber console\n- Persona quick starts for Cyber Admin, Manager, Employee, Platform Owner\n- Developer CLI moved to advanced section\n- Local onboarding progress in localStorage with progress bar\n\ntsc --noEmit: clean\n\nCo-Authored-By: Claude <noreply@anthropic.com>"; update gbrain enterprise UX gap with Phase 10 result and import/embed; append STATE.md Phase 10 section. Return commit hash.',
  { label: "10-E:commit", phase: "Commit", model: "haiku" },
);

return { audit, modal, persistence, verify, commit };
