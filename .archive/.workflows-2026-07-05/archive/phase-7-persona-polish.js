export const meta = {
  name: "phase-7-persona-polish",
  description:
    "UX Phase 7: deep polish per persona surface — Cyber console severity, Manager countdown, Employee live logs, Activity filters, Connections unlock",
  phases: [
    { title: "Build", detail: "5 parallel agents, one per persona surface" },
    { title: "Verify", detail: "tsc clean, key interactions work" },
    { title: "Commit", detail: "Commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${WEB}/apps/web/src`;

const CTX = `
Repo: ${REPO}
Web: ${REPO}/apps/web/src
All pages are TypeScript/Next.js 16 App Router.
shadcn components available: badge, button, card, dialog, alert-dialog, table,
  dropdown-menu, input, skeleton, sheet, toast (sonner), progress, separator.
Import lucide-react icons as needed.
After any change: pnpm tsc --noEmit to verify clean.
`;

// ─── 7-A: Cyber console polish ────────────────────────────────────────────────
const A = `${CTX}

## Agent 7-A: Cyber console — severity, health bar, evidence export

Read: ${REPO}/apps/web/src/app/(dashboard)/console/_components/ciso-console-live.tsx

### 1. Severity badges on violations feed
The violations feed shows blocked requests. Add a severity badge per row:
- "blocked_by_policy" rule → red Badge "Policy Block"
- "rate_limited" → amber Badge "Rate Limit"
- "blocked_by_default_policy" → orange Badge "Default Block"
Read the extraData.decision field to determine which. Use existing Badge component.

### 2. Policy health summary bar
Add a 3-stat bar at the top of the console, above the fleet table:
[N policy rules active] [M violations today] [K sandboxes at risk]
"At risk" = sandboxes with state=error OR no HTTPS_PROXY configured.
Fetch from /v1/console/overview (already exists).
Use Card with 3 equal columns inside.

### 3. Evidence export button
Each sandbox row has a "Export evidence" action already (from Sprint B).
Make it actually work: when clicked, call:
  fetch('/v1/sandboxes/:id').then(r => r.json()).then(data => {
    const blob = new Blob([JSON.stringify({
      id: data.id, name: data.name, state: data.state,
      claudeVersion: data.claudeVersion, bootstrapped: data.bootstrapped,
      exportedAt: new Date().toISOString(),
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = \`evidence-\${data.name}-\${Date.now()}.json\`; a.click()
  })

### tsc
Return: changes made, severity logic, evidence export wired, tsc pass/fail.`;

// ─── 7-B: Manager approvals polish ───────────────────────────────────────────
const B = `${CTX}

## Agent 7-B: Manager approvals — countdown, bulk approve, nav badge pulse

Read: ${REPO}/apps/web/src/app/(dashboard)/approvals/_components/approvals-content.tsx

### 1. Countdown timer to auto-deny
Each pending approval has an expiresAt field. Show a real countdown:
\`\`\`tsx
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) { setRemaining('Expired'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRemaining(\`\${h}h \${m}m \${s}s\`)
    }
    tick(); const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return <span className={remaining === 'Expired' ? 'text-destructive' : 'text-muted-foreground text-xs'}>{remaining}</span>
}
\`\`\`
Add this component. Show countdown on each pending approval card.

### 2. Priority ordering
Sort pending approvals: oldest first (by createdAt ascending).
Add a visual priority indicator: approvals expiring within 1h get an amber left border.

### 3. Nav badge pulse
The Approvals nav link shows a pending count badge. Make it pulse when count > 0:
Find the Approvals nav link in the sidebar. Wrap the count badge with:
className="animate-pulse" when pendingCount > 0.
Or add a pulsing dot: <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-amber-500 animate-ping" />

### tsc
Return: countdown component, priority sort, pulse badge, tsc pass/fail.`;

// ─── 7-C: Employee sandbox polish ────────────────────────────────────────────
const C = `${CTX}

## Agent 7-C: Employee sandboxes — live exec logs, bootstrap timeline, copy buttons

Read: ${REPO}/apps/web/src/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx

### 1. Copy-to-clipboard on sandbox ID and exec output
In the sandbox table, make the truncated ID copyable:
\`\`\`tsx
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <button onClick={copy} className="text-xs text-muted-foreground hover:text-foreground font-mono flex items-center gap-1">
      {id.slice(0, 8)}… {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}
\`\`\`
Do the same for exec output — add a copy button to the output code block.

### 2. Bootstrap progress timeline
During sandbox creation (state=creating), show a 3-step timeline:
  1. Creating container ← current step (spinner)
  2. Installing Claude Code
  3. Ready
When state transitions: creating→started and bootstrapped=true, show all green.
Update the "boot sandbox" modal to show this timeline instead of just text.

### 3. Live exec poll for running commands
After submitting an exec command, the current impl fetches once and shows result.
Add: if exitCode is null (command still running), poll every 2s for up to 30s.
Show a spinner in the output area while polling.

### tsc
Return: copy button, timeline component, live poll logic, tsc pass/fail.`;

// ─── 7-D: Activity page polish ───────────────────────────────────────────────
const D = `${CTX}

## Agent 7-D: Activity page — persona filter, detail drawer, export CSV

Read: ${REPO}/apps/web/src/app/(dashboard)/activity/_components/activity-content.tsx

The activity page already has live polling. Add 3 features:

### 1. Persona filter tab
Add tabs above the existing all/blocked filter:
[All] [My agents] [Blocked] [Slow (>500ms)]
"My agents" = filter requestLog where agentId is in the user's own agents.
Need: fetch /v1/agents first, then filter by agentId in that list.

### 2. Request detail sheet/drawer
When clicking a row in the activity table, open a Sheet (slide-in panel):
Show full detail:
- Method, host, path, status, latency
- Agent name (if available from agentId lookup)
- Policy decision (from extraData.decision)
- Rule name (from extraData.rule or extraData.blocked_by_rule)
- Timestamp (formatted)

### 3. Export to CSV button
Add "Export CSV" button in the top-right of the activity page.
On click: fetch last 100 blocked requests, format as CSV (method,host,path,status,latency,timestamp), trigger download.

### tsc
Return: filter tabs, drawer component, CSV export, tsc pass/fail.`;

// ─── 7-E: Connections unlock ─────────────────────────────────────────────────
const E = `${CTX}

## Agent 7-E: Connections — unlock Microsoft connectors, wire consent_required

### 1. Unlock Outlook Mail and Outlook Calendar
File: ${REPO}/packages/api/src/apps/cloud-app-registry.ts
Find the Outlook Mail and Outlook Calendar entries.
They currently have \`available: false\` or \`connectionMethod: { type: "cloud_only" }\`.
Change to available: true (or remove the cloud-only restriction).

### 2. Wire consent_required flow in the connect UI
When a user clicks "Connect" on a connector and the backend returns:
  { error: "consent_required", authorization_url: "...", ... }
The UI should redirect the user to authorization_url (or open in a new tab).

Find where the connect button POST is handled in:
${REPO}/apps/web/src/app/(dashboard)/connections/ (read the apps-tab or connect flow)

If the response has error === "consent_required":
  window.open(response.authorization_url, '_blank') OR window.location.href = response.authorization_url

### 3. Add SharePoint as a connector entry
In cloud-app-registry.ts, add SharePoint:
\`\`\`typescript
{
  id: 'microsoft-sharepoint',
  name: 'SharePoint',
  description: 'Search and read SharePoint documents (read-only)',
  category: 'microsoft',
  icon: '...',
  available: true,
  connectionMethod: { type: 'oauth' },
  // etc — match the pattern of existing Microsoft connectors
}
\`\`\`

### tsc (both api and web)
pnpm tsc --noEmit 2>&1 | tail -8
Return: connectors unlocked, consent flow, SharePoint added, tsc pass/fail.`;

phase("Build");
const [rA, rB, rC, rD, rE] = await Promise.all([
  agent(A, { label: "7-A:cyber-polish", phase: "Build" }),
  agent(B, { label: "7-B:manager-polish", phase: "Build" }),
  agent(C, { label: "7-C:employee-polish", phase: "Build" }),
  agent(D, { label: "7-D:activity", phase: "Build" }),
  agent(E, { label: "7-E:connections", phase: "Build" }),
]);
log(
  `Build done. ${[rA, rB, rC, rD, rE].filter(Boolean).length}/5 agents completed.`,
);

phase("Verify");
await agent(
  `
${CTX}

## Verify Phase 7

### 1 — tsc clean
cd ${REPO}/apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -8

### 2 — key files exist
ls ${REPO}/apps/web/src/app/\\(dashboard\\)/console/_components/ciso-console-live.tsx
ls ${REPO}/apps/web/src/app/\\(dashboard\\)/approvals/_components/approvals-content.tsx
ls ${REPO}/apps/web/src/app/\\(dashboard\\)/sandboxes/_components/sandboxes-content.tsx

### 3 — connectors: Outlook available
grep -c "available.*true" ${REPO}/packages/api/src/apps/cloud-app-registry.ts 2>/dev/null

Fix tsc errors if any. Report: error count, file existence, connectors count.
`,
  { label: "verify", phase: "Verify" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add -A apps/web/src/ packages/api/src/apps/
git commit -m "feat(ux-p7): per-persona surface polish

Phase 7 — Persona Surface Polish

7-A: Cyber console
  - Severity badges on violations (policy block / rate limit / default block)
  - Policy health bar: active rules, violations today, at-risk sandboxes
  - Evidence export downloads real JSON from sandbox API

7-B: Manager approvals
  - Countdown timer to auto-deny (live, ticks every second)
  - Priority sort: oldest first, amber border for <1h remaining
  - Nav badge pulse animation when pending count > 0

7-C: Employee sandboxes
  - Copy-to-clipboard on sandbox ID and exec output
  - Bootstrap progress timeline: container→Claude→Ready
  - Live exec poll (2s intervals, 30s timeout)

7-D: Activity page
  - Persona filter tabs: All / My agents / Blocked / Slow
  - Request detail Sheet: full method/host/path/rule/decision
  - Export CSV: last 100 blocked requests

7-E: Connections
  - Outlook Mail + Calendar unlocked (available: true)
  - consent_required flow: redirect to authorization_url on Connect
  - SharePoint added as connector in registry

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Phase 7 UX persona-polish (2026-06-28) — cyber severity, manager countdown, employee logs, activity drawer, connections unlock\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
" 2>/dev/null
gbrain import ~/brain/ && gbrain embed --stale
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
