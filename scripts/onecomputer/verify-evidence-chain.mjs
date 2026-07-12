#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

const chainArg = process.argv[2];
if (!chainArg) {
  console.error("Usage: node scripts/onecomputer/verify-evidence-chain.mjs evidence.jsonl");
  process.exit(64);
}
const chainPath = path.resolve(chainArg);
const records = fs.readFileSync(chainPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
let previousHash = "genesis";
for (let i = 0; i < records.length; i += 1) {
  const record = records[i];
  const expectedPrevious = previousHash;
  if (record.previousHash !== expectedPrevious) {
    console.error(JSON.stringify({ ok: false, index: i, error: "previous_hash_mismatch", expectedPrevious, actual: record.previousHash }, null, 2));
    process.exit(1);
  }
  const withoutHash = { ...record };
  delete withoutHash.eventHash;
  const expectedHash = sha256(canonicalJson(withoutHash));
  if (record.eventHash !== expectedHash) {
    console.error(JSON.stringify({ ok: false, index: i, error: "event_hash_mismatch", expectedHash, actual: record.eventHash }, null, 2));
    process.exit(1);
  }
  previousHash = record.eventHash;
}
console.log(JSON.stringify({ ok: true, chain: chainPath, records: records.length, head: previousHash }, null, 2));
