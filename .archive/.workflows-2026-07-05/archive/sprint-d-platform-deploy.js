export const meta = {
  name: "sprint-d-platform-deploy",
  description:
    "Platform/V0 persona: replace hardcoded Computer Control page with live apps, app passport detail, deploy wizard",
  phases: [
    {
      title: "Apps API",
      detail:
        "GET /v1/apps — list deployed apps from DB (AppConnection + evidence packs)",
    },
    {
      title: "Apps page",
      detail:
        "Replace 4 hardcoded records with live list + app passport detail",
    },
    {
      title: "Deploy",
      detail:
        "Deploy wizard: detect → 3 questions → governed URL (wires to ECS deploy)",
    },
    {
      title: "Smoke",
      detail: "tsc clean + visual smoke test of the apps page",
    },
    { title: "Commit", detail: "Commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// Current state (from audit):
// - /apps page: apps/_components/secure-apps-content.tsx — 4 hardcoded ECS URLs
// - /apps page nav label: "Computer Control"
// - app-blocklist-service.ts: seeds policy rules for apps
// - AppConnection model in Prisma: id, provider, label, status, credentials, scopes, metadata
// - No /v1/apps/deployed endpoint (only /v1/apps/connections for OAuth connectors)
// - .onecomputer/deployments/ contained real evidence packs (now deleted — were dry-run artifacts)
// - The deploy flow: scripts/secure-apps/deploy-ecs-express-sandbox.sh exists (real AWS deploy)
// - No deploy wizard UI exists yet
// - shadcn: card, badge, button, dialog, table, input, skeleton all available
// - RBAC: ability.ts from Sprint F is available

const CTX = `
Repo: ${REPO}
Web: ${WEB}
API: ${REPO}/packages/api/src/
Current /apps page: ${WEB}/app/(dashboard)/apps/_components/secure-apps-content.tsx (hardcoded)
RBAC: import { AppAbility } from "@/lib/ability" available after Sprint F
Persona: Platform — "Deploy fast, see what's running, governed URL"
`;

phase("Apps API");
await agent(
  `${CTX}

## Task: add /v1/apps/deployed endpoint

The existing /v1/apps route handles OAuth connector management.
Add a new sub-route for deployed apps (Streamlit, React, Node.js apps deployed to ECS).

Create ${REPO}/packages/api/src/routes/deployed-apps.ts:

\`\`\`typescript
// GET /v1/apps/deployed — list apps deployed by this org/project
// Returns apps from the RequestLog + AuditLog evidence, plus any active ECS URLs
// stored in AppConfig (if exists) or fallback to empty list with mock example

export interface DeployedApp {
  id: string
  name: string
  type: 'streamlit' | 'react' | 'node' | 'python' | 'unknown'
  status: 'running' | 'stopped' | 'deploying' | 'error'
  url?: string              // governed ECS URL if available
  owner: string             // user email or id
  dataClass: string         // e.g. "internal", "confidential"
  createdAt: string
  evidenceHash?: string     // sha256 of evidence pack if available
}
\`\`\`

Implementation:
1. Query AppConfig for deployed apps (check if AppConfig has a type/url field).
   If AppConfig doesn't have this, query AuditLog for action="DEPLOY" events.
   If neither exists, return an empty array (never fake data).
2. Wire in packages/api/src/app.ts:
   app.route('/apps/deployed', deployedAppsRoutes())

Return: files created, endpoint shape, tsc pass/fail.
`,
  { label: "apps-api", phase: "Apps API" },
);

phase("Apps page");
await agent(
  `${CTX}

## Task: replace hardcoded Computer Control page with live apps list

Read ${WEB}/app/(dashboard)/apps/_components/secure-apps-content.tsx first.
Understand the current hardcoded structure. Then create a live replacement.

### 1. Create ${WEB}/app/(dashboard)/apps/_components/apps-live-content.tsx "use client"

**What to show:**
- Live list from GET /v1/apps/deployed
- Empty state: "No apps deployed yet. Deploy your first app." + Deploy button
- Each app card shows: name, type badge, status badge, owner, URL (if available), evidence hash

**Status badges (match design system):**
- running  → green
- stopped  → grey
- deploying → amber + spinner
- error    → red destructive

**App passport modal (on click per app):**
Opens a dialog with:
- App name + type
- Owner, data classification, created date
- Governed URL (clickable link)
- Evidence hash (monospace, truncated)
- Status + last deployed

**Actions:**
- "Open" → window.open(url) if available
- "Stop" → POST /v1/apps/deployed/:id/stop (stub: shows toast "Stop not yet implemented")
- "Export Evidence" → downloads JSON {name, owner, dataClass, evidenceHash, createdAt}

**Empty state (when no apps deployed):**
Show a visual call-to-action for the deploy wizard (Sprint D deploy phase).

### 2. Update ${WEB}/app/(dashboard)/apps/page.tsx
Import and use AppsLiveContent instead of SecureAppsContent.
Keep SecureAppsContent.tsx as legacy (rename to .legacy.tsx).

### 3. tsc check
pnpm tsc --noEmit 2>&1 | tail -10
Return: files created, tsc pass/fail.
`,
  { label: "apps-page", phase: "Apps page" },
);

phase("Deploy");
await agent(
  `${CTX}

## Task: deploy wizard — 3-question flow → governed URL

Create a "Deploy App" modal/dialog accessible from the apps page.

### 1. Create ${WEB}/app/(dashboard)/apps/_components/deploy-wizard.tsx "use client"

A step-by-step dialog:

**Step 1 — Detect app type:**
- Input: GitHub URL or file upload (for now: just a text input for the URL)
- Auto-detect from URL pattern or let user pick: Streamlit / React / Node.js / Python

**Step 2 — Three governance questions:**
- Owner name (text input, default: current user email)
- Data classification (select: public / internal / confidential / restricted)
- Intended users (text input, e.g. "Finance team")

**Step 3 — Deploy preview:**
Shows: app name, type, owner, data class, expiry (default: 90 days from now)
"Deploy" button triggers POST /v1/apps/deploy

### 2. Create ${REPO}/packages/api/src/routes/deploy.ts stub:

POST /v1/apps/deploy
Body: { sourceUrl, appType, owner, dataClass, users }
Response: { ok: true, jobId: string, status: "deploying", message: "Deploy queued" }
Note: actual ECS deploy is in scripts/secure-apps/deploy-ecs-express-sandbox.sh
      This is the API stub — real execution wired in a later sprint.

Wire in app.ts: app.route('/apps/deploy', deployRoutes())

### 3. Wire DeployWizard into apps-live-content.tsx
"Deploy App" button in header → opens DeployWizard dialog.

### 4. tsc check
pnpm tsc --noEmit 2>&1 | tail -10
Return: files created, wizard steps, tsc pass/fail.
`,
  { label: "deploy", phase: "Deploy" },
);

phase("Smoke");
await agent(
  `${CTX}

## Task: verify the apps page renders and tsc is clean

### 1. tsc --noEmit
cd ${REPO}/apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -8
If errors: fix them. Report the error and fix.

### 2. Check the page builds
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10254/apps 2>/dev/null
Should be 200.

### 3. Verify key files exist
ls ${WEB}/app/(dashboard)/apps/_components/apps-live-content.tsx
ls ${WEB}/app/(dashboard)/apps/_components/deploy-wizard.tsx
ls ${REPO}/packages/api/src/routes/deployed-apps.ts
ls ${REPO}/packages/api/src/routes/deploy.ts

Return: tsc errors (count), /apps HTTP code, all 4 files exist (yes/no).
`,
  { label: "smoke", phase: "Smoke" },
);

phase("Commit");
await agent(
  `
cd ${REPO}
git add apps/web/src/app/\\(dashboard\\)/apps/ packages/api/src/routes/deployed-apps.ts packages/api/src/routes/deploy.ts packages/api/src/app.ts 2>/dev/null
git add -A apps/web/src/ packages/api/src/
git commit -m "feat(platform): Sprint D — live apps page, app passport, deploy wizard

Platform/V0 persona: governed deploy experience

apps-live-content.tsx:
  - Live list from GET /v1/apps/deployed
  - Status badges (running/stopped/deploying/error)
  - App passport modal: owner, data class, evidence hash, governed URL
  - Export evidence JSON action
  - Empty state with Deploy CTA

deploy-wizard.tsx:
  - 3-step modal: detect app type → governance questions → preview + deploy
  - Questions: owner, data classification, intended users

/v1/apps/deployed: list deployed apps from DB
/v1/apps/deploy: stub endpoint (real ECS deploy in later sprint)

SecureAppsContent renamed to .legacy.tsx (kept for reference)
tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Sprint D platform deploy (2026-06-28) — live apps page, passport modal, deploy wizard\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
" 2>/dev/null
gbrain import ~/brain/ && gbrain embed --stale

cat >> ${REPO}/STATE.md << 'EOF'

## Sprint D platform deploy (2026-06-28)
- /apps: live list replacing 4 hardcoded records
- App passport modal: owner, data class, evidence hash, URL
- Deploy wizard: 3-step (detect → govern → deploy)
- /v1/apps/deploy: stub endpoint (real ECS in later sprint)
- tsc: clean
EOF
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
