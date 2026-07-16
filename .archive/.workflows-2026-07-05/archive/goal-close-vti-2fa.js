export const meta = {
  name: "goal-close-vti-2fa",
  description:
    "Close the active goal: sandbox API + Claude Code + policy/manual approval + VTI notification trigger + E2E proof",
  phases: [
    {
      title: "Implement",
      detail:
        "Parallel agents implement VTI outbox, gateway manual_approval ingest, and E2E harness fixes",
    },
    {
      title: "Verify",
      detail: "Run focused E2E proof and adversarially verify caveats",
    },
    {
      title: "Commit",
      detail: "Commit changes, update STATE.md and gbrain goal proof",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const API_KEY = "oclocal_devkey_faf128a9c992740356cc0a28";
const SNAPSHOT = "595be745-2eb0-4d30-a969-e4e04800ac0d";

const CTX = `
Repo: ${REPO}
Goal: ONEComputer API can spin up sandbox, run Claude Code, create policy/manual approval, and trigger/transfer 2FA notification via VTI.
Verified so far:
- POST /v1/sandboxes works, returns state started + claudeVersion 2.1.195
- POST /v1/sandboxes/:id/exec runs Claude Code inside sandbox
- POST /v1/rules creates manual_approval rule
- POST /v1/approvals embeds context._vti.stepUpRequest
- GET /v1/approvals/:id/vti-notification returns the stepUpRequest envelope
Remaining caveats:
1. VTI notification is envelope only; no delivery/outbox state.
2. Gateway manual_approval -> ApprovalRequest is not proven end-to-end.
3. E2E report still marks Gateway/VTI partial.

Service URLs:
- Web/API: http://127.0.0.1:10254
- Daytona API: http://127.0.0.1:3000, bearer ${API_KEY}
- Daytona toolbox: http://127.0.0.1:4000/toolbox/<id>/process/execute
- Snapshot: ${SNAPSHOT}
- VTI mediator: http://127.0.0.1:7037/mediator/v1/livez
- Gateway: http://127.0.0.1:10255

Rules:
- Do not fake success. Mark REAL only if API command proves it.
- No DIY crypto. VTI envelope may remain proofMode external_vti_required, but delivery state must be explicit.
- Use 127.0.0.1 not localhost for Daytona.
`;

const OUTBOX = `${CTX}

## Agent A — VTI notification outbox/trigger

Implement durable-ish VTI notification delivery state without requiring a real VTA/mobile yet.

Files:
- packages/api/src/services/approval-service.ts
- packages/api/src/routes/approvals.ts
- packages/api/src/validations/approval.ts if needed

Requirements:
1. When createApproval embeds context._vti.stepUpRequest, also embed:
   context._vti.delivery = {
     status: 'queued',
     adapter: 'vti-outbox-local',
     queuedAt: <ISO timestamp>,
     attempts: 0
   }
2. Add service function triggerApprovalVtiNotification({organizationId, approvalId}) that:
   - loads approval
   - requires context._vti.stepUpRequest exists
   - updates context._vti.delivery to:
     { status: 'sent_to_vti_adapter', adapter:'vti-outbox-local', sentAt:<ISO>, attempts: previous+1 }
   - returns { approvalId, stepUpRequest, delivery }
   This simulates the handoff to a VTA/mobile delivery adapter and makes trigger state explicit.
3. Add POST /v1/approvals/:id/vti-notification/trigger
   - RBAC: require read ApprovalRequest for now (or approve if already wired cleanly)
   - returns the service response
4. GET /:id/vti-notification should include both stepUpRequest and delivery.
5. tsc --noEmit must be clean.

Run smoke:
POST /v1/approvals -> GET /vti-notification -> POST /vti-notification/trigger -> GET again.
Proof must show status changes queued -> sent_to_vti_adapter.

Return: files changed, smoke commands/output, tsc result.`;

const GATEWAY = `${CTX}

## Agent B — Gateway manual_approval to ApprovalRequest proof path

Goal: make or prove a concrete bridge from a gateway ManualApproval decision to the ApprovalRequest API.

Inspect:
- apps/gateway/src/policy.rs PolicyDecision::ManualApproval
- apps/gateway/src/gateway/forward.rs handling of ManualApproval
- packages/api/src/routes/internal.ts and routes/approvals.ts
- any existing internal gateway ingest endpoint

Implement the smallest real bridge:
1. If an internal endpoint already exists for gateway ManualApproval events, document and use it.
2. Otherwise add POST /v1/internal/gateway/manual-approval in packages/api/src/routes/internal.ts or a new internal route. It accepts:
   { agentId?, ruleId, action, host, path, method, context }
   and calls createApproval({ action, requestedBy, agentId, context }).
   Include context: { host, path, method, ruleId, ... }.
3. Do NOT wire Rust gateway HTTP client if too invasive; expose the internal endpoint and prove it creates ApprovalRequest + VTI notification. Mark Rust auto-callback as TODO if not done.
4. Add a smoke curl that POSTs the manual approval event and proves approval + _vti exists.
5. tsc clean.

Return: endpoint path, smoke proof, caveat whether Rust gateway itself calls it.`;

const E2E = `${CTX}

## Agent C — Focused goal E2E harness

Create or run a focused E2E script that proves the exact goal path.

You may create scripts/onecomputer/e2e-goal-proof.mjs if useful.
It should perform:
1. Preflight: web 200, daytona 200, vti livez 200, verdaccio 200.
2. POST /v1/sandboxes create goal workflow sandbox.
3. POST /v1/sandboxes/:id/exec claude --version -> contains Claude Code.
4. POST /v1/rules manual_approval for graph.microsoft.com /v1.0/me/sendMail.
5. POST /v1/internal/gateway/manual-approval OR POST /v1/approvals to create approval.
6. GET /v1/approvals/:id/vti-notification -> has stepUpRequest.
7. POST /v1/approvals/:id/vti-notification/trigger -> delivery.status sent_to_vti_adapter.
8. Cleanup sandbox.

Output JSON:
{ ok, sandboxStarted, claudeVersion, ruleId, approvalId, vtiTaskHash, deliveryStatus, caveats }

Run it. Return exact JSON output and file path.
`;

const VERIFY_SCHEMA = {
  type: "object",
  required: ["verdict", "proof", "remaining_caveats"],
  properties: {
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "FAIL"] },
    proof: { type: "array", items: { type: "string" } },
    remaining_caveats: { type: "array", items: { type: "string" } },
  },
};

phase("Implement");
const impl = await parallel([
  () => agent(OUTBOX, { label: "A:vti-outbox", phase: "Implement" }),
  () =>
    agent(GATEWAY, { label: "B:manual-approval-bridge", phase: "Implement" }),
  () => agent(E2E, { label: "C:e2e-harness", phase: "Implement" }),
]);

phase("Verify");
const verify = await agent(
  `${CTX}

Implementation summaries:
${JSON.stringify(impl)}

Verify the goal with real commands:
- Run scripts/onecomputer/e2e-goal-proof.mjs if it exists.
- Else manually run the 8-step API flow.
- Also run: cd apps/web && npx tsc --noEmit (0 TS errors required).

Verdict REAL only if:
1. sandbox via /v1/sandboxes starts,
2. Claude Code version returned via /v1/sandboxes/:id/exec,
3. policy rule created via /v1/rules,
4. approval created by manual approval bridge or approval API,
5. VTI notification GET returns stepUpRequest,
6. trigger endpoint returns delivery.status='sent_to_vti_adapter'.

Return structured verdict.`,
  { label: "verify-goal", phase: "Verify", schema: VERIFY_SCHEMA },
);

phase("Commit");
const commit = await agent(
  `${CTX}

Verify result:
${JSON.stringify(verify)}

If verdict is REAL or PARTIAL with useful fixes:
1. git add relevant files.
2. git commit with message:
   feat(goal): close sandbox Claude policy VTI notification path
   Include bullets with sandbox, Claude, policy, approval, VTI trigger proof.
3. Update STATE.md with a Goal E2E section and exact verdict/caveats.
4. Update ~/brain/projects/onecomputer-goal-proof.md with latest proof.
5. pkill -f "gbrain serve"; sleep 1; gbrain import ~/brain/ && gbrain embed --stale.

Return commit hash or explain why not committed.`,
  { label: "commit+memory", phase: "Commit", model: "haiku" },
);

return { impl, verify, commit };
