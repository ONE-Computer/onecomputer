export const meta = {
  name: "sprint-3-sandbox",
  description:
    "Wire the Daytona sandbox adapter, Claude auto-install, JFrog-only enforcement, and sandbox lifecycle into OneComputer",
  phases: [
    {
      title: "Implement",
      detail:
        "D1 Daytona adapter + D2 Claude install + D3 JFrog enforcement in parallel",
    },
    {
      title: "Smoke test",
      detail:
        "Create a real sandbox via the adapter, exec Claude, verify JFrog blocks npmjs.org",
    },
    {
      title: "Capture",
      detail: "Write all findings to gbrain, update STATE.md",
    },
  ],
};

// ─── Shared context ───────────────────────────────────────────────────────────
const CONTEXT = `
## Environment (all verified 2026-06-28)
- Repo: /Users/ttwj/Project OneComputer/implementation/onecomputer
- TypeScript API: packages/api/src/
- Daytona stack: /Users/ttwj/Project OneComputer/daytona-oss (v0.190.0)
- Daytona API: http://127.0.0.1:3000 (127.0.0.1 NOT localhost — IPv6 issue on this Mac)
- Daytona auth: Bearer oclocal_devkey_faf128a9c992740356cc0a28
- Daytona personal org: 1c734232-c194-4765-bb55-340706bf6e42
- Default snapshot: 595be745-2eb0-4d30-a969-e4e04800ac0d (daytonaio/sandbox:0.5.0-slim, linux/arm64)
- Toolbox exec path: POST http://127.0.0.1:4000/toolbox/<sandbox-id>/process/execute
  (NOT /api/sandbox/:id/toolbox — that 404s; use proxy port 4000)
- Sandbox user: uid=1000(daytona) — not root. npm global install needs --prefix /home/daytona/.npm-global
- Claude CLI in sandbox: npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global
  → /home/daytona/.npm-global/bin/claude --version → "2.1.195 (Claude Code)"
- JFrog Artifactory: http://127.0.0.1:8082, admin/password (if not changed by JFrog agent)
  Check current password: curl -s -o /dev/null -w "%{http_code}" -u admin:password http://127.0.0.1:8082/artifactory/api/repositories
  If 200 → password still "password". If 401 → check ~/brain/projects/onecomputer-jfrog-local.md for the new one.
- Docker CLI: /Applications/Docker.app/Contents/Resources/bin/docker (NOT on PATH)
  Always: export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
- Adapter contract: ~/brain/projects/onecomputer-daytona-adapter-contract.md
- AUDIT.md ground truth: /Users/ttwj/Project OneComputer/implementation/onecomputer/AUDIT.md
`;

// ─── D1: Daytona adapter (TypeScript) ────────────────────────────────────────
const D1_PROMPT = `${CONTEXT}

## Your task: D1 — Daytona RuntimeProvider adapter

Create a TypeScript Daytona adapter in the OneComputer API that implements the
RuntimeProvider interface for sandbox lifecycle.

### What to implement
Create packages/api/src/services/daytona-sandbox-service.ts:

interface SandboxHandle {
  id: string
  name: string
  state: 'creating' | 'started' | 'stopped' | 'error' | 'archived'
  toolboxUrl: string   // http://127.0.0.1:4000/toolbox/<id>
}

interface ExecResult {
  exitCode: number
  output: string
}

class DaytonaSandboxService {
  private apiBase: string          // DAYTONA_API_URL env, default http://127.0.0.1:3000/api
  private apiKey: string           // DAYTONA_API_KEY env
  private proxyBase: string        // DAYTONA_PROXY_URL env, default http://127.0.0.1:4000

  async create(name: string, snapshotId?: string): Promise<SandboxHandle>
  // POST /api/sandbox { name, snapshot: snapshotId ?? default_snapshot, autoStop: 60 }
  // Poll state every 3s until started or error (timeout 3 min)
  // Returns SandboxHandle with toolboxUrl = http://127.0.0.1:4000/toolbox/<id>

  async exec(sandboxId: string, command: string): Promise<ExecResult>
  // POST http://127.0.0.1:4000/toolbox/<sandboxId>/process/execute
  // { command } → { exitCode, result }

  async stop(sandboxId: string): Promise<void>
  // POST /api/sandbox/<id>/stop

  async delete(sandboxId: string): Promise<void>
  // DELETE /api/sandbox/<id>

  async list(): Promise<SandboxHandle[]>
  // GET /api/sandbox → items[]

  async getState(sandboxId: string): Promise<SandboxHandle>
  // GET /api/sandbox/<id>
}

export const daytonaSandboxService = new DaytonaSandboxService()

### Wire into a route
Add GET /v1/sandboxes and POST /v1/sandboxes to packages/api/src/routes/sandboxes.ts
(create the file). Wire the router in packages/api/src/app.ts.

### Tests
Create packages/api/src/services/daytona-sandbox-service.test.ts:
1. create_builds_correct_url — mock fetch, assert POST to /api/sandbox with correct body
2. exec_uses_proxy_port — mock fetch, assert POST to port 4000, not port 3000
3. list_returns_handles — mock response with items, assert SandboxHandle[] returned
Use vi.fn()/vi.mock() or jest.fn() to mock fetch. No real network calls in tests.

### How to check
pnpm tsc --noEmit 2>&1 | tail -10

### gbrain
Append "## D1 Daytona adapter — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── D2: Claude auto-install in sandbox ──────────────────────────────────────
const D2_PROMPT = `${CONTEXT}

## Your task: D2 — Claude Code auto-install as sandbox startup script

When a sandbox is created via OneComputer, automatically install Claude Code CLI
and set up the correct PATH. This is a startup script wired into the D1 adapter.

### What to implement

1. Create packages/api/src/lib/sandbox-bootstrap.ts:

   export const CLAUDE_BOOTSTRAP_SCRIPT = \`
   set -e
   # Install Claude Code CLI (sandbox user is daytona uid=1000, not root)
   npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global 2>&1 | tail -3
   echo 'export PATH=/home/daytona/.npm-global/bin:\$PATH' >> /home/daytona/.bashrc
   echo 'export PATH=/home/daytona/.npm-global/bin:\$PATH' >> /home/daytona/.profile
   /home/daytona/.npm-global/bin/claude --version
   echo "CLAUDE_BOOTSTRAP_DONE"
   \`

   export async function bootstrapSandbox(
     sandboxId: string,
     exec: (id: string, cmd: string) => Promise<{exitCode: number, output: string}>
   ): Promise<{ claudeVersion: string | null, success: boolean }> {
     const result = await exec(sandboxId, CLAUDE_BOOTSTRAP_SCRIPT)
     const match = result.output.match(/([0-9]+\\.[0-9]+\\.[0-9]+) \\(Claude Code\\)/)
     return {
       claudeVersion: match?.[1] ?? null,
       success: result.exitCode === 0 && result.output.includes('CLAUDE_BOOTSTRAP_DONE')
     }
   }

2. Wire bootstrapSandbox into DaytonaSandboxService.create() — call it after
   the sandbox reaches state=started, before returning the SandboxHandle.
   Add a bootstrapped: boolean field to SandboxHandle.

3. Add a ONECLI_SANDBOX_BOOTSTRAP_ENABLED env var (default true) so it can be
   disabled in tests.

### Tests (sandbox-bootstrap.test.ts)
1. bootstrap_succeeds — mock exec returning exit 0 + "2.1.195 (Claude Code)" + DONE
   → { claudeVersion: "2.1.195", success: true }
2. bootstrap_fails_gracefully — exec returns exit 1 → { success: false }
3. claude_version_parsed — "2.1.195 (Claude Code)" in output → claudeVersion = "2.1.195"

### How to check
pnpm tsc --noEmit 2>&1 | tail -10

### gbrain
Append "## D2 Claude bootstrap — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── D3: JFrog-only package enforcement in sandbox ───────────────────────────
const D3_PROMPT = `${CONTEXT}

## Your task: D3 — JFrog-only package enforcement in sandbox startup

When a sandbox starts, configure npm and pip to use the internal JFrog virtual
repos only. Also verify the gateway's existing 403 blocklist (npmjs.org + pypi.org)
is in effect for the sandbox's outbound traffic.

### What to implement

1. Extend sandbox-bootstrap.ts (from D2 — or create it if D2 hasn't landed):
   Add a JFROG_BOOTSTRAP_SCRIPT that runs inside the sandbox:

   export const JFROG_BOOTSTRAP_SCRIPT = (jfrogBase: string, authToken: string) => \`
   set -e
   # npm: point at JFrog virtual repo
   npm config set registry \${jfrogBase}/artifactory/api/npm/temasek-npm-virtual/
   npm config set //\${jfrogBase.replace('http://','').replace('https://','')}/artifactory/api/npm/temasek-npm-virtual/:_authToken "\${authToken}"
   echo "NPM_JFROG_CONFIGURED"

   # pip: point at JFrog PyPI proxy
   mkdir -p /home/daytona/.config/pip
   cat > /home/daytona/.config/pip/pip.conf << 'PIPEOF'
   [global]
   index-url = \${jfrogBase}/artifactory/api/pypi/temasek-pypi-virtual/simple
   trusted-host = \${jfrogBase.replace('http://','').replace('https://','')}
   PIPEOF
   echo "PIP_JFROG_CONFIGURED"

   # Verify: npm config get registry should show JFrog
   npm config get registry
   \`

2. Add a verifyJfrogBlocking() function that runs inside the sandbox and proves
   the gateway blocks direct registry access:
   Try: curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/ via the proxy
   Expect: 403 (blocked by gateway policy)
   If ONECLI_GATEWAY_PROXY is not set in the sandbox, skip this check.

3. Wire into bootstrapSandbox() as a second phase after Claude install:
   - Read ONECLI_JFROG_BASE_URL and ONECLI_JFROG_AUTH_TOKEN from env
   - If both set: run JFROG_BOOTSTRAP_SCRIPT, log result
   - If not set: log warning "JFrog not configured — sandbox will use public registries"

4. Add ONECLI_JFROG_BASE_URL (default "http://127.0.0.1:8082") and
   ONECLI_JFROG_AUTH_TOKEN to the .env.example file.

### Tests (jfrog-enforcement.test.ts)
1. script_contains_registry_config — JFROG_BOOTSTRAP_SCRIPT("http://jfrog.test","tok")
   result contains "registry=http://jfrog.test"
2. script_contains_pip_config — result contains "index-url"
3. bootstrap_skips_when_no_env — ONECLI_JFROG_AUTH_TOKEN unset → skips with warning,
   does not call exec

### How to check
pnpm tsc --noEmit 2>&1 | tail -10

### Also verify the gateway blocklist is still active
Read apps/gateway/src/services/app-blocklist-service.ts (TS API) to confirm
npmjs.org and pypi.org are seeded as block rules. If D3 adds crates.io and
pythonhosted.org to the blocklist seed, that is a bonus.
Report: which hosts are in the blocklist seed.

### gbrain
Append "## D3 JFrog enforcement — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── Smoke test schema ────────────────────────────────────────────────────────
const SMOKE_SCHEMA = {
  type: "object",
  required: [
    "sandbox_created",
    "sandbox_started",
    "claude_version",
    "jfrog_configured",
    "issues",
  ],
  properties: {
    sandbox_created: { type: "boolean" },
    sandbox_started: { type: "boolean" },
    sandbox_id: { type: "string" },
    claude_version: { type: "string" }, // e.g. "2.1.195"
    jfrog_configured: { type: "boolean" },
    npm_registry: { type: "string" }, // what npm config get registry returns
    issues: { type: "array", items: { type: "string" } },
  },
};

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Implement");

const implResults = await parallel([
  () => agent(D1_PROMPT, { label: "D1: Daytona adapter", phase: "Implement" }),
  () => agent(D2_PROMPT, { label: "D2: Claude bootstrap", phase: "Implement" }),
  () =>
    agent(D3_PROMPT, { label: "D3: JFrog enforcement", phase: "Implement" }),
]);

log(
  `Implement done. ${implResults.filter(Boolean).length}/3 agents completed.`,
);

phase("Smoke test");

// One smoke-test agent that actually creates a real sandbox and runs the full flow
const smokeResult = await agent(
  `
${CONTEXT}

## Smoke test: create a real sandbox and verify the full D1+D2+D3 flow

This is an END-TO-END test against the live Daytona stack. Not a unit test.

### Step 1 — Create a sandbox via the Daytona API directly
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
RESP=$(curl -s -X POST http://127.0.0.1:3000/api/sandbox \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"smoke-test-sprint3","snapshot":"595be745-2eb0-4d30-a969-e4e04800ac0d","autoStop":30}')
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print('id:',d.get('id'),'state:',d.get('state'))"
SANDBOX_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

### Step 2 — Poll until started (max 3 min)
for i in $(seq 1 18); do
  STATE=$(curl -s -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
    "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID" | \\
    python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  echo "[$i] state: $STATE"
  [ "$STATE" = "started" ] && break
  [ "$STATE" = "error" ] && break
  sleep 10
done

### Step 3 — Install Claude via toolbox
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global 2>&1 | tail -2 && /home/daytona/.npm-global/bin/claude --version"}'

### Step 4 — Configure JFrog npm registry
JFROG_BASE="http://127.0.0.1:8082"
# Get JFrog auth token (check brain first)
# If Artifactory is up with default password:
JFROG_TOKEN=$(curl -s -u admin:password -X POST \\
  "$JFROG_BASE/artifactory/api/security/apiKey" 2>/dev/null | \\
  python3 -c "import sys,json;print(json.load(sys.stdin).get('apiKey',''))" 2>/dev/null)
echo "JFrog token: $JFROG_TOKEN"

curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d "{\"command\":\"npm config set registry $JFROG_BASE/artifactory/api/npm/temasek-npm-virtual/ 2>/dev/null || echo JFrog_repo_missing && npm config get registry\"}"

### Step 5 — Clean up
curl -s -X DELETE -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID"

Return structured results.`,
  { label: "smoke-test", phase: "Smoke test", schema: SMOKE_SCHEMA },
);

phase("Capture");

const captureResult = await agent(
  `
${CONTEXT}

## Capture: update gbrain + STATE.md with Sprint 3 results

Smoke test result: ${JSON.stringify(smokeResult)}
Impl agents: ${implResults.filter(Boolean).length}/3 completed.

1. Create ~/brain/projects/onecomputer-sprint-3-result.md with frontmatter:
   title: "Sprint 3 sandbox — integration result"
   type: project
   tags: [sprint, sandbox, result]
   updated: 2026-06-28
   Body: for each D1/D2/D3 — what was implemented, what test coverage exists.
   Smoke test: sandbox_started, claude_version, jfrog_configured, issues.
   What's still missing for production (Linux VM for runner, real JFrog repos, etc.).

2. Update STATE.md to add a Sprint 3 section:
   /Users/ttwj/Project OneComputer/implementation/onecomputer/STATE.md
   Add under "Sprint 0" a "Sprint 3 sandbox" section noting what's real vs TODO.

3. pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

Return: gbrain page created, STATE.md updated, pages/chunks count.`,
  { label: "capture", phase: "Capture" },
);

return {
  impl: { completed: implResults.filter(Boolean).length, total: 3 },
  smoke: smokeResult,
  capture: captureResult,
};
