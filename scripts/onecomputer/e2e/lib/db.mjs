// psql helpers, extracted from scripts/onecomputer/e2e-gateway-approval-proof.mjs
// (two-tier connection fallback: primary connection string, then explicit
// host/port/user + PGPASSWORD).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DATABASE_URL = process.env.DATABASE_URL ??
  'postgresql://onecomputer:onecomputer@localhost:5433/onecomputer';

export async function psqlQuery(sql) {
  try {
    const { stdout } = await execFileAsync('psql', [DATABASE_URL, '-t', '-c', sql]);
    return stdout.trim();
  } catch {
    const { stdout } = await execFileAsync('psql', [
      '-h', 'localhost', '-p', '5433', '-U', 'onecomputer', '-d', 'onecomputer',
      '-t', '-c', sql,
    ], { env: { ...process.env, PGPASSWORD: 'onecomputer' } });
    return stdout.trim();
  }
}

export async function getDefaultAgentToken() {
  return psqlQuery('SELECT access_token FROM agents WHERE is_default = true LIMIT 1');
}
