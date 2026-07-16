#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = undefined) {
  const prefixed = `--${name}=`;
  const found = process.argv.slice(2).find((part) => part.startsWith(prefixed));
  return found ? found.slice(prefixed.length) : fallback;
}

function list(value) {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
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

const appId = arg("app-id", process.env.ONECOMPUTER_APP_ID);
const out = arg("out", "");
if (!appId) {
  console.error("Usage: node scripts/onecomputer/create-policy-artifact.mjs --app-id=<appId> [--out=policy.json]");
  process.exit(64);
}

const policy = {
  schema: "onecomputer.policy.artifact.v1",
  appId,
  issuerDid: arg("issuer-did", process.env.ONECOMPUTER_VTA_DID || "did:example:onecomputer:vta:local"),
  ownerDid: arg("owner-did", process.env.ONECOMPUTER_OWNER_DID || "did:example:onecomputer:user:owner"),
  purpose: arg("purpose", "governed-app-access"),
  dataClassification: arg("data-classification", "internal"),
  riskTier: arg("risk-tier", "medium"),
  allowedUsers: list(arg("allowed-users", process.env.ONECOMPUTER_ALLOWED_USERS)),
  constraints: {
    runtimeKind: arg("runtime", "app"),
    methods: list(arg("methods", "GET,POST,PUT,PATCH,DELETE,HEAD")),
    network: arg("network", "origin-via-gateway-only"),
    credentialMode: arg("credential-mode", "gateway-injected"),
    evidenceRequired: true,
  },
  issuedAt: arg("issued-at", new Date().toISOString()),
};
policy.policyHash = sha256(canonicalJson(policy));
policy.signature = {
  type: "mock-local-policy-signature",
  note: "POC signing shape only. Replace with Affinidi/VTI VTA signature; do not treat this as cryptographic production trust.",
  signedHash: policy.policyHash,
};

const json = `${JSON.stringify(policy, null, 2)}\n`;
if (out) {
  const dest = path.resolve(out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, json);
  console.log(JSON.stringify({ ok: true, out: dest, policyHash: policy.policyHash }, null, 2));
} else {
  process.stdout.write(json);
}
