#!/usr/bin/env node
import crypto from "node:crypto";

function arg(name, fallback = undefined) {
  const prefixed = `--${name}=`;
  const found = process.argv.slice(2).find((part) => part.startsWith(prefixed));
  return found ? found.slice(prefixed.length) : fallback;
}

function list(value) {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

const appId = arg("app-id", process.env.ONECOMPUTER_APP_ID);
if (!appId) {
  console.error("Usage: node scripts/onecomputer/create-app-passport.mjs --app-id=<appId> [--origin-url=<url>] [--allowed-users=a,b]");
  process.exit(64);
}

const policy = {
  schema: "onecomputer.policy.v1",
  appId,
  allowedUsers: list(arg("allowed-users", process.env.ONECOMPUTER_ALLOWED_USERS)),
  dataClassification: arg("data-classification", "internal"),
  riskTier: arg("risk-tier", "medium"),
  purpose: arg("purpose", "governed-app-access"),
  constraints: {
    methods: list(arg("methods", "GET,POST,PUT,PATCH,DELETE,HEAD")),
    network: arg("network", "origin-via-gateway-only"),
    credentialMode: arg("credential-mode", "gateway-injected"),
  },
};
const policyHash = arg("policy-hash", sha256(canonical(policy)));
const passport = {
  schema: "onecomputer.app.passport.v1",
  appId,
  appDid: arg("app-did", `did:example:onecomputer:app:${appId}`),
  ownerDid: arg("owner-did", process.env.ONECOMPUTER_OWNER_DID || "did:example:onecomputer:user:owner"),
  vtaDid: arg("vta-did", process.env.ONECOMPUTER_VTA_DID || "did:example:onecomputer:vta:local"),
  vtcId: arg("vtc-id", process.env.ONECOMPUTER_VTC_ID || "vtc:onecomputer:sandbox"),
  runtimeKind: arg("runtime", "app"),
  originUrl: arg("origin-url", undefined),
  dataClassification: policy.dataClassification,
  riskTier: policy.riskTier,
  allowedUsers: policy.allowedUsers,
  awsResourceArns: list(arg("aws-resource-arns", process.env.ONECOMPUTER_AWS_RESOURCE_ARNS)),
  policy,
  policyHash,
  evidenceHash: arg("evidence-hash", "sha256:pending"),
};
passport.passportHash = sha256(canonical(passport));
console.log(JSON.stringify(passport, null, 2));
