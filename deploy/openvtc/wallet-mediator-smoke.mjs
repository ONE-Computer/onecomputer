#!/usr/bin/env node

// OpenVTC wallet transport smoke test. It deliberately uses the OpenVTC
// browser-wallet core for holder loading and mediator DIDComm, and logs only
// public metadata / message type. It does not print wallet secrets or task
// payloads.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { connectMediatorSession } from "../../../openvtc/vta-browser-plugin/packages/core/dist/didcomm/index.js";
import { generateOrLoadHolderIdentity } from "../../../openvtc/vta-browser-plugin/packages/core/dist/store/holder-identity.js";

const storePath = process.env.OPENVTC_WALLET_STORE;
const mediatorDid = process.env.OPENVTC_MEDIATOR_DID;
const vtaDid = process.env.OPENVTC_VTA_DID;
const waitMs = Number(process.env.OPENVTC_WALLET_WAIT_MS ?? "10000");

if (!storePath || !mediatorDid || !vtaDid) {
  throw new Error("OPENVTC_WALLET_STORE, OPENVTC_MEDIATOR_DID and OPENVTC_VTA_DID are required");
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

const { identity } = await generateOrLoadHolderIdentity(new FileKvStore(storePath), { mediatorDid });
let connection;
try {
  connection = await connectMediatorSession({ holder: identity, mediatorDid, vtaDid });
  console.log(JSON.stringify({ event: "wallet_mediator_connected", did: identity.did }));
  connection.onInbound((message) => {
    console.log(JSON.stringify({
      event: "wallet_inbound_message",
      type: typeof message?.type === "string" ? message.type : "unknown",
      id: typeof message?.id === "string" ? message.id : undefined,
      thid: typeof message?.thid === "string" ? message.thid : undefined,
    }));
  });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
} finally {
  connection?.close();
  identity.dispose();
}
