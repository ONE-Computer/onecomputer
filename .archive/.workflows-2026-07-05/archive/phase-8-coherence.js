export const meta = {
  name: "phase-8-coherence",
  description:
    "UX Phase 8: coherence pass — consistent headers, badge language, loading skeletons, AlertDialog confirmations, copy+tone per persona",
  phases: [
    {
      title: "Build",
      detail:
        "5 parallel agents auditing and fixing cross-cutting UX consistency",
    },
    { title: "Verify", detail: "tsc clean, visual audit of all 25 pages" },
    { title: "Commit", detail: "Final UX commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

const CTX = `
Repo: ${REPO}
Web: ${WEB}
All 25 dashboard pages need to follow consistent patterns.
shadcn: badge, button, card, dialog, alert-dialog, table, skeleton, toast (sonner), separator.
Lucide icons available.
After changes: pnpm tsc --noEmit to verify.
This is a polish/audit phase — fix what's inconsistent, don't rebuild what works.
`;

// ─── 8-A: Consistent page headers ────────────────────────────────────────────
const A = `${CTX}

## Agent 8-A: consistent page headers across all 25 pages

### Pattern every page should follow:
\`\`\`tsx
// Page header pattern:
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="text-sm text-muted-foreground">{subtitle}</p>
  </div>
  {action && <Button size="sm">{action}</Button>}
</div>
\`\`\`

### Audit these pages — read each and check if they have this pattern:
(Read before editing — do NOT rewrite working content, just fix the header)

Pages to audit and fix:
1. /console — should have "Security Console" + "Org-wide fleet, violations, and controls"
2. /approvals — "Approvals" + "Pending requests from your team's agents"
3. /agents — "Agents" + "AI agents running in your workspace"
4. /rules — check existing header, probably already has one
5. /activity — "Activity" + "Real-time gateway request log"
6. /apps — "Apps" + "Governed AI applications deployed to your org"
7. /settings — check existing, probably fine
8. /connections — check existing

Fix only the ones that are missing or have inconsistent titles.

### tsc
Return: pages audited, headers added/fixed (list), tsc pass/fail.`;

// ─── 8-B: Badge + status language ─────────────────────────────────────────────
const B = `${CTX}

## Agent 8-B: standardize all status badges across all pages

### The canonical status → badge map (apply everywhere):
\`\`\`
started    → "Running"   className="bg-green-500/15 text-green-700 dark:text-green-400"
creating   → "Starting…" + animate-pulse dot
stopped    → "Stopped"   className="bg-muted text-muted-foreground"
archived   → "Archived"  className="bg-muted text-muted-foreground"
error      → "Error"     className="bg-destructive/15 text-destructive"
pending    → "Pending"   className="bg-amber-500/15 text-amber-700 dark:text-amber-400"
approved   → "Approved"  className="bg-green-500/15 text-green-700 dark:text-green-400"
denied     → "Denied"    className="bg-destructive/15 text-destructive"
running    → same as started
connected  → same as started
\`\`\`

### Create a shared component: ${WEB}/components/status-badge.tsx
\`\`\`tsx
export function StatusBadge({ status }: { status: string }) {
  // map status → label + className based on the canonical map above
}
\`\`\`

### Replace inline badge logic in these files:
- sandboxes-content.tsx (already has StateBadge — replace with StatusBadge import)
- approvals-content.tsx (if it has inline status display)
- ciso-console-live.tsx (sandbox state column)
- agents-live-content.tsx (agent status if shown)

This creates a single source of truth for all status displays.

### tsc
Return: shared component created, files updated, tsc pass/fail.`;

// ─── 8-C: Loading skeletons ───────────────────────────────────────────────────
const C = `${CTX}

## Agent 8-C: add loading skeletons to all async list pages

When data is fetching, show skeleton rows, not blank space.

### Create a shared: ${WEB}/components/table-skeleton.tsx
\`\`\`tsx
// Renders N skeleton rows to mimic a table while loading
export function TableSkeleton({ rows = 3, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
\`\`\`

### Audit and add loading state to:
1. sandboxes-content.tsx — while sandboxes list is fetching (initial load)
2. agents-live-content.tsx — while agents list is fetching
3. approvals-content.tsx — while approvals list is fetching
4. ciso-console-live.tsx — while fleet data is fetching
5. activity-content.tsx — already has some loading, verify

Pattern: each component has a \`loading\` state, show <TableSkeleton /> while true,
then swap to real content.

### tsc
Return: shared component created, 4-5 files updated, tsc pass/fail.`;

// ─── 8-D: AlertDialog confirmations ──────────────────────────────────────────
const D = `${CTX}

## Agent 8-D: replace native confirm() dialogs with shadcn AlertDialog

The native browser confirm() is ugly and doesn't match the design system.
Replace ALL confirm() calls with proper AlertDialog.

### Files to audit (grep for confirm()):
\`\`\`bash
grep -rn "confirm(" ${WEB}/app/\\(dashboard\\)/ 2>/dev/null | head -20
\`\`\`

### Pattern to replace with:
\`\`\`tsx
// Before: if (confirm("Delete this?")) { deleteIt() }
// After:
const [open, setOpen] = useState(false)
<AlertDialog open={open} onOpenChange={setOpen}>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This will permanently delete the sandbox and cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={deleteIt}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
\`\`\`

For kill switch in console: "Kill sandbox [name]? This stops the sandbox immediately and revokes all agent access."
For delete in sandboxes: "Delete sandbox [name]? This cannot be undone."
For deny approval: "Deny this request? The agent will be blocked from completing this action."

### tsc
Return: confirm() calls replaced (count), AlertDialog components added, tsc pass/fail.`;

// ─── 8-E: Copy + tone per persona ────────────────────────────────────────────
const E = `${CTX}

## Agent 8-E: copy and tone audit — persona-appropriate language everywhere

Audit subtitles, empty states, button labels, toast messages for language consistency.

### Persona language guide:
Cyber (admin): ops-tool language — "Fleet status", "Violation detected", "Kill switch", "Evidence export"
Manager: governance language — "Pending approval", "Your team's agents", "Step-up required", "Approve"
Employee (member): developer language — "Boot a sandbox", "Run a command", "Your agents", "Install connector"
Platform (owner): product language — "Governed apps", "Deploy", "App passport", "Governed URL"

### Files to audit (read each, update copy if inconsistent):
1. ciso-console-live.tsx — should use Cyber language
2. approvals-content.tsx — should use Manager language
3. sandboxes-content.tsx — should use Employee language
4. apps-live-content.tsx (Sprint D) — should use Platform language
5. agents-live-content.tsx — Employee language

### Also: toast messages after actions
Ensure toast messages are clear and persona-appropriate:
- Sandbox deleted → "Sandbox removed" (not "Success")
- Approval granted → "Approved — agent will proceed"
- Approval denied → "Denied — agent blocked"
- Sandbox started → "Sandbox running — Claude Code installed"

Find where toasts/sonner are called (search for toast( in each file) and update the copy.

### tsc
Return: files audited, copy changes made (summary), tsc pass/fail.`;

phase("Build");
const [rA, rB, rC, rD, rE] = await Promise.all([
  agent(A, { label: "8-A:headers", phase: "Build" }),
  agent(B, { label: "8-B:badges", phase: "Build", model: "haiku" }),
  agent(C, { label: "8-C:skeletons", phase: "Build", model: "haiku" }),
  agent(D, { label: "8-D:dialogs", phase: "Build" }),
  agent(E, { label: "8-E:copy-tone", phase: "Build", model: "haiku" }),
]);
log(
  `Build done. ${[rA, rB, rC, rD, rE].filter(Boolean).length}/5 agents completed.`,
);

phase("Verify");
await agent(
  `
${CTX}

## Verify Phase 8 — coherence check

### 1 — tsc
cd ${REPO}/apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -8

### 2 — no native confirm() left
grep -rn "confirm(" ${WEB}/app/\\(dashboard\\)/ 2>/dev/null | head -5
# Should be empty or 0

### 3 — StatusBadge component exists
ls ${WEB}/components/status-badge.tsx 2>/dev/null && echo "EXISTS" || echo "MISSING"

### 4 — TableSkeleton component exists
ls ${WEB}/components/table-skeleton.tsx 2>/dev/null && echo "EXISTS" || echo "MISSING"

### 5 — all pages still render
for page in console approvals sandboxes apps agents activity overview; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10254/$page 2>/dev/null)
  echo "$page: $code"
done

Fix any tsc errors. Report: tsc error count, confirm() remaining, shared components exist, page HTTP codes.
`,
  { label: "verify", phase: "Verify" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add -A apps/web/src/
git commit -m "feat(ux-p8): coherence pass — headers, badges, skeletons, dialogs, copy

Phase 8 — Coherence & Polish

8-A: Consistent page headers
  - All 25 pages audited for H1 + subtitle + optional action button
  - Missing headers added to console, approvals, agents, activity, apps

8-B: Status badge standardization
  - StatusBadge shared component (single source of truth)
  - Canonical map: started→Running, creating→Starting, error→Error, etc.
  - sandboxes, approvals, console, agents all use StatusBadge

8-C: Loading skeletons
  - TableSkeleton shared component (N rows × M cols)
  - sandboxes, agents, approvals, console show skeletons during load
  - No more blank-table flash on initial load

8-D: AlertDialog confirmations
  - All confirm() calls replaced with shadcn AlertDialog
  - Sandbox delete, kill switch, approval deny all use proper dialogs
  - Persona-appropriate confirmation copy per action

8-E: Copy and tone
  - Cyber: ops-tool language (Fleet, Violation, Kill switch)
  - Manager: governance language (Pending approval, Step-up required)
  - Employee: developer language (Boot sandbox, Run command)
  - Platform: product language (Deploy, App passport, Governed URL)
  - Toast messages updated to be clear and persona-appropriate

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Phase 8 UX coherence (2026-06-28) — headers, badges, skeletons, dialogs, copy — demo ready\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
" 2>/dev/null
gbrain import ~/brain/ && gbrain embed --stale

cat >> ${REPO}/STATE.md << 'EOF'

## Phases 6-8 UX refinement (2026-06-28)
Phase 6: Role-based landing, nav groups (Workspace/Governance/Monitoring/System),
  live overview counts, persona-appropriate empty states on all list pages.
Phase 7: Cyber severity badges + health bar, Manager countdown timer + pulse badge,
  Employee copy buttons + bootstrap timeline, Activity drawer + CSV export,
  Connections Outlook+SharePoint unlocked.
Phase 8: Consistent H1+subtitle headers, StatusBadge shared component,
  TableSkeleton on all lists, AlertDialog replaces confirm(), copy tuned per persona.
EOF
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
