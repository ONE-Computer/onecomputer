import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import { canonicalizeJson } from "../lib/jcs";

// approval-service hits the DB via @onecli/db. Mock it so we can assert the
// decide flow produces + persists a signed eddsa-jcs-2022 VC without a real
// database. The signer itself (vti-credential-signer) is real Ed25519 crypto —
// not mocked — so this test exercises the actual sign→persist→verify path.
//
// `verifyCredential` is wrapped in a hoisted spy that delegates to the real
// implementation by default, so the ONE-141 sign/verify tests stay end-to-end
// real. The ONE-56 fail-closed test overrides the spy to return ok=false to
// deterministically exercise the verify-on-write gate without relying on a
// contrived crypto bug.
const mocks = vi.hoisted(() => ({
  approvalFindFirst: vi.fn(),
  approvalUpdate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  verifyCredential: vi.fn(),
}));

vi.mock("@onecli/db", () => ({
  db: {
    approvalRequest: {
      findFirst: mocks.approvalFindFirst,
      update: mocks.approvalUpdate,
    },
    auditLog: {
      create: mocks.auditCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
  Prisma: { JsonNull: null, InputJsonValue: {} },
}));

// Delegate to the real verifyCredential by default. The real impl is imported
// lazily inside the factory so the mock is installed before any test imports
// the service.
vi.mock("../lib/vti-credential-signer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/vti-credential-signer")>();
  mocks.verifyCredential.mockImplementation(
    (signed: unknown, didDoc: unknown) =>
      actual.verifyCredential(signed as never, didDoc as never),
  );
  return {
    ...actual,
    verifyCredential: mocks.verifyCredential,
  };
});

import {
  decideApproval,
  getApproval,
  verifyDecisionVc,
} from "./approval-service";
import {
  buildDidDocument,
  signingKeyFromSeed,
} from "../lib/vti-credential-signer";

// `verifyCredential` is re-exported through the mock; grab the spy for the
// fail-closed test.
const verifyCredential = mocks.verifyCredential;

// Deterministic signing key so the produced VC verifies against a known
// did:web document. Mirrors the signer test's fixed seed.
const SEED = new Uint8Array(32).fill(7);
const DID = "did:web:gw.example.com";
const key = signingKeyFromSeed(SEED, DID);

// Force the signer to load this key (it reads ONECLI_GATEWAY_SIGNING_KEY from
// env; we instead exercise the signCredential path directly via the service,
// which calls loadSigningKey() — so set the env var to our seed in base64).
beforeEach(async () => {
  vi.resetAllMocks();
  // base64 of the 32-byte seed filled with 7.
  process.env.ONECLI_GATEWAY_SIGNING_KEY = Buffer.from(SEED).toString("base64");
  process.env.ONECLI_GATEWAY_PUBLIC_URL = "https://gw.example.com";
  // Re-establish the default pass-through delegation after any test overrode it.
  const actual = await vi.importActual<
    typeof import("../lib/vti-credential-signer")
  >("../lib/vti-credential-signer");
  mocks.verifyCredential.mockImplementation(
    (signed: unknown, didDoc: unknown) =>
      actual.verifyCredential(signed as never, didDoc as never),
  );
  mocks.userFindUnique.mockResolvedValue({
    approvalDid: managerDid,
    approvalPublicKeyJwk: managerPublicJwk,
  });
});

const buildPendingApproval = () => ({
  id: "appr-123",
  status: "pending" as const,
  action: "outlook.send_email",
  context: {
    _vti: {
      stepUpRequest: {
        taskHash: "sha256:request-task",
        payload: { requestedActionDigest: "sha256:requested-action" },
      },
    },
  },
});

const managerKeys = generateKeyPairSync("ed25519");
const managerPublicJwk = managerKeys.publicKey.export({ format: "jwk" });
const managerDid = "did:key:test-manager";

const confirmationFor = (approvalId: string) => {
  const signedAt = new Date().toISOString();
  const challenge = {
    protocol: "confirm/response" as const,
    version: "0.1" as const,
    approvalId,
    requestTaskHash: "sha256:request-task",
    requestedActionDigest: "sha256:requested-action",
    decision: "approved" as const,
    approverDid: managerDid,
    signedAt,
  };
  return {
    protocol: challenge.protocol,
    version: challenge.version,
    approverDid: managerDid,
    signedAt,
    signature: signBytes(
      null,
      Buffer.from(canonicalizeJson(challenge)),
      managerKeys.privateKey,
    ).toString("base64url"),
  };
};

describe("decideApproval — signed decision VC (ONE-141)", () => {
  it("rejects an unsigned approval before changing durable state", async () => {
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    await expect(
      decideApproval({
        organizationId: "org-1",
        approvalId: "appr-unsigned",
        decidedBy: "manager-alice",
        input: { decision: "approved" },
      }),
    ).rejects.toThrow(/signed OpenVTC manager confirmation is required/);
    expect(mocks.approvalUpdate).not.toHaveBeenCalled();
  });

  it("rejects an altered manager signature before changing durable state", async () => {
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    const confirmation = confirmationFor("appr-altered");
    confirmation.signature = `${confirmation.signature.slice(0, -2)}aa`;
    await expect(
      decideApproval({
        organizationId: "org-1",
        approvalId: "appr-altered",
        decidedBy: "manager-alice",
        input: { decision: "approved", confirmation },
      }),
    ).rejects.toThrow(/signature is invalid/);
    expect(mocks.approvalUpdate).not.toHaveBeenCalled();
  });

  it("produces and persists a signed eddsa-jcs-2022 VC on approve", async () => {
    const action = "outlook.send_email";
    const decidedAt = new Date("2026-07-05T18:00:00.000Z");
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    mocks.approvalUpdate
      // first update: the decision itself (status, decidedBy, ...)
      .mockResolvedValueOnce({
        id: "appr-123",
        organizationId: "org-1",
        projectId: "proj-1",
        agentId: null,
        requestedBy: "actor-1",
        action,
        context: { foo: "bar" } as unknown,
        status: "approved",
        decidedBy: "manager-alice",
        decisionComment: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: decidedAt,
      })
      .mockResolvedValueOnce({});

    const updated = await decideApproval({
      organizationId: "org-1",
      approvalId: "appr-123",
      decidedBy: "manager-alice",
      input: {
        decision: "approved",
        confirmation: confirmationFor("appr-123"),
      },
    });

    expect(updated.status).toBe("approved");

    // Status and both proofs are persisted atomically so the gateway can never
    // observe an approved row without its credential.
    expect(mocks.approvalUpdate).toHaveBeenCalledTimes(1);

    const decisionCall = mocks.approvalUpdate.mock.calls[0]?.[0];
    expect(decisionCall).toBeTruthy();
    const persistedContext = decisionCall?.data?.context as {
      _vti?: {
        decision?: { proof?: { cryptosuite?: string; proofValue?: string } };
      };
    };
    expect(persistedContext._vti?.decision).toBeTruthy();
    const decisionVc = persistedContext._vti?.decision;
    expect(decisionVc?.proof?.cryptosuite).toBe("eddsa-jcs-2022");
    expect(decisionVc?.proof?.proofValue?.[0]).toBe("z");

    // The signed VC must verify against the gateway's did:web public key.
    const didDoc = buildDidDocument(key);
    const result = await verifyCredential(decisionVc as never, didDoc);
    expect(result.ok).toBe(true);
    expect(result.credential?.credentialSubject).toMatchObject({
      approvalId: "appr-123",
      decision: "approved",
      decidedBy: "manager-alice",
      requestedActionDigest: "sha256:requested-action",
      action,
    });
  });

  it("the persisted decision VC FAILS verification when the decision is tampered (approved->denied)", async () => {
    const action = "outlook.send_email";
    const decidedAt = new Date("2026-07-05T18:00:00.000Z");
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    mocks.approvalUpdate
      .mockResolvedValueOnce({
        id: "appr-456",
        organizationId: "org-1",
        projectId: "proj-1",
        agentId: null,
        requestedBy: "actor-1",
        action,
        context: {},
        status: "approved",
        decidedBy: "manager-bob",
        decisionComment: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: decidedAt,
      })
      .mockResolvedValueOnce({});

    await decideApproval({
      organizationId: "org-1",
      approvalId: "appr-456",
      decidedBy: "manager-bob",
      input: {
        decision: "approved",
        confirmation: confirmationFor("appr-456"),
      },
    });

    const decisionCall = mocks.approvalUpdate.mock.calls[0]?.[0];
    const decisionVc = (
      decisionCall?.data?.context as { _vti?: { decision?: unknown } }
    )._vti?.decision as { credentialSubject?: { decision?: string } };

    // Tamper: flip approved -> denied AFTER signing. The signature was over
    // "approved", so verification must fail.
    decisionVc.credentialSubject!.decision = "denied";

    const didDoc = buildDidDocument(key);
    const result = await verifyCredential(decisionVc as never, didDoc);
    expect(result.ok).toBe(false);
  });

  it("still records the decision even if the signer throws (best-effort VC)", async () => {
    const action = "outlook.send_email";
    // Unset the signing key so loadSigningKey falls back to an ephemeral key
    // (which still signs fine), but corrupt the env to force a throw via an
    // invalid seed length instead.
    process.env.ONECLI_GATEWAY_SIGNING_KEY =
      Buffer.from("short").toString("base64");

    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    mocks.approvalUpdate.mockResolvedValue({
      id: "appr-789",
      organizationId: "org-1",
      projectId: "proj-1",
      agentId: null,
      requestedBy: "actor-1",
      action,
      context: {},
      status: "denied",
      decidedBy: "manager-carol",
      decisionComment: "no",
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // The decide route must NOT throw even when the signer fails — the
    // decision (status + decidedBy) is the source of truth; the VC is layered
    // evidence. The first update (decision) still happens; the second update
    // (VC persist) is skipped because the signer threw.
    const updated = await decideApproval({
      organizationId: "org-1",
      approvalId: "appr-789",
      decidedBy: "manager-carol",
      input: { decision: "denied", comment: "no" },
    });

    expect(updated.status).toBe("denied");
    // Only the decision update happened — the VC-persist update was skipped
    // because the signer threw on the invalid seed.
    expect(mocks.approvalUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("decideApproval — verify-on-write (ONE-56)", () => {
  it("verifies the just-signed VC before persisting (second update carries a valid VC)", async () => {
    const action = "outlook.send_email";
    const decidedAt = new Date("2026-07-05T18:00:00.000Z");
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    mocks.approvalUpdate
      .mockResolvedValueOnce({
        id: "appr-vw-1",
        organizationId: "org-1",
        projectId: "proj-1",
        agentId: null,
        requestedBy: "actor-1",
        action,
        context: {},
        status: "approved",
        decidedBy: "manager-alice",
        decisionComment: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: decidedAt,
      })
      .mockResolvedValueOnce({});

    await decideApproval({
      organizationId: "org-1",
      approvalId: "appr-vw-1",
      decidedBy: "manager-alice",
      input: {
        decision: "approved",
        confirmation: confirmationFor("appr-vw-1"),
      },
    });

    // The verify-on-write gate passed before the one atomic update ran.
    expect(mocks.approvalUpdate).toHaveBeenCalledTimes(1);
    const decisionCall = mocks.approvalUpdate.mock.calls[0]?.[0];
    const decisionVc = (
      decisionCall?.data?.context as { _vti?: { decision?: unknown } }
    )._vti?.decision;
    // And the persisted VC genuinely verifies against the gateway did doc.
    const result = await verifyCredential(
      decisionVc as never,
      buildDidDocument(key),
    );
    expect(result.ok).toBe(true);
  });

  it("FAILS CLOSED: throws + skips VC persist when the signed VC would not verify", async () => {
    // Override the verifyCredential spy to deterministically return failure.
    // The real signCredential still produces a (valid) VC — proving the gate
    // fails closed on verify failure regardless of why verify returned false.
    mocks.verifyCredential.mockResolvedValue({
      ok: false,
      error: "simulated tampered payload",
    });

    const action = "outlook.send_email";
    const decidedAt = new Date("2026-07-05T18:00:00.000Z");
    mocks.approvalFindFirst.mockResolvedValue(buildPendingApproval());
    mocks.approvalUpdate.mockResolvedValue({
      id: "appr-vw-2",
      organizationId: "org-1",
      projectId: "proj-1",
      agentId: null,
      requestedBy: "actor-1",
      action,
      context: {},
      status: "approved",
      decidedBy: "manager-dave",
      decisionComment: null,
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: decidedAt,
    });

    // The decide route must throw (fail-closed) — no broken signature persisted.
    await expect(
      decideApproval({
        organizationId: "org-1",
        approvalId: "appr-vw-2",
        decidedBy: "manager-dave",
        input: {
          decision: "approved",
          confirmation: confirmationFor("appr-vw-2"),
        },
      }),
    ).rejects.toThrow(/decision VC failed verification on write/);

    // Verification happens before the atomic status+credential update.
    expect(mocks.approvalUpdate).not.toHaveBeenCalled();
  });
});

describe("verifyDecisionVc / getApproval — verify-on-read (ONE-56)", () => {
  const buildDecidedRow = (decisionVc: unknown) => ({
    id: "appr-vr-1",
    organizationId: "org-1",
    projectId: "proj-1",
    agentId: null,
    requestedBy: "actor-1",
    action: "outlook.send_email",
    context: { _vti: { decision: decisionVc } },
    status: "approved" as const,
    decidedBy: "manager-alice",
    decisionComment: null,
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date("2026-07-05T18:00:00.000Z"),
  });

  it("returns vtiVerified=true for a row whose persisted VC verifies", async () => {
    // Sign a real VC with the same key the service loads (SEED env set above).
    const { signCredential } = await import("../lib/vti-credential-signer");
    const vc = await signCredential(
      {
        approvalId: "appr-vr-1",
        decision: "approved",
        decidedBy: "manager-alice",
        approvedAt: "2026-07-05T18:00:00.000Z",
        requestedActionDigest: `sha256:${createHash("sha256")
          .update("outlook.send_email")
          .digest("hex")}`,
      },
      key,
    );

    const result = await verifyDecisionVc(buildDecidedRow(vc));
    expect(result.vtiVerified).toBe(true);
    expect(result.vtiVerifyError).toBeNull();
    expect(result.decisionVc).toBe(vc);
  });

  it("returns vtiVerified=false when the persisted decision payload was tampered (DB flip)", async () => {
    const { signCredential } = await import("../lib/vti-credential-signer");
    const vc = await signCredential(
      {
        approvalId: "appr-vr-1",
        decision: "approved",
        decidedBy: "manager-alice",
        approvedAt: "2026-07-05T18:00:00.000Z",
        requestedActionDigest: `sha256:${createHash("sha256")
          .update("outlook.send_email")
          .digest("hex")}`,
      },
      key,
    );

    // Tamper: flip the signed decision subject after signing (simulating a DB
    // edit of context._vti.decision.credentialSubject.decision).
    (vc.credentialSubject as { decision: string }).decision = "denied";

    const result = await verifyDecisionVc(buildDecidedRow(vc));
    expect(result.vtiVerified).toBe(false);
    expect(result.vtiVerifyError).toMatch(/tampered|signature|invalid|verify/i);
  });

  it("returns vtiVerified=false (no throw) when there is no decision VC on the row", async () => {
    const row = buildDecidedRow(undefined);
    (row.context as { _vti: { decision?: unknown } })._vti.decision = undefined;
    const result = await verifyDecisionVc(row);
    expect(result.vtiVerified).toBe(false);
    expect(result.vtiVerifyError).toMatch(/no signed decision VC/i);
  });

  it("GET /v1/approvals/:id (getApproval) includes a vtiVerified field", async () => {
    const { signCredential } = await import("../lib/vti-credential-signer");
    const vc = await signCredential(
      {
        approvalId: "appr-vr-1",
        decision: "approved",
        decidedBy: "manager-alice",
        approvedAt: "2026-07-05T18:00:00.000Z",
        requestedActionDigest: `sha256:${createHash("sha256")
          .update("outlook.send_email")
          .digest("hex")}`,
      },
      key,
    );

    mocks.approvalFindFirst.mockResolvedValue(buildDecidedRow(vc));

    const approval = await getApproval({
      organizationId: "org-1",
      approvalId: "appr-vr-1",
    });

    expect(approval.id).toBe("appr-vr-1");
    expect(approval.vtiVerified).toBe(true);
    expect(approval).toHaveProperty("vtiVerifyError", null);
    expect(approval).toHaveProperty("decisionVc");
  });
});
