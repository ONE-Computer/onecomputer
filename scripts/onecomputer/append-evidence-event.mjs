#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = undefined) {
  const prefixed = `--${name}=`;
  const idx = process.argv.slice(2).findIndex((part) => part === `--${name}`);
  const found = process.argv.slice(2).find((part) => part.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  if (idx >= 0) return process.argv.slice(2)[idx + 1] || fallback;
  return fallback;
}

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

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|secret|password|credential|grant/i.test(key))
        .map(([key, inner]) => [key, scrub(inner)]),
    );
  }
  return value;
}

const chainPath = arg("chain");
const eventJson = arg("event-json");
const eventFile = arg("event-file");
if (!chainPath || (!eventJson && !eventFile)) {
  console.error("Usage: node scripts/onecomputer/append-evidence-event.mjs --chain evidence.jsonl --event-json '{...}'");
  process.exit(64);
}

const event = scrub(JSON.parse(eventJson || fs.readFileSync(eventFile, "utf8")));
const dest = path.resolve(chainPath);
fs.mkdirSync(path.dirname(dest), { recursive: true });
const prior = fs.existsSync(dest)
  ? fs.readFileSync(dest, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const previousHash = prior.at(-1)?.eventHash || "genesis";
const record = {
  schema: "onecomputer.evidence.event.v1",
  at: new Date().toISOString(),
  previousHash,
  event,
};
record.eventHash = sha256(canonicalJson(record));
fs.appendFileSync(dest, `${JSON.stringify(record)}\n`);
console.log(JSON.stringify({ ok: true, chain: dest, previousHash, eventHash: record.eventHash }, null, 2));
