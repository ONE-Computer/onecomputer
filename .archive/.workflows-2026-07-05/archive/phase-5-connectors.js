export const meta = {
  name: "phase-5-connectors",
  description:
    "Wire SharePoint read-only and Outlook read-write (with step-up gate) as governed MCP connectors through the OneComputer gateway",
  phases: [
    {
      title: "SharePoint",
      detail:
        "Graph API read-only connector, enforced at gateway + VTA capability level",
    },
    {
      title: "Outlook",
      detail:
        "Graph API read connector (no friction) + write connector gated behind step-up approval",
    },
    {
      title: "MCP surface",
      detail:
        "Expose both connectors as MCP tools through the gateway channel routing (Phase 2)",
    },
    {
      title: "Smoke test",
      detail:
        "Search SharePoint via MCP tool; attempt Outlook send → blocked pending approval",
    },
    { title: "Capture", detail: "gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;

// Context:
// - Real Outlook read-only Graph client exists in the vendored POC:
//   implementation/onecomputer-secure-claude-computer-poc/repos/invgini-backend-service/
//   src/utils/msgraph_utils/msgraph_client.py
//   AST test: tests/services/test_agent_write_surface_audit.py:86 — asserts no write methods
// - No SharePoint connector anywhere in the main repo (only stub strings)
// - M365 in main repo: packages/api/src/services/m365-agent-directory-service.ts
//   syncMode: "graph_preview_only" — string literal only, no real calls
// - vti-consent-service.ts: fail-closed step-up logic is REAL but never called from
//   the retrieval path (only from workflow fixtures)
// - Goal: make these work as MCP tools through the gateway, governed by policy rules
// - OAuth: use the consent_required flow from Phase 3 (I4) for credential delegation
// - No plaintext Graph API tokens in sandbox env vars — use gateway credential injection
//   (Secret type "generic" with header injection — this already works)

const CTX = `
## Ground rules
Repo: ${REPO}
Read AUDIT.md: ${REPO}/AUDIT.md
No plaintext tokens in sandbox env or filesystem — use gateway Secret injection.
SharePoint: READ ONLY enforced at the connector level (no POST/PUT/PATCH/DELETE to Graph).
Outlook write: gated behind step-up — vti-consent-service.ts fail-closed logic must
be wired into the actual write path (it currently is not — see AUDIT.md).
These connectors are surfaced as MCP tools — requires Phase 2 (channel routing + MCP parser).
If Phase 2 is not complete, implement the connector logic standalone and note the MCP
surface wiring as TODO.
`;

// ─── SHAREPOINT CONNECTOR ─────────────────────────────────────────────────────
const SHAREPOINT = `${CTX}

## Task: Build a SharePoint read-only Graph API connector

### Create packages/api/src/services/sharepoint-connector.ts

Use the Microsoft Graph API (https://graph.microsoft.com/v1.0).
This connector is READ ONLY — no POST, PUT, PATCH, DELETE ever.

\`\`\`typescript
// Enforced: only GET requests to Graph API are allowed.
// Bearer token injected via OneComputer gateway Secret (not stored in sandbox).

export interface SharePointSearchResult {
  id: string; name: string; webUrl: string
  summary?: string; lastModified: string
}

export interface SharePointFile {
  id: string; name: string; content: string  // text content
  mimeType: string; webUrl: string
}

// Search SharePoint for documents
export async function searchDocuments(
  query: string,
  bearerToken: string,   // injected by gateway — never stored
  maxResults?: number
): Promise<SharePointSearchResult[]>
// GET /search/query with entityTypes: ["driveItem","listItem"]

// Read a specific document (text content only — no binary)
export async function readDocument(
  siteId: string,
  itemId: string,
  bearerToken: string
): Promise<SharePointFile>
// GET /sites/{siteId}/drive/items/{itemId}/content (text/plain only)

// List recent documents in a site
export async function listDocuments(
  siteId: string,
  bearerToken: string,
  limit?: number
): Promise<SharePointSearchResult[]>
// GET /sites/{siteId}/drive/items?top={limit}
\`\`\`

### Read-only enforcement
Add a compile-time assertion: the file must never import 'axios.post' or
use fetch with method POST/PUT/PATCH/DELETE. Add a comment:
// AUDIT: every fetch in this file is GET only. If you add a write call, the
// test_write_surface.test.ts test will fail.

### Create a write-surface audit test (TypeScript version of the Python AST test):
File: packages/api/src/services/sharepoint-connector.test.ts
Parse sharepoint-connector.ts source as text, assert it contains no
"method: 'POST'", "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'",
".post(", ".put(", ".patch(", ".delete(" (case insensitive).
This mirrors the Python AST test in the vendored POC.

### Add as a gateway Secret + channel
The bearer token comes from a Secret with type "generic" and a Graph API scope.
Add a SHAREPOINT_CHANNEL config to channel.rs (from Phase 2) or document as TODO.

### Tests
1. searchDocuments_calls_correct_graph_endpoint — mock fetch, assert GET to /search/query
2. readDocument_calls_get — mock fetch, assert method is GET
3. write_surface_audit — assert no write methods in the source
Run: pnpm tsc --noEmit 2>&1 | tail -10

### Return
Files created, write-surface test result, what needs an OAuth token to test live.`;

// ─── OUTLOOK CONNECTOR + STEP-UP ─────────────────────────────────────────────
const OUTLOOK = `${CTX}

## Task: Build Outlook connector with read/write split and step-up gate on writes

### Context
The vendored POC has a working read-only Python Graph client. Build the TypeScript
equivalent in the main repo, then add write capabilities behind the step-up gate.

### Create packages/api/src/services/outlook-connector.ts

\`\`\`typescript
// READ operations (no friction)
export async function listEmails(bearerToken: string, top?: number): Promise<Email[]>
// GET /me/messages

export async function readEmail(id: string, bearerToken: string): Promise<Email>
// GET /me/messages/{id}

export async function searchEmails(query: string, bearerToken: string): Promise<Email[]>
// POST /me/messages?$search="{query}"  (search is POST per Graph spec — allowed exception)

// WRITE operations — these MUST go through step-up gate before executing
export async function sendEmail(
  to: string, subject: string, body: string,
  bearerToken: string,
  stepUpToken: string     // required — from vti-consent-service step-up approval
): Promise<void>
// POST /me/sendMail — ONLY executes if stepUpToken is valid

export async function replyToEmail(
  id: string, body: string,
  bearerToken: string,
  stepUpToken: string     // required
): Promise<void>
// POST /me/messages/{id}/reply
\`\`\`

### Wire the step-up gate for writes
Import authorizePersonalConnectorRetrievalWithVtiConsent from
packages/api/src/services/vti-consent-service.ts (the fail-closed logic is REAL,
just not yet wired to a retrieval path — this is the wiring).

In sendEmail and replyToEmail:
1. Call authorizePersonalConnectorRetrievalWithVtiConsent with the stepUpToken
2. If it throws or returns unauthorized → throw an error with message
   "Outlook write requires step-up approval. Request approval first."
3. Only proceed to the Graph API call if authorization succeeds.

### Create route: POST /outlook/send
In packages/api/src/routes/outlook.ts — wire into app.ts.
Body: { to, subject, body, stepUpToken }
Returns: 200 OK or 403 with step_up_required error.

### Write-surface audit test
File: packages/api/src/services/outlook-connector.test.ts
1. sendEmail_requires_stepup_token — call without stepUpToken → throws
2. sendEmail_blocked_when_consent_fails — mock vti-consent-service to return
   unauthorized → sendEmail throws, Graph API is never called
3. listEmails_no_stepup_needed — listEmails works without stepUpToken
4. write_surface_all_writes_require_stepup — assert sendEmail + replyToEmail
   signatures require stepUpToken parameter

Run: pnpm tsc --noEmit 2>&1 | tail -10

### Return
Files created, step-up wiring confirmed (yes — vti-consent-service is now called),
test results.`;

// ─── MCP SURFACE ─────────────────────────────────────────────────────────────
const MCP_SURFACE = `${CTX}

## Task: Expose SharePoint and Outlook as MCP tools through gateway channels

This wires Phase 2 (channel routing) with Phase 5 (connectors).
If Phase 2 channel.rs is not complete, document the channel configs as TODO and
implement the connector routes standalone.

### Create ONECLI_CHANNELS config for SharePoint and Outlook
Add to ${REPO}/.env.example:
\`\`\`
ONECLI_CHANNELS=[
  {
    "id": "sharepoint-read",
    "name": "SharePoint Read",
    "route_prefix": "/channels/sharepoint",
    "target_endpoint": "https://graph.microsoft.com/v1.0",
    "protocol": "rest"
  },
  {
    "id": "outlook-read",
    "name": "Outlook Read",
    "route_prefix": "/channels/outlook/read",
    "target_endpoint": "https://graph.microsoft.com/v1.0/me/messages",
    "protocol": "rest"
  },
  {
    "id": "outlook-write",
    "name": "Outlook Write (step-up required)",
    "route_prefix": "/channels/outlook/write",
    "target_endpoint": "https://graph.microsoft.com/v1.0/me/sendMail",
    "protocol": "rest"
  }
]
\`\`\`

### Add policy rules for the channels (using the existing PolicyRule system)
Add default policy rules to app-blocklist-service.ts (or a new
default-policy-service.ts) that seed:
- /channels/sharepoint/* → allow (GET only, enforced at connector level)
- /channels/outlook/read/* → allow
- /channels/outlook/write/* → manual_approval (step-up required at policy layer)

### Create MCP tool descriptions
File: packages/api/src/lib/mcp-tools.ts
Export tool manifests for Claude to discover:
\`\`\`typescript
export const SHAREPOINT_TOOLS = [
  { name: 'sharepoint_search', description: 'Search SharePoint documents', inputSchema: {...} },
  { name: 'sharepoint_read',   description: 'Read a SharePoint document',   inputSchema: {...} },
]
export const OUTLOOK_TOOLS = [
  { name: 'outlook_list',   description: 'List recent emails',             inputSchema: {...} },
  { name: 'outlook_read',   description: 'Read an email',                  inputSchema: {...} },
  { name: 'outlook_send',   description: 'Send an email (requires approval)', inputSchema: {...} },
]
\`\`\`

### Return
Channel configs added, policy rules seeded, MCP tool manifests created.`;

// ─── SMOKE TEST schema ────────────────────────────────────────────────────────
const SMOKE_SCHEMA = {
  type: "object",
  required: [
    "sharepoint_connector_built",
    "outlook_read_built",
    "stepup_gate_wired",
    "mcp_tools_defined",
    "issues",
  ],
  properties: {
    sharepoint_connector_built: { type: "boolean" },
    outlook_read_built: { type: "boolean" },
    stepup_gate_wired: { type: "boolean" }, // vti-consent-service now called from sendEmail
    write_surface_test_pass: { type: "boolean" }, // no-write AST test passes
    mcp_tools_defined: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
};

const SMOKE_PROMPT = `${CTX}

## Smoke test: verify Phase 5 connectors are built and step-up gate is wired

This is a code-level smoke test (no live Graph API token needed — mocked).

### Test 1 — SharePoint write surface audit
node -e "
const fs = require('fs');
const src = fs.readFileSync('${REPO}/packages/api/src/services/sharepoint-connector.ts', 'utf8');
const forbidden = [\"method: 'POST'\", \"method: 'PUT'\", \"method: 'PATCH'\", \"method: 'DELETE'\"];
const found = forbidden.filter(f => src.toLowerCase().includes(f.toLowerCase()));
console.log(found.length === 0 ? 'WRITE_SURFACE_CLEAN' : 'WRITE_SURFACE_VIOLATION: ' + found.join(', '));
" 2>/dev/null || echo "sharepoint-connector.ts not found"

### Test 2 — Outlook step-up gate is wired
grep -n "authorizePersonalConnectorRetrievalWithVtiConsent\\|vti-consent-service" \\
  ${REPO}/packages/api/src/services/outlook-connector.ts 2>/dev/null | head -5
# Should show the import and call — if empty, step-up is NOT wired

### Test 3 — TypeScript compiles
cd ${REPO} && pnpm tsc --noEmit 2>&1 | tail -10

### Test 4 — MCP tools file exists
ls ${REPO}/packages/api/src/lib/mcp-tools.ts 2>/dev/null && echo "MCP_TOOLS_DEFINED" || echo "MCP_TOOLS_MISSING"

### Test 5 — Policy rules include outlook/write manual_approval
grep -n "outlook.*write\\|manual_approval" \\
  ${REPO}/packages/api/src/services/app-blocklist-service.ts 2>/dev/null | head -5

Return structured smoke results.`;

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("SharePoint");
const spResult = await agent(SHAREPOINT, {
  label: "sharepoint:connector",
  phase: "SharePoint",
});
log(`SharePoint: ${spResult?.slice(0, 150)}`);

phase("Outlook");
const olResult = await agent(OUTLOOK, {
  label: "outlook:connector+stepup",
  phase: "Outlook",
});
log(`Outlook: ${olResult?.slice(0, 150)}`);

phase("MCP surface");
const mcpResult = await agent(MCP_SURFACE, {
  label: "mcp:connector-surface",
  phase: "MCP surface",
});
log(`MCP surface: ${mcpResult?.slice(0, 150)}`);

phase("Smoke test");
const smokeResult = await agent(SMOKE_PROMPT, {
  label: "smoke:connectors",
  phase: "Smoke test",
  schema: SMOKE_SCHEMA,
});
log(
  `Smoke: sp=${smokeResult?.sharepoint_connector_built}, stepup=${smokeResult?.stepup_gate_wired}`,
);

phase("Capture");
await agent(
  `
${CTX}
Create ~/brain/projects/onecomputer-phase5-result.md:
  title: Phase 5 connectors — result
  tags: [phase-5, connectors, sharepoint, outlook, result]
  Body: what was built, step-up gate wiring status, write surface test results,
  what needs a real M365 tenant to test live, next steps (real Graph token flow,
  Daytona sandbox with connectors wired).
Append Phase 5 section to ${REPO}/STATE.md.
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`,
  { label: "capture", phase: "Capture" },
);

return {
  sharepoint: spResult?.slice(0, 200),
  outlook: olResult?.slice(0, 200),
  mcp: mcpResult?.slice(0, 200),
  smoke: smokeResult,
};
