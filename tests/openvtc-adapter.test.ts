import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  TASK_CONSENT_DECISION_TYPE,
  base58btcEncode,
  buildTaskConsentRequest,
  didKeyFromEd25519PublicKey,
  jcsCanonicalize,
  taskConsentPayloadDigest,
  taskConsentSigningInput,
  verifyTaskConsentDecision,
} from "@onecomputer/openvtc-adapter";

const REQUEST_ISSUED_AT = "2026-07-21T01:00:00.000Z";
const REQUEST_EXPIRES_AT = "2026-07-21T01:10:00.000Z";
const DECISION_ISSUED_AT = "2026-07-21T01:01:00.000Z";
const NOW = new Date("2026-07-21T01:02:00.000Z");
const CHALLENGE = "g2BvOTJvOXRWdzlYY3dJb3lJclp6aUE";
const PAYLOAD_DIGEST = "96d618125e34a84cb0e2ef863e450d002647847ae38d859d7d8dc907f591eccd";
const EXECUTOR_DID = "did:web:control.onecomputer.test";

type JsonObject = Record<string, unknown>;

const signingIdentity = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const rawPublicKey = spki.subarray(spki.length - 32);
  const did = didKeyFromEd25519PublicKey(rawPublicKey);
  return { privateKey, did };
};

const signedDecision = (
  identity: ReturnType<typeof signingIdentity>,
  decision: "approve" | "deny" = "approve",
  reason?: string,
) => {
  const multikey = identity.did.slice("did:key:".length);
  const payload: JsonObject = { challenge: CHALLENGE, payloadDigest: PAYLOAD_DIGEST, decision };
  if (reason !== undefined) payload.reason = reason;
  const document: JsonObject = {
    id: "urn:uuid:99c504b6-aa52-41c7-a28e-01f8ea962cb0",
    type: TASK_CONSENT_DECISION_TYPE,
    issuer: identity.did,
    recipient: EXECUTOR_DID,
    issuedAt: DECISION_ISSUED_AT,
    payload,
  };
  const proof: JsonObject = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: `${identity.did}#${multikey}`,
    created: DECISION_ISSUED_AT,
    proofPurpose: "assertionMethod",
  };
  const signature = signBytes(null, taskConsentSigningInput(document, proof), identity.privateKey);
  document.proof = { ...proof, proofValue: `z${base58btcEncode(signature)}` };
  return document;
};

const expected = (approverDid: string) => ({
  recipientDid: EXECUTOR_DID,
  challenge: CHALLENGE,
  payloadDigest: PAYLOAD_DIGEST,
  enrolledApproverDids: [approverDid],
  requestIssuedAt: REQUEST_ISSUED_AT,
  requestExpiresAt: REQUEST_EXPIRES_AT,
});

describe("OpenVTC task-consent verifier", () => {
  it("verifies an upstream-compatible signed approval", () => {
    const identity = signingIdentity();
    const result = verifyTaskConsentDecision({ document: signedDecision(identity), expected: expected(identity.did), now: NOW });

    assert.equal(result.verified, true);
    if (!result.verified) return;
    assert.equal(result.signerDid, identity.did);
    assert.equal(result.decision, "approve");
    assert.equal(result.challenge, CHALLENGE);
    assert.equal(result.payloadDigest, PAYLOAD_DIGEST);
    assert.match(result.proofHash, /^[0-9a-f]{64}$/);
    assert.match(result.documentHash, /^[0-9a-f]{64}$/);
  });

  it("verifies a signed denial and preserves its reason", () => {
    const identity = signingIdentity();
    const result = verifyTaskConsentDecision({
      document: signedDecision(identity, "deny", "The target is not expected."),
      expected: expected(identity.did),
      now: NOW,
    });

    assert.equal(result.verified, true);
    if (result.verified) {
      assert.equal(result.decision, "deny");
      assert.equal(result.reason, "The target is not expected.");
    }
  });

  it("rejects a different protocol version", () => {
    const identity = signingIdentity();
    const document = signedDecision(identity);
    document.type = "https://trusttasks.org/spec/task-consent/decision/1.0";
    assert.deepEqual(
      verifyTaskConsentDecision({ document, expected: expected(identity.did), now: NOW }),
      { verified: false, code: "UNSUPPORTED_TYPE", reason: "unsupported task-consent decision type" },
    );
  });

  it("rejects recipient, challenge, and payload-digest substitution", () => {
    const identity = signingIdentity();
    for (const mutate of [
      (document: JsonObject) => { document.recipient = "did:web:attacker.example"; },
      (document: JsonObject) => { (document.payload as JsonObject).challenge = "another-challenge-with-128-bits"; },
      (document: JsonObject) => { (document.payload as JsonObject).payloadDigest = "a".repeat(64); },
    ]) {
      const document = signedDecision(identity);
      mutate(document);
      const result = verifyTaskConsentDecision({ document, expected: expected(identity.did), now: NOW });
      assert.equal(result.verified, false);
      if (!result.verified) assert.equal(result.code, "INVALID_BINDING");
    }
  });

  it("rejects mutation after signing", () => {
    const identity = signingIdentity();
    const document = signedDecision(identity);
    document.id = "urn:uuid:tampered-after-approval";
    const result = verifyTaskConsentDecision({ document, expected: expected(identity.did), now: NOW });
    assert.equal(result.verified, false);
    if (!result.verified) assert.equal(result.code, "INVALID_PROOF");
  });

  it("rejects unsupported proof configuration and malformed signatures", () => {
    const identity = signingIdentity();
    const wrongPurpose = signedDecision(identity);
    (wrongPurpose.proof as JsonObject).proofPurpose = "authentication";
    const purposeResult = verifyTaskConsentDecision({ document: wrongPurpose, expected: expected(identity.did), now: NOW });
    assert.equal(purposeResult.verified, false);
    if (!purposeResult.verified) assert.equal(purposeResult.code, "INVALID_PROOF");

    const badSignature = signedDecision(identity);
    (badSignature.proof as JsonObject).proofValue = "z1111111111111111111111111111111111111111111111111111111111111111";
    const signatureResult = verifyTaskConsentDecision({ document: badSignature, expected: expected(identity.did), now: NOW });
    assert.equal(signatureResult.verified, false);
    if (!signatureResult.verified) assert.equal(signatureResult.code, "INVALID_PROOF");
  });

  it("derives identity from proof and then enforces live enrollment", () => {
    const identity = signingIdentity();
    const result = verifyTaskConsentDecision({
      document: signedDecision(identity),
      expected: { ...expected(identity.did), enrolledApproverDids: [] },
      now: NOW,
    });
    assert.equal(result.verified, false);
    if (!result.verified) assert.equal(result.code, "UNENROLLED_APPROVER");
  });

  it("enforces requester exclusion after proof verification", () => {
    const identity = signingIdentity();
    const result = verifyTaskConsentDecision({
      document: signedDecision(identity),
      expected: { ...expected(identity.did), requesterDid: identity.did, excludeRequester: true },
      now: NOW,
    });
    assert.equal(result.verified, false);
    if (!result.verified) assert.equal(result.code, "REQUESTER_EXCLUDED");
  });

  it("rejects decisions after the pending request expires", () => {
    const identity = signingIdentity();
    const result = verifyTaskConsentDecision({
      document: signedDecision(identity),
      expected: expected(identity.did),
      now: new Date(REQUEST_EXPIRES_AT),
    });
    assert.equal(result.verified, false);
    if (!result.verified) assert.equal(result.code, "INVALID_TIME");
  });
});

describe("OpenVTC canonical primitives", () => {
  it("uses RFC 8785 object ordering and negative-zero representation", () => {
    assert.equal(jcsCanonicalize({ z: -0, a: [3, "line\nfeed", true] }), "{\"a\":[3,\"line\\nfeed\",true],\"z\":0}");
  });

  it("rejects non-JSON numeric values", () => {
    assert.throws(() => jcsCanonicalize({ invalid: Number.NaN }), /non-finite/);
  });

  it("salts and type-binds the upstream wire digest", () => {
    const payload = { operationDigest: PAYLOAD_DIGEST, arguments: { confirm: true } };
    const first = taskConsentPayloadDigest("https://onecomputer.dev/spec/delete/0.1", payload, CHALLENGE);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, taskConsentPayloadDigest("https://onecomputer.dev/spec/delete/0.1", { arguments: { confirm: true }, operationDigest: PAYLOAD_DIGEST }, CHALLENGE));
    assert.notEqual(first, taskConsentPayloadDigest("https://onecomputer.dev/spec/delete/0.2", payload, CHALLENGE));
    assert.notEqual(first, taskConsentPayloadDigest("https://onecomputer.dev/spec/delete/0.1", payload, `${CHALLENGE}-new`));
  });

  it("builds one signed, recipient-bound request without exposing the raw task payload", async () => {
    const executor = signingIdentity();
    const approver = signingIdentity();
    const taskPayload = { operationDigest: PAYLOAD_DIGEST, secretArgument: "must-not-leave-control" };
    const request = await buildTaskConsentRequest({
      id: "urn:uuid:5a01aaf5-0601-48fa-b38f-f98b15a155da",
      issuerDid: executor.did,
      recipientDid: approver.did,
      verificationMethod: `${executor.did}#${executor.did.slice("did:key:".length)}`,
      issuedAt: REQUEST_ISSUED_AT,
      expiresAt: REQUEST_EXPIRES_AT,
      challenge: CHALLENGE,
      taskType: "https://onecomputer.dev/spec/microsoft365/delete-onedrive-file/0.1",
      taskPayload,
      requesterDid: "did:onecomputer:agent:agent-1",
      approverSet: "onecomputer-workspace-owners",
      minApprovals: 1,
      excludeRequester: true,
      sideEffects: "destructive",
      exposure: { discloses: "none", actsAsSubject: true },
      effects: [{ kind: "resourceDelete", summary: "Delete OneDrive item 01NA…NV7O." }],
      subject: "onecomputer:operation:operation-1",
      statePin: { resource: "onedrive:item:01NA…NV7O", version: "etag-value" },
      sign: (bytes) => signBytes(null, bytes, executor.privateKey),
    });

    assert.equal(request.type, "https://trusttasks.org/spec/task-consent/request/0.1");
    assert.equal(request.recipient, approver.did);
    assert.equal((request.payload as JsonObject).payloadDigest, taskConsentPayloadDigest(
      "https://onecomputer.dev/spec/microsoft365/delete-onedrive-file/0.1",
      taskPayload,
      CHALLENGE,
    ));
    assert.equal(JSON.stringify(request).includes("must-not-leave-control"), false);
    assert.match(String((request.proof as JsonObject).proofValue), /^z/);
  });
});
