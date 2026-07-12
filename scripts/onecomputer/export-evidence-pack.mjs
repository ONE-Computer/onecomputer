#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let out = '';
const includes = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--out') out = args[++i] ?? '';
  else if (args[i] === '--include') includes.push(args[++i]);
  else throw new Error(`Unknown arg ${args[i]}`);
}
if (!out || includes.length === 0) {
  console.error('Usage: node scripts/onecomputer/export-evidence-pack.mjs --out evidence.zip --include path[:alias] ...');
  process.exit(64);
}
const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const manifest = {
  schema: 'onecomputer.evidence-export.v0',
  generatedAt: new Date().toISOString(),
  includes: includes.map((item) => {
    const [src, alias] = item.split(':');
    return { src, alias: alias || src };
  }),
};
const stage = path.join(repoRoot, '.onecomputer', 'evidence-export', `${Date.now()}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const item of includes) {
  const [srcRaw, aliasRaw] = item.split(':');
  const src = path.resolve(repoRoot, srcRaw);
  if (!fs.existsSync(src)) throw new Error(`Missing include: ${srcRaw}`);
  const alias = (aliasRaw || srcRaw).replace(/^\/+/, '');
  const dest = path.join(stage, alias);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const py = spawnSync('python3', ['-c', `
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(root):
        for name in files:
            full = os.path.join(base, name)
            z.write(full, os.path.relpath(full, root))
`, stage, path.resolve(out)], { encoding: 'utf8' });
if (py.status !== 0) {
  console.error(py.stderr || py.stdout);
  process.exit(py.status || 1);
}
console.log(JSON.stringify({ ok: true, out: path.resolve(out), fileCount: countFiles(stage) }, null, 2));

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}
