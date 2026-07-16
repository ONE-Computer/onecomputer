export const meta = {
  name: "phase-14-gateway-approval-bridge",
  description:
    "Close the core demo gap: gateway holds a real request, creates a DURABLE ApprovalRequest via the internal API, and the manager's decision wakes the held request (bidirectional bridge). Demo beat 4b.",
  phases: [
    {
      title: "Design lock",
      detail:
        "Confirm the bridge direction + correlation id contract before writing code",
    },
    {
      title: "Gateway->API on hold",
      detail: "forward.rs POSTs /v1/internal/approvals when it starts holding",
    },
    {
      title: "API->Gateway on decision",
      detail:
        "Decision path notifies the gateway to wake the held watch channel",
    },
    {
      title: "E2E proof",
      detail:
        "New proof script: live proxied request held then approved then forwarded",
    },
    {
      title: "Verify+Commit",
      detail: "cargo test/clippy + tsc + proof + commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;
const API = `${REPO}/packages/api/src`;

// VERIFIED SEAMS (2026-07-04) — the whole point of this phase:
// - forward.rs:447-568 ALREADY holds the request in-memory: builds PendingApproval,
//   prepare_wait() -> ApprovalGuard -> store() -> decision_rx.wait(180s). On Approve it
//   forwards; on Deny/timeout it returns 403 via response::manual_approval_denied().
// - approval.rs: ApprovalStore trait { prepare_wait, store, get_pending, list_pending,
//   remove, wait_for_new, submit_decision }. submit_decision() wakes the held request.
// - THE GAP: forward.rs NEVER calls the ONEComputer API. It only holds in-memory. The
//   durable ApprovalRequest (packages/api routes/internal.ts POST /v1/internal/approvals,
//   internalAuth shared secret) is created SEPARATELY (today only by the proof script).
//   And approval-service.decideApproval() writes status but NEVER calls submit_decision()
//   on the gateway. The two halves are disconnected. This phase connects them BOTH ways.
const CTX = `
Repo: ${REPO}
Gateway (Rust): ${GW}
API (TS): ${API}
Gateway http_client is reqwest (already a dep, used in forward.rs).
Internal API auth: internalAuth shared-secret header (routes/internal.ts:44). Find the exact
header name + env var and reuse it — do NOT invent a new auth scheme.

HARD FACTS (verified — do not contradict or re-litigate):
- forward.rs already HOLDS the request (watch channel, 180s). It does NOT 403 immediately.
- The gateway does NOT currently create a durable ApprovalRequest and does NOT call the API.
- approval-service.decideApproval() sets status but does NOT wake the gateway.
- POST /v1/internal/approvals (internal.ts:102) already ingests a gateway ManualApproval
  event and creates a durable ApprovalRequest; it stores gatewayApprovalId in context.
- No-DIY-crypto rule still applies. This phase adds NO crypto.
`;

phase("Design lock");
const design = await agent(
  `${CTX}
## Agent 14-A: Lock the bridge design (READ-ONLY, no edits)

Decide and document the correlation + callback contract. Produce a short design note
(return as text, also write to docs/plan/_scratch/phase-14-design.md).

Answer concretely with file:line evidence:
1. Correlation id: the gateway mints approval_id (uuid) in forward.rs:447. The durable
   ApprovalRequest has its own id. Which is the source of truth? RECOMMEND: gateway sends
   its approval_id as 'gatewayApprovalId' to POST /v1/internal/approvals (already supported),
   and the API stores it. Confirm internal.ts stores/returns it.
2. Callback direction for the decision. Two options — pick ONE and justify:
   (A) PUSH: API decideApproval() makes an HTTP POST to a NEW gateway endpoint
       (e.g. POST /internal/approvals/:gatewayApprovalId/decision on the gateway's admin
       port) which calls approval_store.submit_decision(). Requires the gateway to expose
       an authenticated internal HTTP endpoint + the API to know the gateway URL.
   (B) POLL: the gateway, while holding, polls GET /v1/internal/approvals/:id/status every
       ~2s until approved/denied/expired, then calls submit_decision() locally. No new
       gateway inbound endpoint; only outbound calls from gateway.
   RECOMMEND (B) POLL for the demo: fewer moving parts, no inbound-to-gateway auth surface,
   works even if the gateway is behind NAT. Note (A) as the production-grade follow-up.
3. Failure modes: API unreachable when gateway tries to create the ApprovalRequest ->
   gateway should FAIL CLOSED (deny) or hold-without-durable? RECOMMEND fail-closed-with-log
   but keep holding on the in-memory timeout so the demo degrades gracefully; document it.
4. What new API route (if POLL): GET /v1/internal/approvals/:id/status returning
   { status: pending|approved|denied|expired }. Confirm none exists yet.

Return the locked decision (A or B) with rationale. Default to B unless evidence says otherwise.
`,
  { label: "14-A:design-lock", phase: "Design lock", effort: "high" },
);

phase("Gateway->API on hold");
const gwToApi = await agent(
  `${CTX}

## Agent 14-B: Gateway creates the durable ApprovalRequest when it starts holding

Per the locked design (14-A), edit apps/gateway/src/gateway/forward.rs around the hold
block (currently ~lines 447-516, AFTER store() succeeds, BEFORE decision_rx.wait()):

1. Add an async call that POSTs to the ONEComputer internal API
   POST {API_BASE}/v1/internal/approvals with the internalAuth shared-secret header and a
   body matching gatewayManualApprovalSchema: organizationId, projectId, agentId, action
   (derive from host/path, e.g. "outlook.send_email" for graph sendMail), requestedBy,
   host, path, method, ruleId, context, and gatewayApprovalId = approval_id.
2. API_BASE + shared secret come from gateway config/env — find how the gateway already
   reads env (there is existing config plumbing; reuse it). Add ONECOMPUTER_API_BASE and
   the existing internal secret var. Document defaults for local (http://127.0.0.1:10254).
3. Fail-closed-with-log per design: if the POST fails, log a warning and continue to hold
   on the in-memory timeout (do not crash; do not silently drop). Add a metric/log line.
4. Keep it non-blocking to the extent the design allows, but the durable record MUST exist
   before we start waiting (so the manager can see it). Await the POST before .wait().

Add a unit test that asserts the request body shape is built correctly from a PendingApproval
(pure function — extract body-building into a testable fn; mock the HTTP).

Run: export PATH="$HOME/.cargo/bin:$PATH"; cd ${REPO}/apps/gateway && cargo test && cargo clippy -- -D warnings
PASTE real output. Return files changed + test/clippy result.
`,
  {
    label: "14-B:gateway-to-api",
    phase: "Gateway->API on hold",
    effort: "high",
  },
);

phase("API->Gateway on decision");
const apiToGw = await agent(
  `${CTX}

## Agent 14-C: Wake the held gateway request on manager decision (POLL model per 14-A)

Assuming the locked design is POLL (B):
1. API: add GET /v1/internal/approvals/:id/status (routes/internal.ts, internalAuth) that
   returns { status } for an ApprovalRequest, resolving by either its own id OR its
   gatewayApprovalId in context. Add the validation + service function. Reuse approval-service.
2. Gateway: in forward.rs, replace the single decision_rx.wait(180s) with a loop that, while
   waiting, ALSO polls GET /v1/internal/approvals/:gatewayApprovalId/status every ~2s. On
   'approved' -> call approval_store.submit_decision(Approve); on 'denied'/'expired' ->
   submit_decision(Deny). The existing watch-channel path (submit_decision via wait_for_new)
   still works for in-process tests; polling is the production wake source. Keep the 180s
   hard timeout as the backstop.
   - Factor the poll into a small async fn with a unit test (mock HTTP -> assert it maps
     status strings to ApprovalDecision correctly).

If the locked design was PUSH (A) instead, implement that variant: new authenticated gateway
inbound endpoint + API calls it from decideApproval(). Follow 14-A exactly.

Run: export PATH="$HOME/.cargo/bin:$PATH"; cd ${REPO}/apps/gateway && cargo test && cargo clippy -- -D warnings
Also cd ${REPO}/apps/web && npx tsc --noEmit for the API route.
PASTE real output. Return files changed + results.
`,
  {
    label: "14-C:api-to-gateway",
    phase: "API->Gateway on decision",
    effort: "high",
  },
);

phase("E2E proof");
const proof = await agent(
  `${CTX}

## Agent 14-D: New E2E proof — live proxied request held then approved then forwarded

Write scripts/onecomputer/e2e-gateway-approval-proof.mjs that proves the FULL live path
(this is what today's e2e-goal-proof.mjs does NOT do — it created the ApprovalRequest
directly instead of via a held request):

1. Ensure a manual_approval PolicyRule exists for a test host/path (create via /v1/rules).
2. Start (or reuse) the gateway pointed at the local API. Make a real HTTP request THROUGH
   the gateway to the matching host/path (use a harmless test upstream if graph.microsoft.com
   is unavailable — the point is the gateway HOLD, not real mail). The request should block.
3. Poll GET /v1/approvals to find the durable ApprovalRequest the GATEWAY created (assert it
   exists and has the gatewayApprovalId — proving 14-B).
4. Approve it via POST /v1/approvals/:id/decide.
5. Assert the originally-held request UNBLOCKS and gets forwarded (proving 14-C).
6. Also run the deny path: hold -> deny -> assert 403 manual_approval_denied.
Emit JSON: { ok, held:true, durableApprovalCreatedByGateway:true, approvedUnblocked:true,
deniedReturns403:true, caveats:[] }.

Run it. PASTE the real JSON output. If a step can't run locally (e.g. no gateway build),
say so explicitly in caveats — do NOT fake ok:true.
Return the script + real output.
`,
  { label: "14-D:e2e-proof", phase: "E2E proof", effort: "high" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}

## Agent 14-E: Verify + commit (only if everything is genuinely green)

Re-run and PASTE all output:
  export PATH="$HOME/.cargo/bin:$PATH"
  cd ${REPO} && set -a && source .env && set +a
  DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer" cargo test --manifest-path apps/gateway/Cargo.toml
  cd ${REPO}/apps/gateway && cargo clippy -- -D warnings
  cd ${REPO}/apps/web && npx tsc --noEmit
  cd ${REPO} && node scripts/onecomputer/e2e-gateway-approval-proof.mjs

Only commit if cargo test (WITH env vars set — see docs/plan/05), clippy, tsc are clean
AND the proof prints ok:true with no caveats. If ANY is red, do NOT commit; return the
failures instead.

  git add -A apps/gateway/ packages/api/ scripts/onecomputer/
  git commit -m "feat(approvals): live gateway<->API manual-approval bridge

Gateway now creates a durable ApprovalRequest via /v1/internal/approvals when it
starts holding a request, and wakes the held request when the manager decides
(poll GET /v1/internal/approvals/:id/status). New e2e-gateway-approval-proof.mjs
proves hold->approve->forward and hold->deny->403 through the live proxy.

Closes the Phase 14 gap (previously the ApprovalRequest was created directly, not
by a held proxied request).

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-goal-proof.md (do NOT run
gbrain import — OpenAI key broken; note it). Update STATE.md and docs/plan/05.
Return commit hash + all pasted verification output.
`,
  { label: "14-E:verify-commit", phase: "Verify+Commit" },
);

return { design, gwToApi, apiToGw, proof, commit };
