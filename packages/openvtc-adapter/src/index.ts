import { createHash, createPrivateKey, createPublicKey, sign as signBytes, type KeyObject, verify as verifySignature } from "node:crypto";

export const TASK_CONSENT_REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
export const TASK_CONSENT_DECISION_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.1";

export type TaskConsentDecision = "approve" | "deny";

export type VerifyTaskConsentDecisionInput = {
  document: unknown;
  expected: {
    recipientDid: string;
    challenge: string;
    payloadDigest: string;
    enrolledApproverDids: readonly string[];
    requestIssuedAt: string;
    requestExpiresAt: string;
    requesterDid?: string;
    excludeRequester?: boolean;
  };
  now?: Date;
  clockSkewMs?: number;
};

export type VerifiedTaskConsentDecision = {
  verified: true;
  taskId: string;
  signerDid: string;
  decision: TaskConsentDecision;
  reason: string | null;
  issuedAt: string;
  proofCreatedAt: string;
  challenge: string;
  payloadDigest: string;
  proofHash: string;
  documentHash: string;
};

export type RejectedTaskConsentDecision = {
  verified: false;
  code:
    | "INVALID_DOCUMENT"
    | "UNSUPPORTED_TYPE"
    | "INVALID_BINDING"
    | "INVALID_TIME"
    | "INVALID_PROOF"
    | "UNENROLLED_APPROVER"
    | "REQUESTER_EXCLUDED";
  reason: string;
};

export type VerifyTaskConsentDecisionResult = VerifiedTaskConsentDecision | RejectedTaskConsentDecision;

type JsonObject = Record<string, unknown>;

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TASK_CONSENT_DIGEST_DOMAIN = Buffer.from("vta/task-consent/v1\0", "utf8");
const ED25519_MULTICODEC_PREFIX = Uint8Array.of(0xed, 0x01);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const reject = (code: RejectedTaskConsentDecision["code"], reason: string): RejectedTaskConsentDecision => ({
  verified: false,
  code,
  reason,
});

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value: JsonObject, required: readonly string[], optional: readonly string[] = []) => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest();

export type TaskConsentEffect = {
  kind: string;
  summary: string;
  path?: string;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown>;
};

export type BuildTaskConsentRequestInput = {
  id: string;
  issuerDid: string;
  recipientDid: string;
  verificationMethod: string;
  issuedAt: string;
  expiresAt: string;
  challenge: string;
  taskType: string;
  taskPayload: unknown;
  requesterDid: string;
  approverSet: string;
  minApprovals: number;
  excludeRequester: boolean;
  sideEffects: "none" | "readOnly" | "mutating" | "destructive";
  exposure: { discloses: "none" | "metadata" | "secret"; actsAsSubject: boolean };
  effects: readonly TaskConsentEffect[];
  consequences?: readonly string[];
  subject?: string;
  origin?: string;
  statePin?: { resource: string; version: string };
  sign: (signingInput: Uint8Array) => Uint8Array | Promise<Uint8Array>;
};

/**
 * RFC 8785 JSON Canonicalization Scheme implementation. Kept byte-compatible
 * with OpenVTC/vta-browser-plugin's Apache-2.0 canonical.ts implementation.
 */
export function jcsCanonicalize(value: unknown): string {
  const seen = new WeakSet<object>();

  const encodeString = (input: string) => {
    let output = "\"";
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      if (code === 0x22) output += "\\\"";
      else if (code === 0x5c) output += "\\\\";
      else if (code === 0x08) output += "\\b";
      else if (code === 0x0c) output += "\\f";
      else if (code === 0x0a) output += "\\n";
      else if (code === 0x0d) output += "\\r";
      else if (code === 0x09) output += "\\t";
      else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, "0")}`;
      else output += input[index];
    }
    return `${output}\"`;
  };

  const encode = (input: unknown): string => {
    if (input === null) return "null";
    if (input === true) return "true";
    if (input === false) return "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("JCS rejects non-finite numbers");
      return Object.is(input, -0) ? "0" : String(input);
    }
    if (typeof input === "string") return encodeString(input);
    if (Array.isArray(input)) {
      if (seen.has(input)) throw new Error("circular reference in JCS input");
      seen.add(input);
      const output = `[${input.map(encode).join(",")}]`;
      seen.delete(input);
      return output;
    }
    if (isObject(input)) {
      if (seen.has(input)) throw new Error("circular reference in JCS input");
      seen.add(input);
      const output = `{${Object.keys(input).sort().map((key) => `${encodeString(key)}:${encode(input[key])}`).join(",")}}`;
      seen.delete(input);
      return output;
    }
    throw new Error(`JCS cannot encode value of type ${typeof input}`);
  };

  return encode(value);
}

export function base58btcEncode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    let carry = bytes[index] as number;
    for (let digit = 0; digit < digits.length; digit += 1) {
      carry += (digits[digit] as number) << 8;
      digits[digit] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

export function base58btcDecode(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;
  const bytes: number[] = [];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error(`invalid base58btc character: ${character}`);
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] as number) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const output = new Uint8Array(zeros + bytes.length);
  for (let index = 0; index < bytes.length; index += 1) output[output.length - 1 - index] = bytes[index] as number;
  if (base58btcEncode(output) !== value) throw new Error("non-canonical base58btc value");
  return output;
}

export function didKeyFromEd25519PublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  const multikey = base58btcEncode(Uint8Array.from([...ED25519_MULTICODEC_PREFIX, ...publicKey]));
  return `did:key:z${multikey}`;
}

export class Ed25519DidKeySigner {
  readonly did: string;
  readonly verificationMethod: string;

  constructor(private readonly privateKey: KeyObject) {
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("OpenVTC executor key must be Ed25519");
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    if (spki.length !== ED25519_SPKI_PREFIX.length + 32 || !spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
      throw new Error("OpenVTC executor public key has an unexpected encoding");
    }
    this.did = didKeyFromEd25519PublicKey(spki.subarray(ED25519_SPKI_PREFIX.length));
    this.verificationMethod = `${this.did}#${this.did.slice("did:key:".length)}`;
  }

  static fromPkcs8Base64(value: string) {
    const der = Buffer.from(value, "base64");
    if (!der.length) throw new Error("OpenVTC executor private key is empty");
    return new Ed25519DidKeySigner(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  }

  sign(input: Uint8Array) {
    return signBytes(null, input, this.privateKey);
  }
}

/** Upstream VTA salted wire digest from policy/consent.rs. */
export function taskConsentPayloadDigest(taskType: string, taskPayload: unknown, challenge: string): string {
  if (!taskType || !challenge) throw new Error("task type and challenge are required");
  const typeBytes = Buffer.from(taskType, "utf8");
  const payloadBytes = Buffer.from(jcsCanonicalize(taskPayload), "utf8");
  const typeLength = Buffer.alloc(8);
  const payloadLength = Buffer.alloc(8);
  typeLength.writeBigUInt64BE(BigInt(typeBytes.length));
  payloadLength.writeBigUInt64BE(BigInt(payloadBytes.length));
  return createHash("sha256")
    .update(TASK_CONSENT_DIGEST_DOMAIN)
    .update(typeLength)
    .update(typeBytes)
    .update(payloadLength)
    .update(payloadBytes)
    .update(challenge, "utf8")
    .digest("hex");
}

export async function buildTaskConsentRequest(input: BuildTaskConsentRequestInput): Promise<JsonObject> {
  if (!input.id || !input.issuerDid || !input.recipientDid || !input.requesterDid || !input.approverSet) throw new Error("task-consent identity fields are required");
  if (input.challenge.length < 16) throw new Error("task-consent challenge must be at least 16 characters");
  if (!Number.isInteger(input.minApprovals) || input.minApprovals < 1) throw new Error("minApprovals must be a positive integer");
  if (input.excludeRequester && input.requesterDid === input.recipientDid) throw new Error("excluded requester cannot be a request recipient");
  if (parseTimestamp(input.issuedAt) === null || parseTimestamp(input.expiresAt) === null || Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) {
    throw new Error("task-consent request timestamps are invalid");
  }
  if (!input.effects.length && !input.consequences?.length) throw new Error("task-consent request must describe at least one effect or consequence");
  for (const effect of input.effects) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(effect.kind) || !effect.summary) throw new Error("task-consent effect is invalid");
  }

  const payload: JsonObject = {
    challenge: input.challenge,
    taskType: input.taskType,
    payloadDigest: taskConsentPayloadDigest(input.taskType, input.taskPayload, input.challenge),
    sideEffects: input.sideEffects,
    exposure: input.exposure,
    effects: input.effects,
    requester: input.requesterDid,
    approverSet: input.approverSet,
    minApprovals: input.minApprovals,
    excludeRequester: input.excludeRequester,
    expiresAt: input.expiresAt,
  };
  if (input.consequences) payload.consequences = input.consequences;
  if (input.subject) payload.subject = input.subject;
  if (input.origin) payload.origin = input.origin;
  if (input.statePin) payload.statePin = input.statePin;

  const document: JsonObject = {
    id: input.id,
    type: TASK_CONSENT_REQUEST_TYPE,
    issuer: input.issuerDid,
    recipient: input.recipientDid,
    issuedAt: input.issuedAt,
    payload,
  };
  const proofConfig: JsonObject = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: input.verificationMethod,
    created: input.issuedAt,
    proofPurpose: "assertionMethod",
  };
  const signature = await input.sign(taskConsentSigningInput(document, proofConfig));
  if (signature.length !== 64) throw new Error("Ed25519 signature must be 64 bytes");
  document.proof = { ...proofConfig, proofValue: `z${base58btcEncode(signature)}` };
  return document;
}

function publicKeyFromDidKey(did: string, verificationMethod: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("only did:key approver keys are supported");
  const multibase = did.slice("did:key:z".length);
  if (verificationMethod !== `${did}#z${multibase}`) throw new Error("verificationMethod is not the canonical did:key assertion method");
  const decoded = base58btcDecode(multibase);
  if (decoded.length !== 34 || decoded[0] !== ED25519_MULTICODEC_PREFIX[0] || decoded[1] !== ED25519_MULTICODEC_PREFIX[1]) {
    throw new Error("did:key verification method is not Ed25519");
  }
  return decoded.slice(2);
}

export function taskConsentSigningInput(document: JsonObject, proofConfig: JsonObject): Buffer {
  return Buffer.concat([
    sha256(jcsCanonicalize(proofConfig)),
    sha256(jcsCanonicalize(document)),
  ]);
}

export function verifyTaskConsentDecision(input: VerifyTaskConsentDecisionInput): VerifyTaskConsentDecisionResult {
  const document = input.document;
  if (!isObject(document)) return reject("INVALID_DOCUMENT", "decision must be a JSON object");
  if (document.type !== TASK_CONSENT_DECISION_TYPE) return reject("UNSUPPORTED_TYPE", "unsupported task-consent decision type");
  if (typeof document.id !== "string" || document.id.length === 0) return reject("INVALID_DOCUMENT", "decision id is required");
  if (typeof document.issuer !== "string" || typeof document.recipient !== "string") return reject("INVALID_DOCUMENT", "issuer and recipient are required");
  if (document.recipient !== input.expected.recipientDid) return reject("INVALID_BINDING", "decision recipient does not match this executor");

  const payload = document.payload;
  if (!isObject(payload) || !hasExactKeys(payload, ["challenge", "payloadDigest", "decision"], ["reason", "ext"])) {
    return reject("INVALID_DOCUMENT", "decision payload has an invalid shape");
  }
  if (typeof payload.challenge !== "string" || payload.challenge.length < 16) return reject("INVALID_DOCUMENT", "challenge must be at least 16 characters");
  if (typeof payload.payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(payload.payloadDigest)) return reject("INVALID_DOCUMENT", "payloadDigest must be lowercase SHA-256 hex");
  if (payload.decision !== "approve" && payload.decision !== "deny") return reject("INVALID_DOCUMENT", "decision must be approve or deny");
  if (payload.reason !== undefined && typeof payload.reason !== "string") return reject("INVALID_DOCUMENT", "reason must be a string");
  if (payload.ext !== undefined && !isObject(payload.ext)) return reject("INVALID_DOCUMENT", "ext must be an object");
  if (payload.challenge !== input.expected.challenge || payload.payloadDigest !== input.expected.payloadDigest) {
    return reject("INVALID_BINDING", "decision does not match the pending challenge and payload digest");
  }

  const now = (input.now ?? new Date()).getTime();
  const skew = input.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const issuedAt = parseTimestamp(document.issuedAt);
  const requestIssuedAt = parseTimestamp(input.expected.requestIssuedAt);
  const requestExpiresAt = parseTimestamp(input.expected.requestExpiresAt);
  const documentExpiresAt = document.expiresAt === undefined ? null : parseTimestamp(document.expiresAt);
  if (issuedAt === null || requestIssuedAt === null || requestExpiresAt === null || (document.expiresAt !== undefined && documentExpiresAt === null)) {
    return reject("INVALID_TIME", "decision or request timestamps are invalid");
  }
  if (now >= requestExpiresAt || (documentExpiresAt !== null && now >= documentExpiresAt)) return reject("INVALID_TIME", "approval request or decision has expired");
  if (issuedAt < requestIssuedAt - skew || issuedAt > now + skew || issuedAt >= requestExpiresAt) {
    return reject("INVALID_TIME", "decision issuedAt is outside the live request window");
  }

  const proof = document.proof;
  if (!isObject(proof) || !hasExactKeys(proof, ["type", "cryptosuite", "verificationMethod", "created", "proofPurpose", "proofValue"])) {
    return reject("INVALID_PROOF", "decision proof has an invalid shape");
  }
  if (proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022" || proof.proofPurpose !== "assertionMethod") {
    return reject("INVALID_PROOF", "unsupported Data Integrity proof configuration");
  }
  if (typeof proof.verificationMethod !== "string" || typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) {
    return reject("INVALID_PROOF", "proof verificationMethod or proofValue is invalid");
  }
  const proofCreatedAt = parseTimestamp(proof.created);
  if (proofCreatedAt === null || proofCreatedAt < requestIssuedAt - skew || proofCreatedAt > now + skew || proofCreatedAt >= requestExpiresAt) {
    return reject("INVALID_TIME", "proof created timestamp is outside the live request window");
  }

  const signerDid = document.issuer;
  let publicKey: Uint8Array;
  let signature: Uint8Array;
  try {
    publicKey = publicKeyFromDidKey(signerDid, proof.verificationMethod);
    signature = base58btcDecode(proof.proofValue.slice(1));
  } catch (error) {
    return reject("INVALID_PROOF", error instanceof Error ? error.message : "proof key could not be resolved");
  }
  if (signature.length !== 64) return reject("INVALID_PROOF", "Ed25519 signature must be 64 bytes");

  const proofConfig = { ...proof };
  delete proofConfig.proofValue;
  const documentWithoutProof = { ...document };
  delete documentWithoutProof.proof;
  let signingInput: Buffer;
  try {
    signingInput = taskConsentSigningInput(documentWithoutProof, proofConfig);
  } catch {
    return reject("INVALID_PROOF", "decision cannot be canonicalized");
  }
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]),
    format: "der",
    type: "spki",
  });
  if (!verifySignature(null, signingInput, publicKeyObject, signature)) return reject("INVALID_PROOF", "signature verification failed");

  if (!input.expected.enrolledApproverDids.includes(signerDid)) return reject("UNENROLLED_APPROVER", "proven signer is not currently enrolled");
  if (input.expected.excludeRequester && input.expected.requesterDid === signerDid) {
    return reject("REQUESTER_EXCLUDED", "requester cannot approve this operation");
  }

  return {
    verified: true,
    taskId: document.id,
    signerDid,
    decision: payload.decision,
    reason: typeof payload.reason === "string" ? payload.reason : null,
    issuedAt: document.issuedAt as string,
    proofCreatedAt: proof.created as string,
    challenge: payload.challenge,
    payloadDigest: payload.payloadDigest,
    proofHash: sha256(jcsCanonicalize(proof)).toString("hex"),
    documentHash: sha256(jcsCanonicalize(document)).toString("hex"),
  };
}
