#!/usr/bin/env node

// Separate OpenVTC manager wallet CLI/service.
//
// `serve` owns the manager holder key, authenticates to the OpenVTC mediator,
// verifies RP-signed Trust Tasks, and writes pending requests to an owner-only
// queue. `approve <approval-id>` is the explicit operator action: it signs an
// approve-response/0.2 with the holder's Ed25519 identity and submits only
// that signed document to ONEComputer. No portal cookie or UI decision is
// accepted here.

import { createServer } from "node:http";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

const coreRoot = process.env.OPENVTC_CORE_DIST ?? "/home/azureuser/work/vta-browser-plugin/packages/core/dist";
const core = await import(pathToFileURL(`${coreRoot}/index.js`).href);
const didcomm = await import(pathToFileURL(`${coreRoot}/didcomm/index.js`).href);
const trustTasks = await import(pathToFileURL(`${coreRoot}/trust-tasks/index.js`).href);

const mode = process.argv[2] ?? "serve";
const storePath = process.env.OPENVTC_WALLET_STORE ?? "/var/lib/openvtc/wallet/manager-wallet.json";
const pendingDir = process.env.OPENVTC_WALLET_PENDING_DIR ?? "/var/lib/openvtc/wallet/pending";
const mediatorDid = required("OPENVTC_MEDIATOR_DID");
const vtaDid = required("OPENVTC_VTA_DID");
const expectedManagerDid = process.env.OPENVTC_APPROVER_DID;
const mediatorEnrollmentEnabled = process.env.OPENVTC_MEDIATOR_ENROLL === "1";
const decisionBase = process.env.OPENVTC_DECISION_BASE_URL ?? "http://127.0.0.1:10254/v1/openvtc-approvals";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

class FileKvStore {
  constructor(path) { this.path = path; this.state = null; }
  async load() {
    if (this.state) return;
    try { this.state = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error?.code !== "ENOENT") throw error; this.state = {}; }
  }
  async flush() {
    await mkdir(new URL(".", `file://${this.path}`).pathname, { recursive: true }).catch(() => {});
    await writeFile(this.path, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
  async get(key) { await this.load(); return this.state[key]; }
  async put(key, value) { await this.load(); this.state[key] = value; await this.flush(); }
  async delete(key) { await this.load(); delete this.state[key]; await this.flush(); }
  async keys(prefix) { await this.load(); return Object.keys(this.state).filter((key) => !prefix || key.startsWith(prefix)); }
}

const store = new FileKvStore(storePath);
const { identity, signing } = await core.generateOrLoadHolderIdentity(store, { mediatorDid });
if (expectedManagerDid && identity.did !== expectedManagerDid) {
  throw new Error("manager wallet DID does not match OPENVTC_APPROVER_DID");
}

const safeId = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
const pendingPath = (approvalId) => `${pendingDir}/${safeId(approvalId)}.json`;

// The Azure demo gateway serves its did:web document on loopback. The wallet
// still verifies the RP signature through that document; did:peer and other
// self-resolving OpenVTC DIDs use the core resolver unchanged.
const resolveDid = async (did) => {
  if (did === "did:web:onecomputer.local") {
    const response = await fetch("http://127.0.0.1:10255/.well-known/did.json");
    if (!response.ok) throw new Error(`ONEComputer DID document unavailable: HTTP ${response.status}`);
    return response.json();
  }
  return core.resolveDidDocument(did);
};

async function handleInbound(message) {
  if (message?.type !== "https://onecomputer.openvtc/approval/1.0") return;
  const body = message.body;
  const document = body?.document;
  const approvalId = body?.approvalId;
  if (body?.protocol !== "onecomputer-openvtc-approval" || typeof approvalId !== "string" || !document || typeof document !== "object") {
    console.log(JSON.stringify({ event: "openvtc_wallet_rejected_message", reason: "invalid_message_shape" }));
    return;
  }
  if (document.recipient !== identity.did || document.type !== "https://trusttasks.org/spec/auth/step-up/approve-request/0.1") {
    console.log(JSON.stringify({ event: "openvtc_wallet_rejected_message", approvalId, reason: "wrong_recipient_or_type" }));
    return;
  }
  const proof = await trustTasks.verifyTrustTaskProof(document, { expectedProofPurpose: "assertionMethod", resolveDid });
  if (!proof.verified || proof.signer !== document.issuer) {
    console.log(JSON.stringify({ event: "openvtc_wallet_rejected_message", approvalId, reason: proof.reason ?? "request_proof_failed" }));
    return;
  }
  await mkdir(pendingDir, { recursive: true, mode: 0o700 });
  const record = {
    status: "pending",
    approvalId,
    receivedAt: new Date().toISOString(),
    messageId: message.id,
    document,
  };
  await writeFile(pendingPath(approvalId), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await chmod(pendingPath(approvalId), 0o600);
  console.log(JSON.stringify({ event: "openvtc_wallet_alert", approvalId, type: document.type }));
}

async function enrollMediator(connection) {
  const mediator = new core.MediatorClient({
    holder: identity,
    mediator: {
      did: connection.mediator.did,
      keyAgreementKid: connection.mediator.keyAgreementKid,
      keyAgreementPublicJwk: connection.mediator.keyAgreementPublicJwk,
    },
    bridge: {
      send: async (outer) => connection.send(outer),
      sendAndAwaitReply: async (outer, requestId, options) => {
        const reply = connection.waitFor(requestId, options?.timeoutMs ?? 30000);
        connection.send(outer);
        return reply;
      },
    },
  });
  await mediator.requestMediation();
  await mediator.updateKeylist([{ recipient_did: identity.did, action: "add" }]);
}

async function serve() {
  const connection = await core.connectMediatorSession({
    holder: identity,
    mediatorDid,
    vtaDid,
    onClose: () => console.log(JSON.stringify({ event: "openvtc_wallet_mediator_disconnected" })),
  });
  if (mediatorEnrollmentEnabled) {
    await enrollMediator(connection);
  } else {
    console.log(JSON.stringify({
      event: "openvtc_wallet_mediator_enrollment_skipped",
      reason: "staging_mediator_has_no_coordinate_mediation_protocol",
    }));
  }
  connection.onInbound((message) => { void handleInbound(message); });
  console.log(JSON.stringify({ event: "openvtc_wallet_started", did: identity.did }));
  await new Promise((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  connection.close();
}

async function approve(approvalId, decision = "approved") {
  if (!approvalId) throw new Error("approval id is required");
  const path = pendingPath(approvalId);
  const record = JSON.parse(await readFile(path, "utf8"));
  if (record.status !== "pending") throw new Error(`approval ${approvalId} is already ${record.status}`);
  const request = record.document;
  const payload = request.payload;
  const response = await trustTasks.signTrustTask({
    envelope: {
      id: `urn:uuid:${globalThis.crypto.randomUUID()}`,
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      issuer: signing.did,
      recipient: request.issuer,
      issuedAt: new Date().toISOString(),
      payload: {
        subject: payload.subject,
        sessionId: payload.sessionId,
        challenge: payload.challenge,
        decision,
        ...(decision === "approved" ? { grantedAcr: "aal2" } : { deniedReason: "manager denied" }),
      },
    },
    signing,
  });
  const responseBody = await fetch(`${decisionBase}/${encodeURIComponent(approvalId)}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document: response }),
  });
  if (!responseBody.ok) throw new Error(`ONEComputer rejected wallet decision: HTTP ${responseBody.status}`);
  record.status = decision;
  record.decidedAt = new Date().toISOString();
  record.response = response;
  await writeFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ event: "openvtc_wallet_decision_submitted", approvalId, decision }));
}

try {
  if (mode === "serve") await serve();
  else if (mode === "approve" || mode === "deny") await approve(process.argv[3], mode === "approve" ? "approved" : "denied");
  else throw new Error(`unknown mode ${mode}; use serve, approve, or deny`);
} finally {
  identity.dispose();
}
