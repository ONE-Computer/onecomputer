/**
 * vti-credential-signer.ts — Data Integrity `eddsa-jcs-2022` VC signing.
 *
 * This is the TypeScript counterpart to the gateway's Rust `vti_signer.rs`
 * (which delegates to the affinidi TDK). It signs a W3C Verifiable Credential
 * 2.0 envelope with a real Ed25519 Data Integrity proof, fully in-process on
 * the API side, so the manager-approval decide route can produce a
 * cryptographically verifiable decision record without an HTTP round-trip to
 * the Rust gateway.
 *
 * Why not call the gateway? The gateway's signer (`apps/gateway/src/vti_signer.rs`)
 * is NOT exposed over HTTP — `apps/gateway/src/gateway.rs:224-309` only mounts
 * vault + approvals routes, no `/sign` or `/verify` endpoint. Wiring a new
 * gateway HTTP route + Rust rebuild per approval is heavier than the value.
 * Porting the suite to TS keeps the signature real (Ed25519 over JCS-canonical
 * SHA-256) and interop with the same key seed (`ONECLI_GATEWAY_SIGNING_KEY`,
 * base64 Ed25519 seed), so a proof signed here will verify against the public
 * key in the gateway's did:web DID document.
 *
 * Crypto is delegated to `@noble/ed25519` + `@noble/hashes` (audited,
 * WebCrypto-grade). No custom signature math. JCS canonicalization is in
 * `./jcs.ts` (RFC 8785). Multibase base58btc encoding is in `./multibase.ts`.
 *
 * Spec: https://www.w3.org/TR/vc-di-eddsa-1.1/ (eddsa-jcs-2022 suite, §3.3).
 */
import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";

const sha256 = (data: Uint8Array): Uint8Array =>
  createHash("sha256").update(data).digest();
import { canonicalizeJson } from "./jcs";
import { encodeBase58Btc, decodeBase58Btc } from "./multibase";

// `@noble/ed25519` v2+ leaves the SHA-512 backend unset by default — the sync
// `getPublicKey` / `sign` APIs throw "hashes.sha512 not set" until a sync
// SHA-512 implementation is wired onto `ed.hashes.sha512`. We use Node's
// built-in `node:crypto` (synchronous, audited, no new dependency) so the
// signing key can be derived synchronously. This mirrors the gateway's
// in-process Ed25519 derivation (affinidi TDK uses `ed25519-dalek`, which
// bundles its own SHA-512) — the *signature* math is still `@noble/ed25519`;
// only the hash backend is supplied by the platform.
//
// Configured once at module load. Idempotent: re-assigning the same fn is a
// no-op.
ed.hashes.sha512 = ((msg: Uint8Array): Uint8Array =>
  createHash("sha512").update(msg).digest()) as (typeof ed.hashes)["sha512"];

const CREDENTIALS_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

/** A loaded Ed25519 keypair, derived from the gateway's signing key seed. */
export interface SigningKey {
  /** 32-byte Ed25519 private seed. */
  seed: Uint8Array;
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  /** did:web DID of the issuer, e.g. `did:web:onecomputer.local`. */
  did: string;
  /** Verification method id (`<did>#key-1`). */
  verificationMethodId: string;
}

/**
 * Build a `did:web:<host>` identifier from a base URL, mirroring the gateway's
 * `vti_signer::gateway_did` (strips scheme/path/port, keeps bare host).
 */
export const didWebFromBaseUrl = (baseUrl: string): string => {
  const host = baseUrl.replace(/^https:\/\//, "").replace(/^http:\/\//, "");
  const end = host.search(/[/:]/);
  const bare = end === -1 ? host : host.slice(0, end);
  return `did:web:${bare || "localhost"}`;
};

/**
 * Whether the API process is running in a dev/local context. Mirrors the
 * gateway's `vti_signer::is_dev_environment()`. Dev is signalled by
 * `NODE_ENV === 'development'` (Next.js / Node convention) OR an explicit
 * `ONECOMPUTER_ENV` of `dev`/`local`/`development`. An unset `ONECOMPUTER_ENV`
 * defers to `NODE_ENV` (so a production NODE_ENV with no ONECOMPUTER_ENV is
 * NOT dev), while `ONECOMPUTER_ENV=dev` opts a production build into the
 * ephemeral fallback for local dev.
 */
export const isDevEnvironment = (): boolean => {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  const ocEnv = process.env.ONECOMPUTER_ENV ?? "";
  return ocEnv === "dev" || ocEnv === "local" || ocEnv === "development";
};

/**
 * Load the Ed25519 signing key from `ONECLI_GATEWAY_SIGNING_KEY` (base64 32-byte
 * seed). When unset, an ephemeral key is generated and a warning is logged —
 * mirroring `vti_signer::load_signing_key` — **but only in dev**. In non-dev
 * environments (`NODE_ENV !== 'development'`), an unset key throws at call time
 * so a misconfigured production deployment cannot silently rotate the signing
 * key on every restart (which would make all previously-signed VCs read
 * `vtiVerified=false`). The issuer DID is derived from
 * `ONECLI_GATEWAY_PUBLIC_URL` (default `localhost`) so the verification method
 * resolves to the gateway's did:web document.
 */
export const loadSigningKey = (): SigningKey => {
  const baseUrl = process.env.ONECLI_GATEWAY_PUBLIC_URL ?? "localhost";
  const did = didWebFromBaseUrl(baseUrl);
  const verificationMethodId = `${did}#key-1`;

  const b64 = process.env.ONECLI_GATEWAY_SIGNING_KEY;
  if (!b64) {
    // Non-dev environments must fail closed: an ephemeral key would not
    // persist across restarts, so every restart rotates the key and all
    // previously-signed VCs read vtiVerified=false. Mirrors the gateway's
    // `is_dev_environment()` gate (vti_signer.rs).
    if (!isDevEnvironment()) {
      throw new Error(
        "ONECLI_GATEWAY_SIGNING_KEY is required in non-dev environments — " +
          "set it to a base64-encoded 32-byte Ed25519 seed " +
          "(generate one with: head -c 32 /dev/urandom | base64). " +
          "The key MUST be set identically on the API and gateway processes " +
          "and sourced from a secret manager / KMS.",
      );
    }
    // Ephemeral key (dev only). Signatures won't persist across restarts, but
    // the proof still verifies against this process's public key (exposed via
    // buildDidDocument). Mirrors the gateway's ephemeral fallback.
    const seed = ed.utils.randomSecretKey();
    return {
      seed,
      // `getPublicKey` (sync) derives the 32-byte Ed25519 public key from the
      // seed using synchronous SHA-512 — no Promise. Storing a resolved
      // Uint8Array (not a Promise) here is what lets `buildDidDocument` spread
      // `...key.publicKey` synchronously. `signAsync`/`verifyAsync` below work
      // against either form; we keep the public key eagerly materialized so
      // `SigningKey` is a plain data object the decide route can hold without
      // an `await` at construction time.
      publicKey: ed.getPublicKey(seed),
      did,
      verificationMethodId,
    };
  }

  // Decode base64 (accept standard or url-safe, with or without pad) — matches
  // the gateway's tolerant decoding in vti_signer::load_signing_key.
  const seed = decodeBase64Flexible(b64.trim());
  if (seed.length !== 32) {
    throw new Error(
      `ONECLI_GATEWAY_SIGNING_KEY must decode to exactly 32 bytes (Ed25519 seed), got ${seed.length}`,
    );
  }
  return {
    seed,
    publicKey: ed.getPublicKey(seed),
    did,
    verificationMethodId,
  };
};

/** Synchronous variant — used when the caller already holds a seed. */
export const signingKeyFromSeed = (
  seed: Uint8Array,
  did: string,
  verificationMethodId = `${did}#key-1`,
): SigningKey => {
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  return {
    seed,
    publicKey: ed.getPublicKey(seed),
    did,
    verificationMethodId,
  };
};

/**
 * Derive the self-certifying Ed25519 did:key used by OpenVTC wallets.
 *
 * The multibase value is the Ed25519 Multikey (0xed01) followed by the raw
 * public key. A did:key verification method uses that same multibase value as
 * its fragment, e.g. `did:key:z6Mk...#z6Mk...`.
 */
export const didKeyFromPublicKey = (publicKey: Uint8Array) => {
  if (publicKey.length !== 32) {
    throw new Error(
      `Ed25519 public key must be 32 bytes, got ${publicKey.length}`,
    );
  }
  const multibase = encodeBase58Btc(new Uint8Array([0xed, 0x01, ...publicKey]));
  const did = `did:key:${multibase}`;
  return {
    did,
    verificationMethodId: `${did}#${multibase}`,
    publicKeyMultibase: multibase,
  };
};

const decodeBase64Flexible = (s: string): Uint8Array => {
  // Node's Buffer accepts both standard and url-safe base64 with/without pad.
  return new Uint8Array(Buffer.from(s, "base64"));
};

export interface ProofConfig {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string; // RFC 3339
  verificationMethod: string; // did:web:...#key-1
  proofPurpose: "assertionMethod";
}

export interface SignedCredential {
  "@context": string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: unknown;
  proof: ProofConfig & { proofValue: string };
}

/**
 * Compute the 64-byte `hashData` for an eddsa-jcs-2022 proof:
 *   hashData = SHA256(JCS(proofConfig)) || SHA256(JCS(document))
 * (proof-config hash FIRST, document hash second — per spec §3.3.4).
 */
const computeHashData = (
  document: unknown,
  proofConfig: ProofConfig,
): Uint8Array => {
  const canonicalDoc = canonicalizeJson(document);
  const canonicalProof = canonicalizeJson(proofConfig);
  const docHash = sha256(canonicalDoc);
  const proofHash = sha256(canonicalProof);
  const combined = new Uint8Array(64);
  combined.set(proofHash, 0);
  combined.set(docHash, 32);
  return combined;
};

/** Build the DID document that the OpenVTC did:key resolver derives locally. */
export const buildDidKeyDocument = (did: string) => {
  const multibase = did.startsWith("did:key:")
    ? did.slice("did:key:".length)
    : "";
  if (!multibase.startsWith("z")) {
    throw new Error("OpenVTC approver must use a base58btc did:key");
  }
  const raw = decodeBase58Btc(multibase);
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) {
    throw new Error("OpenVTC did:key is not an Ed25519 Multikey");
  }
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#${multibase}`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: multibase,
      },
    ],
    assertionMethod: [`${did}#${multibase}`],
  };
};

/**
 * Build the self-resolving did:peer:2 document emitted by the OpenVTC
 * browser/mobile wallet core. The peer method encodes the X25519
 * key-agreement key in the `E` segment and the Ed25519 authentication key in
 * the `V` segment; the segment order maps to `#key-1` / `#key-2`.
 *
 * This parser is intentionally narrow: it accepts only the canonical
 * self-contained numalgo-2 shape we use for manager wallets, and it never
 * trusts a public key claimed by the response outside the DID itself.
 */
export const buildDidPeerDocument = (did: string) => {
  const prefix = "did:peer:2.";
  if (!did.startsWith(prefix)) {
    throw new Error("OpenVTC approver must use a did:peer:2 identity");
  }
  const segments = did.slice(prefix.length).split(".");
  const keyAgreementSegment = segments.find((segment) =>
    segment.startsWith("E"),
  );
  const authenticationSegment = segments.find((segment) =>
    segment.startsWith("V"),
  );
  if (!keyAgreementSegment || !authenticationSegment) {
    throw new Error("did:peer:2 identity is missing E/V key segments");
  }
  const keyAgreementMultibase = keyAgreementSegment.slice(1);
  const authenticationMultibase = authenticationSegment.slice(1);
  const keyAgreement = decodeBase58Btc(keyAgreementMultibase);
  const authentication = decodeBase58Btc(authenticationMultibase);
  if (
    keyAgreement.length !== 34 ||
    keyAgreement[0] !== 0xec ||
    keyAgreement[1] !== 0x01
  ) {
    throw new Error("did:peer:2 keyAgreement is not an X25519 Multikey");
  }
  if (
    authentication.length !== 34 ||
    authentication[0] !== 0xed ||
    authentication[1] !== 0x01
  ) {
    throw new Error("did:peer:2 authentication key is not an Ed25519 Multikey");
  }
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: keyAgreementMultibase,
      },
      {
        id: `${did}#key-2`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: authenticationMultibase,
      },
    ],
    keyAgreement: [`${did}#key-1`],
    authentication: [`${did}#key-2`],
    assertionMethod: [`${did}#key-2`],
  };
};

/**
 * Verify a wallet-signed OpenVTC Trust-Task document locally.
 *
 * This verifier accepts only self-resolving did:key and canonical did:peer:2
 * identities. It never accepts an arbitrary DID and a separately claimed key;
 * a future did:webvh path must resolve and validate the DID document through a
 * pinned OpenVTC resolver/trust registry before it is enabled here.
 */
export const verifyTrustTaskProof = async (
  document: Record<string, unknown>,
): Promise<{ ok: true; signer: string } | { ok: false; error: string }> => {
  const proof = document.proof;
  const issuer = document.issuer;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { ok: false, error: "Trust Task has no proof" };
  }
  if (
    typeof issuer !== "string" ||
    (!issuer.startsWith("did:key:") && !issuer.startsWith("did:peer:2."))
  ) {
    return {
      ok: false,
      error: "Trust Task issuer is not a supported OpenVTC DID",
    };
  }
  const proofRecord = proof as Record<string, unknown>;
  if (
    proofRecord.type !== "DataIntegrityProof" ||
    proofRecord.cryptosuite !== "eddsa-jcs-2022" ||
    proofRecord.proofPurpose !== "assertionMethod" ||
    typeof proofRecord.verificationMethod !== "string" ||
    typeof proofRecord.created !== "string" ||
    typeof proofRecord.proofValue !== "string"
  ) {
    return { ok: false, error: "Trust Task proof is not a valid DI proof" };
  }
  let didDocument:
    | ReturnType<typeof buildDidKeyDocument>
    | ReturnType<typeof buildDidPeerDocument>;
  try {
    didDocument = issuer.startsWith("did:key:")
      ? buildDidKeyDocument(issuer)
      : buildDidPeerDocument(issuer);
  } catch (error) {
    return {
      ok: false,
      error: `invalid OpenVTC DID: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const expectedVerificationMethod = didDocument.verificationMethod.find(
    (method) =>
      method.id === proofRecord.verificationMethod &&
      method.publicKeyMultibase?.startsWith("z"),
  );
  if (!expectedVerificationMethod) {
    return { ok: false, error: "Trust Task proof key is not the issuer key" };
  }
  const unsigned = { ...document };
  delete unsigned.proof;
  const proofConfig = { ...proofRecord };
  delete proofConfig.proofValue;
  let signature: Uint8Array;
  try {
    signature = decodeBase58Btc(proofRecord.proofValue);
  } catch (error) {
    return {
      ok: false,
      error: `invalid Trust Task proofValue: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let valid = false;
  try {
    const raw = decodeBase58Btc(expectedVerificationMethod.publicKeyMultibase);
    valid = await ed.verifyAsync(
      signature,
      computeHashData(unsigned, proofConfig as unknown as ProofConfig),
      raw.slice(2),
    );
  } catch (error) {
    return {
      ok: false,
      error: `invalid Trust Task proof: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return valid
    ? { ok: true, signer: issuer }
    : { ok: false, error: "Trust Task signature does not verify" };
};

/** RFC 3339 timestamp in UTC with millisecond precision truncated to seconds. */
const rfc3339Now = (now: Date = new Date()): string =>
  now.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Sign a credential subject as a W3C VC 2.0 with an eddsa-jcs-2022 Data
 * Integrity proof. The `subject` becomes the `credentialSubject` of the
 * signed VC. Returns the VC with the embedded `proof.proofValue`
 * (multibase base58btc of the 64-byte Ed25519 signature).
 *
 * The proof is real Ed25519 (RFC 8032) over the JCS-canonicalized document +
 * proof config. Tampering with the document after signing invalidates the
 * signature (see `verifyCredential`).
 */
export const signCredential = async (
  subject: unknown,
  key: SigningKey,
): Promise<SignedCredential> => {
  const now = rfc3339Now();
  const credential = {
    "@context": [CREDENTIALS_V2_CONTEXT],
    type: ["VerifiableCredential"],
    issuer: key.did,
    issuanceDate: now,
    credentialSubject: subject,
  };

  const proofConfig: ProofConfig = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: now,
    verificationMethod: key.verificationMethodId,
    proofPurpose: "assertionMethod",
  };

  const hashData = computeHashData(credential, proofConfig);
  const signature = await ed.signAsync(hashData, key.seed);
  const proofValue = encodeBase58Btc(signature);

  return {
    ...credential,
    proof: { ...proofConfig, proofValue },
  };
};

/**
 * Sign an arbitrary Trust-Task document with the RP's Data Integrity key.
 *
 * This is deliberately limited to the RP-authored request side of a flow.
 * The manager's approve-response is produced by the external OpenVTC wallet
 * and is verified by the gateway; the API never signs on the manager's behalf.
 */
export const signTrustTask = async (
  document: Record<string, unknown>,
  key: SigningKey,
): Promise<Record<string, unknown>> => {
  const now = rfc3339Now();
  const proofConfig: ProofConfig = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: now,
    verificationMethod: key.verificationMethodId,
    proofPurpose: "assertionMethod",
  };
  const hashData = computeHashData(document, proofConfig);
  const signature = await ed.signAsync(hashData, key.seed);
  return {
    ...document,
    proof: { ...proofConfig, proofValue: encodeBase58Btc(signature) },
  };
};

export interface VerifyResult {
  ok: boolean;
  error?: string;
  /** The unsigned VC (sans proof) on success. */
  credential?: Omit<SignedCredential, "proof">;
}

/**
 * Verify an eddsa-jcs-2022 Data Integrity proof against a DID document's
 * public key. Returns `{ ok: true, credential }` on success, or
 * `{ ok: false, error }` when the signature is invalid or the verification
 * method is missing.
 *
 * `issuerDidDoc` is the issuer's did:web document (see `buildDidDocument`);
 * its `verificationMethod` array is searched for the proof's
 * `verificationMethod` to obtain the 32-byte Ed25519 public key. No network
 * I/O — the caller fetches/caches the DID document.
 */
export const verifyCredential = async (
  signed: SignedCredential,
  issuerDidDoc: unknown,
): Promise<VerifyResult> => {
  const proof = signed.proof;
  if (!proof || proof.cryptosuite !== "eddsa-jcs-2022") {
    return { ok: false, error: "missing or non-eddsa-jcs-2022 proof" };
  }

  // Resolve the public key from the DID document by verification method id.
  const pubKey = resolvePublicKey(issuerDidDoc, proof.verificationMethod);
  if (!pubKey) {
    return {
      ok: false,
      error: `verificationMethod ${proof.verificationMethod} not found in DID document`,
    };
  }

  // Reconstruct the unsigned credential (drop the proof field) and the proof
  // config (the proof WITHOUT proofValue).
  const { proofValue, ...proofConfig } = proof;
  const credential: Omit<SignedCredential, "proof"> = {
    "@context": signed["@context"],
    type: signed.type,
    issuer: signed.issuer,
    issuanceDate: signed.issuanceDate,
    credentialSubject: signed.credentialSubject,
  };

  const hashData = computeHashData(credential, proofConfig);

  let signature: Uint8Array;
  try {
    signature = decodeBase58Btc(proofValue);
  } catch (e) {
    return {
      ok: false,
      error: `failed to decode proofValue: ${(e as Error).message}`,
    };
  }

  const valid = await ed.verifyAsync(signature, hashData, pubKey);
  if (!valid) {
    return {
      ok: false,
      error: "signature does not verify (tampered payload or key mismatch)",
    };
  }

  return { ok: true, credential };
};

/**
 * Extract the 32-byte Ed25519 public key for a verification method from a DID
 * document. Supports `publicKeyMultibase` (Multikey, `0xed01` prefix) and
 * `publicKeyJwk` (JsonWebKey2020, `crv: Ed25519`). Mirrors the resolver in
 * `vti_signer::DidDocResolver`.
 */
const resolvePublicKey = (
  didDoc: unknown,
  verificationMethodId: string,
): Uint8Array | null => {
  if (!didDoc || typeof didDoc !== "object") return null;
  const methods = (didDoc as { verificationMethod?: unknown })
    .verificationMethod;
  if (!Array.isArray(methods)) return null;

  const entry = methods.find(
    (m): m is Record<string, unknown> =>
      !!m &&
      typeof m === "object" &&
      (m as { id?: unknown }).id === verificationMethodId,
  );
  if (!entry) return null;

  const mb = entry.publicKeyMultibase;
  if (typeof mb === "string") {
    const raw = decodeBase58Btc(mb);
    // Multikey Ed25519: 2-byte prefix 0xed 0x01, then 32-byte public key.
    if (raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01) {
      return raw.slice(2);
    }
    // Some encodings omit the multikey prefix and store the raw 32 bytes.
    if (raw.length === 32) return raw;
    return null;
  }

  const jwk = entry.publicKeyJwk as
    | { crv?: string; x?: string; kty?: string }
    | undefined;
  if (jwk && jwk.crv === "Ed25519" && typeof jwk.x === "string") {
    return new Uint8Array(Buffer.from(jwk.x, "base64url"));
  }

  return null;
};

/**
 * Build a minimal did:web DID document exposing the public key as a Multikey
 * verification method. This is the document shape `verifyCredential` consumes,
 * and mirrors `vti_signer::build_did_doc` in the gateway.
 */
export const buildDidDocument = (key: SigningKey) => ({
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/multikey/v1",
  ],
  id: key.did,
  verificationMethod: [
    {
      id: key.verificationMethodId,
      type: "Multikey",
      controller: key.did,
      publicKeyMultibase: encodeBase58Btc(
        new Uint8Array([0xed, 0x01, ...key.publicKey]),
      ),
    },
  ],
  assertionMethod: [key.verificationMethodId],
});
