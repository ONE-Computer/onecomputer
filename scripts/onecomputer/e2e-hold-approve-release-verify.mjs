#!/usr/bin/env node
/**
 * e2e-hold-approve-release-verify.mjs — ONE-79
 *
 * ONE runnable end-to-end proof of the OneComputer approval trust loop, exercised
 * against the REAL services on this VM (API :10254 + Postgres :5432) with REAL
 * Ed25519 Data Integrity crypto (no mocks). The full chain, in one script:
 *
 *   hold ──▶ approve ──▶ signed VC ──▶ verified ──▶ tamper-rejected
 *
 * PATH CHOICE (documented per the ticket constraint):
 *   The hold is created via POST /v1/internal/gateway/manual-approval — the
 *   *gateway-ingest bridge shape* (see routes/internal.ts). This is the exact
 *   durable record the Rust gateway would create when its MITM matches a
 *   `manual_approval` policy rule (apps/gateway/src/gateway/forward.rs builds a
 *   PendingApproval and calls the same createApproval path). Driving the live
 *   gateway MITM from a test is brittle (curl-through-proxy + ManualApproval
 *   rule + settle timing — see the older scripts/onecomputer/e2e-gateway-approval-proof.mjs,
 *   which is macOS-pathed and not runnable on this Linux VM). The trust loop the
 *   ticket asks us to prove — hold → approve → signed VC → verified →
 *   tamper-rejected — is fully exercised by the durable API + signer path below,
 *   against real Postgres and a real Ed25519 signature, without the gateway MITM.
 *
 *   If you DO want the gateway-MITM leg too, run e2e-gateway-approval-proof.mjs
 *   separately (it proves the held request is released after approve/deny). This
 *   script deliberately consolidates the *trust* loop into one runnable proof.
 *
 * STEPS:
 *   (a) hold          — POST /v1/internal/gateway/manual-approval  → ApprovalRequest(status=pending)
 *   (b) confirm hold  — GET /v1/internal/approvals/:id  → status=pending, context._vti.stepUpRequest present
 *   (c) approve       — POST /v1/internal/approvals/:id/decide {decision:approved}
 *                        → decideApprovalByBridgeId signs a real eddsa-jcs-2022 VC,
 *                          persists it into context._vti.decision (verify-on-write fail-closed)
 *   (d) confirm signed VC — read context._vti.decision: real proof.proofValue (multibase base58btc),
 *                            cryptosuite eddsa-jcs-2022, credentialSubject.decision=approved
 *   (e) confirm verify — GET /v1/internal/approvals/:id → vtiVerified=true, vtiVerifyError=null
 *   (f) tamper + reject — flip context._vti.decision.credentialSubject.decision approved→denied
 *                          directly in the DB row, then GET /v1/internal/approvals/:id →
 *                          vtiVerified=false (signature no longer verifies against the tampered payload)
 *
 * EXIT CODE: 0 on full pass, 1 on any failure. Prints a JSON summary.
 *
 * Usage:
 *   node scripts/onecomputer/e2e-hold-approve-release-verify.mjs
 *
 * Env (all optional — sensible defaults for this VM):
 *   API_URL                  default http://127.0.0.1:10254
 *   GATEWAY_INTERNAL_SECRET  default read from .env
 *   DATABASE_URL             default postgresql://onecomputer:onecomputer@localhost:5432/onecomputer
 *   ORGANIZATION_ID          default demo-corp-org
 *   PROJECT_ID               default demo-corp-team-field-sales
 *   AGENT_ID                 default b45114d8-986e-40c7-85f5-d20fa9b6e6c5 (demo alex-agent)
 *   REQUESTED_BY             default alex-agent
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from this script's location so the script is runnable
// from anywhere (it lives at <repo>/scripts/onecomputer/).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

// ── Config ───────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? "http://127.0.0.1:10254";

function loadEnv(key, fallback) {
  if (process.env[key]) return process.env[key];
  try {
    const envFile = readFileSync(join(REPO_ROOT, ".env"), "utf8");
    const match = envFile.match(new RegExp(`^${key}=(.+)$`, "m"));
    if (match) return match[1].trim();
  } catch {
    /* no .env */
  }
  return fallback;
}

const INTERNAL_SECRET =
  process.env.GATEWAY_INTERNAL_SECRET ?? loadEnv("GATEWAY_INTERNAL_SECRET", "");

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://onecomputer:onecomputer@localhost:5432/onecomputer";

const ORGANIZATION_ID = process.env.ORGANIZATION_ID ?? "demo-corp-org";
const PROJECT_ID = process.env.PROJECT_ID ?? "demo-corp-team-field-sales";
const AGENT_ID =
  process.env.AGENT_ID ?? "b45114d8-986e-40c7-85f5-d20fa9b6e6c5"; // demo alex-agent
const REQUESTED_BY = process.env.REQUESTED_BY ?? "alex-agent";

// ── Output ───────────────────────────────────────────────────────────────

const caveats = [];
const steps = {};
const out = { ok: false, steps, caveats };

// ── HTTP helpers ─────────────────────────────────────────────────────────

function internalHeaders() {
  return { "X-Gateway-Secret": INTERNAL_SECRET, "content-type": "application/json" };
}

async function http(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: internalHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

// ── Prisma (DB tamper step) ──────────────────────────────────────────────
//
// We import the generated Prisma client by absolute path (the pnpm store
// location). This keeps the script runnable as a standalone .mjs file with no
// build step — it does not need to live inside a tsconfig package. The path is
// resolved relative to the repo's node_modules; if pnpm bumps the versioned
// dir name the require fails loudly and we surface a clear error.
import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);

/**
 * Load the generated PrismaClient.
 *
 * pnpm's strict node_modules layout means `require.resolve("@prisma/client")`
 * from a standalone .mjs script does NOT find the package — it lives under a
 * versioned dir in `node_modules/.pnpm`. We resolve it by:
 *   1. trying the normal package name (works when run inside a package that
 *      declares the dep, or with a non-pnpm install);
 *   2. falling back to globbing the pnpm store path
 *      `node_modules/.pnpm/<@prisma+client@...>/node_modules/@prisma/client/index.js`
 *      (the `@prisma+client@<version>` dir name matches any version).
 * This keeps the script runnable with no build step and survives a pnpm
 * version bump (the glob matches any version).
 */
function loadPrismaClient() {
  try {
    const resolved = require.resolve("@prisma/client", {
      paths: [join(REPO_ROOT, "node_modules"), REPO_ROOT],
    });
    return require(resolved);
  } catch {
    // Fall through to the pnpm-store glob.
  }
  const pnpmDir = join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    throw new Error(
      `Cannot locate @prisma/client: no node_modules/.pnpm at ${pnpmDir}. Run "pnpm install" in the repo.`,
    );
  }
  const candidate = readdirSync(pnpmDir)
    .filter((d) => d.startsWith("@prisma+client@"))
    .sort()
    .map((d) =>
      join(pnpmDir, d, "node_modules", "@prisma", "client", "index.js"),
    )
    .find((p) => existsSync(p));
  if (!candidate) {
    throw new Error(
      "Cannot locate @prisma/client under node_modules/.pnpm. Run \"pnpm install\" then \"pnpm db:generate\".",
    );
  }
  return require(candidate);
}

// ── Assertions ────────────────────────────────────────────────────────────

function assert(name, condition, detail = "") {
  steps[name] = { ok: !!condition, detail: detail || undefined };
  if (!condition) {
    throw new Error(`assertion failed: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

let prisma;
let createdApprovalId;

async function main() {
  // ── Preflight ──────────────────────────────────────────────────────────
  if (!INTERNAL_SECRET) {
    throw new Error(
      "GATEWAY_INTERNAL_SECRET not set and not found in .env (repo root).",
    );
  }
  const healthRes = await fetch(`${API_URL}/v1/health`).catch(() => null);
  if (!healthRes || healthRes.status !== 200) {
    throw new Error(`API unhealthy at ${API_URL} (health check failed)`);
  }

  const { PrismaClient } = loadPrismaClient();
  prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } },
    log: ["error"],
  });

  const runId = `one79-${Date.now()}`;
  const action = "outlook.send_email";
  const holdContext = {
    host: "graph.microsoft.com",
    path: "/v1.0/me/sendMail",
    method: "POST",
    recipient: "ceo@example.com",
    subject: `ONE-79 e2e proof ${runId}`,
    body: "held-approve-release-verify chain proof",
  };

  // ── (a) HOLD: create the durable ApprovalRequest via the gateway-ingest
  //         bridge shape. This is exactly the record the Rust gateway MITM
  //         would create when forward.rs matches a ManualApproval rule. ────
  const createBody = {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    agentId: AGENT_ID,
    requestedBy: REQUESTED_BY,
    ruleId: `e2e-one79-${runId}`,
    action,
    host: holdContext.host,
    path: holdContext.path,
    method: holdContext.method,
    context: {
      recipient: holdContext.recipient,
      subject: holdContext.subject,
      runId,
    },
  };
  const createRes = await http("POST", "/v1/internal/gateway/manual-approval", createBody);
  assert(
    "a_hold_created",
    createRes.status === 201 && !!createRes.body?.id,
    `status=${createRes.status} body=${JSON.stringify(createRes.body).slice(0, 200)}`,
  );
  createdApprovalId = createRes.body.id;
  steps.a_hold_created.id = createdApprovalId;

  // ── (b) CONFIRM HOLD: read it back, status=pending, VTI step-up envelope
  //         was embedded at create time (proves the durable create path ran
  //         the full createApproval → VTI consent build). ──────────────────
  const holdReadRes = await http("GET", `/v1/internal/approvals/${createdApprovalId}`);
  assert(
    "b_hold_pending",
    holdReadRes.status === 200 && holdReadRes.body?.status === "pending",
    `status=${holdReadRes.status} body.status=${holdReadRes.body?.status}`,
  );
  const holdCtx = holdReadRes.body?.context ?? {};
  assert(
    "b_hold_vti_envelope",
    !!holdCtx?._vti?.stepUpRequest,
    "context._vti.stepUpRequest missing on held row",
  );

  // ── (c) APPROVE: POST /v1/internal/approvals/:id/decide {decision:approved}.
  //         decideApprovalByBridgeId flips status → approved, then signs a real
  //         eddsa-jcs-2022 VC over the decision (Ed25519 via @noble/ed25519),
  //         re-verifies it on write (fail-closed), and persists it into
  //         context._vti.decision. ────────────────────────────────────────
  const decideRes = await http(
    "POST",
    `/v1/internal/approvals/${createdApprovalId}/decide`,
    { decision: "approved", comment: `ONE-79 e2e approve ${runId}` },
  );
  assert(
    "c_approve_ok",
    decideRes.status === 200 && decideRes.body?.status === "approved",
    `status=${decideRes.status} body=${JSON.stringify(decideRes.body).slice(0, 200)}`,
  );

  // ── (d) CONFIRM SIGNED VC: pull the row from the DB directly and inspect
  //         context._vti.decision. It must be a real W3C VC 2.0 with an
  //         eddsa-jcs-2022 proof carrying a non-empty multibase proofValue. ─
  const row = await prisma.approvalRequest.findUnique({
    where: { id: createdApprovalId },
    select: { context: true, status: true },
  });
  const decisionVc = row?.context?._vti?.decision;
  assert("d_row_status_approved", row?.status === "approved", `row.status=${row?.status}`);
  assert(
    "d_decision_vc_present",
    !!decisionVc && Array.isArray(decisionVc["@context"]),
    "context._vti.decision is not a VC envelope",
  );
  const proof = decisionVc?.proof;
  assert(
    "d_real_eddsa_proof",
    proof?.cryptosuite === "eddsa-jcs-2022" &&
      proof?.type === "DataIntegrityProof" &&
      typeof proof?.proofValue === "string" &&
      proof.proofValue.length > 0,
    `proof=${JSON.stringify(proof).slice(0, 200)}`,
  );
  const subject = decisionVc?.credentialSubject;
  assert(
    "d_vc_subject_binds_decision",
    subject?.approvalId === createdApprovalId && subject?.decision === "approved",
    `credentialSubject=${JSON.stringify(subject).slice(0, 200)}`,
  );

  // ── (e) CONFIRM VERIFY-ON-READ: GET /v1/internal/approvals/:id re-verifies
  //         the persisted VC against the gateway's did:web public key and
  //         returns vtiVerified=true. ───────────────────────────────────────
  const verifyRes = await http("GET", `/v1/internal/approvals/${createdApprovalId}`);
  assert(
    "e_vti_verified_true",
    verifyRes.status === 200 && verifyRes.body?.vtiVerified === true,
    `status=${verifyRes.status} vtiVerified=${verifyRes.body?.vtiVerified} err=${verifyRes.body?.vtiVerifyError}`,
  );
  assert(
    "e_no_verify_error",
    verifyRes.body?.vtiVerifyError === null || verifyRes.body?.vtiVerifyError === undefined,
    `vtiVerifyError=${verifyRes.body?.vtiVerifyError}`,
  );

  // ── (f) TAMPER + REJECT: flip the signed payload's `decision` field
  //         approved→denied directly in the DB row's context._vti.decision
  //         .credentialSubject.decision. The VC's signature was computed over
  //         the JCS-canonical credential (which includes credentialSubject), so
  //         this mutation invalidates the signature. The next GET must read
  //         vtiVerified=false. ─────────────────────────────────────────────
  const tamperedContext = JSON.parse(JSON.stringify(row.context));
  tamperedContext._vti.decision.credentialSubject.decision = "denied";
  await prisma.approvalRequest.update({
    where: { id: createdApprovalId },
    data: { context: tamperedContext },
  });

  const tamperedRes = await http("GET", `/v1/internal/approvals/${createdApprovalId}`);
  assert(
    "f_tamper_rejected",
    tamperedRes.status === 200 && tamperedRes.body?.vtiVerified === false,
    `status=${tamperedRes.status} vtiVerified=${tamperedRes.body?.vtiVerified}`,
  );
  // The verify error should mention a signature/tamper failure (not "no VC").
  const tamperErr = String(tamperedRes.body?.vtiVerifyError ?? "");
  assert(
    "f_tamper_error_explains",
    tamperErr.length > 0 &&
      !/no signed decision VC/i.test(tamperErr),
    `vtiVerifyError="${tamperErr}"`,
  );

  out.ok = true;
}

try {
  await main();
} catch (err) {
  out.ok = false;
  caveats.push(err.message);
} finally {
  // Best-effort: leave the demo row in its tampered state is fine (it's a
  // proof row), but disconnect the Prisma client so the process exits cleanly.
  try {
    await prisma?.$disconnect();
  } catch {
    /* ignore */
  }
}

// Also record the approval id at top level for quick triage from the summary.
if (createdApprovalId) out.approvalId = createdApprovalId;

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
