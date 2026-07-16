// Enforces the existing proof-script convention of printing one JSON object
// and exiting 0/1 based on `ok`.

import { pathToFileURL } from 'node:url';

/** True when the current module was invoked directly via `node <file>` (space-safe). */
export function isMainModule(moduleUrl) {
  return moduleUrl === pathToFileURL(process.argv[1]).href;
}

export function report(out) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

/** Summarize an array of { id, status, evidence } into a compact string. */
export function summarize(results) {
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const blocked = results.filter(r => r.status === 'blocked').length;
  const skip = results.filter(r => r.status === 'skip').length;
  return { total: results.length, pass, fail, blocked, skip };
}
