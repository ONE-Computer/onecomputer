import crypto from "node:crypto";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 3000);
const grantSecret = process.env.ONECOMPUTER_GATEWAY_GRANT_SECRET || "";
const adminToken = process.env.ONECOMPUTER_GATEWAY_ADMIN_TOKEN || "";
const gatewayAudience =
  process.env.ONECOMPUTER_GATEWAY_AUDIENCE || "onecomputer.access-gateway";
const verifierBackend = (
  process.env.ONECOMPUTER_VERIFIER_BACKEND || "local-hmac"
).toLowerCase();
const externalVerifierUrl = process.env.ONECOMPUTER_EXTERNAL_VERIFIER_URL || "";
const externalVerifierToken =
  process.env.ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN || "";
const externalVerifierTimeoutMs = Number(
  process.env.ONECOMPUTER_EXTERNAL_VERIFIER_TIMEOUT_MS || 2500,
);
const bodyLimit = process.env.ONECOMPUTER_BODY_LIMIT || "256kb";
const rateLimitWindowMs = Number(
  process.env.ONECOMPUTER_RATE_LIMIT_WINDOW_MS || 60_000,
);
const rateLimitMax = Number(process.env.ONECOMPUTER_RATE_LIMIT_MAX || 120);
const adminRateLimitMax = Number(
  process.env.ONECOMPUTER_ADMIN_RATE_LIMIT_MAX || 30,
);

app.disable("x-powered-by");
app.use(assignRequestContext);
app.use(applySecurityHeaders);
app.use(rateLimitMiddleware);
app.use(express.json({ limit: bodyLimit }));

const rateLimitBuckets = new Map();

function assignRequestContext(req, res, next) {
  const incoming = String(req.get("x-onecomputer-request-id") || "").trim();
  req.requestId =
    incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  res.setHeader("x-onecomputer-request-id", req.requestId);
  next();
}

function applySecurityHeaders(req, res, next) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  );
  if (req.path.startsWith("/admin") || req.path.startsWith("/app")) {
    res.setHeader("cache-control", "no-store");
  }
  next();
}

function rateLimitMiddleware(req, res, next) {
  if (req.path === "/health") return next();
  const now = Date.now();
  const bucketType = req.path.startsWith("/admin") ? "admin" : "gateway";
  const max = bucketType === "admin" ? adminRateLimitMax : rateLimitMax;
  const key = `${bucketType}:${req.ip || req.socket.remoteAddress || "unknown"}`;
  const current = rateLimitBuckets.get(key);
  const bucket =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + rateLimitWindowMs };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count > max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    res.setHeader("retry-after", String(retryAfterSeconds));
    auditLog({
      event: "onecomputer.rate_limit",
      decision: "deny",
      reason: "rate_limit_exceeded",
      path: req.path,
      requestId: req.requestId,
      detail: { bucketType },
    });
    return res
      .status(429)
      .json({ error: "rate_limit_exceeded", requestId: req.requestId });
  }
  next();
}

function clientError(res, status, error, requestId) {
  return res.status(status).json({ error, requestId });
}

function parseRegistry(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) throw new Error("registry must be an array");
    return parsed.map(normalizeRegistryEntry).filter(Boolean);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gateway_config_error",
        error: String(error.message || error),
      }),
    );
    return [];
  }
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value instanceof Set)
    return Array.from(value).map(String).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return [];
}

function normalizeRegistryEntry(entry) {
  if (!entry) return null;
  const appId = String(entry.appId || entry.id || "").trim();
  if (!appId) return null;
  return {
    ...entry,
    appId,
    id: String(entry.id || appId),
    originUrl: String(entry.originUrl || "").replace(/\/$/, ""),
    originToken: String(entry.originToken || ""),
    status: String(entry.status || "active"),
    allowedUsers: normalizeStringList(entry.allowedUsers),
    revokedUsers: normalizeStringList(entry.revokedUsers),
    ownerDid: entry.ownerDid || entry.owner || null,
    appDid: entry.appDid || null,
    vtaDid: entry.vtaDid || null,
    vtcId: entry.vtcId || null,
    dataClassification: entry.dataClassification || "internal",
    riskTier: entry.riskTier || "medium",
    runtimeKind: entry.runtimeKind || entry.runtime || "app",
    policyHash: entry.policyHash || entry.passport?.policyHash || null,
    evidenceHash: entry.evidenceHash || entry.passport?.evidenceHash || null,
    passportHash: entry.passportHash || entry.passport?.passportHash || null,
    awsResourceArns: normalizeStringList(entry.awsResourceArns),
    updatedAt: entry.updatedAt || null,
  };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64) {
  if (!grantSecret) return "";
  return crypto
    .createHmac("sha256", grantSecret)
    .update(payloadB64)
    .digest("base64url");
}

function verifyLocalHmacGrant(token) {
  if (!grantSecret) return { ok: false, reason: "gateway_secret_missing" };
  const [payloadB64, signature] = String(token || "").split(".");
  if (!payloadB64 || !signature) {
    return { ok: false, reason: "grant_missing_or_malformed" };
  }
  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "grant_bad_signature" };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
    return validateVerifierPayload(payload);
  } catch {
    return { ok: false, reason: "grant_bad_payload" };
  }
}

function validateVerifierPayload(
  payload,
  { requireOneComputerGrant = false } = {},
) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "grant_payload_missing" };
  }
  if (payload.schema && payload.schema !== "onecomputer.access.grant.v1") {
    return { ok: false, reason: "grant_unsupported_schema", payload };
  }
  if (
    requireOneComputerGrant &&
    payload.schema !== "onecomputer.access.grant.v1"
  ) {
    return { ok: false, reason: "grant_schema_required", payload };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && nowSeconds > Number(payload.exp)) {
    return { ok: false, reason: "grant_expired", payload };
  }
  if (payload.nbf && nowSeconds < Number(payload.nbf)) {
    return { ok: false, reason: "grant_not_yet_valid", payload };
  }
  if (payload.schema === "onecomputer.access.grant.v1") {
    if (payload.aud !== gatewayAudience) {
      return { ok: false, reason: "grant_bad_audience", payload };
    }
    if (!payload.iss)
      return { ok: false, reason: "grant_issuer_missing", payload };
    if (!payload.sub)
      return { ok: false, reason: "grant_subject_missing", payload };
    if (!payload.purpose)
      return { ok: false, reason: "grant_purpose_missing", payload };
    if (!payload.nonce)
      return { ok: false, reason: "grant_nonce_missing", payload };
  }
  return { ok: true, payload };
}

async function verifyExternalGrant(token, { req, appId }) {
  if (!externalVerifierUrl)
    return { ok: false, reason: "external_verifier_url_missing" };
  try {
    const headers = {
      "content-type": "application/json",
      "x-onecomputer-request-id": req.requestId,
    };
    if (externalVerifierToken)
      headers.authorization = `Bearer ${externalVerifierToken}`;
    const response = await fetch(externalVerifierUrl, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(externalVerifierTimeoutMs),
      body: JSON.stringify({
        schema: "onecomputer.verifier.request.v1",
        token,
        audience: gatewayAudience,
        appId,
        request: {
          method: req.method,
          path: req.path,
          requestId: req.requestId,
        },
      }),
    });
    if (!response.ok)
      return { ok: false, reason: "external_verifier_http_error" };
    const result = await response.json();
    if (!result.ok)
      return { ok: false, reason: result.reason || "external_verifier_denied" };
    if (!result.payload || typeof result.payload !== "object") {
      return { ok: false, reason: "external_verifier_payload_missing" };
    }
    return validateVerifierPayload(result.payload, {
      requireOneComputerGrant: true,
    });
  } catch {
    return { ok: false, reason: "external_verifier_unreachable" };
  }
}

async function verifyGrant(token, context) {
  if (verifierBackend === "local-hmac") return verifyLocalHmacGrant(token);
  if (["http", "external-http", "affinidi-vti"].includes(verifierBackend)) {
    return verifyExternalGrant(token, context);
  }
  return { ok: false, reason: "verifier_backend_not_configured" };
}

function grantSubject(payload) {
  return payload.sub || payload.email || "unknown-user";
}

function grantAllowedApps(payload) {
  const apps = new Set();
  for (const app of payload.apps || []) apps.add(app);
  if (payload.appId) apps.add(payload.appId);
  for (const app of payload.constraints?.apps || []) apps.add(app);
  return Array.from(apps);
}

function grantAllowsMethod(payload, method) {
  const allowedMethods = payload.constraints?.methods;
  if (!Array.isArray(allowedMethods) || allowedMethods.length === 0)
    return true;
  return allowedMethods.includes(method) || allowedMethods.includes("*");
}

function validateGrantForTarget({ payload, target, appId, method }) {
  const allowedApps = grantAllowedApps(payload);
  if (!allowedApps.includes(appId) && !allowedApps.includes("*")) {
    return "grant_app_not_allowed";
  }
  if (target.policyHash && payload.policyHash !== target.policyHash) {
    return "grant_policy_hash_mismatch";
  }
  if (!grantAllowsMethod(payload, method)) {
    return "grant_method_not_allowed";
  }
  return null;
}

function safeAppPassport(entry) {
  return {
    schema: "onecomputer.app.passport.v1",
    appId: entry.appId,
    appDid: entry.appDid,
    ownerDid: entry.ownerDid,
    vtaDid: entry.vtaDid,
    vtcId: entry.vtcId,
    runtimeKind: entry.runtimeKind,
    dataClassification: entry.dataClassification,
    riskTier: entry.riskTier,
    allowedUsers: entry.allowedUsers || [],
    policyHash: entry.policyHash,
    evidenceHash: entry.evidenceHash,
    passportHash: entry.passportHash,
    awsResourceArns: entry.awsResourceArns || [],
    status: entry.status,
    updatedAt: entry.updatedAt,
  };
}

function scrubDetail(detail) {
  if (!detail) return undefined;
  return Object.fromEntries(
    Object.entries(detail).filter(
      ([key]) => !/token|secret|password|credential|grant/i.test(key),
    ),
  );
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

function buildEvidenceEvent(event, previousHash = "genesis") {
  const safeEvent = {
    ...event,
    detail: scrubDetail(event.detail),
  };
  const evidence = {
    schema: "onecomputer.evidence.event.v1",
    previousHash,
    event: safeEvent,
  };
  return {
    ...safeEvent,
    evidenceSchema: evidence.schema,
    previousHash,
    eventHash: sha256(canonicalJson(evidence)),
  };
}

function auditLog({
  event = "onecomputer.access_decision",
  decision,
  reason,
  appId,
  user,
  path,
  detail,
  requestId,
}) {
  console.log(
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      decision,
      reason,
      appId: appId || null,
      user: user || null,
      path,
      requestId: requestId || null,
      detail: scrubDetail(detail),
    }),
  );
}

class EnvRegistryStore {
  constructor(entries) {
    this.entries = entries;
    this.backend = "env";
    this.auditHeads = new Map();
  }

  async listApps() {
    return this.entries;
  }

  async getApp(appId) {
    return (
      this.entries.find(
        (entry) => entry.appId === appId || entry.id === appId,
      ) || null
    );
  }

  async updateStatus(appId, status) {
    const target = await this.getApp(appId);
    if (!target) return null;
    target.status = status;
    target.updatedAt = new Date().toISOString();
    return target;
  }

  async revokeUser(appId, user) {
    const target = await this.getApp(appId);
    if (!target) return null;
    target.revokedUsers = Array.from(
      new Set([...(target.revokedUsers || []), user]),
    );
    target.updatedAt = new Date().toISOString();
    return target;
  }

  async appendAudit(event) {
    const chainKey = event.appId || "GLOBAL";
    const previousHash = this.auditHeads.get(chainKey) || "genesis";
    const evidenceEvent = buildEvidenceEvent(event, previousHash);
    this.auditHeads.set(chainKey, evidenceEvent.eventHash);
    auditLog(evidenceEvent);
  }
}

class DynamoDbRegistryStore {
  constructor({ tableName, seedEntries = [] }) {
    if (!tableName) throw new Error("ONECOMPUTER_CONTROL_TABLE is required");
    this.tableName = tableName;
    this.seedEntries = seedEntries;
    this.backend = "dynamodb";
    this.clientPromise = this.loadClient();
  }

  async loadClient() {
    const dynamo = await import("@aws-sdk/client-dynamodb");
    const util = await import("@aws-sdk/util-dynamodb");
    return {
      client: new dynamo.DynamoDBClient({}),
      commands: dynamo,
      marshall: util.marshall,
      unmarshall: util.unmarshall,
    };
  }

  appKey(appId) {
    return { pk: `APP#${appId}`, sk: "METADATA" };
  }

  async listApps() {
    const { client, commands, unmarshall } = await this.clientPromise;
    const result = await client.send(
      new commands.ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :prefix) AND sk = :metadata",
        ExpressionAttributeValues: {
          ":prefix": { S: "APP#" },
          ":metadata": { S: "METADATA" },
        },
      }),
    );
    return (result.Items || [])
      .map((item) => normalizeRegistryEntry(unmarshall(item)))
      .filter(Boolean);
  }

  async getApp(appId) {
    const { client, commands, marshall, unmarshall } = await this.clientPromise;
    const result = await client.send(
      new commands.GetItemCommand({
        TableName: this.tableName,
        Key: marshall(this.appKey(appId)),
      }),
    );
    if (result.Item) return normalizeRegistryEntry(unmarshall(result.Item));
    return (
      this.seedEntries.find(
        (entry) => entry.appId === appId || entry.id === appId,
      ) || null
    );
  }

  async updateStatus(appId, status) {
    const { client, commands, marshall, unmarshall } = await this.clientPromise;
    const now = new Date().toISOString();
    const result = await client.send(
      new commands.UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall(this.appKey(appId)),
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: marshall({
          ":status": status,
          ":updatedAt": now,
        }),
        ConditionExpression: "attribute_exists(pk)",
        ReturnValues: "ALL_NEW",
      }),
    );
    return normalizeRegistryEntry(unmarshall(result.Attributes));
  }

  async revokeUser(appId, user) {
    const current = await this.getApp(appId);
    if (!current) return null;
    const revokedUsers = Array.from(
      new Set([...(current.revokedUsers || []), user]),
    );
    const { client, commands, marshall, unmarshall } = await this.clientPromise;
    const result = await client.send(
      new commands.UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall(this.appKey(appId)),
        UpdateExpression:
          "SET revokedUsers = :revokedUsers, updatedAt = :updatedAt",
        ExpressionAttributeValues: marshall({
          ":revokedUsers": revokedUsers,
          ":updatedAt": new Date().toISOString(),
        }),
        ConditionExpression: "attribute_exists(pk)",
        ReturnValues: "ALL_NEW",
      }),
    );
    return normalizeRegistryEntry(unmarshall(result.Attributes));
  }

  async latestAuditHash(chainKey) {
    const { client, commands } = await this.clientPromise;
    const result = await client.send(
      new commands.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: `AUDIT#${chainKey}` } },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return result.Items?.[0]?.eventHash?.S || "genesis";
  }

  async appendAudit(event) {
    const { client, commands, marshall } = await this.clientPromise;
    const at = new Date().toISOString();
    const chainKey = event.appId || "GLOBAL";
    const evidenceEvent = buildEvidenceEvent(
      {
        ...event,
        event: event.event || "onecomputer.access_decision",
        at,
      },
      await this.latestAuditHash(chainKey),
    );
    auditLog(evidenceEvent);
    await client.send(
      new commands.PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            pk: `AUDIT#${chainKey}`,
            sk: `${at}#${crypto.randomUUID()}`,
            ...evidenceEvent,
            at,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  }
}

function createRegistryStore() {
  const seedEntries = parseRegistry(
    process.env.ONECOMPUTER_REGISTRY_JSON || "[]",
  );
  const backend = (
    process.env.ONECOMPUTER_REGISTRY_BACKEND || "env"
  ).toLowerCase();
  if (backend === "dynamodb") {
    return new DynamoDbRegistryStore({
      tableName: process.env.ONECOMPUTER_CONTROL_TABLE,
      seedEntries,
    });
  }
  return new EnvRegistryStore(seedEntries);
}

const registryStore = createRegistryStore();

async function decisionLog(input) {
  await registryStore.appendAudit({
    event: "onecomputer.access_decision",
    ...input,
  });
}

function requireAdmin(req, res, next) {
  if (!adminToken)
    return clientError(res, 503, "admin_token_not_configured", req.requestId);
  if (req.get("x-onecomputer-admin-token") !== adminToken) {
    auditLog({
      event: "onecomputer.admin_decision",
      decision: "deny",
      reason: "bad_admin_token",
      appId: req.params.appId || null,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, "bad_admin_token", req.requestId);
  }
  next();
}

function appProxyPath(req) {
  const query = new URLSearchParams(req.url.split("?").slice(1).join("?"));
  query.delete("grant");
  const suffix = req.params[0] || "";
  const qs = query.toString();
  return `/${suffix}${qs ? `?${qs}` : ""}`;
}

app.get("/health", (_req, res) => res.type("text").send("ok"));

app.get("/", async (_req, res) => {
  const registry = await registryStore.listApps();
  res
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneComputer Access Gateway</title><style>body{font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#f8fafc;margin:0}main{max-width:960px;margin:0 auto;padding:48px 20px}.card{border:1px solid #334155;background:#111827;border-radius:20px;padding:24px}.pill{display:inline-block;color:#86efac;border:1px solid #22c55e;border-radius:999px;padding:4px 10px;font-size:12px}code{color:#86efac}</style></head><body><main><div class="card"><span class="pill">OneComputer Gateway</span><h1>Access Gateway Proof</h1><p>This gateway validates signed grants, checks app registry state, injects origin tokens, and logs access decisions.</p><p>Registry backend: <code>${registryStore.backend}</code></p><h2>Registered apps</h2><ul>${registry.map((entry) => `<li><code>${entry.appId}</code> — ${entry.status}</li>`).join("")}</ul></div></main></body></html>`,
    );
});

app.get("/admin/apps/:appId/passport", requireAdmin, async (req, res) => {
  const target = await registryStore.getApp(req.params.appId);
  if (!target) return clientError(res, 404, "app_not_found", req.requestId);
  res.json(safeAppPassport(target));
});

app.post("/admin/apps/:appId/pause", requireAdmin, async (req, res) => {
  const target = await registryStore.updateStatus(req.params.appId, "paused");
  if (!target) return clientError(res, 404, "app_not_found", req.requestId);
  await registryStore.appendAudit({
    event: "onecomputer.admin_action",
    decision: "allow",
    reason: "app_paused",
    appId: req.params.appId,
    path: req.path,
    requestId: req.requestId,
  });
  res.json({ ok: true, appId: req.params.appId, status: target.status });
});

app.post("/admin/apps/:appId/resume", requireAdmin, async (req, res) => {
  const target = await registryStore.updateStatus(req.params.appId, "active");
  if (!target) return clientError(res, 404, "app_not_found", req.requestId);
  await registryStore.appendAudit({
    event: "onecomputer.admin_action",
    decision: "allow",
    reason: "app_resumed",
    appId: req.params.appId,
    path: req.path,
    requestId: req.requestId,
  });
  res.json({ ok: true, appId: req.params.appId, status: target.status });
});

app.post("/admin/apps/:appId/revoke-user", requireAdmin, async (req, res) => {
  const user = String(req.body?.user || "");
  if (!user) return clientError(res, 400, "user_required", req.requestId);
  const target = await registryStore.revokeUser(req.params.appId, user);
  if (!target) return clientError(res, 404, "app_not_found", req.requestId);
  await registryStore.appendAudit({
    event: "onecomputer.admin_action",
    decision: "allow",
    reason: "user_revoked",
    appId: req.params.appId,
    user,
    path: req.path,
    requestId: req.requestId,
  });
  res.json({
    ok: true,
    appId: req.params.appId,
    revokedUsers: target.revokedUsers,
  });
});

app.all("/app/:appId/*", async (req, res) => {
  const appId = req.params.appId;
  const target = await registryStore.getApp(appId);
  const grant =
    req.query.grant ||
    req.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.cookies?.oc_grant;
  const grantResult = await verifyGrant(grant, { req, appId });
  const path = appProxyPath(req);

  if (!target) {
    await decisionLog({
      decision: "deny",
      reason: "app_not_found",
      appId,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 404, "app_not_found", req.requestId);
  }
  if (target.status !== "active") {
    await decisionLog({
      decision: "deny",
      reason: `app_${target.status}`,
      appId,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, `app_${target.status}`, req.requestId);
  }
  if (!grantResult.ok) {
    await decisionLog({
      decision: "deny",
      reason: grantResult.reason,
      appId,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, grantResult.reason, req.requestId);
  }
  const user = grantSubject(grantResult.payload);
  const grantTargetError = validateGrantForTarget({
    payload: grantResult.payload,
    target,
    appId,
    method: req.method,
  });
  if (grantTargetError) {
    await decisionLog({
      decision: "deny",
      reason: grantTargetError,
      appId,
      user,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, grantTargetError, req.requestId);
  }
  if ((target.revokedUsers || []).includes(user)) {
    await decisionLog({
      decision: "deny",
      reason: "user_revoked",
      appId,
      user,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, "user_revoked", req.requestId);
  }
  if (target.allowedUsers.length && !target.allowedUsers.includes(user)) {
    await decisionLog({
      decision: "deny",
      reason: "user_not_allowed",
      appId,
      user,
      path: req.path,
      requestId: req.requestId,
    });
    return clientError(res, 403, "user_not_allowed", req.requestId);
  }

  const url = new URL(path, `${target.originUrl}/`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (["host", "connection", "authorization"].includes(key.toLowerCase()))
      continue;
    if (Array.isArray(value)) headers.set(key, value.join(","));
    else if (value) headers.set(key, value);
  }
  headers.set("x-onecomputer-origin-token", target.originToken);
  headers.set("x-onecomputer-user", user);
  headers.set("x-onecomputer-app-id", appId);

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: ["GET", "HEAD"].includes(req.method) ? undefined : "half",
      redirect: "manual",
    });
    await decisionLog({
      decision: "allow",
      reason: "grant_valid",
      appId,
      user,
      path: req.path,
      requestId: req.requestId,
      detail: { schema: grantResult.payload.schema || "legacy" },
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (
        !["content-encoding", "transfer-encoding", "connection"].includes(
          key.toLowerCase(),
        )
      ) {
        res.setHeader(key, value);
      }
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (error) {
    await decisionLog({
      decision: "deny",
      reason: "origin_fetch_failed",
      appId,
      user,
      path: req.path,
      requestId: req.requestId,
    });
    res.status(502).json({
      error: "origin_fetch_failed",
      requestId: req.requestId,
      detail: String(error.message || error),
    });
  }
});

app.use(async (req, res) => {
  await decisionLog({
    decision: "deny",
    reason: "route_not_found",
    appId: null,
    path: req.path,
    requestId: req.requestId,
  });
  clientError(res, 404, "route_not_found", req.requestId);
});

app.use((error, req, res, next) => {
  if (!error) return next();
  const status = error.type === "entity.too.large" ? 413 : 400;
  const reason =
    error.type === "entity.too.large"
      ? "request_entity_too_large"
      : "bad_request_body";
  auditLog({
    event: "onecomputer.request_rejected",
    decision: "deny",
    reason,
    path: req.path,
    requestId: req.requestId,
  });
  return clientError(res, status, reason, req.requestId);
});

app.listen(port, "127.0.0.1", () => {
  console.log(
    `OneComputer Access Gateway listening on ${port} using ${registryStore.backend} registry`,
  );
});

export function createGrant({
  sub,
  apps,
  ttlSeconds = 8 * 60 * 60,
  secret = grantSecret,
}) {
  const payload = {
    sub,
    apps,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}
