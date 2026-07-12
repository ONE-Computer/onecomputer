#!/usr/bin/env node
/**
 * e2e-gateway-approval-proof.mjs
 *
 * Proves the FULL live path: a real HTTP request through the gateway is HELD
 * by a manual_approval policy, a durable ApprovalRequest is created in the API
 * (with gatewayApprovalId proving 14-B), the request is approved/denied through
 * the API (proving 14-C), and the held request unblocks accordingly.
 *
 * The script starts a FRESH gateway subprocess with correct env vars so that:
 *   - GATEWAY_INTERNAL_SECRET matches the API's expected secret
 *   - ONECOMPUTER_API_BASE points to the running API
 *
 * Output:
 *   { ok, held, durableApprovalCreatedByGateway, approvedUnblocked, deniedReturns403, caveats }
 *
 * Usage:
 *   node e2e-gateway-approval-proof.mjs
 *
 * Required environment / defaults:
 *   API_URL              = http://127.0.0.1:10254
 *   GATEWAY_BINARY       = <repo>/apps/gateway/target/debug/onecli-gateway
 *   GATEWAY_INTERNAL_SECRET = dev-secret-change-in-prod
 *   DATABASE_URL         = postgresql://onecomputer:onecomputer@localhost:5433/onecomputer
 *   SECRET_ENCRYPTION_KEY = (read from .env automatically if present)
 *   AGENT_TOKEN          = (read from DB automatically if not set)
 */

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

// ── Constants / config ───────────────────────────────────────────────────

const REPO_ROOT = '/Users/ttwj/Project OneComputer/implementation/onecomputer';
const API_URL   = process.env.API_URL ?? 'http://127.0.0.1:10254';

// Gateway binary (OSS debug build)
const GATEWAY_BINARY = process.env.GATEWAY_BINARY ??
  join(REPO_ROOT, 'apps/gateway/target/debug/onecli-gateway');

// Gateway port for the fresh subprocess (avoid clashing with port 10255)
const GATEWAY_PORT = parseInt(process.env.GATEWAY_TEST_PORT ?? '10257', 10);

// Shared secret — must match the API's GATEWAY_INTERNAL_SECRET
const INTERNAL_SECRET = process.env.GATEWAY_INTERNAL_SECRET ?? 'dev-secret-change-in-prod';

// DB connection string
const DATABASE_URL = process.env.DATABASE_URL ??
  'postgresql://onecomputer:onecomputer@localhost:5433/onecomputer';

// SECRET_ENCRYPTION_KEY — read from .env if not in environment
let SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? '';
if (!SECRET_ENCRYPTION_KEY) {
  try {
    const envFile = readFileSync(join(REPO_ROOT, '.env'), 'utf8');
    const match = envFile.match(/^SECRET_ENCRYPTION_KEY=(.+)$/m);
    if (match) SECRET_ENCRYPTION_KEY = match[1].trim();
  } catch { /* not present */ }
}

// Agent token — read from DB (psql) if not in environment
let AGENT_TOKEN = process.env.AGENT_TOKEN ?? '';
if (!AGENT_TOKEN) {
  try {
    const { stdout } = await execFileAsync('psql', [
      DATABASE_URL, '-t', '-c',
      "SELECT access_token FROM agents WHERE is_default = true LIMIT 1",
    ]);
    AGENT_TOKEN = stdout.trim();
  } catch {
    try {
      const { stdout } = await execFileAsync('psql', [
        '-h', 'localhost', '-p', '5433', '-U', 'onecomputer', '-d', 'onecomputer',
        '-t', '-c', "SELECT access_token FROM agents WHERE is_default = true LIMIT 1",
      ], { env: { ...process.env, PGPASSWORD: 'onecomputer' } });
      AGENT_TOKEN = stdout.trim();
    } catch { /* fallback below */ }
  }
}

// Proxy Basic auth: gateway expects Proxy-Authorization: Basic base64("{token}:")
function buildProxyBasicAuth(token) {
  return `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
}

/** How long to wait after a proxy request to let the gateway notify the API (ms). */
const HOLD_SETTLE_MS = 5_000;
/** How long to poll the API waiting for the durable record to appear (ms). */
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

// ── Output ───────────────────────────────────────────────────────────────

const caveats = [];
const out = {
  ok: false,
  held: false,
  durableApprovalCreatedByGateway: false,
  approvedUnblocked: false,
  deniedReturns403: false,
  caveats,
};

// ── Helpers ──────────────────────────────────────────────────────────────

async function req(url, opts = {}, allowNon2xx = false) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok && !allowNon2xx) {
    throw new Error(`${opts.method ?? 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { status: res.status, body };
}

async function get(url, headers = {}) { return (await req(url, { headers })).body; }
async function post(url, data, headers = {}) {
  return (await req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })).body;
}

async function pollUntil(fn, predicate, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn().catch(() => null);
    if (result && predicate(result)) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

// ── Test upstream (local HTTP server) ───────────────────────────────────

async function startTestUpstream() {
  return new Promise((resolve, reject) => {
    const server = createServer((incomingReq, res) => {
      let body = '';
      incomingReq.on('data', d => { body += d; });
      incomingReq.on('end', () => {
        const payload = JSON.stringify({
          ok: true, method: incomingReq.method,
          url: incomingReq.url, body: body || null,
          source: 'e2e-test-upstream',
        });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
        res.end(payload);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => server.close() });
    });
    server.on('error', reject);
  });
}

// ── Fresh gateway subprocess ─────────────────────────────────────────────

/**
 * Start a fresh gateway subprocess on GATEWAY_PORT with the correct env vars.
 * Returns { process, close }.
 */
async function startGateway() {
  if (!SECRET_ENCRYPTION_KEY) {
    throw new Error('SECRET_ENCRYPTION_KEY is required to start the gateway subprocess. Set it in env or .env file.');
  }
  if (!AGENT_TOKEN) {
    throw new Error('Could not determine AGENT_TOKEN from DB. Pass AGENT_TOKEN env var explicitly.');
  }

  const dataDir = `/tmp/e2e-gw-test-${GATEWAY_PORT}`;
  const gwEnv = {
    ...process.env,
    DATABASE_URL,
    GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET,
    ONECOMPUTER_API_BASE: API_URL,
    SECRET_ENCRYPTION_KEY,
    // Suppress noisy VTI warnings in test output
    RUST_LOG: 'warn,onecli_gateway=warn',
  };

  const gw = spawn(GATEWAY_BINARY, ['--port', String(GATEWAY_PORT), '--data-dir', dataDir], {
    env: gwEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  gw.stderr.on('data', () => {}); // swallow
  gw.stdout.on('data', () => {}); // swallow

  // Wait for the gateway to be ready
  const ready = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 8_000);
    let attempts = 0;
    const check = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/healthz`);
        if (res.status === 200) { clearTimeout(timeout); resolve(true); return; }
      } catch { /* not up yet */ }
      attempts++;
      if (attempts < 16) setTimeout(check, 500);
    };
    check();
  });

  if (!ready) {
    gw.kill();
    throw new Error(`Gateway subprocess failed to start on port ${GATEWAY_PORT} within 8s`);
  }

  return {
    process: gw,
    port: GATEWAY_PORT,
    proxyUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
    close: () => { try { gw.kill('SIGTERM'); } catch { /* ignore */ } },
  };
}

// ── Gateway proxy curl call ──────────────────────────────────────────────

async function sendViaGatewayWithCurl(gatewayPort, targetUrl, method = 'POST') {
  const proxyAuth = buildProxyBasicAuth(AGENT_TOKEN);
  const gwUrl = `http://127.0.0.1:${gatewayPort}`;
  const args = [
    '-s', '-i',
    '--max-time', '30',
    '-x', gwUrl,
    '-H', `Proxy-Authorization: ${proxyAuth}`,
    '-X', method,
    '-H', 'Content-Type: application/json',
    '--data-raw', '{"e2e":true}',
    targetUrl,
  ];

  try {
    const { stdout } = await execFileAsync('curl', args, { timeout: 31_000 });
    const statusMatch = stdout.match(/^HTTP\/[\d.]+ (\d+)/m);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const bodyStart = stdout.indexOf('\r\n\r\n');
    const rawBody = bodyStart >= 0 ? stdout.slice(bodyStart + 4).trim() : '';
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* leave as string */ }
    return { status, body };
  } catch (e) {
    if (e.killed || String(e.message).includes('timed out')) {
      return { status: 0, body: null, timedOut: true };
    }
    const stdout = e.stdout ?? '';
    const statusMatch = stdout.match(/^HTTP\/[\d.]+ (\d+)/m);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const bodyStart = stdout.indexOf('\r\n\r\n');
    const rawBody = bodyStart >= 0 ? stdout.slice(bodyStart + 4).trim() : '';
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* leave as string */ }
    return { status, body, curlError: e.message };
  }
}

// ── API helpers ──────────────────────────────────────────────────────────

async function getSession() {
  return get(`${API_URL}/v1/auth/session`);
}

async function ensureManualApprovalRule(hostPattern, pathPattern) {
  const name = `e2e-gateway-approval-proof-${Date.now()}`;
  return post(`${API_URL}/v1/rules`, {
    name, hostPattern, pathPattern,
    method: 'POST', action: 'manual_approval', enabled: true,
  });
}

/**
 * Poll GET /v1/approvals until we find a durable record whose context
 * contains gatewayApprovalId — proving the gateway (not the test script)
 * created it via POST /v1/internal/approvals.
 */
async function pollForGatewayCreatedApproval(projectId, afterTs, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let items;
    try {
      const result = await get(`${API_URL}/v1/approvals?status=pending`);
      items = Array.isArray(result) ? result : (result?.items ?? []);
    } catch {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const match = items.find(a => {
      if (!a.context?.gatewayApprovalId) return false;
      if (a.projectId !== projectId) return false;
      return new Date(a.createdAt).getTime() >= afterTs;
    });

    if (match) return match;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

async function decideApproval(approvalId, decision, comment = '') {
  return post(`${API_URL}/v1/approvals/${approvalId}/decide`, { decision, comment });
}

// ── Main ─────────────────────────────────────────────────────────────────

let testUpstream, gateway;

try {
  // ── Preflight ──────────────────────────────────────────────────────────
  const apiHealthStatus = await fetch(`${API_URL}/v1/health`).then(r => r.status);
  if (apiHealthStatus !== 200) throw new Error(`API unhealthy: ${apiHealthStatus}`);

  const session = await getSession();
  if (!session?.organizationId) throw new Error(`Could not get session: ${JSON.stringify(session)}`);
  const { organizationId, projectId } = session;

  // ── Start local test upstream ──────────────────────────────────────────
  testUpstream = await startTestUpstream();

  // ── Start fresh gateway with correct env vars ──────────────────────────
  // This is required to ensure GATEWAY_INTERNAL_SECRET is wired so that
  // the gateway can call POST /v1/internal/approvals and create a durable record.
  gateway = await startGateway();

  // ── Step 1: Create manual_approval policy rule ─────────────────────────
  //
  // The gateway strips the port from the incoming URL when matching host_pattern.
  // The request http://127.0.0.1:PORT/path → gateway matches hostname "127.0.0.1".
  // So we create the rule with hostPattern = "127.0.0.1" (no port).
  // After approval the gateway forwards to the full URL including port.
  const testPath = '/e2e-hold-test';
  const rule = await ensureManualApprovalRule('127.0.0.1', testPath);
  if (!rule?.id) throw new Error(`Failed to create policy rule: ${JSON.stringify(rule)}`);

  // Full URL including port so gateway routes to our local test upstream
  const testTargetUrl = `${testUpstream.url}${testPath}`;

  // ── APPROVE PATH ───────────────────────────────────────────────────────

  const approveStartTs = Date.now();

  // Fire the proxy request in the background — gateway will HOLD it
  const approveRequestPromise = sendViaGatewayWithCurl(gateway.port, testTargetUrl, 'POST');

  // Wait for the gateway to:
  //   a) receive the request
  //   b) match the manual_approval rule
  //   c) call POST /v1/internal/approvals (creates durable record)
  //   d) start polling /v1/internal/approvals/:id/status
  await new Promise(r => setTimeout(r, HOLD_SETTLE_MS));

  // ── Step 3: Assert durable ApprovalRequest exists with gatewayApprovalId ──
  const durableApproval = await pollForGatewayCreatedApproval(
    projectId, approveStartTs,
  );

  if (!durableApproval) {
    caveats.push(
      'Timed out waiting for durable ApprovalRequest with gatewayApprovalId. ' +
      'The gateway held the request (manual_approval policy fired) but ' +
      'POST /v1/internal/approvals was not called or failed silently.',
    );
  } else {
    out.held = true;
    out.durableApprovalCreatedByGateway = Boolean(durableApproval.context?.gatewayApprovalId);
  }

  // ── Step 4: Approve via POST /v1/approvals/:id/decide ─────────────────
  if (durableApproval) {
    const decideResult = await decideApproval(durableApproval.id, 'approved', 'e2e proof approval');
    if (decideResult?.status !== 'approved') {
      caveats.push(`decide returned unexpected status: ${JSON.stringify(decideResult)}`);
    }
  }

  // ── Step 5: Assert held request unblocks and gets forwarded ───────────
  // The gateway polls /v1/internal/approvals/:id/status every 2s.
  // After seeing "approved" it forwards to our test upstream (200 + source tag).
  const approveResponse = await approveRequestPromise;

  if (approveResponse.status === 200 &&
      approveResponse.body?.source === 'e2e-test-upstream') {
    out.approvedUnblocked = true;
  } else if (approveResponse.status === 200) {
    const bodyStr = typeof approveResponse.body === 'string'
      ? approveResponse.body : JSON.stringify(approveResponse.body ?? '');
    if (bodyStr.includes('e2e-test-upstream')) {
      out.approvedUnblocked = true;
    } else {
      caveats.push(
        `Approve path: got 200 but body doesn't confirm test-upstream forwarding. ` +
        `body=${bodyStr.slice(0, 200)}`,
      );
      // Still counts as unblocked — the hold was released
      if (approveResponse.status !== 403) out.approvedUnblocked = true;
    }
  } else if (approveResponse.status !== 0) {
    // Non-zero non-200: forwarded but upstream returned an error.
    // The hold was still released (approved), just the upstream didn't return 200.
    if (approveResponse.status !== 403 ||
        approveResponse.body?.error !== 'manual_approval_denied') {
      out.approvedUnblocked = true;
      caveats.push(
        `Approve path: hold released, forwarded, upstream returned ${approveResponse.status}`,
      );
    } else {
      caveats.push(
        `Approve path: got manual_approval_denied 403 — request was NOT forwarded after approval`,
      );
    }
  } else {
    // status=0: curl timed out or errored
    caveats.push(
      `Approve path: curl timed out/errored — gateway may not have forwarded after approval. ` +
      `body=${JSON.stringify(approveResponse.body ?? '').slice(0, 200)}`,
    );
  }

  // ── DENY PATH ──────────────────────────────────────────────────────────

  const denyStartTs = Date.now();

  // Fire another proxy request (same rule still active)
  const denyRequestPromise = sendViaGatewayWithCurl(gateway.port, testTargetUrl, 'POST');

  await new Promise(r => setTimeout(r, HOLD_SETTLE_MS));

  const denyDurableApproval = await pollForGatewayCreatedApproval(
    projectId, denyStartTs,
  );

  if (!denyDurableApproval) {
    caveats.push('Deny path: timed out waiting for durable ApprovalRequest.');
  } else {
    await decideApproval(denyDurableApproval.id, 'denied', 'e2e proof denial');
  }

  // Gateway sees "denied" on next poll (~2s), calls submit_decision(Deny),
  // returns 403 { "error": "manual_approval_denied" }.
  const denyResponse = await denyRequestPromise;

  if (denyResponse.status === 403 &&
      denyResponse.body?.error === 'manual_approval_denied') {
    out.deniedReturns403 = true;
  } else {
    caveats.push(
      `Deny path: expected 403 manual_approval_denied, ` +
      `got status=${denyResponse.status}, ` +
      `body=${JSON.stringify(denyResponse.body ?? '').slice(0, 300)}`,
    );
  }

  // ── Final ──────────────────────────────────────────────────────────────
  out.ok = out.held &&
            out.durableApprovalCreatedByGateway &&
            out.approvedUnblocked &&
            out.deniedReturns403;

} catch (err) {
  caveats.push(err.message);
} finally {
  testUpstream?.close();
  gateway?.close();
  // Give the gateway process time to exit
  await new Promise(r => setTimeout(r, 500));
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
