export const meta = {
  name: "sprint-a-complete",
  description:
    "Complete Sprint A: wire agents page to live API, add Sandboxes nav link, sandbox overview count widget",
  phases: [
    {
      title: "Agents page",
      detail: "Replace 3 hardcoded agent records with live GET /v1/agents",
    },
    {
      title: "Nav + counts",
      detail: "Add Sandboxes nav link, sandbox count widget on overview",
    },
    { title: "Commit", detail: "Commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// What's already done (sandboxes-content.tsx written + committed):
// - /sandboxes page: live list, state badges, 5s polling, exec panel, boot modal ✅
// - API client: apps/web/src/lib/api/sandboxes.ts ✅
// What remains:
// - /agents page: 3 hardcoded records → live GET /v1/agents
// - nav-config.ts: add Sandboxes link
// - overview: sandbox count widget

phase("Agents page");
await agent(
  `
Repo: ${REPO}

## Task: wire the agents page to the live agents API

Read these files first:
1. ${WEB}/app/(dashboard)/agents/page.tsx
2. ${WEB}/app/(dashboard)/agents/_components/agents-page-content.tsx (first 80 lines)
   (This shows 3 hardcoded agent records — replace with live API call)

### What to do

1. Create ${WEB}/lib/api/agents.ts — typed fetch wrapper:
\`\`\`typescript
export interface AgentInfo {
  id: string; name: string; identifier?: string
  accessToken?: string; isDefault?: boolean
  did?: string; createdAt?: string
}
export const agentsApi = {
  list: (): Promise<AgentInfo[]> =>
    fetch('/v1/agents').then(r => r.json()).then(d => Array.isArray(d) ? d : d.agents ?? []),
  get: (id: string): Promise<AgentInfo> =>
    fetch(\`/v1/agents/\${id}\`).then(r => r.json()),
}
\`\`\`

2. Create ${WEB}/app/(dashboard)/agents/_components/agents-live-content.tsx "use client":
- useEffect with 10s interval polling GET /v1/agents
- Table columns: Name | Identifier | DID (if present) | Created | Actions
- Empty state: "No agents yet. Create your first agent."
- Keep the existing AgentControlWorkbench component if it still renders — just replace
  the hardcoded data source with the live API result
- RBAC-aware: if ability.can('create', 'Agent') → show "New Agent" button
  (import AppAbility type from @/lib/ability if Sprint F is done, otherwise skip ability check)

3. Update ${WEB}/app/(dashboard)/agents/page.tsx to use agents-live-content.tsx

pnpm tsc --noEmit 2>&1 | tail -10
Return: files created/modified, tsc pass/fail.
`,
  { label: "agents-page", phase: "Agents page" },
);

phase("Nav + counts");
await agent(
  `
Repo: ${REPO}

## Task 1: add Sandboxes to nav

Read ${WEB}/lib/nav-config.ts — find the navigation item array.
Add after "Computer Control" (apps):
\`\`\`typescript
{
  title: 'Sandboxes',
  href: '/sandboxes',
  icon: Terminal,   // from lucide-react — check if already imported
}
\`\`\`
Import Terminal from lucide-react if not present.

## Task 2: sandbox count on overview

Find the overview stats/counts component — likely at:
${WEB}/app/(dashboard)/overview/_components/stats-cards.tsx
or similar.

Add a "Sandboxes" stat card showing:
- Total sandboxes (GET /v1/sandboxes, count items)
- Running now (items where state === 'started')
- Wrap in try/catch — if Daytona down, show 0/0 gracefully

Look at how the existing cards fetch data (server action, useQuery, etc.) and match the pattern exactly.

pnpm tsc --noEmit 2>&1 | tail -10
Return: nav updated (yes/no), stats card added (yes/no), tsc pass/fail.
`,
  { label: "nav-counts", phase: "Nav + counts" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add apps/web/src/app/\\(dashboard\\)/agents/ apps/web/src/lib/nav-config.ts apps/web/src/lib/api/agents.ts 2>/dev/null
git add -A apps/web/src/
git commit -m "feat(employee): complete Sprint A — agents live, sandboxes nav

Sprint A complete:
- /agents: replaced 3 hardcoded records with live GET /v1/agents + 10s polling
- /sandboxes: nav link added (Terminal icon)
- Overview: sandbox count widget (total + running, graceful if Daytona down)
- /sandboxes page: list + boot modal + exec panel already done (prev commit)

Persona: Employee (20-30 Claude Code agents)

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale
echo "Sprint A complete"
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
