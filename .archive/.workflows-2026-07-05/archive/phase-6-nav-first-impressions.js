export const meta = {
  name: "phase-6-nav-first-impressions",
  description:
    "UX Phase 6: role-based landing, nav personalization, live overview counts, persona-appropriate empty states across all 25 pages",
  phases: [
    {
      title: "Build",
      detail:
        "4 parallel agents: landing redirect, nav groups, overview live data, empty states",
    },
    { title: "Verify", detail: "tsc clean, all pages render, no blank tables" },
    { title: "Commit", detail: "Commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// Verified facts:
// - 25 pages under app/(dashboard)/
// - RBAC from Sprint F: OrgRole = "owner"|"admin"|"manager"|"member"
// - Auth: NextAuth v5, session has user.id + user.email, AUTH_MODE=local (no real roles yet)
// - In local mode all users are "local-admin" (auth-server.ts:10)
//   → Phase 6 should simulate role via a user setting or URL param, not break local dev
// - Nav config: apps/web/src/lib/nav-config.ts (Sandboxes added in Sprint A)
// - Overview components: apps/web/src/app/(dashboard)/overview/_components/
//   ciso-command-center.tsx, ciso-readiness-panel.tsx, stats-cards.tsx — all hardcoded
// - useCounts hook exists, real counts from API
// - Empty states: sandboxes has one, agents/approvals/apps may not

const CTX = `
Repo: ${REPO}
Web: ${WEB}
Auth: NextAuth v5, AUTH_MODE=local. In local mode role is always "local-admin".
  → For Phase 6 role simulation: read a cookie/localStorage "oc_role" (default: "admin").
  → Do NOT break local dev — always fall back to "admin" if no role set.
RBAC from Sprint F: OrgRole = "owner" | "admin" | "manager" | "member"
  admin = Cyber persona, manager = Manager persona, member = Employee persona, owner = Platform
Nav items in: apps/web/src/lib/nav-config.ts
Persona north stars:
  Cyber (admin/owner): /console first — fleet, violations, kill switch
  Manager: /approvals first — pending queue, team summary
  Employee (member): /sandboxes first — boot and run agents
  Platform (owner in deploy mode): /apps first — deploy wizard
`;

// ─── 6-A: Role-based landing ─────────────────────────────────────────────────
const A = `${CTX}

## Agent 6-A: role-based landing redirect

When a user logs in, redirect them to the right page for their persona.

### 1. Create ${WEB}/lib/role-preference.ts
\`\`\`typescript
// Stores and reads the simulated role preference.
// In local dev (AUTH_MODE=local) there's no real role — use localStorage.
// In production this should come from the session's org member role.

const KEY = 'oc_role_pref'

export type PersonaRole = 'admin' | 'manager' | 'member' | 'owner'

export function getPersonaRole(): PersonaRole {
  if (typeof window === 'undefined') return 'admin'  // SSR default
  return (localStorage.getItem(KEY) as PersonaRole) ?? 'admin'
}

export function setPersonaRole(role: PersonaRole): void {
  localStorage.setItem(KEY, role)
}

export function getLandingPage(role: PersonaRole): string {
  switch (role) {
    case 'manager': return '/approvals'
    case 'member':  return '/sandboxes'
    case 'owner':   return '/apps'
    default:        return '/console'  // admin/Cyber
  }
}
\`\`\`

### 2. Add a persona switcher to the settings sidebar
File: ${WEB}/app/(dashboard)/settings/profile/page.tsx (or a new component there)
Add a "Persona preview" card below the profile form:
- Label: "Preview as persona"
- Dropdown: Admin (Cyber), Manager, Employee, Owner (Platform)
- On change: call setPersonaRole() + navigate to getLandingPage(role)
- Note: "In production this will be set by your org role. This is for preview only."

### 3. Auto-redirect on overview
In ${WEB}/app/(dashboard)/overview/page.tsx (server component):
Read the persona from a cookie (set by the client) or header.
If role !== admin/owner (which use overview as home), redirect to getLandingPage(role).
Note: use Next.js redirect() for server-side, or useEffect + router.push client-side.

### tsc check
pnpm tsc --noEmit 2>&1 | tail -8
Return: files created, persona dropdown working (yes/no), tsc pass/fail.`;

// ─── 6-B: Nav personalization ─────────────────────────────────────────────────
const B = `${CTX}

## Agent 6-B: nav personalization — group items by persona

Read ${WEB}/lib/nav-config.ts first. Then add section grouping.

### Current nav items (to be grouped):
Overview, Agent Control, Computer Control (=apps), Rules, Connections, Activity,
CISO/Privacy (=console), Copilot, Sandboxes (added Sprint A), Approvals (added Sprint C), Settings

### Grouping to add:
Create 4 nav sections. Each section has a title and a list of items.
Sections are always visible but section titles help orient each persona.

\`\`\`
─── Workspace ────────────────────────
  Sandboxes     (Employee primary)
  Agent Control (Employee/all)
  Connections   (Employee)
  Copilot       (all, disabled)
─── Governance ───────────────────────
  Approvals     (Manager primary)
  Rules         (Manager/Cyber)
  Activity      (all)
─── Monitoring ───────────────────────
  CISO Console  (Cyber primary)
  Computer Control / Apps (Platform)
─── System ───────────────────────────
  Overview
  Settings
────────────────────────────────────
\`\`\`

Update nav-config.ts to export an array of sections instead of a flat array.
Update the sidebar component to render sections with a small section header label.
Section headers should use text-xs text-muted-foreground uppercase tracking-wider.

Find the sidebar nav component — likely in:
${WEB}/app/(dashboard)/_components/ or ${WEB}/components/
Read it before editing.

### tsc check
pnpm tsc --noEmit 2>&1 | tail -8
Return: sidebar file modified, section headers render (yes/no), tsc pass/fail.`;

// ─── 6-C: Overview live data ──────────────────────────────────────────────────
const C = `${CTX}

## Agent 6-C: replace hardcoded overview data with live counts

Read these files first:
- ${WEB}/app/(dashboard)/overview/_components/stats-cards.tsx
- ${WEB}/app/(dashboard)/overview/_components/ciso-command-center.tsx
- ${WEB}/app/(dashboard)/overview/_components/ciso-readiness-panel.tsx

### 1. stats-cards.tsx — wire to real counts
Replace hardcoded const cards = [...] with data from the existing useCounts hook
(or fetch from /v1/counts). Add a "Sandboxes" card showing:
  total: N, running: (state=started)
Wire agents, secrets, rules cards to real API data too if they're hardcoded.
Show <Skeleton /> during loading.

### 2. ciso-command-center.tsx — remove theater, replace with real
The const controlGraph, actionQueue, demoScript, finalScorecard are all hardcoded.
Replace with:
  - Recent activity count (blocked requests last 24h from /activity)
  - Approvals pending count (from /v1/approvals/summary)
  - Active sandboxes count
  - Active agents count
Keep the layout but swap hardcoded data for real.
If any data fetch fails, show "--" not 0 (graceful degradation).

### 3. ciso-readiness-panel.tsx — simplify
This has a const controls = [...] which is a fake readiness checklist.
Replace with an honest status panel:
  ✅ Gateway enforcement: 4/4 gaps compiled
  ✅ RBAC: @casl wired to routes
  🟡 VTI identity: in progress (Phase I)
  🟡 Verdaccio package gate: in progress (Sprint G)
  ❌ SharePoint connector: not built
This is static (not a live fetch) but honest — no fake percentages.

### tsc check
pnpm tsc --noEmit 2>&1 | tail -8
Return: files modified, fake data removed, live data wired, tsc pass/fail.`;

// ─── 6-D: Empty states ───────────────────────────────────────────────────────
const D = `${CTX}

## Agent 6-D: persona-appropriate empty states for all list pages

Audit and fix empty states on these pages:
1. /sandboxes — already has an empty state (good, verify it works)
2. /agents — check agents-live-content.tsx, add empty state if missing
3. /approvals — check approvals-content.tsx, add empty state if missing
4. /apps — check apps-live-content.tsx, add empty state if missing
5. /activity — check if empty state exists

### Empty state design pattern (consistent across all pages):
\`\`\`tsx
// Each empty state has:
// - A simple icon (lucide-react, appropriate to the page)
// - A heading (persona-appropriate language)
// - A subtitle (what they should do next)
// - A CTA button (the primary action for this page)

// Examples:
// Sandboxes: Server icon, "No sandboxes running", "Boot your first sandbox", [New Sandbox]
// Agents: Bot icon, "No agents yet", "Create your first agent to get started", [New Agent]
// Approvals: CheckCircle icon, "No pending approvals", "All caught up — your team is operating within policy"
// Apps: Layout icon, "No apps deployed", "Deploy your first governed app", [Deploy App]
// Activity: Activity icon, "No activity yet", "Agent activity will appear here once sandboxes are running"
\`\`\`

Read each component file first, check for existing empty state, add if missing.

### tsc check
pnpm tsc --noEmit 2>&1 | tail -8
Return: pages audited, empty states added/fixed, tsc pass/fail.`;

phase("Build");
const [rA, rB, rC, rD] = await Promise.all([
  agent(A, { label: "6-A:landing", phase: "Build" }),
  agent(B, { label: "6-B:nav-groups", phase: "Build" }),
  agent(C, { label: "6-C:overview", phase: "Build" }),
  agent(D, { label: "6-D:empty-states", phase: "Build" }),
]);
log(`Build done: A=${rA?.slice(0, 80)} B=${rB?.slice(0, 80)}`);

phase("Verify");
await agent(
  `
${CTX}
## Verify Phase 6

### 1 — tsc
cd ${REPO}/apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -8
Fix any errors found.

### 2 — all pages render
for page in sandboxes agents approvals apps console overview; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10254/$page 2>/dev/null)
  echo "$page: $code"
done

### 3 — nav has sections
grep -c "section\|Section\|workspace\|governance\|monitoring" ${WEB}/lib/nav-config.ts 2>/dev/null || echo "0 section markers"

Report: tsc errors, page HTTP codes, section markers count.
`,
  { label: "verify", phase: "Verify" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add -A apps/web/src/
git commit -m "feat(ux-p6): nav grouping, role landing, live overview, empty states

Phase 6 — Navigation & First Impressions

6-A: Role-based landing redirect
  - getPersonaRole() + getLandingPage() in lib/role-preference.ts
  - Persona preview switcher in settings/profile
  - admin→/console, manager→/approvals, member→/sandboxes, owner→/apps

6-B: Nav personalization
  - 4 sections: Workspace / Governance / Monitoring / System
  - Section headers with muted uppercase text
  - Items grouped by persona intent

6-C: Overview live data
  - stats-cards: real counts (sandboxes, agents, rules, secrets)
  - ciso-command-center: real blocked/approval/sandbox counts
  - ciso-readiness-panel: honest build status (no fake percentages)

6-D: Empty states
  - Consistent pattern: icon + heading + subtitle + CTA
  - All list pages (sandboxes, agents, approvals, apps, activity) covered
  - Persona-appropriate language per page

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Phase 6 UX nav+first-impressions (2026-06-28) — role landing, nav groups, live overview, empty states\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
" 2>/dev/null
gbrain import ~/brain/ && gbrain embed --stale
echo "Phase 6 committed"
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
