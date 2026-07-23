// Security behavior is adapted from OpenVTC/vta-browser-plugin's Apache-2.0
// approver identity and WebAuthn PRF wrap at commit 68b4d6c8d19203fac4b1ff401fa56bd8c564175c.
// ONEComputer keeps the same KEK domain and one-gesture-per-decision model while
// limiting the profile to Trust Tasks HTTPS enrollment, polling, and decisions.
const STORE_NAME = "onecomputer-openvtc";
const RECORD_KEY = "browser-approver-v1";
const ENROLLMENT_TYPE = "https://onecomputer.dev/spec/openvtc/approver-enrollment/0.1";
const REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
const DECISION_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.1";
const WRAP_INFO = "pnm/approver-secret/aes-gcm/v1";
const WRAP_AAD = new TextEncoder().encode("onecomputer/openvtc/browser-approver/v1");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PREFIX = Uint8Array.of(0xed, 0x01);

const bytesToBase64url = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const base64urlToBytes = (value) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const base58Encode = (bytes) => {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
};

const base58Decode = (value) => {
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;
  const bytes = [];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("The approval request uses an invalid signing key.");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const output = new Uint8Array(zeros + bytes.length);
  for (let index = 0; index < bytes.length; index += 1) output[output.length - 1 - index] = bytes[index];
  return output;
};

const canonicalize = (value) => {
  if (value === null || value === true || value === false) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The signed document contains an invalid number.");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("The signed document is not valid JSON.");
};

const sha256 = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value));

const signingInput = async (document, proof) => {
  const [proofHash, documentHash] = await Promise.all([sha256(canonicalize(proof)), sha256(canonicalize(document))]);
  const output = new Uint8Array(proofHash.length + documentHash.length);
  output.set(proofHash);
  output.set(documentHash, proofHash.length);
  return output;
};

const didKey = (publicKey) => {
  const multicodec = new Uint8Array(ED25519_PREFIX.length + publicKey.length);
  multicodec.set(ED25519_PREFIX);
  multicodec.set(publicKey, ED25519_PREFIX.length);
  const multikey = `z${base58Encode(multicodec)}`;
  const did = `did:key:${multikey}`;
  return { did, verificationMethod: `${did}#${multikey}` };
};

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(STORE_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("records");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const databaseOperation = async (mode, operation) => {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("records", mode);
      const request = operation(transaction.objectStore("records"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const readRecord = () => databaseOperation("readonly", (store) => store.get(RECORD_KEY));
const writeRecord = (record) => databaseOperation("readwrite", (store) => store.put(record, RECORD_KEY));
export const clearBrowserApprover = async (expectedDid) => {
  const record = await readRecord();
  if (!record || (expectedDid && record.did !== expectedDid)) return false;
  await databaseOperation("readwrite", (store) => store.delete(RECORD_KEY));
  return true;
};
export const hasBrowserApprover = async (expectedDid) => {
  const record = await readRecord();
  return Boolean(record && (!expectedDid || record.did === expectedDid));
};
export const getBrowserApproverIdentity = async () => {
  const record = await readRecord();
  if (!record) return null;
  if (!record.installationId) {
    record.installationId = crypto.randomUUID();
    await writeRecord(record);
  }
  return {
    did: record.did,
    verificationMethod: record.verificationMethod,
    installationId: record.installationId,
  };
};

const deriveWrapKey = async (prfOutput) => {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(),
    info: new TextEncoder().encode(WRAP_INFO),
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
};

const wrapBundle = async (bundle, key) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: WRAP_AAD }, key, plaintext);
  return { iv: bytesToBase64url(iv), ciphertext: bytesToBase64url(new Uint8Array(ciphertext)) };
};

const unwrapBundle = async (record, key) => {
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64urlToBytes(record.iv),
    additionalData: WRAP_AAD,
  }, key, base64urlToBytes(record.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
};

const prfOutput = (credential) => {
  const output = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  if (!output) throw new Error("This browser or device did not return a WebAuthn PRF. Use current Chrome with Windows Hello, Touch ID, or a compatible security key.");
  return new Uint8Array(output);
};

const createPrfCredential = async () => {
  if (!window.PublicKeyCredential) {
    throw new Error("This browser does not support device-verified approval.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { id: location.hostname, name: "ONEComputer" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "onecomputer-approver", displayName: "ONEComputer approval device" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -8 }, { type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  if (!credential) throw new Error("Device enrollment was cancelled.");
  return { credentialId: new Uint8Array(credential.rawId), salt, output: prfOutput(credential) };
};

const unlockRecord = async (payloadDigest) => {
  const record = await readRecord();
  if (!record) throw new Error("This browser is not enrolled as an approval device.");
  const challenge = payloadDigest ? await sha256(payloadDigest) : crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      rpId: location.hostname,
      challenge,
      allowCredentials: [{ type: "public-key", id: base64urlToBytes(record.credentialId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: base64urlToBytes(record.prfSalt) } } },
    },
  });
  if (!assertion) throw new Error("Device verification was cancelled.");
  const key = await deriveWrapKey(prfOutput(assertion));
  return { record, bundle: await unwrapBundle(record, key) };
};

const signDocument = async (document, privateKeyPkcs8, verificationMethod) => {
  const created = document.issuedAt;
  const proof = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", verificationMethod, created, proofPurpose: "assertionMethod" };
  const privateKey = await crypto.subtle.importKey("pkcs8", base64urlToBytes(privateKeyPkcs8), { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, await signingInput(document, proof)));
  return { ...document, proof: { ...proof, proofValue: `z${base58Encode(signature)}` } };
};

export async function enrollBrowserApprover(challenge, displayName, enroll, rollback) {
  const credential = await createPrfCredential();
  const wrapKey = await deriveWrapKey(credential.output);
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const privateKeyPkcs8 = bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey)));
  const identifiers = didKey(publicKey);
  const issuedAt = new Date().toISOString();
  const unsigned = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: ENROLLMENT_TYPE,
    issuer: identifiers.did,
    recipient: challenge.recipientDid,
    issuedAt,
    expiresAt: challenge.expiresAt,
    payload: {
      challenge: challenge.challenge,
      tenantId: challenge.tenantId,
      subjectId: challenge.subjectId,
      verificationMethod: identifiers.verificationMethod,
      displayName,
    },
  };
  const document = await signDocument(unsigned, privateKeyPkcs8, identifiers.verificationMethod);
  const response = await enroll(document);
  const bundle = { privateKeyPkcs8, transportToken: response.transportToken, executorDid: challenge.recipientDid };
  const wrapped = await wrapBundle(bundle, wrapKey);
  try {
    await writeRecord({
      version: 1,
      installationId: crypto.randomUUID(),
      did: identifiers.did,
      verificationMethod: identifiers.verificationMethod,
      credentialId: bytesToBase64url(credential.credentialId),
      prfSalt: bytesToBase64url(credential.salt),
      ...wrapped,
    });
  } catch (error) {
    await rollback?.(identifiers.did).catch(() => undefined);
    throw new Error("The device key could not be saved in this browser profile. The incomplete enrollment was removed; check that persistent site storage is enabled and try again.", { cause: error });
  }
  return { did: identifiers.did, displayName, ...(await getBrowserApproverIdentity()) };
}

const verifyRequest = async (request, record, executorDid) => {
  if (!request || request.type !== REQUEST_TYPE || request.issuer !== executorDid || request.recipient !== record.did) {
    throw new Error("The approval request is not addressed by the enrolled ONEComputer executor to this browser.");
  }
  if (Date.parse(request.payload?.expiresAt) <= Date.now()) throw new Error("This approval request has expired.");
  const proof = request.proof;
  const multikey = String(request.issuer).slice("did:key:".length);
  if (!proof || proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022"
    || proof.proofPurpose !== "assertionMethod" || proof.verificationMethod !== `${request.issuer}#${multikey}`
    || typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) {
    throw new Error("The approval request does not carry a supported executor proof.");
  }
  const decoded = base58Decode(multikey.slice(1));
  if (decoded.length !== 34 || decoded[0] !== ED25519_PREFIX[0] || decoded[1] !== ED25519_PREFIX[1]) throw new Error("The executor proof key is invalid.");
  const proofConfig = { ...proof };
  delete proofConfig.proofValue;
  const document = { ...request };
  delete document.proof;
  const publicKey = await crypto.subtle.importKey("raw", decoded.slice(2), { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("Ed25519", publicKey, base58Decode(proof.proofValue.slice(1)), await signingInput(document, proofConfig));
  if (!valid) throw new Error("The executor signature on this approval request is invalid.");
  return request;
};

export async function loadPendingApproval(fetchInbox, executorDid) {
  const record = await readRecord();
  if (!record) throw new Error("This browser is not enrolled as an approval device.");
  const request = await fetchInbox();
  return request ? verifyRequest(request, record, executorDid) : null;
}

export async function signApprovalDecision(request, decision) {
  const payloadDigest = request?.payload?.payloadDigest;
  if (typeof payloadDigest !== "string") throw new Error("The pending request does not contain an operation digest.");
  const { record, bundle } = await unlockRecord(payloadDigest);
  await verifyRequest(request, record, bundle.executorDid);
  const issuedAt = new Date().toISOString();
  return {
    transportToken: bundle.transportToken,
    document: await signDocument({
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: DECISION_TYPE,
      issuer: record.did,
      recipient: request.issuer,
      issuedAt,
      payload: {
        challenge: request.payload.challenge,
        payloadDigest,
        decision,
        reason: decision === "approve" ? "The user verified the signed effects." : "The user rejected this operation.",
      },
    }, bundle.privateKeyPkcs8, record.verificationMethod),
  };
}
