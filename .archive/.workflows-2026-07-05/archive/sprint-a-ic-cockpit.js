export const meta = {
  name: "sprint-a-ic-cockpit",
  description:
    "Employee persona: live sandbox cockpit — list, create, exec terminal, status badges. Replaces hardcoded Computer Control page.",
  phases: [
    {
      title: "Branch",
      detail: "Create feature/employee-sandbox from persona-platform",
    },
    {
      title: "Sandboxes page",
      detail:
        "Live /sandboxes route: list, create modal, status badges, exec panel",
    },
    {
      title: "Overview wire",
      detail: "Wire overview counts to real API, add sandbox count widget",
    },
    { title: "Commit", detail: "Commit + update gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// Verified facts (do NOT re-probe):
// - API: GET/POST /v1/sandboxes, GET /v1/sandboxes/:id, POST /v1/sandboxes/:id/exec, DELETE /v1/sandboxes/:id
// - SandboxInfo: { id, name, state, toolboxUrl, claudeVersion?, bootstrapped }
// - state values: 'creating'|'started'|'stopped'|'error'|'archived'
// - Daytona API on 127.0.0.1:3000, toolbox on 127.0.0.1:4000
// - sandbox user uid=1000(daytona), node v22 pre-installed
// - Nav config: apps/web/src/lib/nav-config.ts (add Sandboxes item)
// - shadcn components: button, badge, card, dialog, table, skeleton, input, dropdown-menu
// - Hono API, Next.js App Router, "use client" for hooks
// - No Storybook. Prettier auto-formats on commit.
// - Branch: currently on feature/onecomputer-persona-platform

const BRAND_CTX = `
## Employee persona north star
The IC manages 20-30 Claude Code agents/sandboxes. They want Vercel-like UX:
- See all their sandboxes at a glance (name, state, how long running, Claude version)
- Boot a new one in one click
- Exec a command without leaving the browser
- Know immediately when something is broken (red badge, error reason)
Keep it fast and operational. No governance theater — compliance is a background concern.
`;

phase("Branch");
await agent(
  `
cd ${REPO}
git checkout feature/onecomputer-persona-platform
git checkout -b feature/employee-sandbox
echo "on branch: $(git branch --show-current)"
`,
  { label: "branch", phase: "Branch" },
);

phase("Sandboxes page");
await agent(
  `
${BRAND_CTX}

## Task: build the live Sandboxes page for the Employee persona

Repo: ${REPO}
Create these files:

### 1. ${WEB}/lib/api/sandboxes.ts — typed API client

\`\`\`typescript
// Thin fetch wrappers — no state, just typed calls
export interface SandboxInfo {
  id: string
  name: string
  state: 'creating' | 'started' | 'stopped' | 'error' | 'archived' | string
  toolboxUrl: string
  claudeVersion?: string
  bootstrapped: boolean
}
export interface ExecResult { exitCode: number; output: string }

const BASE = '/v1/sandboxes'
export const sandboxesApi = {
  list:   (): Promise<SandboxInfo[]> => fetch(BASE).then(r => r.json()),
  get:    (id: string): Promise<SandboxInfo> => fetch(\`\${BASE}/\${id}\`).then(r => r.json()),
  create: (name: string): Promise<SandboxInfo> =>
    fetch(BASE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) }).then(r=>r.json()),
  exec:   (id: string, command: string): Promise<ExecResult> =>
    fetch(\`\${BASE}/\${id}/exec\`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({command}) }).then(r=>r.json()),
  delete: (id: string): Promise<void> => fetch(\`\${BASE}/\${id}\`, {method:'DELETE'}).then(()=>undefined),
}
\`\`\`

### 2. ${WEB}/app/(dashboard)/sandboxes/page.tsx — server component for initial fetch

Simple server component: fetch initial list, pass to client component.
If Daytona is unreachable (fetch throws), pass empty array — graceful degradation.
Use Next.js fetch with { cache: 'no-store' }.
Internal API URL from env INTERNAL_API_URL ?? 'http://localhost:10256'.

### 3. ${WEB}/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx — "use client"

**State badge colour** (match existing badge usage in the codebase):
- started  → green (variant="default" or a green className)
- creating → amber + spinner (animate-spin on a Loader2 icon from lucide-react)
- error    → red (destructive variant)
- stopped/archived → grey (secondary variant)

**Layout**:
A. Header row: "Sandboxes" title + right-aligned "New Sandbox" button
B. If list empty: empty state — "No sandboxes running. Boot your first one." + big boot button
C. Table with columns: Name | State | Claude | Uptime | Actions
   - Uptime: calculate from createdAt if available, else show "—"
   - Actions dropdown per row: Open (link to toolboxUrl) | Exec | Stop | Delete
D. "New Sandbox" modal:
   - Text input: sandbox name (default: "sandbox-" + 4 random chars)
   - Create button: POST, show spinner, poll state every 3s until started/error
   - Progress messages: "Creating..." → "Installing Claude..." → "Ready" or "Error: {reason}"
E. "Exec" panel (sheet/dialog):
   - Simple textarea for command, Run button
   - POST /v1/sandboxes/:id/exec, show { exitCode, output } in a code block
   - Exit code 0 = green, non-zero = red
F. Live polling: useEffect with setInterval every 5s, fetch list, update state
G. Honest gap notice (small info callout at bottom):
   "Gateway proxy not yet active — sandbox traffic is unrouted. Verdaccio npm gate coming in Phase 4."

### 4. Add Sandboxes to nav

Read ${WEB}/lib/nav-config.ts first. Add after "Computer Control":
{ title: 'Sandboxes', href: '/sandboxes', icon: Terminal }
(import Terminal from lucide-react — already used in the codebase)

### After writing all files:
Run: cd ${REPO} && pnpm tsc --noEmit 2>&1 | tail -15
Fix any type errors. Report: files created, tsc pass/fail, error count.
`,
  { label: "sandboxes-page", phase: "Sandboxes page" },
);

phase("Overview wire");
await agent(
  `
${BRAND_CTX}

## Task: wire the overview page sandbox count widget

Repo: ${REPO}
File to edit: ${WEB}/app/(dashboard)/overview/_components/

1. Find where the overview counts are fetched (look for useCounts, getRecentActivity, etc.)
2. The sandboxes API is now at /v1/sandboxes (GET returns SandboxInfo[]).
   Add a "Sandboxes" count card to the overview showing:
   - Total sandboxes
   - Running (state=started)
   - Link to /sandboxes

3. Find the existing counts structure in packages/api/src/routes/counts.ts (or wherever
   counts come from). Add a sandboxes count: call listSandboxes() and include
   { total, running } in the response. Import from daytona-service.ts.

4. Wrap in try/catch — if Daytona is down, sandbox counts return { total: 0, running: 0 }.
   Never crash the overview page because Daytona is unreachable.

Run: pnpm tsc --noEmit 2>&1 | tail -10
Report: what you changed, tsc pass/fail.
`,
  { label: "overview-wire", phase: "Overview wire" },
);

phase("Commit");
await agent(
  `
## Task: commit Sprint A to git and update gbrain

Repo: ${REPO}

1. Stage and commit:
\`\`\`bash
cd ${REPO}
git add apps/web/src/app/\\(dashboard\\)/sandboxes/ apps/web/src/lib/api/sandboxes.ts apps/web/src/lib/nav-config.ts packages/api/src/routes/counts.ts 2>/dev/null
git add -A apps/web/src/
git status --short | head -20
git commit -m "feat(ic): live sandboxes cockpit — list, create, exec, status badges

Persona: Individual Contributor (IC managing 20-30 agents/sandboxes)

- /sandboxes page: live list with state badges, 5s polling
- New Sandbox modal: create + bootstrap progress + Claude version display
- Exec panel: run commands, show exit code + output
- Nav: Sandboxes link added (Terminal icon)
- Overview: sandbox count widget (total/running, graceful if Daytona down)
- Honest gap notice: gateway proxy + Verdaccio not yet active

Co-Authored-By: Claude <noreply@anthropic.com>"
\`\`\`

2. Update gbrain:
\`\`\`bash
pkill -f "gbrain serve"; sleep 1
\`\`\`
Append to ~/brain/projects/onecomputer-build-priorities.md:
"## Sprint A Employee cockpit (2026-06-28) — DONE: /sandboxes page live, nav wired, overview counts, tsc pass"

Then: gbrain import ~/brain/ && gbrain embed --stale

3. Report: commit hash, files changed, tsc status, gbrain updated.
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
