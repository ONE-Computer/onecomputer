export const meta = {
  name: "phase-16-audit-timeline",
  description:
    "Ops/Audit persona: a unified audit timeline joining RequestLog (gateway decisions) + AuditLog (state changes) + ApprovalRequest (approvals/decisions) into one filterable, exportable evidence view. Demo beat 5.",
  phases: [
    {
      title: "Timeline API",
      detail:
        "GET /v1/audit/timeline merging the three sources into one ordered feed",
    },
    {
      title: "Timeline UI",
      detail: "/audit page: filterable timeline with evidence detail drawer",
    },
    {
      title: "Export",
      detail: "Evidence export (JSON) of a filtered timeline slice",
    },
    {
      title: "Verify+Commit",
      detail: "tsc + real data check + commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API = `${REPO}/packages/api/src`;

// VERIFIED SEAMS (2026-07-04):
// - Console today (console-live.ts /overview) shows RequestLog rows with decision="blocked"
//   from last 24h only. That's violations, not a full audit trail.
// - AuditLog table EXISTS (schema.prisma:437-456) for state changes (create agent, update
//   rule, etc.) via withAudit wrapper — but has NO viewer UI at all.
// - ApprovalRequest holds approvals + decidedBy + decisionComment + _vti.
// - No dedicated /audit route exists.
const CTX = `
Repo: ${REPO}
Web: ${WEB}
API: ${API}
Web app http://127.0.0.1:10254, AUTH_MODE=local.

HARD FACTS (verified — do not contradict):
- Three real data sources exist and are populated: RequestLog (gateway decisions incl.
  allowed/blocked/approval-pending/approval-denied), AuditLog (state changes via withAudit),
  ApprovalRequest (approvals + decisions + VTI). This phase JOINS them; it does not create
  new logging.
- The console page shows ONLY blocked RequestLog rows for 24h. Do NOT duplicate the console;
  build a proper cross-source timeline.
- Persona: "Ops / Audit" — read-only, wants a defensible evidence trail. Use existing RBAC
  (ability.ts) so this is visible to Cyber/Owner (and Ops if that maps to a role).
- Follow CLAUDE.md audit-logging conventions; do NOT weaken existing withAudit calls.
`;

phase("Timeline API");
const api = await agent(
  `${CTX}
## Agent 16-A: Unified timeline API

Add GET /v1/audit/timeline (new routes/audit.ts + service). It returns a single ordered
(desc by timestamp) array of typed events merged from:
- RequestLog: { kind:"gateway", decision, host, path, method, agentName, ruleName, ts, id }
- AuditLog:   { kind:"admin", action, service, actorEmail, metadata, ts, id }
- ApprovalRequest: { kind:"approval", action, status, requestedBy, decidedBy, ts, id, vtiTaskHash? }

Query params: from, to (ISO), kind (filter), agentId, limit (default 100, cap 500), cursor.
Implement server-side merge + pagination sensibly (fetch each source with the window, merge,
sort, slice). Reuse existing Prisma models; do NOT add columns.
RBAC: requireAbility(ability, 'read', <appropriate subject>) — pick the subject already used
for the console/audit-ish reads; if none, use 'RequestLog'/'AuditLog' consistently.

Run: cd ${REPO}/apps/web && npx tsc --noEmit
Return: route/service files, the event union shape, tsc result, and a real sample response
(curl http://127.0.0.1:10254/v1/audit/timeline?limit=5 — PASTE it).
`,
  { label: "16-A:timeline-api", phase: "Timeline API", effort: "high" },
);

phase("Timeline UI");
const ui = await agent(
  `${CTX}
## Agent 16-B: Audit timeline page

Create apps/web/src/app/(dashboard)/audit/page.tsx + _components/audit-timeline.tsx.
- Vertical timeline; each event typed by kind with an icon + color (gateway / admin / approval).
- Filters: time range (24h/7d/30d), kind, agent, free-text.
- Row shows a one-line human summary; clicking opens a detail drawer with the full raw
  record (pretty JSON) — this is the "evidence" view.
- Approval rows link to /device/approvals/:id (phase-15a) and show the VTI taskHash.
- Add /audit to nav-config.ts under the Cyber/Ops persona grouping.
- Empty state: "No audit events in this window."

Run tsc. Return files changed, nav change, tsc result, and http code for /audit.
`,
  { label: "16-B:timeline-ui", phase: "Timeline UI" },
);

phase("Export");
const exp = await agent(
  `${CTX}
## Agent 16-C: Evidence export

Add an "Export evidence (JSON)" button on /audit that downloads the CURRENTLY FILTERED
timeline slice (same query params) as a JSON file with a small envelope:
{ exportedAt, filter, count, events:[...] }.
Prefer a server route GET /v1/audit/timeline/export (streams JSON with content-disposition)
so large exports don't bloat the client; reuse the 16-A service.
Do NOT include secrets/tokens in exported metadata (respect the audit metadata guidelines
in CLAUDE.md).

Run tsc. Return route/files + tsc result + real bytes from a small export (PASTE head).
`,
  { label: "16-C:export", phase: "Export" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 16-D: Verify + commit

PASTE real output:
  cd ${REPO}/apps/web && npx tsc --noEmit
  curl -s "http://127.0.0.1:10254/v1/audit/timeline?limit=5" | head -c 1000
  curl -s -o /dev/null -w "audit:%{http_code}\\n" http://127.0.0.1:10254/audit

Only commit if tsc clean AND the timeline returns real merged events (not an empty stub):
  cd ${REPO}
  git add -A apps/web/ packages/api/
  git commit -m "feat(audit): unified ops/audit timeline (RequestLog + AuditLog + approvals)

New /v1/audit/timeline merges gateway decisions, admin state-changes, and approval
decisions into one ordered, filterable feed; /audit page with evidence detail drawer
and filtered JSON export. Demo beat 5 (Ops/Audit trail).

tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-enterprise-ux-gap.md (do NOT
run gbrain import — key broken). Update docs/plan/00-current-state.md (STATE.md is now a
redirect stub — do not edit it).
Return commit hash + pasted output.
`,
  { label: "16-D:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { api, ui, exp, commit };
