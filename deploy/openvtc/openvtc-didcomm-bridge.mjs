#!/usr/bin/env node

// ONEComputer -> OpenVTC DIDComm adapter.
//
// This process deliberately owns only a transport identity. It never loads
// the manager wallet store and cannot sign an approval response. ONEComputer
// POSTs the already RP-signed Trust Task to localhost; this adapter wraps it
// in an authenticated DIDComm message and relays it through the OpenVTC
// mediator to the manager wallet DID.

import { createServer } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

const coreRoot = process.env.OPENVTC_CORE_DIST ?? "/home/azureuser/work/vta-browser-plugin/packages/core/dist";
const core = await import(pathToFileURL(`${coreRoot}/index.js`).href);
const didcomm = await import(pathToFileURL(`${coreRoot}/didcomm/index.js`).href);

const storePath = process.env.OPENVTC_BRIDGE_STORE ?? "/var/lib/openvtc/bridge/identity.json";
const mediatorDid = required("OPENVTC_MEDIATOR_DID");
const vtaDid = required("OPENVTC_VTA_DID");
const managerDid = required("OPENVTC_APPROVER_DID");
const mediatorEnrollmentEnabled = process.env.OPENVTC_MEDIATOR_ENROLL === "1";
const directDeliveryEnabled = process.env.OPENVTC_MEDIATOR_DIRECT_DELIVERY === "1";
const host = process.env.OPENVTC_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENVTC_BRIDGE_PORT ?? "18130");
const maxBodyBytes = 2 * 1024 * 1024;

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

const { identity } = await core.generateOrLoadHolderIdentity(new FileKvStore(storePath), { mediatorDid });
const manager = await core.resolveKeyAgreement(managerDid);
let connection;
let connectPromise;

async function ensureConnection() {
  if (connection?.isOpen) return connection;
  if (!connectPromise) {
    connectPromise = core.connectMediatorSession({
      holder: identity,
      mediatorDid,
      vtaDid,
      onClose: () => { connection = undefined; },
    }).then(async (next) => {
      if (mediatorEnrollmentEnabled) {
        await enrollMediator(next);
      } else {
        console.log(JSON.stringify({
          event: "openvtc_bridge_mediator_enrollment_skipped",
          reason: "staging_mediator_has_no_coordinate_mediation_protocol",
        }));
      }
      connection = next;
      return next;
    }).finally(() => { connectPromise = undefined; });
  }
  return connectPromise;
}

async function enrollMediator(active) {
  const mediator = new core.MediatorClient({
    holder: identity,
    mediator: {
      did: active.mediator.did,
      keyAgreementKid: active.mediator.keyAgreementKid,
      keyAgreementPublicJwk: active.mediator.keyAgreementPublicJwk,
    },
    bridge: {
      send: async (outer) => active.send(outer),
      sendAndAwaitReply: async (outer, requestId, options) => {
        const reply = active.waitFor(requestId, options?.timeoutMs ?? 30000);
        active.send(outer);
        return reply;
      },
    },
  });
  await mediator.requestMediation();
  await mediator.updateKeylist([{ recipient_did: identity.did, action: "add" }]);
}

async function sendTask(approvalId, document) {
  const active = await ensureConnection();
  const message = {
    id: `urn:uuid:${globalThis.crypto.randomUUID()}`,
    typ: "application/didcomm-plain+json",
    type: "https://onecomputer.openvtc/approval/1.0",
    from: identity.did,
    to: [managerDid],
    created_time: Math.floor(Date.now() / 1000),
    body: { protocol: "onecomputer-openvtc-approval", approvalId, document },
  };
  const inner = await didcomm.packAuthcryptJson(
    JSON.stringify(message),
    identity,
    [{ kid: manager.keyAgreementKid, jwk: manager.keyAgreementPublicJwk }],
  );
  // The staging mediator has retained the manager account's historical
  // RECEIVE_MESSAGES grant but not RECEIVE_FORWARDED. Use direct authenticated
  // delivery on the same mediator only when explicitly configured. Production
  // uses the normal forward envelope after explicit ACL/keylist bootstrap.
  const outer = directDeliveryEnabled
    ? inner
    : await didcomm.packAuthcryptJson(
      didcomm.wrapForward(managerDid, identity.did, mediatorDid, inner),
      identity,
      [{ kid: active.mediator.keyAgreementKid, jwk: active.mediator.keyAgreementPublicJwk }],
    );
  active.send(outer);
  return { adapter: "openvtc-didcomm-bridge", receiptId: `didcomm:${approvalId}` };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("request body must be JSON")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/tasks") {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readJson(req);
    if (typeof body?.approvalId !== "string" || !body.document || typeof body.document !== "object") {
      throw new Error("approvalId and document are required");
    }
    if (body.document.recipient !== managerDid) {
      throw new Error("Trust Task recipient is not the configured manager wallet");
    }
    const receipt = await sendTask(body.approvalId, body.document);
    res.writeHead(202, { "content-type": "application/json" }).end(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" }).end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: "openvtc_didcomm_bridge_started", host, port, transportDid: identity.did }));
});

const stop = () => {
  server.close();
  connection?.close();
  identity.dispose();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
