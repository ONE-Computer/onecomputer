#!/usr/bin/env node

// Dev/staging operator harness. It uses the OpenVTC browser-wallet core to
// mint/load a did:peer:2 holder identity and persists the core's own record in
// an owner-only JSON file. Production browser/mobile wallets must replace the
// passthrough secret storage with WebAuthn PRF/Keychain-backed custody.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const storePath = process.env.OPENVTC_WALLET_STORE;
const mediatorDid = process.env.OPENVTC_MEDIATOR_DID;
const coreRoot = process.env.OPENVTC_CORE_DIST ?? "/usr/local/lib/openvtc/vta-browser-plugin/packages/core/dist";
const { generateOrLoadHolderIdentity } = await import(
  pathToFileURL(`${coreRoot}/store/holder-identity.js`).href,
);

if (!storePath || !mediatorDid) {
  throw new Error("OPENVTC_WALLET_STORE and OPENVTC_MEDIATOR_DID are required");
}

class FileKvStore {
  constructor(path) {
    this.path = path;
    this.state = null;
  }

  async load() {
    if (this.state) return;
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = {};
    }
  }

  async flush() {
    await mkdir(new URL(".", `file://${this.path}`).pathname, { recursive: true }).catch(() => {});
    await writeFile(this.path, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async get(key) {
    await this.load();
    return this.state[key];
  }

  async put(key, value) {
    await this.load();
    this.state[key] = value;
    await this.flush();
  }

  async delete(key) {
    await this.load();
    delete this.state[key];
    await this.flush();
  }

  async keys(prefix) {
    await this.load();
    return Object.keys(this.state).filter((key) => !prefix || key.startsWith(prefix));
  }
}

const store = new FileKvStore(storePath);
const { identity, signing, freshlyMinted } = await generateOrLoadHolderIdentity(store, {
  mediatorDid,
});

// Only public identity metadata is printed. The persisted file contains the
// private wallet material and must never be logged or committed.
console.log(JSON.stringify({
  did: signing.did,
  signingKid: signing.kid,
  keyAgreementKid: identity.kid,
  freshlyMinted,
}));
identity.dispose();
