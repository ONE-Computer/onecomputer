export const meta = {
  name: "phase-6a-sandbox-ui",
  description:
    "Replace hardcoded Computer Control page with live sandbox management UI wired to the real Daytona adapter API",
  phases: [
    {
      title: "API client",
      detail: "Add a typed frontend API client for /v1/sandboxes",
    },
    {
      title: "UI",
      detail: "Replace hardcoded secure-apps-content with live SandboxesPage",
    },
    {
      title: "Smoke test",
      detail: "tsc --noEmit clean + visual check via the preview server",
    },
    { title: "Capture", detail: "gbrain + STATE.md" },
  ],
};

// ─── Verified facts ────────────────────────────────────────────────────────────
// Phase 1 built:
//   packages/api/src/services/daytona-service.ts  — SandboxInfo + create/exec/list/stop/delete
//   packages/api/src/routes/sandboxes.ts           — mounted at /v1/sandboxes in app.ts:119
//   packages/api/src/services/sandbox-bootstrap.ts — Claude install bootstrap
//
// SandboxInfo shape (from daytona-service.ts:27-35):
//   { id, name, state, toolboxUrl, claudeVersion?, bootstrapped }
//   state values: 'creating' | 'started' | 'stopped' | 'error' | 'archived'
//
// Smoke test smoke results (verified 2026-06-28):
//   sandbox_started: true (reaches state=started in ~1-5s on this machine)
//   claude_version:  "2.1.195 (Claude Code)"
//   proxy_configured: false — HTTPS_PROXY not yet injected at create time (known gap)
//   npm_registry: "http://host.docker.internal:4873/" (Verdaccio placeholder, not yet live)
//   Locale warning in exec output is cosmetic — exit codes all 0
//   autoStopInterval: returns 15 despite requesting 30 (Daytona default enforcement, not a bug)
//
// Current Computer Control page:
//   apps/web/src/app/(dashboard)/apps/_components/secure-apps-content.tsx
//   governedComputers = [ ... ] — 4 hardcoded records with real ECS URLs from June 2026
//   all ComputerRow actions are disabled={action.state === "preview"}
//   remainingGaps list explicitly says "App registry", "Admin/CISO UX", "Real revoke" missing
//
// Next.js App Router, Hono API, shadcn/ui components (in packages/ui/src/components/)
// No Storybook. Auth: NextAuth, project-scoped routes /p/<projectId>/overview

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API_SRC = `${REPO}/packages/api/src`;

const CTX = `
## Repo facts
Repo: ${REPO}
Next.js App Router: ${WEB}/app/(dashboard)/
Existing Computer Control: ${WEB}/app/(dashboard)/apps/_components/secure-apps-content.tsx
API routes: ${API_SRC}/routes/sandboxes.ts (mounted at /v1/sandboxes)
SandboxInfo: { id, name, state, toolboxUrl, claudeVersion?, bootstrapped }
State badge colours to match existing UI convention (from activity-content.tsx or rules-content.tsx):
  started  → green badge
  creating → yellow/amber badge + spinner
  error    → red badge
  stopped  → grey badge
  archived → grey badge

shadcn components available: button, badge, card, dialog, skeleton, table, tooltip, dropdown-menu, progress
Use cn() from @onecli/ui/lib/utils for class merging
Use "use client" for any component with hooks/state
Server components for the page.tsx fetch + initial data

## Ground rules
Read AUDIT.md: ${REPO}/AUDIT.md
- A component is done when it renders real data and tsc --noEmit passes
- No hardcoded sandbox records — everything from the API
- Keep Computer Control page intact as a legacy tab (don't delete it)
- Add Sandboxes as a NEW tab/section, not a replacement, so nothing breaks
`;

// ─── PHASE: API CLIENT ────────────────────────────────────────────────────────
const API_CLIENT = `${CTX}

## Task: create the frontend sandbox API client

Create ${WEB}/lib/api/sandboxes.ts — a typed fetch wrapper for /v1/sandboxes.
This is a thin client: no state management, just typed fetch. React Query /
SWR hooks will go in the component.

\`\`\`typescript
import type { SandboxInfo } from './types'

// Re-export the shape so UI components import from one place
export type { SandboxInfo }

// Base URL matches the Hono API — relative in the browser
const BASE = '/v1/sandboxes'

export const sandboxesApi = {
  list: (): Promise<SandboxInfo[]> =>
    fetch(BASE).then(r => r.json()),

  get: (id: string): Promise<SandboxInfo> =>
    fetch(\`\${BASE}/\${id}\`).then(r => r.json()),

  create: (name: string): Promise<SandboxInfo> =>
    fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),

  exec: (id: string, command: string): Promise<{ exitCode: number; output: string }> =>
    fetch(\`\${BASE}/\${id}/exec\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    }).then(r => r.json()),

  delete: (id: string): Promise<void> =>
    fetch(\`\${BASE}/\${id}\`, { method: 'DELETE' }).then(() => undefined),
}
\`\`\`

Also create ${WEB}/lib/api/types.ts with:
\`\`\`typescript
export interface SandboxInfo {
  id: string
  name: string
  state: 'creating' | 'started' | 'stopped' | 'error' | 'archived' | string
  toolboxUrl: string
  claudeVersion?: string
  bootstrapped: boolean
}
\`\`\`

Return: files created, any type issues.`;

// ─── PHASE: UI ────────────────────────────────────────────────────────────────
const UI = `${CTX}

## Task: build the live Sandboxes UI page

### 1. Create ${WEB}/app/(dashboard)/sandboxes/page.tsx (server component)
Fetches the sandbox list on the server for initial render, passes to the client component.
Handle the case where the Daytona API is unreachable (show empty state, not a crash).

\`\`\`tsx
import { SandboxesContent } from './_components/sandboxes-content'

export default async function SandboxesPage() {
  // Server-side initial fetch — graceful if Daytona is down
  let initial: SandboxInfo[] = []
  try {
    // fetch from the internal API (same host in Next.js)
    const res = await fetch(\`\${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:10256'}/v1/sandboxes\`,
      { cache: 'no-store' })
    if (res.ok) initial = await res.json()
  } catch { /* Daytona not running — show empty state */ }
  return <SandboxesContent initial={initial} />
}
\`\`\`

### 2. Create ${WEB}/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx (client)

This is the main interactive component. It must:

**A. Sandbox list**
- Display all sandboxes in a table/card grid
- Each row: name, state badge (colour-coded), bootstrapped indicator,
  claude version if present, created time
- State badge: started=green, creating=amber+spinner, error=red, stopped/archived=grey
- Live polling: refetch the list every 5s using setInterval + fetch (or React state)

**B. Create sandbox button**
- Top-right "New Sandbox" button → opens a dialog
- Dialog: text input for sandbox name, "Create" button
- On submit: POST /v1/sandboxes, show loading state, poll until state=started,
  then add to list
- Bootstrap progress: while creating, show "Installing Claude..." message
- Claude version badge shown once bootstrapped=true

**C. Row actions (dropdown menu per sandbox)**
- Open: links to the Daytona dashboard or copies the toolboxUrl
- Exec: opens a small terminal/command dialog, POST /:id/exec, shows output
- Delete: confirmation dialog → DELETE /:id → removes from list

**D. Empty state**
When list is empty (no sandboxes or Daytona unreachable):
- "No sandboxes running"
- "Boot your first sandbox" button (same as New Sandbox)
- Show a note if Daytona appears unreachable (fetch failed)

**E. Known gaps notice (honest, not hidden)**
A small info callout below the table:
- "HTTPS_PROXY gateway injection: not yet active — sandbox traffic is not routed through the OneComputer gateway until Phase 2 enforcement is wired"
- "Package gate: npm registry points to Verdaccio (not yet running — Phase 4)"

### 3. Add the Sandboxes link to navigation

Find ${WEB}/lib/nav-config.ts. The current nav items include "Computer Control"
(which links to the hardcoded apps page). Add a new nav item:
  { title: 'Sandboxes', href: '/sandboxes', icon: <Server /> }
Place it after Computer Control, before Rules.

Import Server from lucide-react (already used elsewhere in nav-config or the layout).

### Do NOT delete or modify secure-apps-content.tsx
Keep it as-is. Computer Control and Sandboxes are separate nav items.

### Return
Files created, does it compile (tsc --noEmit), what is the URL, what is the empty state copy.`;

// ─── SMOKE TEST ───────────────────────────────────────────────────────────────
const SMOKE = `${CTX}

## Task: verify Phase 6A UI compiles and the API client is correct

### Step 1 — TypeScript compile
cd ${REPO} && pnpm tsc --noEmit 2>&1 | tail -20
Report: error count. If > 0, show first 5 errors and attempt to fix them.

### Step 2 — Verify API client has correct endpoint
grep -n "v1/sandboxes\\|DAYTONA" ${WEB}/lib/api/sandboxes.ts 2>/dev/null | head -10

### Step 3 — Verify nav has the new Sandboxes item
grep -n "Sandboxes\\|sandboxes" ${WEB}/lib/nav-config.ts 2>/dev/null | head -5

### Step 4 — Verify polling is real (not fake)
grep -n "setInterval\\|useEffect\\|refetch\\|polling" \
  "${WEB}/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx" 2>/dev/null | head -5

### Step 5 — Verify empty state exists
grep -n "empty\\|No sandboxes\\|Boot your first" \
  "${WEB}/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx" 2>/dev/null | head -5

### Step 6 — Verify honest gap notice is present
grep -n "HTTPS_PROXY\\|gateway injection\\|Phase 2" \
  "${WEB}/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx" 2>/dev/null | head -3

Return: tsc pass/fail, all 5 verifications pass/fail.`;

// ─── CAPTURE ──────────────────────────────────────────────────────────────────
const CAPTURE = (apiResult, uiResult, smokeResult) => `${CTX}

## Task: capture Phase 6A results

Build results:
API client: ${apiResult?.slice(0, 200) ?? "(none)"}
UI: ${uiResult?.slice(0, 200) ?? "(none)"}
Smoke: ${smokeResult?.slice(0, 200) ?? "(none)"}

1. Create ~/brain/projects/onecomputer-phase6a-result.md:
---
title: "Phase 6A sandbox UI — result"
type: project
aliases: [phase-6a, sandbox-ui]
tags: [phase-6, ui, sandbox, result]
updated: 2026-06-28
---
Body: files created (with absolute paths), tsc pass/fail, what the UI shows,
what polling interval, what the known-gap notice says, what is TODO.
Link [[projects/onecomputer-phase1-result]] (the adapter this UI wraps).

2. Append to ${REPO}/STATE.md:
## Phase 6A sandbox UI (2026-06-28)
- sandboxes-content.tsx: [done/partial]
- API client: [done]
- nav wired: [done/todo]
- tsc: [pass/fail]
- TODO: HTTPS_PROXY injection (Phase 2), Verdaccio (Phase 4)

3. pkill -f "gbrain serve"; sleep 90
   gbrain import ~/brain/ && gbrain embed --stale
   (90s stagger to avoid PGLite collision with other running workflows)

Return: gbrain created, STATE.md updated, pages/chunks.`;

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("API client");
const apiResult = await agent(API_CLIENT, {
  label: "api:sandbox-client",
  phase: "API client",
});
log(`API client: ${apiResult?.slice(0, 150)}`);

phase("UI");
const uiResult = await agent(UI, { label: "ui:sandboxes-page", phase: "UI" });
log(`UI: ${uiResult?.slice(0, 150)}`);

phase("Smoke test");
const smokeResult = await agent(SMOKE, {
  label: "smoke:tsc+verify",
  phase: "Smoke test",
});
log(`Smoke: ${smokeResult?.slice(0, 150)}`);

phase("Capture");
await agent(CAPTURE(apiResult, uiResult, smokeResult), {
  label: "capture",
  phase: "Capture",
});

return {
  api: apiResult?.slice(0, 300),
  ui: uiResult?.slice(0, 300),
  smoke: smokeResult?.slice(0, 300),
};
