#!/usr/bin/env node
// Orchestrator: runs every area's runArea() in sequence (auth first — it's
// the preflight everything else implicitly depends on), aggregates results,
// writes them all to the CSV in one pass, and prints a summary.
//
// Usage: node scripts/onecomputer/e2e/run-all.mjs

import { runArea as runAuth } from './api/auth.mjs';
import { runArea as runPolicy } from './api/policy.mjs';
import { runArea as runMembers } from './api/members.mjs';
import { runArea as runSandbox } from './api/sandbox.mjs';
import { runArea as runApprovals } from './api/approvals.mjs';
import { runArea as runAudit } from './api/audit.mjs';
import { updateRows } from './lib/csv-tracker.mjs';
import { report, summarize, isMainModule } from './lib/report.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '../../../docs/plan/e2e-test-matrix.csv');

const AREAS = [
  ['auth', runAuth],
  ['policy', runPolicy],
  ['members', runMembers],
  ['sandbox', runSandbox],
  ['approvals', runApprovals],
  ['audit', runAudit],
];

async function main() {
  const allResults = [];
  const byArea = {};
  for (const [name, runArea] of AREAS) {
    const results = await runArea();
    byArea[name] = summarize(results);
    allResults.push(...results);
  }
  updateRows(CSV_PATH, allResults);
  const out = {
    ok: allResults.every(r => r.status === 'pass' || r.status === 'blocked'),
    ...summarize(allResults),
    byArea,
    results: allResults,
  };
  report(out);
}

if (isMainModule(import.meta.url)) {
  await main();
}
