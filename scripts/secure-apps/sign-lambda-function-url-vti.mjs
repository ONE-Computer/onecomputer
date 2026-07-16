#!/usr/bin/env node
import crypto from "node:crypto";
import https from "node:https";

const required = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_DEFAULT_REGION",
  "FUNCTION_URL",
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}`);
    process.exit(1);
  }
}

const claim = {
  iss: "did:web:onecomputer.local",
  sub: process.env.ONECOMPUTER_SUBJECT ?? "terencetan@temasek.com.sg",
  subject:
    process.env.ONECOMPUTER_SUBJECT_LABEL ?? "Terence Tan sandbox access grant",
  aud: "onecomputer-secure-vibe-app",
  trustTaskId:
    process.env.ONECOMPUTER_TRUST_TASK_ID ??
    "tt-onecomputer-secure-apps-20260621-001",
  consentState: "granted_by_onecomputer_admin",
  policyArtifactId: "onecomputer-secure-app-runtime-v0",
  iat: Math.floor(Date.now() / 1000),
  exp:
    Math.floor(Date.now() / 1000) +
    Number(process.env.ONECOMPUTER_GRANT_TTL_SECONDS ?? 900),
};

const vtiClaim = Buffer.from(JSON.stringify(claim)).toString("base64url");
const url = new URL(process.env.FUNCTION_URL);
const method = "GET";
const service = "lambda";
const region = process.env.AWS_DEFAULT_REGION;
const now = new Date();
const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
const dateStamp = amzDate.slice(0, 8);
const payloadHash = crypto.createHash("sha256").update("").digest("hex");

const headers = {
  host: url.host,
  "x-amz-content-sha256": payloadHash,
  "x-amz-date": amzDate,
  "x-onecomputer-vti-claim": vtiClaim,
};

const signedHeaders = Object.keys(headers).sort().join(";");
const canonicalHeaders = Object.keys(headers)
  .sort()
  .map((key) => `${key}:${String(headers[key]).trim()}\n`)
  .join("");
const canonicalRequest = [
  method,
  url.pathname || "/",
  url.searchParams.toString(),
  canonicalHeaders,
  signedHeaders,
  payloadHash,
].join("\n");
const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
const stringToSign = [
  "AWS4-HMAC-SHA256",
  amzDate,
  credentialScope,
  crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
].join("\n");

const hmac = (key, data) =>
  crypto.createHmac("sha256", key).update(data).digest();
const signingKey = hmac(
  hmac(
    hmac(hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, dateStamp), region),
    service,
  ),
  "aws4_request",
);
const signature = crypto
  .createHmac("sha256", signingKey)
  .update(stringToSign)
  .digest("hex");
headers.authorization = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

const request = https.request(
  {
    method,
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    headers,
    timeout: 30000,
  },
  (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      console.log(
        JSON.stringify(
          {
            statusCode: response.statusCode,
            contentType: response.headers["content-type"],
            trustTask: response.headers["x-onecomputer-vti-trust-task"],
            bytes: Buffer.byteLength(body),
            bodyPreview: body.slice(0, 160),
          },
          null,
          2,
        ),
      );
      if (response.statusCode !== 200) process.exitCode = 2;
    });
  },
);
request.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
request.end();
