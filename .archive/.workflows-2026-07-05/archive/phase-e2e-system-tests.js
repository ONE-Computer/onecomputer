export const meta = {
  name: "phase-e2e-system-tests",
  description:
    "Full E2E validation of ONEComputer across Employee, Cyber, Manager, Gateway, Package Gate, VTI identity, and Platform deploy paths",
  phases: [
    {
      title: "Preflight",
      detail: "Verify local services, env, DB migrations, web app reachable",
    },
    {
      title: "Employee E2E",
      detail:
        "Sandbox lifecycle, Claude install, exec, package registry config",
    },
    {
      title: "Cyber E2E",
      detail: "Console fleet, activity logs, violations, kill switch",
    },
    {
      title: "Manager E2E",
      detail: "ApprovalRequest creation, approve/deny, RBAC negative checks",
    },
    {
      title: "Gateway E2E",
      detail:
        "Policy block/allow, MCP tool parsing, channel routing, Prometheus metrics",
    },
    {
      title: "VTI E2E",
      detail: "Signed VP injected into MCP response and verified",
    },
    {
      title: "Report",
      detail:
        "Write E2E report to gbrain and STATE.md, mark readiness honestly",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API_KEY = "oclocal_devkey_faf128a9c992740356cc0a28";
const SNAPSHOT = "595be745-2eb0-4d30-a969-e4e04800ac0d";

const CTX = `
Repo: ${REPO}
Web: http://127.0.0.1:10254
Daytona API: http://127.0.0.1:3000 (use 127.0.0.1, NOT localhost)
Daytona toolbox: http://127.0.0.1:4000/toolbox/<sandbox-id>/process/execute
Daytona bearer: ${API_KEY}
Default snapshot: ${SNAPSHOT}
OneComputer Postgres: localhost:5433 / onecomputer:onecomputer / onecomputer
JFrog: http://127.0.0.1:8082 admin / Beepbeep13579!
Verdaccio: http://127.0.0.1:4873
VTI mediator: http://127.0.0.1:7037/mediator/v1/livez
Docker CLI: /Applications/Docker.app/Contents/Resources/bin/docker
Rust cargo: $HOME/.cargo/bin/cargo

E2E rule: report REAL/PARTIAL/FAIL per persona. Do not mark anything complete unless a browser/API/sandbox command actually proves it.
`;

const RESULT_SCHEMA = {
  type: "object",
  required: ["area", "verdict", "proof", "issues"],
  properties: {
    area: { type: "string" },
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "FAIL"] },
    proof: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
  },
};

phase("Preflight");
const preflight = await agent(
  `${CTX}

## Preflight E2E

Run these checks exactly:

~~~bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH:$HOME/.cargo/bin"

curl -s -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1:10254/
curl -s -o /dev/null -w "daytona:%{http_code}\n" http://127.0.0.1:3000/api/health
curl -s -o /dev/null -w "jfrog:%{http_code}\n" http://127.0.0.1:8082/artifactory/api/system/ping
curl -s -o /dev/null -w "verdaccio:%{http_code}\n" http://127.0.0.1:4873/
curl -s -o /dev/null -w "vti:%{http_code}\n" http://127.0.0.1:7037/mediator/v1/livez

docker exec onecomputer-postgres-1 pg_isready -U onecomputer
cd ${REPO}/apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
cd ${REPO}/apps/gateway && cargo test 2>&1 | tail -20
cd ${REPO}/apps/gateway && cargo clippy -- -D warnings 2>&1 | grep "^error" | head -10
~~~

Verdict REAL only if all HTTP statuses are healthy, tsc has 0 errors, cargo tests pass, clippy has no errors.
Return structured result.`,
  { label: "preflight", phase: "Preflight", schema: RESULT_SCHEMA },
);

phase("Employee E2E");
const employee = await agent(
  `${CTX}

## Employee E2E — sandbox lifecycle + Claude + package config

Steps:
1. Create a sandbox:
~~~bash
RESP=$(curl -s -X POST http://127.0.0.1:3000/api/sandbox \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-employee-sandbox","snapshot":"${SNAPSHOT}","autoStop":30}')
SANDBOX_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo $SANDBOX_ID
~~~
2. Poll until started.
3. Exec:
~~~bash
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command":"uname -m && node --version && python3 --version"}'
~~~
4. Install Claude:
~~~bash
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command":"npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global >/tmp/claude-install.log 2>&1 && /home/daytona/.npm-global/bin/claude --version"}'
~~~
5. Set npm registry to Verdaccio and verify:
~~~bash
curl -s -X POST "http://127.0.0.1:4000/toolbox/$SANDBOX_ID/process/execute" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command":"npm config set registry http://host.docker.internal:4873/ && npm config get registry"}'
~~~
6. Delete sandbox at end.

REAL only if sandbox starts, exec works, Claude version returns, npm registry shows Verdaccio.
Return structured result.`,
  { label: "employee-e2e", phase: "Employee E2E", schema: RESULT_SCHEMA },
);

phase("Cyber E2E");
const cyber = await agent(
  `${CTX}

## Cyber E2E — console, fleet, activity, kill switch

Check via API and browser-reachable pages:
1. GET http://127.0.0.1:10254/console → HTTP 200
2. GET /v1/console-live or /v1/console/overview (try both; report which exists)
3. Verify response includes sandbox counts, rules counts, recent violations.
4. Create a sandbox, then DELETE it through /v1/sandboxes/:id and confirm it disappears from Daytona API.
5. Check /activity returns HTTP 200.

REAL only if console page loads, live API returns real JSON, kill switch deletes a real sandbox.
Return structured result.`,
  { label: "cyber-e2e", phase: "Cyber E2E", schema: RESULT_SCHEMA },
);

phase("Manager E2E");
const manager = await agent(
  `${CTX}

## Manager E2E — approvals + RBAC negative checks

Checks:
1. GET http://127.0.0.1:10254/approvals → HTTP 200.
2. POST /v1/approvals to create a pending request with action "outlook.send_email" and context {to, subject}.
3. GET /v1/approvals confirms it appears.
4. POST /v1/approvals/:id/decide {decision:"approved"} confirms status changes.
5. RBAC negative: member role should NOT approve. If a route test exists, run it. If not, inspect ability.test.ts and run it.

REAL only if create/list/decide works and a negative permission test exists/passes.
Return structured result.`,
  { label: "manager-e2e", phase: "Manager E2E", schema: RESULT_SCHEMA },
);

phase("Gateway E2E");
const gateway = await agent(
  `${CTX}

## Gateway E2E — policy, MCP, channel, metrics

Checks:
1. cargo test condition_match mcp channel metrics (or all cargo test if filters awkward).
2. Start gateway if possible on :10255 and hit /metrics. If already running, curl /metrics.
3. Verify metrics output contains agent_trust_gateway_.
4. Verify app blocklist contains registry.npmjs.org, pypi.org, files.pythonhosted.org, crates.io, cdn.jsdelivr.net.
5. If live proxy is running, test direct registry host through proxy returns 403. If not, mark live proxy as PARTIAL.

REAL only if tests pass and /metrics is reachable. PARTIAL if tests pass but live gateway is not running.
Return structured result.`,
  { label: "gateway-e2e", phase: "Gateway E2E", schema: RESULT_SCHEMA },
);

phase("VTI E2E");
const vti = await agent(
  `${CTX}

## VTI E2E — signed VP proof

Checks:
1. VTI mediator livez returns alive.
2. cargo test vti_signer and identity_injection pass.
3. Find any generated/signed VP test output or create a tiny local test command that signs and verifies a payload using the existing vti_signer tests.
4. Confirm no DIY crypto by grep:
~~~bash
grep -rn "createSign\|createVerify\|custom.*sign\|raw.*ed25519" ${REPO}/apps/gateway/src/vti_signer.rs ${REPO}/apps/gateway/src/identity_injection.rs
~~~

REAL only if sign/verify tests pass and grep shows no DIY crypto except comments.
PARTIAL if VP injection is tested but not hit by a live MCP response.
Return structured result.`,
  { label: "vti-e2e", phase: "VTI E2E", schema: RESULT_SCHEMA },
);

phase("Report");
const report = await agent(
  `${CTX}

## E2E Report

Results:
Preflight: ${JSON.stringify(preflight)}
Employee: ${JSON.stringify(employee)}
Cyber: ${JSON.stringify(cyber)}
Manager: ${JSON.stringify(manager)}
Gateway: ${JSON.stringify(gateway)}
VTI: ${JSON.stringify(vti)}

Write a report to:
1. ~/brain/projects/onecomputer-e2e-result.md
2. Append a concise "Phase E2E" section to ${REPO}/STATE.md

Report format:
- Overall verdict: REAL/PARTIAL/FAIL
- Table per area with verdict, proof, issues
- Updated readiness estimate (prototype/demo, controlled pilot, production)
- Top 5 blockers in priority order

Then:
~~~bash
pkill -f "gbrain serve"; sleep 1
gbrain import ~/brain/ && gbrain embed --stale
~~~
Return: report path, overall verdict, blocker list.`,
  { label: "report", phase: "Report" },
);

return { preflight, employee, cyber, manager, gateway, vti, report };
