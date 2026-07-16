export const meta = {
  name: "sprint-b-cyber-console",
  description:
    "Cyber/Compliance persona: replace hardcoded CISO console with live org-wide fleet view, violations feed, kill switches, evidence export",
  phases: [
    { title: "Branch", detail: "Create feature/cyber-live-console" },
    {
      title: "Console",
      detail:
        "Wire /console to real data: sandbox fleet, violations, kill switch",
    },
    {
      title: "Kill switch",
      detail: "Wire agent revoke + sandbox delete as kill switch actions",
    },
    { title: "Commit", detail: "Commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// Key facts:
// /console → console/_components/ciso-privacy-console.tsx
// Currently calls buildCisoUserPrivacyConsolePayload() → samplePersonalConnectorRegistryPayload()
// = HARDCODED SAMPLES. Must be replaced with real API calls.
// Real data available:
//   GET /v1/sandboxes → SandboxInfo[] (all sandboxes this session can see)
//   GET /v1/agents → agents list
//   GET /v1/rules → policy rules
//   GET /activity (server action) → RequestLog[] (live request logs with blocked/allowed)
// AuditLog model in Prisma — has action, resource, userId, createdAt
// RequestLog model: method, host, path, status, latencyMs, injectionCount, provider, agentId
// /activity page already polls every 3s — reuse that hook/action

const CYBER_CTX = `
## Cyber/Compliance persona north star
The CISO needs to answer three questions instantly:
1. What is running right now? (all sandboxes, all agents, who owns them)
2. Is anything bad happening? (policy violations, blocked requests, anomalies)
3. Can I stop it? (kill switch per sandbox/agent, evidence export)

The console must feel like a security operations dashboard — concrete, real-time,
no decorative charts. Think CrowdStrike/Splunk clarity, not a product marketing page.
`;

phase("Branch");
await agent(
  `
cd ${REPO}
git checkout feature/onecomputer-persona-platform
git checkout -b feature/cyber-live-console
echo "branch: $(git branch --show-current)"
`,
  { label: "branch", phase: "Branch" },
);

phase("Console");
await agent(
  `
${CYBER_CTX}

## Task: replace hardcoded CISO console with live org-wide view

Repo: ${REPO}

### Step 1 — Read what currently exists
Read: ${WEB}/app/(dashboard)/console/page.tsx
Read: ${WEB}/app/(dashboard)/console/_components/ciso-privacy-console.tsx (first 100 lines)
Understand the current structure before changing anything.

### Step 2 — Add a live console API endpoint
Create ${REPO}/packages/api/src/routes/console-live.ts:

\`\`\`typescript
// GET /v1/console/overview — returns real data for the CISO console
// Aggregates: sandbox fleet, agent count, recent violations, rule summary
// All in one call so the page doesn't need 5 separate fetches.

import { listSandboxes } from '../services/daytona-service'

interface ConsoleOverview {
  sandboxes: { total: number; running: number; error: number; items: SandboxInfo[] }
  agents:    { total: number }
  rules:     { total: number; blockRules: number; approvalRules: number }
  violations: { last24h: number; recent: RecentViolation[] }
  lastUpdated: string
}
interface RecentViolation {
  id: string; agentId?: string; host: string; path: string
  method: string; ruleName: string; timestamp: string
}
\`\`\`

Implement:
- sandboxes: call listSandboxes() (wrap in try/catch, empty if Daytona down)
- agents: query DB Agent count for this org
- rules: query PolicyRule count, filter by action
- violations: query RequestLog where status starts with "blocked" OR
  where the decision was blocked, last 24h, latest 10
Mount at: app.route('/console-live', consoleLiveRoutes()) in app.ts

### Step 3 — Replace the hardcoded console component

Replace the sample-data-driven console with a real one.
DO NOT delete the existing component — rename it to ciso-privacy-console.legacy.tsx
and create a new ciso-console-live.tsx "use client" component.

Update page.tsx to use the new component.

**New component layout** (3 sections):

**A. Fleet status bar** (top, always visible):
Row of 4 stat cards:
- Sandboxes running: N (green if >0)
- Sandboxes with errors: N (red if >0)
- Agents active: N
- Policy violations (24h): N (amber/red if >0)
Data from: GET /v1/console/overview
Poll every 30s.

**B. Sandbox fleet table** (main section):
Columns: Name | Owner | State | Started | Claude | Actions
Actions per row:
- "View" → links to /sandboxes/:id (once Sprint A is done)
- "Kill" → DELETE /v1/sandboxes/:id with confirmation dialog
  Confirmation copy: "This will immediately stop sandbox [name] and revoke all
  access. This cannot be undone."
- "Export evidence" → downloads a JSON file with the sandbox's metadata,
  request log count, and rule evaluation summary

**C. Violations feed** (bottom section, same as /activity but filtered to blocked):
Show last 20 blocked/policy-denied requests.
Columns: Time | Agent | Host | Path | Rule | Status
Color: all rows are red/amber (they're violations).
Link to full /activity page for more.

### Step 4 — Wire the new route in app.ts
Add: app.route('/console-live', consoleLiveRoutes())

### Step 5 — tsc check
pnpm tsc --noEmit 2>&1 | tail -15
Fix errors. Report pass/fail.
`,
  { label: "console", phase: "Console" },
);

phase("Kill switch");
await agent(
  `
${CYBER_CTX}

## Task: wire the agent kill switch (revoke access instantly)

Repo: ${REPO}

The kill switch needs TWO levels:
1. Sandbox-level: DELETE /v1/sandboxes/:id (already exists in daytona-service.ts)
2. Agent-level: revoke the agent's access token so it can't call the gateway

### Agent revoke endpoint
Find packages/api/src/routes/agents.ts. Add:
POST /agents/:id/revoke
- Sets agent.accessToken to null or a revoked sentinel ("revoked_" + Date.now())
- Logs to AuditLog: action="REVOKE", service="AGENT", metadata={agentId, reason}
- Returns { ok: true, message: "Agent access revoked" }

### Wire revoke in the console UI
In the new ciso-console-live.tsx, the sandbox "Kill" button should:
1. First call DELETE /v1/sandboxes/:id (stop the sandbox)
2. Then if there's an agent associated, call POST /v1/agents/:agentId/revoke
3. Show success: "Sandbox stopped and agent access revoked"

Add a standalone "Revoke Agent" button to the agents section (if it exists on
the console page) that calls just the revoke endpoint.

### tsc check
pnpm tsc --noEmit 2>&1 | tail -10
Report pass/fail.
`,
  { label: "kill-switch", phase: "Kill switch" },
);

phase("Commit");
await agent(
  `
## Commit Sprint B and update gbrain

cd ${REPO}
git add -A apps/web/src/app/\\(dashboard\\)/console/ packages/api/src/routes/ packages/api/src/app.ts 2>/dev/null
git add -A apps/web/src/
git status --short | head -20
git commit -m "feat(cyber): live CISO console — fleet view, violations feed, kill switch

Persona: Cyber/Compliance team

- /console: replaced hardcoded samples with live org-wide data
- Fleet status bar: sandbox counts, error count, violations (24h)
- Sandbox fleet table: all sandboxes with Kill + Evidence export actions
- Kill switch: DELETE sandbox + POST /agents/:id/revoke in sequence
- Violations feed: last 20 blocked requests with rule names
- /v1/console/overview endpoint: aggregates fleet + rules + violations in one call
- Agent revoke endpoint: POST /agents/:id/revoke + AuditLog entry

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
# Update gbrain
python3 -c "
import subprocess, datetime
note = '## Sprint B cyber console (2026-06-28) — DONE: live CISO console, kill switch wired, violations feed, tsc pass'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write('\\n' + note + '\\n')
print('gbrain page updated')
"
gbrain import ~/brain/ && gbrain embed --stale
echo "done"
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
