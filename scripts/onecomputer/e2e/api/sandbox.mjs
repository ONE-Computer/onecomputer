#!/usr/bin/env node
// SANDBOX-01..06: Daytona reachability preflight + sandbox CRUD + exec.
//
// Usage: node scripts/onecomputer/e2e/api/sandbox.mjs

import { get, post, del, API_URL } from '../lib/api-client.mjs';
import { pollUntil } from '../lib/poll.mjs';
import { updateRows } from '../lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from '../lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../../docs/plan/e2e-test-matrix.csv');

const BLOCKED_IDS = ['SANDBOX-02', 'SANDBOX-03', 'SANDBOX-04', 'SANDBOX-05', 'SANDBOX-06'];

export async function runArea() {
  const results = [];

  // SANDBOX-01: preflight — Daytona reachable via the app's own sandbox list
  // endpoint (proves both the control-plane API and the app's client config
  // are working, without hardcoding Daytona's own ports/creds into the test).
  let daytonaUp = false;
  try {
    const { status } = await get(`${API_URL}/v1/sandboxes`, {}, true);
    daytonaUp = status === 200;
    results.push({ id: 'SANDBOX-01', status: daytonaUp ? 'pass' : 'fail', evidence: `status=${status}` });
  } catch (e) {
    results.push({ id: 'SANDBOX-01', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  if (!daytonaUp) {
    for (const id of BLOCKED_IDS) {
      results.push({ id, status: 'blocked', evidence: 'Daytona unreachable (SANDBOX-01 preflight failed)' });
    }
    return results;
  }

  // SANDBOX-02: create sandbox, poll until started
  let sandboxId = null;
  try {
    const name = `e2e-sandbox-${Date.now()}`;
    const { body: sandbox } = await post(`${API_URL}/v1/sandboxes`, { name });
    sandboxId = sandbox.id;
    const final = await pollUntil(
      async () => (await get(`${API_URL}/v1/sandboxes/${sandboxId}`)).body,
      (s) => s.state === 'started' || s.state === 'error',
      60_000,
      2_000,
    );
    const ok = final?.state === 'started';
    results.push({ id: 'SANDBOX-02', status: ok ? 'pass' : 'fail', evidence: `sandboxId=${sandboxId} state=${final?.state}` });
  } catch (e) {
    results.push({ id: 'SANDBOX-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // SANDBOX-03: list includes the created sandbox
  try {
    if (!sandboxId) throw new Error('no sandbox from SANDBOX-02');
    const { body: list } = await get(`${API_URL}/v1/sandboxes`);
    const ok = Array.isArray(list) && list.some(s => s.id === sandboxId);
    results.push({ id: 'SANDBOX-03', status: ok ? 'pass' : 'fail', evidence: `sandboxId=${sandboxId} present=${ok}` });
  } catch (e) {
    results.push({ id: 'SANDBOX-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // SANDBOX-04: get by id matches
  try {
    if (!sandboxId) throw new Error('no sandbox from SANDBOX-02');
    const { body: fetched } = await get(`${API_URL}/v1/sandboxes/${sandboxId}`);
    const ok = fetched?.id === sandboxId;
    results.push({ id: 'SANDBOX-04', status: ok ? 'pass' : 'fail', evidence: `sandboxId=${sandboxId}` });
  } catch (e) {
    results.push({ id: 'SANDBOX-04', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // SANDBOX-05: exec a trivial command
  try {
    if (!sandboxId) throw new Error('no sandbox from SANDBOX-02');
    const { body: result } = await post(`${API_URL}/v1/sandboxes/${sandboxId}/exec`, { command: 'echo hello' });
    const output = JSON.stringify(result);
    const ok = output.includes('hello');
    results.push({ id: 'SANDBOX-05', status: ok ? 'pass' : 'fail', evidence: output.slice(0, 200) });
  } catch (e) {
    results.push({ id: 'SANDBOX-05', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // SANDBOX-06: delete, confirm absent from list. Daytona's control-plane
  // list endpoint can lag a beat behind a DELETE, so poll for absence
  // instead of asserting on a single immediate GET.
  try {
    if (!sandboxId) throw new Error('no sandbox from SANDBOX-02');
    await del(`${API_URL}/v1/sandboxes/${sandboxId}`);
    const absent = await pollUntil(
      async () => (await get(`${API_URL}/v1/sandboxes`)).body,
      (list) => Array.isArray(list) && !list.some(s => s.id === sandboxId),
      15_000,
      1_500,
    );
    const ok = !!absent;
    results.push({ id: 'SANDBOX-06', status: ok ? 'pass' : 'fail', evidence: `deleted sandboxId=${sandboxId}` });
  } catch (e) {
    results.push({ id: 'SANDBOX-06', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
