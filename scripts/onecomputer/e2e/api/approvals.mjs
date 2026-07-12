#!/usr/bin/env node
// APPROVAL-01..07: demo seed sanity, summary, create/vti-notification/trigger/
// actor-ack/decide(approve)/decide(deny).
//
// Usage: node scripts/onecomputer/e2e/api/approvals.mjs

import { get, post, API_URL, gatewaySecretHeaders, projectHeader, getSession, DEMO_PROJECT_ID } from '../lib/api-client.mjs';
import { updateRows } from '../lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from '../lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../../docs/plan/e2e-test-matrix.csv');

async function resetDemo() {
  try {
    await post(`${API_URL}/v1/internal/demo/reset`, {}, gatewaySecretHeaders());
    return true;
  } catch {
    return false;
  }
}

export async function runArea() {
  const results = [];
  const session = await getSession();

  // APPROVAL-01: demo-corp seeded pending Outlook approval exists.
  // Same identity-switching limitation as POLICY-06/MEMBER-06 — local-admin
  // cannot list approvals scoped to demo-corp's project via X-Project-Id.
  try {
    const didReset = await resetDemo();
    if (!didReset) throw new Error('demo reset unreachable/failed');
    const { body } = await get(`${API_URL}/v1/approvals?status=pending`, projectHeader(DEMO_PROJECT_ID));
    const items = body?.items ?? [];
    const ok = items.some(a => a.action?.toLowerCase().includes('mail') || a.action?.toLowerCase().includes('outlook'));
    results.push({ id: 'APPROVAL-01', status: ok ? 'pass' : 'fail', evidence: `count=${items.length}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-01', status: 'blocked', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-02: summary reflects >=1 pending (own default project context,
  // not demo — avoids the identity-switch limitation).
  try {
    await post(`${API_URL}/v1/approvals`, {
      action: 'outlook.send_email',
      requestedBy: session.id,
      context: { recipient: 'test@example.test', subject: 'e2e summary seed' },
    });
    const { body: summary } = await get(`${API_URL}/v1/approvals/summary`);
    const ok = (summary?.pending ?? 0) >= 1;
    results.push({ id: 'APPROVAL-02', status: ok ? 'pass' : 'fail', evidence: `pending=${summary?.pending}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-03: create approval, fetch its VTI notification envelope
  let approvalId = null;
  try {
    const { body: approval } = await post(`${API_URL}/v1/approvals`, {
      action: 'outlook.send_email',
      requestedBy: session.id,
      context: { recipient: 'test@example.test', subject: 'e2e vti seed' },
    });
    approvalId = approval.id;
    const { body: notification } = await get(`${API_URL}/v1/approvals/${approvalId}/vti-notification`);
    const ok = !!notification?.stepUpRequest;
    results.push({ id: 'APPROVAL-03', status: ok ? 'pass' : 'fail', evidence: `approvalId=${approvalId}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-04: trigger VTI notification delivery, confirm status transitions
  try {
    if (!approvalId) throw new Error('no approval from APPROVAL-03');
    const before = await get(`${API_URL}/v1/approvals/${approvalId}/vti-notification`);
    const beforeStatus = before.body?.delivery?.status;
    const { body: after } = await post(`${API_URL}/v1/approvals/${approvalId}/vti-notification/trigger`, {});
    const afterStatus = after?.delivery?.status;
    const ok = !!afterStatus && afterStatus !== beforeStatus;
    results.push({ id: 'APPROVAL-04', status: ok ? 'pass' : 'fail', evidence: `before=${beforeStatus} after=${afterStatus}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-04', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-05: actor-ack on own approval request
  try {
    if (!approvalId) throw new Error('no approval from APPROVAL-03');
    const { status, body } = await post(`${API_URL}/v1/approvals/${approvalId}/actor-ack`, {});
    const ok = status === 200 && !!body;
    results.push({ id: 'APPROVAL-05', status: ok ? 'pass' : 'fail', evidence: `status=${status}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-05', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-06: decide(approve) on the APPROVAL-03 approval
  try {
    if (!approvalId) throw new Error('no approval from APPROVAL-03');
    const { body } = await post(`${API_URL}/v1/approvals/${approvalId}/decide`, { decision: 'approved' });
    const ok = body?.status === 'approved';
    results.push({ id: 'APPROVAL-06', status: ok ? 'pass' : 'fail', evidence: `approvalId=${approvalId} status=${body?.status}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-06', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // APPROVAL-07: decide(deny) on a fresh separate approval
  try {
    const { body: approval } = await post(`${API_URL}/v1/approvals`, {
      action: 'outlook.send_email',
      requestedBy: session.id,
      context: { recipient: 'test@example.test', subject: 'e2e deny seed' },
    });
    const { body } = await post(`${API_URL}/v1/approvals/${approval.id}/decide`, { decision: 'denied' });
    const ok = body?.status === 'denied';
    results.push({ id: 'APPROVAL-07', status: ok ? 'pass' : 'fail', evidence: `approvalId=${approval.id} status=${body?.status}` });
  } catch (e) {
    results.push({ id: 'APPROVAL-07', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
