#!/usr/bin/env node
// AUDIT-01..03: timeline, kind filter, export envelope.
//
// Usage: node scripts/onecomputer/e2e/api/audit.mjs

import { get, API_URL } from '../lib/api-client.mjs';
import { updateRows } from '../lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from '../lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../../docs/plan/e2e-test-matrix.csv');

export async function runArea() {
  const results = [];

  // AUDIT-01: timeline returns entries after prior area scripts ran
  try {
    const { body } = await get(`${API_URL}/v1/audit/timeline?limit=20`);
    const ok = Array.isArray(body?.events) && body.events.length > 0;
    results.push({ id: 'AUDIT-01', status: ok ? 'pass' : 'fail', evidence: `count=${body?.events?.length}` });
  } catch (e) {
    results.push({ id: 'AUDIT-01', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // AUDIT-02: kind=admin filter returns only AuditLog-sourced entries
  try {
    const { body } = await get(`${API_URL}/v1/audit/timeline?kind=admin&limit=20`);
    const events = body?.events ?? [];
    const ok = events.length > 0 && events.every(e => e.kind === 'admin');
    results.push({ id: 'AUDIT-02', status: ok ? 'pass' : 'fail', evidence: `count=${events.length} kinds=${[...new Set(events.map(e => e.kind))].join(',')}` });
  } catch (e) {
    results.push({ id: 'AUDIT-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // AUDIT-03: export envelope has exportedAt/filter/count/events
  try {
    const { body } = await get(`${API_URL}/v1/audit/timeline/export?kind=admin`);
    const ok = !!body?.exportedAt && !!body?.filter && typeof body?.count === 'number' && Array.isArray(body?.events);
    const filterEchoed = body?.filter?.kind === 'admin';
    results.push({
      id: 'AUDIT-03',
      status: ok && filterEchoed ? 'pass' : 'fail',
      evidence: `exportedAt=${body?.exportedAt} count=${body?.count} filterKind=${body?.filter?.kind}`,
    });
  } catch (e) {
    results.push({ id: 'AUDIT-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
