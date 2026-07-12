#!/usr/bin/env node
import crypto from "node:crypto";

const [sub, appsCsv, ttlRaw] = process.argv.slice(2);
const secret = process.env.ONECOMPUTER_GATEWAY_GRANT_SECRET;
const schema = process.env.ONECOMPUTER_GRANT_SCHEMA || "legacy";
const now = Math.floor(Date.now() / 1000);

if (!secret || !sub || !appsCsv) {
  console.error(
    [
      "Usage: ONECOMPUTER_GATEWAY_GRANT_SECRET=<secret> node scripts/onecomputer/generate-gateway-grant.mjs <user> <app1,app2> [ttlSeconds]",
      "Optional VTI-shaped mode: ONECOMPUTER_GRANT_SCHEMA=vti ONECOMPUTER_POLICY_HASH=<sha256:...>",
    ].join("\n"),
  );
  process.exit(64);
}

const apps = appsCsv
  .split(",")
  .map((app) => app.trim())
  .filter(Boolean);
const ttlSeconds = Number(ttlRaw || 8 * 60 * 60);
const exp = now + ttlSeconds;

const payload =
  schema === "vti" || schema === "onecomputer.access.grant.v1"
    ? {
        schema: "onecomputer.access.grant.v1",
        iss: process.env.ONECOMPUTER_GRANT_ISSUER || "did:example:onecomputer:vta:local",
        sub,
        aud: process.env.ONECOMPUTER_GATEWAY_AUDIENCE || "onecomputer.access-gateway",
        appId: apps.length === 1 ? apps[0] : undefined,
        apps,
        policyHash: process.env.ONECOMPUTER_POLICY_HASH || undefined,
        purpose: process.env.ONECOMPUTER_GRANT_PURPOSE || "governed-app-access",
        constraints: {
          apps,
          methods: (process.env.ONECOMPUTER_GRANT_METHODS || "GET,POST,PUT,PATCH,DELETE,HEAD")
            .split(",")
            .map((method) => method.trim().toUpperCase())
            .filter(Boolean),
        },
        iat: now,
        nbf: Number(process.env.ONECOMPUTER_GRANT_NOT_BEFORE || now),
        exp,
        nonce: process.env.ONECOMPUTER_GRANT_NONCE || crypto.randomUUID(),
      }
    : {
        sub,
        apps,
        exp,
      };

const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
console.log(`${payloadB64}.${sig}`);
