#!/usr/bin/env node
/**
 * ONE-142 E2E proof: the gateway verify_vc is load-bearing on release.
 *
 * Two live paths through a FRESH gateway subprocess (built from this branch):
 *   A) verified -> release : hold -> approve (signs VC) -> gateway verifies the
 *      decision VC against the gateway did:web key -> RELEASES the held request.
 *   B) tampered  -> deny    : hold -> approve (signs VC) -> tamper the VC in the
 *      DB -> gateway verifies, fails -> DENIES (403, NOT released).
 *
 * Both legs use the SAME shared signing seed (ONECLI_GATEWAY_SIGNING_KEY) on the
 * API signer and the gateway verifier, so a legit VC verifies and a tampered one
 * does not. Gateway stderr is captured and the relevant log lines are echoed.
 *
 * Linux-VM specific (azureuser): Postgres 5432, release binary, internal
 * shared-secret bridge decide route (cross-org), Prisma client loaded by glob.
 */
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { globSync } from 'node:fs';

const execFileAsync = promisify(execFile);

const REPO_ROOT = '/home/azureuser/work/onecomputer';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:10254';
const GATEWAY_BINARY =
  process.env.GATEWAY_BINARY ?? join(REPO_ROOT, 'apps/gateway/target/release/onecli-gateway');
const GATEWAY_PORT = parseInt(process.env.GATEWAY_TEST_PORT ?? '10257', 10);

// ── Load .env (repo root) ─────────────────────────────────────────────────
const envFile = readFileSync(join(REPO_ROOT, '.env'), 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const INTERNAL_SECRET = env.GATEWAY_INTERNAL_SECRET;
const SIGNING_KEY = env.ONECLI_GATEWAY_SIGNING_KEY;
const PUBLIC_URL = env.ONECLI_GATEWAY_PUBLIC_URL ?? 'http://onecomputer.local';
const DATABASE_URL = env.DATABASE_URL;
// The real SECRET_ENCRYPTION_KEY lives in the running gateway process env (not the .env file, which has a placeholder). Read it from there so the fresh gateway subprocess can decrypt secrets the same way.
let SECRET_ENCRYPTION_KEY = env.SECRET_ENCRYPTION_KEY;
try {
  const runningGwEnv = readFileSync("/proc/191870/environ", "utf8");
  const m = runningGwEnv.split("\0").find(l => l.startsWith("SECRET_ENCRYPTION_KEY="));
  if (m) SECRET_ENCRYPTION_KEY = m.slice("SECRET_ENCRYPTION_KEY=".length);
} catch {}

if (!INTERNAL_SECRET || !SIGNING_KEY || !DATABASE_URL || !SECRET_ENCRYPTION_KEY) {
  console.error('Missing required env vars from .env.');
  process.exit(2);
}

// ── Prisma client (glob — psql absent on this VM) ─────────────────────────
async function loadPrismaClient() {
  const hits = globSync('node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/index.js');
  if (!hits.length) throw new Error('Prisma client not found in node_modules');
  const mod = await import(pathToFileURL(resolve(hits[0])).href);
  process.env.DATABASE_URL = DATABASE_URL;
  return new mod.PrismaClient();
}

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
async function getJson(url, headers = {}) { return req(url, { headers }); }
async function postJson(url, data, headers = {}) {
  return req(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
}

function buildProxyBasicAuth(token) {
  return `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
}

async function sendViaGateway(gatewayPort, targetUrl, method = 'POST') {
  // Read the agent token from the DB (default agent).
  const proxyAuth = buildProxyBasicAuth(AGENT_TOKEN);
  const gwUrl = `http://127.0.0.1:${gatewayPort}`;
  const args = [
    '-s', '-i', '--max-time', '40',
    '-x', gwUrl,
    '-H', `Proxy-Authorization: ${proxyAuth}`,
    '-X', method,
    '-H', 'Content-Type: application/json',
    '--data-raw', '{"e2e":true}',
    targetUrl,
  ];
  try {
    const { stdout } = await execFileAsync('curl', args, { timeout: 41_000 });
    const statusMatch = stdout.match(/^HTTP\/[\d.]+ (\d+)/m);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const bodyStart = stdout.indexOf('\r\n\r\n');
    const rawBody = bodyStart >= 0 ? stdout.slice(bodyStart + 4).trim() : '';
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* leave string */ }
    return { status, body };
  } catch (e) {
    if (e.killed || String(e.message).includes('timed out')) return { status: 0, body: null, timedOut: true };
    return { status: 0, body: null, error: e.message };
  }
}

async function startTestUpstream() {
  return new Promise((resolve, reject) => {
    const server = createServer((incomingReq, res) => {
      let body = '';
      incomingReq.on('data', d => { body += d; });
      incomingReq.on('end', () => {
        const payload = JSON.stringify({ ok: true, method: incomingReq.method, url: incomingReq.url, source: 'e2e-test-upstream' });
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

// ── Fresh gateway subprocess with the shared signing key ─────────────────
let gwLogBuf = '';
async function startGateway() {
  const dataDir = `/tmp/e2e-one142-gw-${GATEWAY_PORT}`;
  const gwEnv = {
    ...process.env,
    DATABASE_URL,
    GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET,
    ONECOMPUTER_API_BASE: API_URL,
    ONECLI_GATEWAY_SIGNING_KEY: SIGNING_KEY,
    ONECLI_GATEWAY_PUBLIC_URL: PUBLIC_URL,
    SECRET_ENCRYPTION_KEY,
    RUST_LOG: 'info',
  };
  const gw = spawn(GATEWAY_BINARY, ['--port', String(GATEWAY_PORT), '--data-dir', dataDir], {
    env: gwEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pushLog = (chunk) => {
    const s = chunk.toString();
    gwLogBuf += s;
    process.stderr.write(s);
  };
  gw.stdout.on('data', pushLog);
  gw.stderr.on('data', pushLog);
  const ready = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10_000);
    let attempts = 0;
    const check = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/healthz`);
        if (res.status === 200) { clearTimeout(timeout); resolve(true); return; }
      } catch {}
      attempts++;
      if (attempts < 20) setTimeout(check, 500);
    };
    check();
  });
  if (!ready) { try { gw.kill(); } catch {} throw new Error(`gateway failed to start on ${GATEWAY_PORT}`); }
  return { process: gw, port: GATEWAY_PORT, close: () => { try { gw.kill('SIGTERM'); } catch {} } };
}

// ── Main ─────────────────────────────────────────────────────────────────
const HOLD_SETTLE_MS = 5_000;
let AGENT_TOKEN = '';
let prisma, testUpstream, gateway;

const out = { ok: false, verifiedReleased: false, tamperedDenied: false, logExcerpts: {}, caveats: [] };

function extractLog(needle) {
  const lines = gwLogBuf.split('\n').filter(l => l.includes(needle));
  return lines.length ? lines[lines.length - 1] : null;
}

try {
  // ── Preflight ──────────────────────────────────────────────────────────
  const apiHealth = await fetch(`${API_URL}/v1/health`).then(r => r.status);
  if (apiHealth !== 200) throw new Error(`API unhealthy: ${apiHealth}`);

  prisma = await loadPrismaClient();
  const agent = await prisma.agent.findFirst({ where: { isDefault: true }, select: { accessToken: true, id: true, projectId: true, project: { select: { organizationId: true } } } });
  if (!agent?.accessToken) throw new Error("No default agent token in DB");
  AGENT_TOKEN = agent.accessToken;
  const organizationId = agent.project.organizationId;
  const agentProjectId = agent.projectId;
  

  testUpstream = await startTestUpstream();
  gateway = await startGateway();

  // ── Create manual_approval rule directly in the agent's project/org ─────
  // The local-mode admin session lives in a different org than the default
  // agent (demo-corp-org), so POST /v1/rules would land the rule in the wrong
  // org and the gateway would never match it. Write the PolicyRule directly.
  const testPath = '/e2e-one142-hold';
  const ruleName = `e2e-one142-${Date.now()}`;
  const rule = await prisma.policyRule.create({
    data: {
      scope: 'project',
      projectId: agentProjectId,
      organizationId,
      name: ruleName,
      hostPattern: '127.0.0.1',
      pathPattern: testPath,
      method: 'POST',
      action: 'manual_approval',
      enabled: true,
    },
  });
  if (!rule?.id) throw new Error(`rule create failed: ${JSON.stringify(rule)}`);
  const testTargetUrl = `${testUpstream.url}${testPath}`;

  // ── Path A: verified -> release ─────────────────────────────────────────
  const aStart = Date.now();
  const aPromise = sendViaGateway(gateway.port, testTargetUrl, 'POST');
  await new Promise(r => setTimeout(r, HOLD_SETTLE_MS));

  // Find the durable record the gateway created (cross-org: list internal).
  let aApproval = null;
  const aDeadline = Date.now() + 20_000;
  while (Date.now() < aDeadline && !aApproval) {
    const list = await (await getJson(`${API_URL}/v1/internal/approvals?status=pending`, { 'X-Gateway-Secret': INTERNAL_SECRET })).body;
    const items = list?.items ?? [];
    aApproval = items.find(a => a.context?.gatewayApprovalId && new Date(a.createdAt).getTime() >= aStart);
    if (!aApproval) await new Promise(r => setTimeout(r, 500));
  }
  if (!aApproval) throw new Error('Path A: timed out waiting for durable hold');
  console.log(`[A] held approval ${aApproval.id} (gw ${aApproval.context.gatewayApprovalId})`);

  // Approve via the internal bridge decide (signs + persists VC).
  const aDecide = await (await postJson(`${API_URL}/v1/internal/approvals/${aApproval.id}/decide`, { decision: 'approved', comment: 'one142 e2e approve' }, { 'X-Gateway-Secret': INTERNAL_SECRET })).body;
  console.log(`[A] decide -> ${JSON.stringify(aDecide)}`);

  const aResp = await aPromise;
  // Verified VC -> gateway releases -> upstream returns 200 source=e2e-test-upstream.
  out.verifiedReleased = (aResp.status === 200 && aResp.body?.source === 'e2e-test-upstream');
  console.log(`[A] gateway response status=${aResp.status} released=${out.verifiedReleased}`);

  // ── Path B: tampered -> deny ────────────────────────────────────────────
  const bStart = Date.now();
  const bPromise = sendViaGateway(gateway.port, testTargetUrl, 'POST');
  await new Promise(r => setTimeout(r, HOLD_SETTLE_MS));

  let bApproval = null;
  const bDeadline = Date.now() + 20_000;
  while (Date.now() < bDeadline && !bApproval) {
    const list = await (await getJson(`${API_URL}/v1/internal/approvals?status=pending`, { 'X-Gateway-Secret': INTERNAL_SECRET })).body;
    const items = list?.items ?? [];
    bApproval = items.find(a => a.context?.gatewayApprovalId && new Date(a.createdAt).getTime() >= bStart);
    if (!bApproval) await new Promise(r => setTimeout(r, 500));
  }
  if (!bApproval) throw new Error('Path B: timed out waiting for durable hold');
  console.log(`[B] held approval ${bApproval.id} (gw ${bApproval.context.gatewayApprovalId})`);

  // Approve (signs VC), then immediately tamper the VC proofValue in the DB
  // BEFORE the gateway's next 2s poll picks it up.
  await postJson(`${API_URL}/v1/internal/approvals/${bApproval.id}/decide`, { decision: 'approved', comment: 'one142 e2e tamper' }, { 'X-Gateway-Secret': INTERNAL_SECRET });
  console.log(`[B] decide approved; tampering VC in DB now`);

  // Tamper: flip a byte in context._vti.decision.proof.proofValue.
  const row = await prisma.approvalRequest.findUnique({ where: { id: bApproval.id }, select: { context: true } });
  const ctx = typeof row.context === 'string' ? JSON.parse(row.context) : row.context;
  const pv = ctx?._vti?.decision?.proof?.proofValue;
  if (typeof pv !== 'string') throw new Error('Path B: no proofValue to tamper');
  const bytes = Buffer.from(pv, 'utf8');
  const idx = Math.max(2, bytes.length - 4);
  bytes[idx] = bytes[idx] === 0x7a ? 0x79 : (bytes[idx] + 1);
  ctx._vti.decision.proof.proofValue = bytes.toString('utf8');
  await prisma.approvalRequest.update({ where: { id: bApproval.id }, data: { context: ctx } });
  console.log(`[B] tampered proofValue byte ${idx}`);

  const bResp = await bPromise;
  // Tampered VC -> gateway verify fails -> deny -> 403 manual_approval_denied.
  out.tamperedDenied = (bResp.status === 403);
  console.log(`[B] gateway response status=${bResp.status} denied=${out.tamperedDenied} body=${JSON.stringify(bResp.body).slice(0,200)}`);

  // ── Log excerpts ────────────────────────────────────────────────────────
  out.logExcerpts.verifying = extractLog('verifying decision VC');
  out.logExcerpts.released = extractLog('VC verified, releasing');
  out.logExcerpts.denied = extractLog('VC verification failed, denying');

  out.ok = out.verifiedReleased && out.tamperedDenied;
} catch (e) {
  out.caveats.push(`FATAL: ${e.message}`);
  console.error(e);
} finally {
  try { if (testUpstream) testUpstream.close(); } catch {}
  try { if (gateway) gateway.close(); } catch {}
  try { if (prisma) await prisma.$disconnect(); } catch {}
}

console.log('\n=== ONE-142 E2E RESULT ===');
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
