#!/usr/bin/env node
// MEMBER-01..06: list/roles/invite + role-patch/remove (against a throwaway
// DB-seeded member row, since PATCH/DELETE only operate on real
// OrganizationMember rows, never on pending Invitations — there is no
// invite-accept API route in this codebase) + demo-corp seed sanity check.
//
// Usage: node scripts/onecomputer/e2e/api/members.mjs

import { get, post, patch, del, API_URL, gatewaySecretHeaders, projectHeader, getSession, DEMO_PROJECT_ID } from '../lib/api-client.mjs';
import { psqlQuery } from '../lib/db.mjs';
import { updateRows } from '../lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from '../lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../../docs/plan/e2e-test-matrix.csv');

async function seedThrowawayMember(organizationId) {
  const userId = randomUUID();
  const email = `e2e-member-${Date.now()}@example.test`;
  await psqlQuery(
    `INSERT INTO users (id, email, external_auth_id, created_at, updated_at)
     VALUES ('${userId}', '${email}', 'e2e-${userId}', now(), now())`,
  );
  await psqlQuery(
    `INSERT INTO organization_members (organization_id, user_id, user_email, role, created_at)
     VALUES ('${organizationId}', '${userId}', '${email}', 'member', now())`,
  );
  return { userId, email };
}

async function cleanupThrowawayMember(organizationId, userId) {
  await psqlQuery(`DELETE FROM organization_members WHERE organization_id = '${organizationId}' AND user_id = '${userId}'`).catch(() => {});
  await psqlQuery(`DELETE FROM users WHERE id = '${userId}'`).catch(() => {});
}

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

  // MEMBER-01: list members includes bootstrap owner
  try {
    const { body: members } = await get(`${API_URL}/v1/members`);
    const ok = Array.isArray(members) && members.length >= 1;
    results.push({ id: 'MEMBER-01', status: ok ? 'pass' : 'fail', evidence: `count=${members?.length}` });
  } catch (e) {
    results.push({ id: 'MEMBER-01', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // MEMBER-02: role matrix returns expected role keys
  try {
    const { body: matrix } = await get(`${API_URL}/v1/members/roles`);
    const roleKeys = (matrix?.roles ?? []).map(r => r.role);
    const expected = ['owner', 'admin', 'manager', 'member'];
    const ok = expected.every(r => roleKeys.includes(r));
    results.push({ id: 'MEMBER-02', status: ok ? 'pass' : 'fail', evidence: `roles=${roleKeys.join(',')}` });
  } catch (e) {
    results.push({ id: 'MEMBER-02', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // MEMBER-03: invite a new member by email + role
  try {
    const email = `e2e-invite-${Date.now()}@example.test`;
    const { body: invite } = await post(`${API_URL}/v1/members/invite`, { email, role: 'member' });
    const ok = !!invite?.invitationId && invite?.email === email;
    results.push({ id: 'MEMBER-03', status: ok ? 'pass' : 'fail', evidence: `invitationId=${invite?.invitationId}` });
  } catch (e) {
    results.push({ id: 'MEMBER-03', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  // MEMBER-04/05: PATCH role + DELETE against a throwaway DB-seeded member
  // (no invite-accept API route exists to turn MEMBER-03's invite into a
  // real OrganizationMember row).
  let throwaway = null;
  try {
    throwaway = await seedThrowawayMember(session.organizationId);
    const { body: patched } = await patch(`${API_URL}/v1/members/${throwaway.userId}/role`, { role: 'manager' });
    const ok = patched?.role === 'manager';
    results.push({ id: 'MEMBER-04', status: ok ? 'pass' : 'fail', evidence: `userId=${throwaway.userId} role=${patched?.role}` });
  } catch (e) {
    results.push({ id: 'MEMBER-04', status: 'fail', evidence: String(e.message).slice(0, 200) });
  }

  try {
    if (!throwaway) throw new Error('no throwaway member seeded');
    await del(`${API_URL}/v1/members/${throwaway.userId}`);
    const { body: members } = await get(`${API_URL}/v1/members`);
    const ok = Array.isArray(members) && !members.some(m => m.userId === throwaway.userId);
    results.push({ id: 'MEMBER-05', status: ok ? 'pass' : 'fail', evidence: `removed userId=${throwaway.userId}` });
  } catch (e) {
    results.push({ id: 'MEMBER-05', status: 'fail', evidence: String(e.message).slice(0, 200) });
  } finally {
    if (throwaway) await cleanupThrowawayMember(session.organizationId, throwaway.userId);
  }

  // MEMBER-06: demo-corp seed sanity — exactly 4 members at expected roles.
  // Requires acting AS a demo-corp member, which the local session provider
  // cannot do (see POLICY-06 in policy.mjs) — verify via direct DB query
  // instead of the API, since that's the only way to observe demo-corp's
  // member rows without an identity-switch mechanism.
  try {
    const didReset = await resetDemo();
    if (!didReset) throw new Error('demo reset unreachable/failed');
    const countStr = await psqlQuery(
      `SELECT count(*) FROM organization_members WHERE organization_id = 'demo-corp-org'`,
    );
    const roleListStr = await psqlQuery(
      `SELECT role FROM organization_members WHERE organization_id = 'demo-corp-org' ORDER BY role`,
    );
    const count = parseInt(countStr.trim(), 10);
    const roles = roleListStr.split('\n').map(s => s.trim()).filter(Boolean);
    const expectedRoles = ['admin', 'manager', 'member', 'owner'];
    const ok = count === 4 && JSON.stringify(roles) === JSON.stringify(expectedRoles);
    results.push({
      id: 'MEMBER-06',
      status: ok ? 'pass' : 'fail',
      evidence: `count=${count} roles=${roles.join(',')} (via direct DB query, not API — see notes)`,
    });
  } catch (e) {
    results.push({ id: 'MEMBER-06', status: 'blocked', evidence: String(e.message).slice(0, 200) });
  }

  return results;
}

if (isMainModule(import.meta.url)) {
  const results = await runArea();
  updateRows(CSV_PATH, results);
  const out = { ok: results.every(r => r.status === 'pass'), ...summarize(results), results, caveats: [] };
  report(out);
}
