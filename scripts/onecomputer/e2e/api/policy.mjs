#!/usr/bin/env node
// POLICY-01..07: rule CRUD, validation, project scoping, internal manual-approval ingest.
//
// Usage: node scripts/onecomputer/e2e/api/policy.mjs

import {
  get, post, patch, del, API_URL,
  gatewaySecretHeaders, projectHeader, getSession, DEMO_PROJECT_ID,
} from '../lib/api-client.mjs';
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

export async function runArea({ resetDemoFirst = true } = {}) {
  const results = [];
  let createdRuleId = null;

  // POLICY-01: create allow rule, appears in list
  try {
    const { body: rule } = await post(`${API_URL}/v1/rules`, {
      name: `e2e-allow-${Date.now()}`,
      hostPattern: 'example.com',
      action: 'allow',
      enabled: true,
    });
    createdRuleId = rule.id;
    const { body: list } = await get(`${API_URL}/v1/rules`);
    const ok = Array.isArray(list) && list.some(r => r.id === rule.id);
    results.push({ id: 'POLICY-01', status: ok ? 'pass' : 'fail', evidence: `ruleId=${rule.id}` });
  } catch (e) {
    results.push({ id: 'POLICY-01', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-02: create block rule, get by id
  let blockRuleId = null;
  try {
    const { body: rule } = await post(`${API_URL}/v1/rules`, {
      name: `e2e-block-${Date.now()}`,
      hostPattern: 'registry.npmjs.org',
      action: 'block',
      enabled: true,
    });
    blockRuleId = rule.id;
    const { body: fetched } = await get(`${API_URL}/v1/rules/${rule.id}`);
    const ok = fetched.id === rule.id && fetched.action === 'block';
    results.push({ id: 'POLICY-02', status: ok ? 'pass' : 'fail', evidence: `ruleId=${rule.id}` });
  } catch (e) {
    results.push({ id: 'POLICY-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-03: rate_limit rule missing rateLimit fields -> 400
  try {
    const { status } = await post(`${API_URL}/v1/rules`, {
      name: `e2e-ratelimit-bad-${Date.now()}`,
      hostPattern: 'example.com',
      action: 'rate_limit',
      enabled: true,
    }, {}, true);
    results.push({ id: 'POLICY-03', status: status === 400 ? 'pass' : 'fail', evidence: `status=${status}` });
  } catch (e) {
    results.push({ id: 'POLICY-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-04: PATCH enabled:false on POLICY-01's rule
  try {
    if (!createdRuleId) throw new Error('no rule from POLICY-01 to patch');
    await patch(`${API_URL}/v1/rules/${createdRuleId}`, { enabled: false });
    const { body: fetched } = await get(`${API_URL}/v1/rules/${createdRuleId}`);
    const ok = fetched.enabled === false;
    results.push({ id: 'POLICY-04', status: ok ? 'pass' : 'fail', evidence: `enabled=${fetched.enabled}` });
  } catch (e) {
    results.push({ id: 'POLICY-04', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-05: DELETE the block rule, subsequent GET -> 404
  try {
    if (!blockRuleId) throw new Error('no rule from POLICY-02 to delete');
    await del(`${API_URL}/v1/rules/${blockRuleId}`);
    const { status } = await get(`${API_URL}/v1/rules/${blockRuleId}`, {}, true);
    results.push({ id: 'POLICY-05', status: status === 404 ? 'pass' : 'fail', evidence: `status=${status}` });
  } catch (e) {
    results.push({ id: 'POLICY-05', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-06: demo-corp project scoping via X-Project-Id
  try {
    if (resetDemoFirst) {
      const didReset = await resetDemo();
      if (!didReset) throw new Error('demo reset unreachable/failed');
    }
    const { body: demoRule } = await post(`${API_URL}/v1/rules`, {
      name: `e2e-demo-scoped-${Date.now()}`,
      hostPattern: 'graph.microsoft.com',
      pathPattern: '/v1.0/me/sendMail',
      method: 'POST',
      action: 'manual_approval',
      enabled: true,
    }, projectHeader(DEMO_PROJECT_ID));
    const { body: defaultList } = await get(`${API_URL}/v1/rules`);
    const { body: demoList } = await get(`${API_URL}/v1/rules`, projectHeader(DEMO_PROJECT_ID));
    const visibleInDemo = Array.isArray(demoList) && demoList.some(r => r.id === demoRule.id);
    const absentInDefault = Array.isArray(defaultList) && !defaultList.some(r => r.id === demoRule.id);
    const ok = visibleInDemo && absentInDefault;
    results.push({
      id: 'POLICY-06',
      status: ok ? 'pass' : 'fail',
      evidence: `ruleId=${demoRule.id} visibleInDemo=${visibleInDemo} absentInDefault=${absentInDefault}`,
    });
  } catch (e) {
    results.push({ id: 'POLICY-06', status: 'blocked', evidence: String(e.message).slice(0, 200) });
  }

  // POLICY-07: internal manual-approval ingest, needs a ruleId + org/project from session
  try {
    const session = await getSession();
    const { body: ruleForIngest } = await post(`${API_URL}/v1/rules`, {
      name: `e2e-manual-approval-${Date.now()}`,
      hostPattern: 'graph.microsoft.com',
      action: 'manual_approval',
      enabled: true,
    });
    const { body: approval } = await post(`${API_URL}/v1/internal/gateway/manual-approval`, {
      organizationId: session.organizationId,
      projectId: session.projectId,
      requestedBy: session.id,
      ruleId: ruleForIngest.id,
      action: 'sendMail',
      host: 'graph.microsoft.com',
      path: '/v1.0/me/sendMail',
      method: 'POST',
    }, gatewaySecretHeaders());
    const ok = !!approval?.id;
    results.push({ id: 'POLICY-07', status: ok ? 'pass' : 'fail', evidence: `approvalId=${approval?.id}` });
  } catch (e) {
    results.push({ id: 'POLICY-07', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
