export const meta = {
  name: "phase-4-package-gate",
  description:
    "Stand up Verdaccio as the npm package gate, extend gateway blocklist to all public registries, wire into sandbox bootstrap",
  phases: [
    {
      title: "Verdaccio",
      detail:
        "Spin up Verdaccio in Docker, configure allowlist/blocklist, verify npm install goes through it",
    },
    {
      title: "Gateway",
      detail:
        "Extend gateway blocklist to crates.io + pythonhosted; verify sandbox traffic is blocked at the gateway",
    },
    {
      title: "Wire",
      detail:
        "Update sandbox bootstrap to point npm at Verdaccio and HTTPS_PROXY at the gateway",
    },
    {
      title: "Smoke test",
      detail:
        "Full flow: sandbox npm install express → Verdaccio → works; npm install blocked-pkg → blocked",
    },
    { title: "Capture", detail: "gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;

// Context:
// - JFrog OSS free tier: NO npm/PyPI proxy support — only LOCAL repos. Not usable as npm gate.
// - Verdaccio: lightweight Node.js npm proxy, free, Docker < 100MB, port 4873
//   See: https://verdaccio.org/docs/docker
// - Gateway already 403s: registry.npmjs.org, pypi.org (via PolicyRule {action:"block"})
//   File: packages/api/src/services/app-blocklist-service.ts:76-77
//   These are seeded when JFrog app is connected — need to verify they're active
// - Gateway runs as HTTPS_PROXY in the sandbox; all outbound goes through it
// - JFrog: http://127.0.0.1:8082, admin/Beepbeep13579! — use for artifact storage only

const CTX = `
## Environment
Repo: ${REPO}
Docker: /Applications/Docker.app/Contents/Resources/bin/docker (add to PATH)
Verdaccio target port: 4873
Gateway blocklist seeds: packages/api/src/services/app-blocklist-service.ts
JFrog: http://127.0.0.1:8082 — OSS free tier, no npm proxy, use for artifacts only
Verdaccio docs: https://verdaccio.org/docs/docker
`;

// ─── VERDACCIO SETUP ─────────────────────────────────────────────────────────
const VERDACCIO_SETUP = `${CTX}

## Task: stand up Verdaccio as the npm package gate

### Step 1 — Run Verdaccio in Docker
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Create config dir
mkdir -p ~/verdaccio/conf ~/verdaccio/storage ~/verdaccio/plugins

# Write config (allowlist by default: proxy to npmjs, auth required to publish)
cat > ~/verdaccio/conf/config.yaml << 'EOF'
storage: /verdaccio/storage
auth:
  htpasswd:
    file: /verdaccio/conf/htpasswd
    max_users: 10

uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    timeout: 60s
    maxage: 10m

packages:
  '@*/*':
    access: $authenticated $anonymous
    proxy: npmjs
  '**':
    access: $authenticated $anonymous
    proxy: npmjs

# Log requests
logs:
  type: stdout
  format: pretty
  level: http
EOF

# Start Verdaccio
docker run -d \\
  --name verdaccio \\
  --restart unless-stopped \\
  -p 4873:4873 \\
  -v ~/verdaccio/conf:/verdaccio/conf \\
  -v ~/verdaccio/storage:/verdaccio/storage \\
  verdaccio/verdaccio:latest 2>&1

### Step 2 — Wait for it to start
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4873/ 2>/dev/null)
  echo "[$i] HTTP $code"
  [ "$code" = "200" ] && break
  sleep 5
done

### Step 3 — Verify npm can use it
npm view express --registry http://127.0.0.1:4873/ 2>&1 | head -5
(Should show express package info, proxied from npmjs)

### Step 4 — Save config to gbrain
pkill -f "gbrain serve"; sleep 1
Append to ~/brain/projects/onecomputer-jfrog-local.md a new section
"## Verdaccio npm gate (2026-06-28)" with:
- docker run command
- config.yaml
- health check URL: http://127.0.0.1:4873/
- npm registry URL: http://127.0.0.1:4873/
- Note: for production use Verdaccio's allowlist feature to restrict packages
gbrain import ~/brain/ && gbrain embed --stale

### Return
Is Verdaccio up (yes/no), HTTP status code, npm view express result (worked/failed),
docker run command used.`;

// ─── GATEWAY BLOCKLIST EXTENSION ─────────────────────────────────────────────
const GATEWAY_BLOCKLIST = `${CTX}

## Task: extend gateway blocklist to cover all public registries

### Current blocklist (from code audit)
File: ${REPO}/packages/api/src/services/app-blocklist-service.ts
Already seeded when JFrog app connects: registry.npmjs.org, pypi.org

### What to add
Read app-blocklist-service.ts first to understand the seeding pattern.
Add these to the default block rules (same pattern as existing npmjs/pypi entries):
- crates.io
- files.pythonhosted.org  (PyPI file downloads — separate from pypi.org)
- cdn.jsdelivr.net        (CDN that can be used to bypass registries)
- raw.githubusercontent.com (GitHub raw — common package install vector)

These should be seeded with action: "block", enabled: true, the same way
registry.npmjs.org is seeded today.

### Also verify the existing blocks are active
Check if there is a running gateway to test against. If not, just verify the
seed code is correct and note "gateway not running — need DATABASE_URL to activate".

### Test
Add to the existing test for app-blocklist-service (find it or create it):
1. default_blocklist_includes_cratesio — initBlocklistDefaults seeds crates.io
2. default_blocklist_includes_pythonhosted — seeds files.pythonhosted.org

### Return
Files modified, new hosts added, test results, whether gateway needs to restart to pick up.`;

// ─── WIRE INTO SANDBOX BOOTSTRAP ─────────────────────────────────────────────
const WIRE_BOOTSTRAP = `${CTX}

## Task: update sandbox bootstrap to use Verdaccio + gateway proxy

File: ${REPO}/packages/api/src/services/sandbox-bootstrap.ts
(Created in Phase 1 — if absent, create it now with the full bootstrap logic)

### Update the package gate section of the bootstrap script
Replace the placeholder Verdaccio config from Phase 1 with the real URL:

\`\`\`typescript
const VERDACCIO_URL = process.env.VERDACCIO_URL ?? 'http://host.docker.internal:4873'
const GATEWAY_URL   = process.env.GATEWAY_PROXY_URL ?? ''
// Note: host.docker.internal resolves to the Mac host from inside Docker containers

const PACKAGE_GATE_SCRIPT = \`
# npm → Verdaccio
npm config set registry \${VERDACCIO_URL}
echo NPM_REGISTRY=$(npm config get registry)

# pip → through gateway proxy (if configured)
\${GATEWAY_URL ? \`export HTTPS_PROXY=\${GATEWAY_URL}
export HTTP_PROXY=\${GATEWAY_URL}\` : '# GATEWAY_PROXY_URL not set — no proxy'}

echo PACKAGE_GATE_DONE
\`
\`\`\`

### Also add .env.example entries
In ${REPO}/.env.example, add:
VERDACCIO_URL=http://host.docker.internal:4873
GATEWAY_PROXY_URL=http://host.docker.internal:10255

### Test (update sandbox-bootstrap.test.ts)
1. bootstrap_npm_points_at_verdaccio — default VERDACCIO_URL → script contains "4873"
2. bootstrap_proxy_set_when_gateway_configured — GATEWAY_PROXY_URL set → script contains HTTPS_PROXY

### Return
Files modified, test results.`;

// ─── SMOKE TEST schema ────────────────────────────────────────────────────────
const SMOKE_SCHEMA = {
  type: "object",
  required: [
    "verdaccio_up",
    "npm_via_verdaccio",
    "registry_npmjs_blocked",
    "issues",
  ],
  properties: {
    verdaccio_up: { type: "boolean" },
    npm_via_verdaccio: { type: "boolean" }, // npm install express via Verdaccio works
    registry_npmjs_blocked: { type: "boolean" }, // direct npmjs.org → 403 from gateway
    sandbox_id: { type: "string" },
    npm_registry_in_sandbox: { type: "string" }, // what npm config get registry shows
    issues: { type: "array", items: { type: "string" } },
  },
};

const SMOKE_PROMPT = `${CTX}

## Smoke test: end-to-end package gate verification

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

### Test 1 — Verdaccio is up and can proxy npm
curl -s http://127.0.0.1:4873/ | head -3
npm view express --registry http://127.0.0.1:4873/ 2>&1 | head -3

### Test 2 — Create a sandbox and verify npm points at Verdaccio
RESP=$(curl -s -X POST http://127.0.0.1:3000/api/sandbox \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"pkg-gate-smoke","snapshot":"595be745-2eb0-4d30-a969-e4e04800ac0d","autoStop":20}')
SANDBOX_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")

# Poll until started
for i in $(seq 1 18); do
  S=$(curl -s -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
    "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID" | \\
    python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  echo "[$i] $S"; [ "$S" = "started" ] && break; sleep 10
done

# Set npm registry to Verdaccio inside the sandbox
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"npm config set registry http://host.docker.internal:4873/ && npm config get registry"}'

# Install a package via Verdaccio
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \\
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"npm install --prefix /tmp/test-install express 2>&1 | tail -3 && echo INSTALL_OK"}'

# Cleanup
curl -s -X DELETE -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \\
  "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID"

Return structured smoke results.`;

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Verdaccio");
const verdaccioResult = await agent(VERDACCIO_SETUP, {
  label: "verdaccio:setup",
  phase: "Verdaccio",
});
log(`Verdaccio: ${verdaccioResult?.slice(0, 150)}`);

phase("Gateway");
const gatewayResult = await agent(GATEWAY_BLOCKLIST, {
  label: "gateway:blocklist",
  phase: "Gateway",
});
log(`Gateway blocklist: ${gatewayResult?.slice(0, 150)}`);

phase("Wire");
const wireResult = await agent(WIRE_BOOTSTRAP, {
  label: "wire:bootstrap",
  phase: "Wire",
});
log(`Bootstrap wire: ${wireResult?.slice(0, 150)}`);

phase("Smoke test");
const smokeResult = await agent(SMOKE_PROMPT, {
  label: "smoke:package-gate",
  phase: "Smoke test",
  schema: SMOKE_SCHEMA,
});
log(
  `Smoke: verdaccio=${smokeResult?.verdaccio_up}, npm_via_verdaccio=${smokeResult?.npm_via_verdaccio}`,
);

phase("Capture");
await agent(
  `
${CTX}
Create ~/brain/projects/onecomputer-phase4-result.md:
  title: Phase 4 package gate — result
  tags: [phase-4, packages, verdaccio, result]
  Body: Verdaccio docker run command + config, gateway blocklist hosts added,
  sandbox bootstrap npm registry setting, smoke test results.
  TODO section: Verdaccio auth (require login to publish), package allowlist
  (only pre-approved packages), pip via JFrog generic artifacts.
Append Phase 4 section to ${REPO}/STATE.md.
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`,
  { label: "capture", phase: "Capture" },
);

return {
  verdaccio: verdaccioResult?.slice(0, 200),
  gateway: gatewayResult?.slice(0, 200),
  smoke: smokeResult,
};
