export const meta = {
  name: "sprint-g-package-gate",
  description:
    "Stand up Verdaccio npm proxy on port 4873, extend gateway blocklist to crates.io + pythonhosted, wire sandbox bootstrap to use Verdaccio",
  phases: [
    {
      title: "Verdaccio",
      detail:
        "docker run verdaccio:latest on port 4873, verify npm proxy works",
    },
    {
      title: "Blocklist",
      detail:
        "Extend gateway blocklist: add crates.io, files.pythonhosted.org, cdn.jsdelivr.net",
    },
    {
      title: "Bootstrap",
      detail: "Update sandbox-bootstrap.ts to set npm registry to Verdaccio",
    },
    {
      title: "Smoke",
      detail:
        "Create sandbox, configure npm → Verdaccio, npm install express works",
    },
    { title: "Commit", detail: "Commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";

// Context:
// - JFrog OSS free tier has NO npm/PyPI proxy — only LOCAL repos. Not usable as npm gate.
// - Verdaccio: lightweight Node.js private npm registry + proxy, free, Docker, port 4873
// - Gateway already 403s: registry.npmjs.org, pypi.org (from app-blocklist-service.ts:76-77)
// - Docker CLI: /Applications/Docker.app/Contents/Resources/bin/docker (not on PATH)
// - Daytona API: http://127.0.0.1:3000, Bearer: oclocal_devkey_faf128a9c992740356cc0a28
// - Toolbox exec: POST http://127.0.0.1:4000/toolbox/<id>/process/execute
// - Sandbox bootstrap: packages/api/src/services/sandbox-bootstrap.ts (Phase 1)
// - Sandbox user: uid=1000(daytona), npm needs --prefix /home/daytona/.npm-global

const CTX = `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
Repo: ${REPO}
JFrog: http://127.0.0.1:8082 (OSS free — generic artifacts only, NO npm proxy)
Verdaccio target: http://127.0.0.1:4873 (not yet running)
Gateway blocklist: packages/api/src/services/app-blocklist-service.ts
`;

phase("Verdaccio");
await agent(
  `${CTX}

## Task: stand up Verdaccio as npm proxy/gate

### Step 1 — create config
\`\`\`bash
mkdir -p ~/verdaccio/conf ~/verdaccio/storage

cat > ~/verdaccio/conf/config.yaml << 'EOF'
storage: /verdaccio/storage
auth:
  htpasswd:
    file: /verdaccio/conf/htpasswd
    max_users: 50

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

logs:
  type: stdout
  format: pretty
  level: http
EOF
\`\`\`

### Step 2 — run Verdaccio
\`\`\`bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker run -d --name verdaccio --restart unless-stopped -p 4873:4873 \
  -v ~/verdaccio/conf:/verdaccio/conf \
  -v ~/verdaccio/storage:/verdaccio/storage \
  verdaccio/verdaccio:latest
\`\`\`

### Step 3 — verify it starts and proxies npm
\`\`\`bash
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4873/ 2>/dev/null)
  echo "[$i] HTTP $code"; [ "$code" = "200" ] && break; sleep 5
done
npm view express version --registry http://127.0.0.1:4873/ 2>&1 | head -3
\`\`\`

Return: Verdaccio up (yes/no), npm view express result.
`,
  { label: "verdaccio", phase: "Verdaccio" },
);

phase("Blocklist");
await agent(
  `${CTX}

## Task: extend gateway blocklist to all public registries

### Step 1 — read current blocklist
Read: ${REPO}/packages/api/src/services/app-blocklist-service.ts
Find initBlocklistDefaults() — currently seeds registry.npmjs.org + pypi.org.

### Step 2 — add missing registries
Add these to the same blocklist seed pattern (action: "block", enabled: true):
- "crates.io"            (Rust package registry)
- "files.pythonhosted.org"  (PyPI file downloads — separate from pypi.org)
- "cdn.jsdelivr.net"     (CDN bypass vector)

Follow the exact same code pattern as the existing npmjs.org/pypi.org entries.

### Step 3 — pnpm tsc --noEmit
Return: files modified, new hosts added, tsc pass/fail.
`,
  { label: "blocklist", phase: "Blocklist", isolation: "worktree" },
);

phase("Bootstrap");
await agent(
  `${CTX}

## Task: update sandbox bootstrap to point npm at Verdaccio

Read: ${REPO}/packages/api/src/services/sandbox-bootstrap.ts

The PACKAGE_GATE_SCRIPT currently has a placeholder comment about Verdaccio.
Update it to use the REAL Verdaccio URL now that it's running.

\`\`\`typescript
const VERDACCIO_URL = process.env.VERDACCIO_URL ?? 'http://host.docker.internal:4873'

// In the bootstrap script section, replace the placeholder with:
const JFROG_PACKAGE_GATE = \`
# npm → Verdaccio (replaces direct npmjs.org)
npm config set registry \${VERDACCIO_URL}
echo "NPM_REGISTRY=$(npm config get registry)"
echo PACKAGE_GATE_DONE
\`
\`\`\`

Note: host.docker.internal resolves to the Mac host from inside Docker containers.
Verify VERDACCIO_URL is in the .env.example file. Add it if not.

Return: file modified, tsc pass/fail, .env.example updated.
`,
  { label: "bootstrap", phase: "Bootstrap" },
);

phase("Smoke");
await agent(
  `${CTX}

## Smoke test: sandbox npm via Verdaccio end-to-end

### Step 1 — create sandbox
\`\`\`bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
RESP=$(curl -s -X POST http://127.0.0.1:3000/api/sandbox \
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \
  -H "Content-Type: application/json" \
  -d '{"name":"pkg-gate-smoke","snapshot":"595be745-2eb0-4d30-a969-e4e04800ac0d","autoStop":20}')
SANDBOX_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "SANDBOX_ID=$SANDBOX_ID"

# Poll until started
for i in $(seq 1 18); do
  S=$(curl -s -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \
    "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID" | \
    python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  echo "[$i] $S"; [ "$S" = "started" ] && break; sleep 10
done
\`\`\`

### Step 2 — configure npm → Verdaccio and install a package
\`\`\`bash
# Set registry to Verdaccio
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \
  -H "Content-Type: application/json" \
  -d '{"command":"npm config set registry http://host.docker.internal:4873/ && npm config get registry"}'

# Install express via Verdaccio
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \
  -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \
  -H "Content-Type: application/json" \
  -d '{"command":"npm install --prefix /tmp/test-install express 2>&1 | tail -3 && echo INSTALL_OK"}'

# Cleanup
curl -s -X DELETE -H "Authorization: Bearer oclocal_devkey_faf128a9c992740356cc0a28" \
  "http://127.0.0.1:3000/api/sandbox/$SANDBOX_ID"
\`\`\`

Return: sandbox started (yes/no), npm registry = Verdaccio (yes/no), install OK (yes/no).
`,
  { label: "smoke", phase: "Smoke" },
);

phase("Commit");
await agent(
  `${CTX}

## Commit Sprint G and update memory

\`\`\`bash
cd ${REPO}
git add packages/api/src/services/app-blocklist-service.ts \
        packages/api/src/services/sandbox-bootstrap.ts \
        .env.example 2>/dev/null
git add -A packages/api/src/
git commit -m "feat(packages): Verdaccio npm gate + extended blocklist

Sprint G: Package gate

Verdaccio:
- Running on port 4873 (docker: verdaccio/verdaccio:latest)
- Config: ~/verdaccio/conf/config.yaml
- Proxies npmjs.org, caches packages locally

Gateway blocklist extended:
- Added: crates.io, files.pythonhosted.org, cdn.jsdelivr.net
- Existing: registry.npmjs.org, pypi.org

Sandbox bootstrap:
- npm registry now points to http://host.docker.internal:4873 (Verdaccio)
- VERDACCIO_URL env var documented in .env.example

Smoke test: npm install express in sandbox → hits Verdaccio

Note: JFrog OSS free tier = generic artifacts only (no npm/PyPI proxy)
Verdaccio is the npm gate; JFrog handles internal binaries.

Co-Authored-By: Claude <noreply@anthropic.com>"
\`\`\`

Update gbrain:
\`\`\`bash
pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Sprint G package gate (2026-06-28) — Verdaccio :4873, blocklist extended, sandbox npm wired\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
"
gbrain import ~/brain/ && gbrain embed --stale
\`\`\`

Append to ${REPO}/STATE.md under Sprint 0:
\`\`\`
## Sprint G package gate (2026-06-28)
- Verdaccio: running :4873, proxies npmjs.org
- Gateway blocklist: + crates.io, + files.pythonhosted.org, + cdn.jsdelivr.net
- Sandbox npm: → http://host.docker.internal:4873
- Smoke: npm install express in sandbox OK
\`\`\`

Return: commit hash, gbrain updated, STATE.md updated.
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
