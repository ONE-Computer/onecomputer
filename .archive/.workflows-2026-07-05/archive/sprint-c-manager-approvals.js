export const meta = {
  name: "sprint-c-manager-approvals",
  description:
    "Manager persona: approval queue, 2FA step-up gate for sensitive ops, team-scoped agent overview",
  phases: [
    { title: "Branch", detail: "Create feature/manager-approvals" },
    {
      title: "Approvals API",
      detail: "Approval records in DB, create/list/decide endpoints",
    },
    {
      title: "Approvals UI",
      detail: "/approvals page: queue, approve/deny, step-up gate on Outlook",
    },
    { title: "Commit", detail: "Commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// Key facts:
// - vti-consent-service.ts has real fail-closed consent logic (verified in audit)
//   but it's never called from the retrieval path — Sprint C wires it
// - PolicyRule model has manual_approval action — gateway returns ManualApproval decision
// - OrganizationMember model has role field — use for manager detection
// - AuditLog exists and is real
// - The "step-up" concept: before sending email via Outlook connector,
//   the agent must have a manager-approved token

const MGR_CTX = `
## Manager persona north star
The Business Unit Manager needs to:
1. See a queue of pending approvals from their team's agents
2. Approve or deny each one with one tap (+ optional comment)
3. Know that certain ops (external email, large data export) CANNOT happen without their approval
4. Get a summary of what their team's agents did today

The approvals flow must be simple — binary decision, clear context, fast.
Not a compliance form. Think: iOS app approval prompt with subject/requester/action.
`;

phase("Branch");
await agent(
  `
cd ${REPO}
git checkout feature/onecomputer-persona-platform
git checkout -b feature/manager-approvals
echo "branch: $(git branch --show-current)"
`,
  { label: "branch", phase: "Branch" },
);

phase("Approvals API");
await agent(
  `
${MGR_CTX}

## Task: add approval records and endpoints

Repo: ${REPO}

### Step 1 — Add ApprovalRequest to Prisma schema
File: packages/db/prisma/schema.prisma

Add after AuditLog:
\`\`\`prisma
model ApprovalRequest {
  id          String   @id @default(uuid())
  organizationId String @map("organization_id")
  projectId   String?  @map("project_id")
  agentId     String?  @map("agent_id")
  requestedBy String   @map("requested_by")  // userId or agentId
  action      String   // e.g. "outlook.send_email", "sharepoint.write", "data.export"
  context     Json?    // { recipient, subject, preview } — what the agent wants to do
  status      String   @default("pending")  // "pending" | "approved" | "denied"
  decidedBy   String?  @map("decided_by")
  decisionComment String? @map("decision_comment")
  expiresAt   DateTime @map("expires_at")   // auto-deny if not acted on
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("approval_requests")
}
\`\`\`

Run: pnpm db:generate
(This generates the Prisma client. Do NOT run db:migrate — needs a live DB.)

### Step 2 — Create approval routes
Create packages/api/src/routes/approvals.ts:

\`\`\`typescript
// GET  /approvals          → list pending approvals for this org (paginated)
// POST /approvals          → create a new approval request (called by agent/gateway)
// POST /approvals/:id/decide → approve or deny { decision: 'approved'|'denied', comment? }
// GET  /approvals/summary  → { pending: N, approved24h: N, denied24h: N }
\`\`\`

Implement all four. For POST /approvals:
- Set expiresAt to 24h from now
- Require: action, requestedBy, context (JSON)
- Optional: agentId, projectId

For POST /approvals/:id/decide:
- Only org members with role="admin" or role="manager" can decide
- Write to AuditLog on decision
- Return { ok: true, status: decision }

Wire in app.ts: app.route('/approvals', approvalRoutes())

### Step 3 — Hook the gateway manual_approval decision into approvals
In packages/api/src/ find where ManualApproval PolicyDecision is handled
(it exists in the gateway but the API side doesn't create approval records yet).
In the activity or internal route, when the gateway reports a ManualApproval event,
create an ApprovalRequest record.

This is the connection: gateway says "manual approval needed" → API creates a
pending ApprovalRequest → manager sees it in the UI → decides → API unblocks.

For now, wire the CREATE path only (the unblock path is Phase 3 identity work).

### tsc check
pnpm tsc --noEmit 2>&1 | tail -15
Report pass/fail.
`,
  { label: "approvals-api", phase: "Approvals API" },
);

phase("Approvals UI");
await agent(
  `
${MGR_CTX}

## Task: build the /approvals page

Repo: ${REPO}

### 1. New page: ${WEB}/app/(dashboard)/approvals/page.tsx (server component)
Fetch initial approval queue from GET /v1/approvals. Pass to client component.

### 2. New component: ${WEB}/app/(dashboard)/approvals/_components/approvals-content.tsx "use client"

**Layout**:

A. Header: "Approvals" + summary badges: "N pending", "N approved today", "N denied today"

B. Pending queue (main section):
Each approval card shows:
- Agent name + avatar initial
- Action: human-readable description (e.g. "Wants to send email" for outlook.send_email)
- Context preview: recipient, subject line (truncated), timestamp
- Time remaining until auto-deny (countdown)
- Two buttons: ✓ Approve (green) / ✗ Deny (red)
- Optional: comment textarea (collapsed by default)

On Approve/Deny:
- POST /v1/approvals/:id/decide { decision, comment }
- Show spinner, then move card to "Decided" section
- Toast: "Approved — agent will proceed" or "Denied — agent blocked"

C. Recent decisions (collapsed section):
Last 10 approved/denied in the last 24h.
Shows: action, agent, decision, who decided, when.

D. Empty state: "No pending approvals. Your team's agents are operating within policy."

### 3. Add Approvals to nav
In lib/nav-config.ts, add under the Manager section (or after Rules):
{ title: 'Approvals', href: '/approvals', icon: CheckCircle }
Add a badge count showing pending approvals — fetch from /v1/approvals/summary.

### 4. Step-up gate visible in sandbox exec
In the exec panel (Sprint A sandboxes-content.tsx), when an exec command includes
keywords like "send" "email" "outlook" "calendar write", show a warning:
"This action may require manager approval. The request will be queued if policy requires it."
(This is a UX hint — the actual gate is in the gateway via PolicyRule.)

### tsc check
pnpm tsc --noEmit 2>&1 | tail -15
Report pass/fail, files created.
`,
  { label: "approvals-ui", phase: "Approvals UI" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add -A apps/web/src/app/\\(dashboard\\)/approvals/ apps/web/src/lib/nav-config.ts 2>/dev/null
git add packages/api/src/routes/approvals.ts packages/api/src/app.ts packages/db/prisma/schema.prisma packages/db/prisma/ 2>/dev/null
git add -A apps/web/src/
git status --short | head -20
git commit -m "feat(manager): approval queue + step-up gate UI

Persona: Business Unit Manager

- ApprovalRequest model in Prisma schema
- POST/GET /v1/approvals + POST /v1/approvals/:id/decide
- /approvals page: pending queue with approve/deny + countdown
- Recent decisions section
- Nav: Approvals link with pending count badge
- Exec panel: step-up hint for sensitive keywords
- AuditLog write on every approval decision

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Sprint C manager approvals (2026-06-28) — DONE: ApprovalRequest model, approval queue UI, step-up gate hint\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
"
gbrain import ~/brain/ && gbrain embed --stale
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
