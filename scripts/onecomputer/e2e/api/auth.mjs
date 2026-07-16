#!/usr/bin/env node
// AUTH-01..03: session bootstrap + health preflight.
//
// Usage: node scripts/onecomputer/e2e/api/auth.mjs

import { get, API_URL } from '../lib/api-client.mjs';
import { updateRows } from '../lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from '../lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../../docs/plan/e2e-test-matrix.csv');

export async function runArea() {
  const results = [];

  // AUTH-03: health preflight
  try {
    const { status } = await get(`${API_URL}/v1/health`, {}, true);
    results.push({ id: 'AUTH-03', status: status === 200 ? 'pass' : 'fail', evidence: `status=${status}` });
  } catch (e) {
    results.push({ id: 'AUTH-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // AUTH-01: bare session call
  let session1 = null;
  try {
    const { body } = await get(`${API_URL}/v1/auth/session`);
    session1 = body;
    const ok = !!(body?.id && body?.organizationId && body?.projectId);
    results.push({
      id: 'AUTH-01',
      status: ok ? 'pass' : 'fail',
      evidence: ok ? `userId=${body.id} orgId=${body.organizationId} projectId=${body.projectId}` : JSON.stringify(body).slice(0, 200),
    });
  } catch (e) {
    results.push({ id: 'AUTH-01', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // AUTH-02: idempotency check
  try {
    const { body: session2 } = await get(`${API_URL}/v1/auth/session`);
    const ok = !!session1 &&
      session1.id === session2.id &&
      session1.organizationId === session2.organizationId &&
      session1.projectId === session2.projectId;
    results.push({
      id: 'AUTH-02',
      status: ok ? 'pass' : 'fail',
      evidence: ok ? `stable userId=${session2.id}` : `mismatch: ${JSON.stringify({ session1, session2 }).slice(0, 200)}`,
    });
  } catch (e) {
    results.push({ id: 'AUTH-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
