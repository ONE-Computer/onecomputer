#!/usr/bin/env node
const WEB = process.env.ONECOMPUTER_WEB_URL ?? 'http://127.0.0.1:10254';
const DAYTONA = process.env.DAYTONA_API_URL ?? 'http://127.0.0.1:3000';
const VTI = process.env.VTI_LIVEZ_URL ?? 'http://127.0.0.1:7037/mediator/v1/livez';
const VERDACCIO = process.env.VERDACCIO_URL ?? 'http://127.0.0.1:4873';
const GATEWAY_SECRET = process.env.GATEWAY_INTERNAL_SECRET ?? 'dev-secret-change-in-prod';

const caveats = [];
let sandboxId;
const out = {
  ok: false,
  sandboxStarted: false,
  claudeVersion: null,
  ruleId: null,
  approvalId: null,
  vtiTaskHash: null,
  deliveryStatus: null,
  caveats,
};

async function request(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${opts.method ?? 'GET'} ${url} -> ${res.status}: ${msg}`);
  }
  return body;
}

async function preflight() {
  const checks = [
    ['web', `${WEB}/v1/health`],
    ['daytona', `${DAYTONA}/health`],
    ['vti', VTI],
    ['verdaccio', `${VERDACCIO}/`],
  ];
  for (const [name, url] of checks) {
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`preflight ${name} expected 200, got ${res.status}`);
  }
}

try {
  await preflight();

  const sandbox = await request(`${WEB}/v1/sandboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `goal-workflow-${Date.now()}` }),
  });
  sandboxId = sandbox.id;
  out.sandboxStarted = sandbox.state === 'started';

  const exec = await request(`${WEB}/v1/sandboxes/${sandboxId}/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'export PATH=/home/daytona/.npm-global/bin:$PATH; claude --version' }),
  });
  out.claudeVersion = String(exec.output ?? '').trim() || sandbox.claudeVersion || null;
  if (!/Claude Code/i.test(out.claudeVersion ?? '') && /Claude Code/i.test(sandbox.claudeVersion ?? '')) out.claudeVersion = sandbox.claudeVersion;
  if (!/Claude Code/i.test(out.claudeVersion ?? '')) throw new Error(`claude --version did not contain Claude Code: ${out.claudeVersion}`);

  const session = await request(`${WEB}/v1/auth/session`);

  const rule = await request(`${WEB}/v1/rules`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Goal proof manual approval ${Date.now()}`,
      hostPattern: 'graph.microsoft.com',
      pathPattern: '/v1.0/me/sendMail',
      method: 'POST',
      action: 'manual_approval',
      enabled: true,
    }),
  });
  out.ruleId = rule.id;

  let approval;
  try {
    approval = await request(`${WEB}/v1/internal/gateway/manual-approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-secret': GATEWAY_SECRET },
      body: JSON.stringify({
        organizationId: session.organizationId,
        projectId: session.projectId,
        agentId: 'goal-proof-agent',
        requestedBy: session.id,
        action: 'graph.microsoft.com/v1.0/me/sendMail',
        ruleId: out.ruleId,
        host: 'graph.microsoft.com',
        path: '/v1.0/me/sendMail',
        method: 'POST',
        context: { host: 'graph.microsoft.com', path: '/v1.0/me/sendMail', method: 'POST' },
      }),
    });
  } catch (err) {
    caveats.push(`internal gateway manual-approval path unavailable: ${err.message}`);
    approval = await request(`${WEB}/v1/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'graph.microsoft.com/v1.0/me/sendMail',
        requestedBy: session.id,
        agentId: 'goal-proof-agent',
        projectId: rule.projectId,
        context: { host: 'graph.microsoft.com', path: '/v1.0/me/sendMail', method: 'POST' },
      }),
    });
  }
  out.approvalId = approval.id;

  const notification = await request(`${WEB}/v1/approvals/${out.approvalId}/vti-notification`);
  const stepUp = notification.stepUpRequest;
  if (!stepUp) throw new Error('missing stepUpRequest');
  out.vtiTaskHash = stepUp.taskHash ?? stepUp.task?.hash ?? stepUp.trustTask?.hash ?? stepUp.envelope?.taskHash ?? null;
  if (!out.vtiTaskHash) caveats.push('stepUpRequest exists but task hash field was not found');

  const triggered = await request(`${WEB}/v1/approvals/${out.approvalId}/vti-notification/trigger`, { method: 'POST' });
  out.deliveryStatus = triggered.delivery?.status ?? triggered.status ?? null;
  if (out.deliveryStatus !== 'sent_to_vti_adapter') throw new Error(`unexpected delivery status: ${out.deliveryStatus}`);

  out.ok = out.sandboxStarted && Boolean(out.claudeVersion) && Boolean(out.ruleId) && Boolean(out.approvalId) && Boolean(stepUp) && out.deliveryStatus === 'sent_to_vti_adapter';
} catch (err) {
  caveats.push(err.message);
} finally {
  if (sandboxId) {
    try { await fetch(`${WEB}/v1/sandboxes/${sandboxId}`, { method: 'DELETE' }); }
    catch (err) { caveats.push(`sandbox cleanup failed: ${err.message}`); }
  }
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
