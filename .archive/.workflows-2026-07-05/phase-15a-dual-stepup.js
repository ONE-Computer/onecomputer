export const meta = {
  name: "phase-15a-dual-stepup",
  description:
    "Dual step-up (actor gets a 2FA prompt AND manager gets an approval prompt) + a 'manager device' web page that renders the REAL VTI Trust Task envelope and lets the manager approve/deny. Transport still simulated (real DIDComm is phase-15). Demo beats 3c + 4b.",
  phases: [
    {
      title: "Dual envelopes",
      detail:
        "Emit an actor step-up envelope alongside the manager approve-request envelope",
    },
    {
      title: "Device page",
      detail:
        "/device/approvals/:id manager-phone view rendering the real envelope",
    },
    {
      title: "Actor prompt",
      detail: "Actor-side 2FA prompt surface in the sandbox/console UI",
    },
    {
      title: "Verify+Commit",
      detail: "tsc + real envelope check + commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API = `${REPO}/packages/api/src`;

// VERIFIED SEAMS (2026-07-04):
// - vti-consent-service.ts:158 buildApprovalStepUpNotificationEnvelope distinguishes
//   requesterDid (actor) / subjectDid (manager) / agentDid. Today only ONE envelope
//   (taskType auth/step-up/approve-request) is emitted, aimed at the manager (subjectDid).
// - approval-service.ts embeds context._vti.stepUpRequest on create; triggerApprovalVtiNotification()
//   marks context._vti.delivery.status = sent_to_vti_adapter (adapter "vti-outbox-local").
// - GET /v1/approvals/:id/vti-notification returns the envelope (routes/approvals.ts).
// - POST /v1/approvals/:id/decide (manager+) sets approved/denied.
const CTX = `
Repo: ${REPO}
Web: ${WEB}
API: ${API}
Web app http://127.0.0.1:10254, AUTH_MODE=local.

HARD FACTS (verified — do not contradict):
- The VTI Trust Task envelope is REAL (canonical JSON + sha256 taskHash). What is SIMULATED
  is the transport: no phone app, delivery is "vti-outbox-local" marking sent_to_vti_adapter.
  This phase does NOT build real DIDComm/mobile (that is phase-15). It builds a WEB stand-in
  for the manager's device that renders the real envelope.
- buildApprovalStepUpNotificationEnvelope already separates actor (requesterDid) vs
  manager (subjectDid). Reuse it; do NOT hand-roll a second envelope format.
- NO crypto invented here.
- Be scrupulously honest in copy: the device page must say "Simulated device delivery —
  envelope is cryptographically real, transport is local for demo".
`;

phase("Dual envelopes");
const dual = await agent(
  `${CTX}
## Agent 15A-A: Emit an actor step-up envelope in addition to the manager one

Today one envelope targets the manager. Add a SECOND envelope targeting the ACTOR (the
user who triggered the risky action) so the demo can show "user gets a 2FA prompt AND
manager gets an approval".

1. In vti-consent-service.ts add buildActorStepUpNotificationEnvelope (or a variant flag on
   the existing builder) with taskType "auth/step-up/verify-actor" (or the closest existing
   Trust Task type — check the type constants first; do NOT invent a type if a suitable one
   exists). subjectDid = the actor here (they verify themselves); include the same
   requestedActionDigest so both envelopes reference the same action.
2. In approval-service.ts on ApprovalRequest create, embed BOTH:
   context._vti.stepUpRequest (manager, existing) and context._vti.actorStepUp (new).
3. Keep taskHash correct for each (canonical JSON hash — reuse the existing hashing fn).
4. Do NOT change the manager envelope's existing shape (the E2E proof asserts it).

Run: cd ${REPO}/apps/web && npx tsc --noEmit (API is TS in the same typecheck).
Return files changed + tsc result + a sample of BOTH envelopes (redact nothing structural).
`,
  { label: "15A-A:dual-envelopes", phase: "Dual envelopes", effort: "high" },
);

phase("Device page");
const device = await agent(
  `${CTX}
## Agent 15A-B: Manager 'device' approval page

Create a standalone-feeling page that looks like a phone approval prompt:
apps/web/src/app/device/approvals/[id]/page.tsx (route OUTSIDE the dashboard layout so it
reads like a separate device surface; if the app router group makes that hard, use
/(device)/... route group).

Behavior:
1. Fetch GET /v1/approvals/:id/vti-notification -> render the REAL manager envelope:
   humanSummary, action, requestedActionDigest (short), requester, agent, taskHash (short),
   expiry countdown.
2. Two big buttons: Approve / Deny -> POST /v1/approvals/:id/decide.
3. On decision, show a confirmation state.
4. Prominent honesty banner: "Simulated device delivery — the Trust Task envelope shown is
   cryptographically real; mobile DIDComm transport is on the roadmap (phase-15)."
5. Phone-frame styling (narrow max-width, rounded), so it demos well beside the desktop app.

This page is the manager's half of demo beat 4b.

Run tsc. Return files changed, tsc result, and the HTTP code from loading the page against
a real approval id if one exists.
`,
  { label: "15A-B:device-page", phase: "Device page" },
);

phase("Actor prompt");
const actor = await agent(
  `${CTX}
## Agent 15A-C: Actor-side 2FA prompt

When the acting user triggers a held action (from the sandbox detail 'Attempt Outlook send'
button, phase-12), surface an actor step-up prompt so the demo shows the USER also gets a
2FA moment, not just the manager.

1. On the sandbox detail page (or a toast/dialog), after the risky action is held, poll
   GET /v1/approvals to find the pending approval for this actor/agent and show:
   "Action held for approval. Your identity step-up: <render context._vti.actorStepUp
   humanSummary + a 'Confirm it's me' button>." The confirm button can POST a lightweight
   actor-acknowledgement (add a minimal route POST /v1/approvals/:id/actor-ack that records
   context._vti.actorStepUp.acknowledgedAt) — this is the actor's 2FA analogue for the demo.
2. Show live status: waiting on manager -> approved/denied.
3. Honesty note: same simulated-transport banner.

Keep it simple and honest. Run tsc. Return files/routes changed + tsc result.
`,
  { label: "15A-C:actor-prompt", phase: "Actor prompt" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 15A-D: Verify + commit

PASTE real output:
  cd ${REPO}/apps/web && npx tsc --noEmit
  # Create a throwaway approval via the internal API or proof helper, then:
  curl -s http://127.0.0.1:10254/v1/approvals/<id>/vti-notification | head -c 800
  curl -s -o /dev/null -w "device:%{http_code}\\n" http://127.0.0.1:10254/device/approvals/<id>

Only commit if tsc clean and the vti-notification returns a real envelope with a taskHash:
  cd ${REPO}
  git add -A apps/web/ packages/api/
  git commit -m "feat(approvals): dual step-up + manager device approval page

Emit an actor step-up envelope alongside the manager approve-request envelope;
add /device/approvals/:id manager-phone view that renders the real Trust Task
envelope and approves/denies; actor-side step-up prompt + actor-ack route.
Transport remains simulated (vti-outbox-local); envelopes are cryptographically
real. Demo beats 3c and 4b.

tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-vti-hands-on.md (do NOT run
gbrain import — key broken). Update docs/plan/00-current-state.md (STATE.md is now a
redirect stub — do not edit it).
Return commit hash + pasted output.
`,
  { label: "15A-D:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { dual, device, actor, commit };
