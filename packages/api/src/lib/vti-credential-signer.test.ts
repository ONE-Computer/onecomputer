import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signCredential,
  verifyCredential,
  buildDidDocument,
  didWebFromBaseUrl,
  signingKeyFromSeed,
  loadSigningKey,
  isDevEnvironment,
  didKeyFromPublicKey,
  signTrustTask,
  verifyTrustTaskProof,
} from "./vti-credential-signer";
import { canonicalizeJson } from "./jcs";
import { encodeBase58Btc, decodeBase58Btc } from "./multibase";

// Deterministic 32-byte seed for reproducible tests.
const SEED = new Uint8Array(32).fill(7);
const DID = "did:web:gw.example.com";
const key = signingKeyFromSeed(SEED, DID);

describe("didWebFromBaseUrl", () => {
  it("strips scheme, port, and path", () => {
    expect(didWebFromBaseUrl("https://gw.example.com")).toBe(
      "did:web:gw.example.com",
    );
    expect(didWebFromBaseUrl("http://localhost:8080/path")).toBe(
      "did:web:localhost",
    );
    expect(didWebFromBaseUrl("gw.example.com")).toBe("did:web:gw.example.com");
    expect(didWebFromBaseUrl("localhost")).toBe("did:web:localhost");
  });
});

describe("multibase base58btc roundtrip", () => {
  it("round-trips arbitrary bytes including leading zeros", () => {
    const cases = [
      new Uint8Array([0]),
      new Uint8Array([0, 0, 1, 2, 3]),
      new Uint8Array(Array.from({ length: 64 }, (_, i) => i % 256)),
      new Uint8Array(64).fill(0xff),
    ];
    for (const bytes of cases) {
      const encoded = encodeBase58Btc(bytes);
      expect(encoded[0]).toBe("z");
      const decoded = decodeBase58Btc(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });

  it("matches the canonical Ed25519 public key multikey prefix", () => {
    // Ed25519 Multikey = 0xed 0x01 || 32-byte pubkey.
    const multikey = encodeBase58Btc(
      new Uint8Array([0xed, 0x01, ...key.publicKey]),
    );
    expect(multikey[0]).toBe("z");
    // Decoding back yields the 34-byte multikey payload.
    expect(decodeBase58Btc(multikey).length).toBe(34);
  });
});

describe("JCS canonicalization", () => {
  it("sorts keys and produces deterministic output", () => {
    const a = canonicalizeJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalizeJson({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(Buffer.from(a).toString()).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
    expect(Buffer.from(a)).toEqual(b);
  });

  it("escapes control characters and quotes", () => {
    const out = canonicalizeJson({ msg: 'he said "hi"\n\tbye' });
    expect(Buffer.from(out).toString()).toBe(
      '{"msg":"he said \\"hi\\"\\n\\tbye"}',
    );
  });

  it("rejects NaN and Infinity", () => {
    expect(() => canonicalizeJson({ x: NaN })).toThrow();
    expect(() => canonicalizeJson({ x: Infinity })).toThrow();
  });
});

describe("eddsa-jcs-2022 sign/verify", () => {
  it("signs a credential subject and the proof verifies", async () => {
    const didDoc = buildDidDocument(key);
    const subject = {
      approvalId: "appr-123",
      decision: "approved",
      decidedBy: "manager-alice",
      approvedAt: "2026-07-05T18:00:00Z",
      requestedActionDigest: "sha256:abcdef",
    };

    const signed = await signCredential(subject, key);
    expect(signed.proof.cryptosuite).toBe("eddsa-jcs-2022");
    expect(signed.proof.type).toBe("DataIntegrityProof");
    expect(signed.proof.proofValue[0]).toBe("z");
    expect(signed.proof.verificationMethod).toBe(`${DID}#key-1`);

    const result = await verifyCredential(signed, didDoc);
    expect(result.ok).toBe(true);
    expect(result.credential?.credentialSubject).toEqual(subject);
  });

  it("FAILS verification when the payload is tampered (approved->denied)", async () => {
    const didDoc = buildDidDocument(key);
    const signed = await signCredential(
      { approvalId: "appr-456", decision: "approved" },
      key,
    );

    // Tamper with the credentialSubject decision after signing. This changes
    // the canonicalized document hash, so the signature no longer matches.
    (signed.credentialSubject as { decision: string }).decision = "denied";

    const result = await verifyCredential(signed, didDoc);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tampered|signature|invalid/i);
  });

  it("FAILS when the proofValue itself is mutated", async () => {
    const didDoc = buildDidDocument(key);
    const signed = await signCredential({ approvalId: "appr-789" }, key);

    // Flip a character deep in the proofValue (past the 'z' prefix) so the
    // base58 still decodes but the signature bytes change.
    const pv = signed.proof.proofValue.split("");
    const idx = pv.length - 4;
    const cur = pv[idx] ?? "z";
    pv[idx] = cur === "z" ? "y" : String.fromCharCode(cur.charCodeAt(0) + 1);
    signed.proof.proofValue = pv.join("");

    const result = await verifyCredential(signed, didDoc);
    expect(result.ok).toBe(false);
  });

  it("FAILS when verified against a different issuer's DID document", async () => {
    const signed = await signCredential({ approvalId: "appr-000" }, key);

    // A different key's DID document → public key mismatch → verify fails.
    const otherKey = signingKeyFromSeed(
      new Uint8Array(32).fill(99),
      "did:web:other.example.com",
    );
    const otherDidDoc = buildDidDocument(otherKey);

    // But signed.proof.verificationMethod points at `key`'s method, which
    // otherDidDoc doesn't contain → resolver error.
    const result = await verifyCredential(signed, otherDidDoc);
    expect(result.ok).toBe(false);

    // And even if we point the proof at otherKey's method, the signature
    // won't verify under otherKey's public key.
    const { proofValue } = signed.proof;
    const tamperedProof = {
      ...signed.proof,
      verificationMethod: otherKey.verificationMethodId,
    };
    const tamperedSigned = { ...signed, proof: tamperedProof };
    void proofValue;
    const result2 = await verifyCredential(tamperedSigned, otherDidDoc);
    expect(result2.ok).toBe(false);
  });

  it("is deterministic: same seed → same signature (interop with gateway key)", async () => {
    // The same seed must produce the same public key and the same signature
    // over the same payload — this is what makes a proof persisted on an
    // approval verifiable later by re-loading ONECLI_GATEWAY_SIGNING_KEY.
    const k1 = signingKeyFromSeed(SEED, DID);
    const k2 = signingKeyFromSeed(SEED, DID);
    expect(Array.from(k1.publicKey)).toEqual(Array.from(k2.publicKey));

    const s1 = await signCredential({ a: 1 }, k1);
    const s2 = await signCredential({ a: 1 }, k1);
    expect(s1.proof.proofValue).toBe(s2.proof.proofValue);
  });
});

describe("OpenVTC did:key Trust Tasks", () => {
  it("verifies a canonical wallet approval and rejects tampering", async () => {
    const identity = didKeyFromPublicKey(key.publicKey);
    const wallet = signingKeyFromSeed(
      SEED,
      identity.did,
      identity.verificationMethodId,
    );
    const document = await signTrustTask(
      {
        id: "urn:uuid:approval-1",
        type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
        issuer: identity.did,
        recipient: "did:web:onecomputer.example",
        issuedAt: "2026-07-12T00:00:00Z",
        payload: {
          subject: "did:key:zRequester",
          sessionId: "approval-1",
          challenge: "challenge-1",
          decision: "approved",
        },
      },
      wallet,
    );

    expect(await verifyTrustTaskProof(document)).toEqual({
      ok: true,
      signer: identity.did,
    });

    const tampered = {
      ...document,
      payload: {
        ...(document.payload as Record<string, unknown>),
        decision: "denied",
      },
    };
    expect((await verifyTrustTaskProof(tampered)).ok).toBe(false);
  });

  it("rejects an unsigned or synthetic manager identity", async () => {
    const unsigned = {
      issuer: "did:key:e2e-manager-not-a-key",
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      payload: { decision: "approved" },
    };
    expect((await verifyTrustTaskProof(unsigned)).ok).toBe(false);
  });

  it("returns a rejection rather than throwing for malformed did:key input", async () => {
    const malformed = {
      issuer: "did:key:zNotARealMultikey",
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      payload: { decision: "approved" },
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        proofPurpose: "assertionMethod",
        verificationMethod: "did:key:zNotARealMultikey#zNotARealMultikey",
        created: "2026-07-12T00:00:00Z",
        proofValue: "z123",
      },
    };
    await expect(verifyTrustTaskProof(malformed)).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("loadSigningKey fail-closed gate (ONE-58)", () => {
  const orig = { ...process.env };

  beforeEach(() => {
    delete process.env.ONECLI_GATEWAY_SIGNING_KEY;
    delete process.env.ONECLI_GATEWAY_PUBLIC_URL;
  });

  afterEach(() => {
    process.env = { ...orig };
  });

  it("isDevEnvironment: development NODE_ENV is dev", () => {
    process.env.NODE_ENV = "development";
    expect(isDevEnvironment()).toBe(true);
  });

  it("isDevEnvironment: production NODE_ENV with no ONECOMPUTER_ENV is NOT dev", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ONECOMPUTER_ENV;
    expect(isDevEnvironment()).toBe(false);
  });

  it("isDevEnvironment: production NODE_ENV + ONECOMPUTER_ENV=dev is dev", () => {
    process.env.NODE_ENV = "production";
    process.env.ONECOMPUTER_ENV = "dev";
    expect(isDevEnvironment()).toBe(true);
  });

  it("throws in non-dev when ONECLI_GATEWAY_SIGNING_KEY is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ONECOMPUTER_ENV;
    expect(() => loadSigningKey()).toThrow(
      /ONECLI_GATEWAY_SIGNING_KEY is required/,
    );
  });

  it("returns an ephemeral key in dev when ONECLI_GATEWAY_SIGNING_KEY is unset", () => {
    process.env.NODE_ENV = "development";
    const k = loadSigningKey();
    expect(k.seed.length).toBe(32);
    expect(k.publicKey.length).toBe(32);
    expect(k.did).toBe("did:web:localhost");
  });

  it("loads a pinned key in non-dev when ONECLI_GATEWAY_SIGNING_KEY is set", () => {
    process.env.NODE_ENV = "production";
    const seedB64 = Buffer.from(SEED).toString("base64");
    process.env.ONECLI_GATEWAY_SIGNING_KEY = seedB64;
    process.env.ONECLI_GATEWAY_PUBLIC_URL = "https://gw.example.com";
    const k = loadSigningKey();
    expect(Array.from(k.seed)).toEqual(Array.from(SEED));
    expect(Array.from(k.publicKey)).toEqual(Array.from(key.publicKey));
    expect(k.verificationMethodId).toBe("did:web:gw.example.com#key-1");
  });
});
