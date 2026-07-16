export const meta = {
  name: "phase-1-sandbox-wiring",
  description:
    "Wire Daytona sandboxes into OneComputer API: create, bootstrap Claude, inject gateway proxy, configure package registry",
  phases: [
    {
      title: "Build",
      detail:
        "Daytona adapter + Claude bootstrap + package config in the TypeScript API",
    },
    {
      title: "Smoke test",
      detail:
        "Create a real sandbox end-to-end: started → Claude installed → proxy wired → npm via Verdaccio",
    },
    {
      title: "Capture",
      detail:
        "Save learnings to gbrain, update STATE.md, flag what is still TODO",
    },
  ],
};

// ─── Shared facts (all verified 2026-06-28) ──────────────────────────────────
const ENV = {
  repo: "/Users/ttwj/Project OneComputer/implementation/onecomputer",
  daytonaApi: "http://127.0.0.1:3000",
  daytonaProxy: "http://127.0.0.1:4000", // toolbox goes here, NOT port 3000
  daytonaBearer: "oclocal_devkey_faf128a9c992740356cc0a28",
  defaultSnapshot: "595be745-2eb0-4d30-a969-e4e04800ac0d",
  jfrogBase: "http://127.0.0.1:8082",
  jfrogPass: "Beepbeep13579!", // JFrog OSS admin — free tier, no npm proxy
  gatewayPort: 10255,
  // Sandbox facts:
  // - image: daytonaio/sandbox:0.5.0-slim, linux/arm64 native
  // - user: uid=1000(daytona) — NOT root
  // - node: v22.14.0 (via nvm at /usr/local/nvm)
  // - npm global install needs: --prefix /home/daytona/.npm-global
  // - claude: npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global
  //           → /home/daytona/.npm-global/bin/claude --version → "2.1.195 (Claude Code)"
  // - exec path: POST http://127.0.0.1:4000/toolbox/<id>/process/execute
  //              { command: "..." } → { exitCode: 0, result: "..." }
};

const CTX = `
## Verified environment (do NOT re-probe these, just use the values)
Repo: ${ENV.repo}
TypeScript API: packages/api/src/  (Hono framework, existing routes in app.ts lines 96-120)
Daytona API: ${ENV.daytonaApi} — auth Bearer ${ENV.daytonaBearer}
Toolbox exec: POST ${ENV.daytonaProxy}/toolbox/<sandbox-id>/process/execute
Default snapshot: ${ENV.defaultSnapshot}
JFrog: ${ENV.jfrogBase} admin/Beepbeep13579! — OSS free tier, NO npm/PyPI proxy support
Sandbox user: uid=1000(daytona), node v22, claude installs via --prefix /home/daytona/.npm-global
Gateway: not yet running as a service — runs locally as cargo binary on port ${ENV.gatewayPort}
Docker: /Applications/Docker.app/Contents/Resources/bin/docker (add to PATH first)

## Ground rules
- Read AUDIT.md before writing any code: ${ENV.repo}/AUDIT.md
- A feature is done only when it has a test that asserts AND is wired to a real call path
- No DIY crypto anywhere
- JFrog OSS cannot proxy npm/PyPI — package gate uses Verdaccio (port 4873, not yet installed)
  For this phase: configure sandbox npm to point at Verdaccio:4873 (placeholder URL),
  AND set HTTPS_PROXY in the sandbox to route through the OneComputer gateway
`;

// ─── BUILD AGENT ─────────────────────────────────────────────────────────────
const BUILD_PROMPT = `${CTX}

## Task: implement the Daytona sandbox adapter in the TypeScript API

### 1. Create packages/api/src/services/daytona-service.ts

Implement these with real fetch calls (no mocks, no TODOs for the core paths):

\`\`\`typescript
// Config (read from env with defaults)
const DAYTONA_API   = process.env.DAYTONA_API_URL   ?? 'http://127.0.0.1:3000'
const DAYTONA_KEY   = process.env.DAYTONA_API_KEY   ?? 'oclocal_devkey_faf128a9c992740356cc0a28'
const DAYTONA_PROXY = process.env.DAYTONA_PROXY_URL ?? 'http://127.0.0.1:4000'
const SNAPSHOT_ID   = process.env.DAYTONA_SNAPSHOT  ?? '595be745-2eb0-4d30-a969-e4e04800ac0d'

export interface SandboxInfo {
  id: string; name: string; state: string
  toolboxUrl: string   // http://127.0.0.1:4000/toolbox/<id>
  claudeVersion?: string; bootstrapped: boolean
}

export async function createSandbox(name: string): Promise<SandboxInfo>
// POST /api/sandbox {name, snapshot: SNAPSHOT_ID, autoStop: 60}
// Poll GET /api/sandbox/<id> every 4s up to 3 min until state === 'started' or 'error'
// On started: call bootstrapSandbox(id)
// On error: throw with the errorReason

export async function execInSandbox(sandboxId: string, command: string): Promise<{exitCode: number, output: string}>
// POST http://127.0.0.1:4000/toolbox/<sandboxId>/process/execute
// {command} → {exitCode, result}
// Note: proxy port 4000, NOT API port 3000

export async function deleteSandbox(id: string): Promise<void>
// DELETE /api/sandbox/<id>

export async function listSandboxes(): Promise<SandboxInfo[]>
// GET /api/sandbox → items[]

export async function getSandbox(id: string): Promise<SandboxInfo>
// GET /api/sandbox/<id>
\`\`\`

### 2. Create packages/api/src/services/sandbox-bootstrap.ts

\`\`\`typescript
// Runs inside the sandbox after it reaches state=started
// Returns { claudeVersion, success, log }

const BOOTSTRAP_SCRIPT = \`
set -e
# Claude Code CLI
npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global 2>&1 | tail -2
export PATH=/home/daytona/.npm-global/bin:$PATH

# Verify
claude --version && echo BOOTSTRAP_OK
\`

// Package gate: configure npm to use Verdaccio (not yet running, but configure the URL)
// When VERDACCIO_URL is set, redirect npm registry
const PACKAGE_GATE_SCRIPT = (verdaccioUrl?: string, gatewayUrl?: string) => \`
# npm package gate
\${verdaccioUrl ? \`npm config set registry \${verdaccioUrl}\` : '# Verdaccio not configured — npm uses default (TODO: set VERDACCIO_URL)'}

# Gateway proxy: route all outbound HTTP through OneComputer gateway
\${gatewayUrl ? \`export HTTPS_PROXY=\${gatewayUrl}\\nexport HTTP_PROXY=\${gatewayUrl}\\nexport NODE_EXTRA_CA_CERTS=/tmp/onecli-ca.pem\` : '# Gateway not configured — no proxy (TODO: set GATEWAY_PROXY_URL)'}

echo PACKAGE_GATE_CONFIGURED
\`

export async function bootstrapSandbox(
  sandboxId: string,
  exec: (id: string, cmd: string) => Promise<{exitCode: number, output: string}>
): Promise<{ claudeVersion: string | null, success: boolean, log: string }>
\`\`\`

### 3. Create packages/api/src/routes/sandboxes.ts

\`\`\`typescript
// Register in app.ts: app.route('/sandboxes', sandboxRoutes())
// Routes:
// GET  /sandboxes          → listSandboxes()
// POST /sandboxes          → createSandbox(name) — REAL call, not a mock
// GET  /sandboxes/:id      → getSandbox(id)
// POST /sandboxes/:id/exec → execInSandbox(id, body.command)
// DELETE /sandboxes/:id    → deleteSandbox(id)
\`\`\`

Wire the router into packages/api/src/app.ts. Find the import block at lines 29-53
and the route registration block at lines 96-120. Add sandboxes there.

### 4. Tests (packages/api/src/services/daytona-service.test.ts)

Use vitest (check package.json — likely "vitest" or "jest"). Create 4 tests:
1. createSandbox_calls_correct_endpoint — mock fetch, assert POST to /api/sandbox
2. exec_uses_proxy_port_4000 — mock fetch, assert toolbox URL contains ':4000'
3. bootstrap_parses_claude_version — mock exec returning "2.1.195 (Claude Code)", assert claudeVersion="2.1.195"
4. package_gate_script_contains_registry — with verdaccioUrl set, assert script contains 'registry'

Run: cd ${ENV.repo} && pnpm --filter @onecli/api test 2>&1 | tail -20
If no test runner: pnpm tsc --noEmit 2>&1 | tail -10

### Capture to gbrain
pkill -f "gbrain serve"; sleep 1
Append "## Phase 1 sandbox wiring — build (2026-06-28)" to ~/brain/projects/onecomputer-build-priorities.md
Include: files created, what each does, test results (pass/fail count)
gbrain import ~/brain/ && gbrain embed --stale

### Return (under 200 words)
Files created, types compile (yes/no), test pass/fail, what is wired vs TODO`;

// ─── SMOKE TEST AGENT ────────────────────────────────────────────────────────
const SMOKE_SCHEMA = {
  type: "object",
  required: [
    "sandbox_started",
    "exec_works",
    "claude_installed",
    "proxy_configured",
    "issues",
  ],
  properties: {
    sandbox_started: { type: "boolean" },
    sandbox_id: { type: "string" },
    exec_works: { type: "boolean" },
    claude_installed: { type: "boolean" },
    claude_version: { type: "string" },
    proxy_configured: { type: "boolean" }, // HTTPS_PROXY set in sandbox env
    npm_registry: { type: "string" }, // what npm config get registry shows
    issues: { type: "array", items: { type: "string" } },
  },
};

const SMOKE_PROMPT = `${CTX}

## Task: end-to-end smoke test of the Phase 1 sandbox wiring

This agent creates a REAL sandbox and tests every wire. All calls use curl directly.

### Step 1 — create sandbox
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
RESP=$(curl -s -X POST ${ENV.daytonaApi}/api/sandbox \\
  -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"phase1-smoke","snapshot":"${ENV.defaultSnapshot}","autoStop":30}')
SANDBOX_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "SANDBOX_ID=$SANDBOX_ID"

### Step 2 — poll until started (max 3 min)
for i in $(seq 1 18); do
  S=$(curl -s -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
    "${ENV.daytonaApi}/api/sandbox/$SANDBOX_ID" | \\
    python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('state'),d.get('errorReason','')[:60])")
  echo "[$i] $S"; echo "$S" | grep -q "^started" && break
  echo "$S" | grep -q "^error" && break; sleep 10
done

### Step 3 — exec a basic command to confirm toolbox works
curl -s -X POST "${ENV.daytonaProxy}/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"uname -m && id && node --version"}'

### Step 4 — install Claude Code
curl -s -X POST "${ENV.daytonaProxy}/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global 2>&1 | tail -3 && /home/daytona/.npm-global/bin/claude --version"}'

### Step 5 — configure package gate (Verdaccio placeholder + gateway proxy)
curl -s -X POST "${ENV.daytonaProxy}/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"npm config set registry http://host.docker.internal:4873/ 2>/dev/null || npm config set registry http://localhost:4873/; npm config get registry; echo PROXY_ENV=$(printenv HTTPS_PROXY || echo not_set)"}'

### Step 6 — cleanup
curl -s -X DELETE -H "Authorization: Bearer ${ENV.daytonaBearer}" \\
  "${ENV.daytonaApi}/api/sandbox/$SANDBOX_ID"

Return structured smoke test results.`;

// ─── CAPTURE AGENT ───────────────────────────────────────────────────────────
const CAPTURE_PROMPT = (buildSummary, smokeResult) => `${CTX}

## Task: capture Phase 1 results to gbrain and STATE.md

Build summary: ${buildSummary || "(not available)"}
Smoke test: ${JSON.stringify(smokeResult)}

1. Create ~/brain/projects/onecomputer-phase1-result.md:
---
title: "Phase 1 sandbox wiring — result"
type: project
aliases: [phase-1-result, sandbox-wiring]
tags: [sprint, sandbox, result]
updated: 2026-06-28
---
Body: what was built (adapter, bootstrap, routes), smoke test results (with exact
versions/outputs), what is still TODO (Verdaccio not up, gateway not injected as
service, real HTTPS_PROXY injection into sandbox env).

2. Append to ${ENV.repo}/STATE.md under Sprint 0:
## Phase 1 sandbox wiring (2026-06-28)
- DaytonaSandboxService: [done/todo]
- Claude auto-install on start: [done/todo]
- HTTPS_PROXY gateway injection: TODO — gateway needs to run as a service first
- npm via Verdaccio: TODO — Verdaccio not yet installed (Phase 4)
- Smoke test: sandbox_started=[x], claude=[version], issues=[...]

3. pkill -f "gbrain serve"; sleep 1
   gbrain import ~/brain/ && gbrain embed --stale

Return: gbrain page created (yes/no), STATE.md updated (yes/no), pages/chunks count.`;

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Build");
const buildResult = await agent(BUILD_PROMPT, {
  label: "build:sandbox-adapter",
  phase: "Build",
});
log(`Build done: ${buildResult?.slice(0, 200) ?? "no output"}`);

phase("Smoke test");
const smokeResult = await agent(SMOKE_PROMPT, {
  label: "smoke:live-sandbox",
  phase: "Smoke test",
  schema: SMOKE_SCHEMA,
});
log(
  `Smoke: started=${smokeResult?.sandbox_started}, claude=${smokeResult?.claude_version}, issues=${smokeResult?.issues?.length ?? 0}`,
);

phase("Capture");
const captureResult = await agent(CAPTURE_PROMPT(buildResult, smokeResult), {
  label: "capture:gbrain",
  phase: "Capture",
});

return {
  build: buildResult?.slice(0, 400),
  smoke: smokeResult,
  capture: captureResult,
};
