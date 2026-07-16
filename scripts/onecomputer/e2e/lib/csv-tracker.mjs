// Minimal RFC 4180 CSV read/write for docs/plan/e2e-test-matrix.csv.
// Only the run-result columns (status, last_run_at, last_run_evidence) are
// ever mutated by scripts; all other columns are preserved byte-identical.

import { readFileSync, writeFileSync } from 'node:fs';

export const RUN_RESULT_COLUMNS = ['status', 'last_run_at', 'last_run_evidence'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function escapeField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(header, rows) {
  const lines = [header, ...rows].map(r => r.map(escapeField).join(','));
  return lines.join('\n') + '\n';
}

/** Returns { header: string[], rows: Array<Record<string,string>>, raw: string[][] } */
export function readMatrix(csvPath) {
  const text = readFileSync(csvPath, 'utf8');
  const raw = parseCsv(text);
  const [header, ...dataRows] = raw;
  const rows = dataRows.map(cols => {
    const obj = {};
    header.forEach((col, idx) => { obj[col] = cols[idx] ?? ''; });
    return obj;
  });
  return { header, rows };
}

/**
 * updates: Array<{ id: string, status: string, evidence: string }>
 * Only rewrites status/last_run_at/last_run_evidence for matching ids.
 * Leaves every other row and column untouched. Preserves row order.
 */
export function updateRows(csvPath, updates) {
  const { header, rows } = readMatrix(csvPath);
  const byId = new Map(updates.map(u => [u.id, u]));
  const nowIso = new Date().toISOString();

  const updatedRows = rows.map(row => {
    const u = byId.get(row.id);
    if (!u) return row;
    return {
      ...row,
      status: u.status,
      last_run_at: u.timestamp ?? nowIso,
      last_run_evidence: u.evidence ?? '',
    };
  });

  const outRows = updatedRows.map(row => header.map(col => row[col] ?? ''));
  writeFileSync(csvPath, writeCsv(header, outRows), 'utf8');
  return updatedRows;
}

/** newRows: Array<Record<string,string>> matching the header's columns. */
export function appendRows(csvPath, newRows) {
  const { header, rows } = readMatrix(csvPath);
  const combined = [...rows, ...newRows];
  const outRows = combined.map(row => header.map(col => row[col] ?? ''));
  writeFileSync(csvPath, writeCsv(header, outRows), 'utf8');
}

export function writeNewMatrix(csvPath, header, rows) {
  const outRows = rows.map(row => header.map(col => row[col] ?? ''));
  writeFileSync(csvPath, writeCsv(header, outRows), 'utf8');
}
