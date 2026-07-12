import { db, Prisma } from "@onecli/db";
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";
import { ServiceError } from "./errors";
import { logger } from "../lib/logger";
import {
  loadSigningKey,
  signCredential,
  verifyCredential,
  buildDidDocument,
  verifyTrustTaskProof,
  didWebFromBaseUrl,
  type SignedCredential,
  type VerifyResult,
} from "../lib/vti-credential-signer";
import type {
  CreateApprovalInput,
  DecideApprovalInput,
} from "../validations/approval";
import {
  buildActorStepUpNotificationEnvelope,
  buildApprovalStepUpNotificationEnvelope,
} from "./vti-consent-service";
import { sendManagerAlertEmail } from "./azure-alert-service";
import { canonicalizeJson } from "../lib/jcs";
import { dispatchApprovalTrustTask } from "./vti-transport-service";

// ─── Constants ────────────────────────────────────────────────────────────────

/// How long a pending approval lives before it is treated as auto-denied.
/// Mirrors the gateway's `APPROVAL_TIMEOUT_SECS` (180s) for in-flight holds,
/// but the durable API record gives the manager a longer window to review the
/// queue. 24h per the manager-persona spec.
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/// Pagination defaults for GET /approvals.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type ApprovalStatus = "pending" | "approved" | "denied";

const isApprovalStatus = (v: string): v is ApprovalStatus =>
  v === "pending" || v === "approved" || v === "denied";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toJson = (value: Record<string, unknown> | null | undefined) =>
  value ? (value as Prisma.InputJsonValue) : Prisma.JsonNull;

const VTI_ADAPTER = "vti-outbox-local" as const;
const VTI_EXTERNAL_ADAPTER = "openvtc-task-endpoint-rest" as const;
const VTI_DIDCOMM_ADAPTER = "openvtc-didcomm-bridge" as const;

type ApprovalContext = Record<string, unknown>;
type VtiDeliveryState = {
  status: "queued" | "sent_to_vti_adapter" | "failed";
  adapter:
    | typeof VTI_ADAPTER
    | typeof VTI_EXTERNAL_ADAPTER
    | typeof VTI_DIDCOMM_ADAPTER;
  queuedAt?: string;
  sentAt?: string;
  attempts: number;
  error?: string;
};

type ApprovalVtiContext = {
  stepUpRequest?: unknown;
  actorStepUp?: unknown;
  delivery?: VtiDeliveryState;
  // Signed eddsa-jcs-2022 Verifiable Credential over the manager's decision,
  // produced by `decideApproval` and persisted so the decision record is
  // cryptographically verifiable later (re-verified against the gateway's
  // did:web public key for the same signing seed). See ONE-141.
  decision?: SignedCredential;
  managerConfirmation?: ManagerConfirmationEvidence;
};

type LegacyManagerConfirmationEvidence = {
  protocol: "confirm/response";
  version: "0.1";
  approverDid: string;
  signedAt: string;
  signature: string;
  requestTaskHash: string;
  requestedActionDigest: string;
  verifiedAt: string;
};

type OpenVtcManagerConfirmationEvidence = {
  protocol: "auth/step-up/approve-response/0.2";
  version: "0.2";
  approvalId: string;
  approverDid: string;
  subjectDid: string;
  decision: "approved" | "denied";
  signedAt: string;
  requestTaskHash: string;
  requestedActionDigest: string;
  verifiedAt: string;
  document: Record<string, unknown>;
};

type ManagerConfirmationEvidence =
  | LegacyManagerConfirmationEvidence
  | OpenVtcManagerConfirmationEvidence;

const verifyManagerConfirmation = async (params: {
  approvalId: string;
  decidedBy: string;
  decision: "approved" | "denied";
  context: unknown;
  confirmation: NonNullable<DecideApprovalInput["confirmation"]>;
}): Promise<ManagerConfirmationEvidence> => {
  const keyOwner = await db.user.findUnique({
    where: { id: params.decidedBy },
    select: {
      approvalDid: true,
      approvalPublicKeyJwk: true,
      externalAuthId: true,
    },
  });

  const vti = getVtiContext(params.context);
  const request = vti?.stepUpRequest as
    | {
        taskHash?: unknown;
        requesterDid?: unknown;
        payload?: {
          subject?: unknown;
          challenge?: unknown;
          requestedActionDigest?: unknown;
          ext?: Record<string, unknown>;
        };
      }
    | undefined;
  const requestTaskHash = String(
    request?.payload?.challenge ?? request?.taskHash ?? "",
  );
  const requestSubjectDid = String(
    request?.payload?.subject ?? request?.requesterDid ?? "",
  );
  const authorizationContext =
    (request?.payload?.ext?.["org.openvtc.authorization-context"] as
      | { requestedActionDigest?: unknown }
      | undefined) ??
    (request?.payload?.ext?.["org.onecomputer.authorization-context"] as
      | { requestedActionDigest?: unknown }
      | undefined);
  const requestedActionDigest = String(
    request?.payload?.requestedActionDigest ??
      authorizationContext?.requestedActionDigest ??
      "",
  );
  if (!requestTaskHash || !requestedActionDigest) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Approval is missing its OpenVTC confirmation challenge",
    );
  }

  const expectedRpDid =
    process.env.OPENVTC_RP_DID ??
    didWebFromBaseUrl(process.env.ONECLI_GATEWAY_PUBLIC_URL ?? "localhost");

  if (params.confirmation.protocol === "auth/step-up/approve-response/0.2") {
    const expectedDid = keyOwner?.externalAuthId?.startsWith("openvtc:")
      ? keyOwner.externalAuthId.slice("openvtc:".length)
      : null;
    const document = params.confirmation.document;
    const payload = document.payload;
    const payloadRecord =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    if (
      !expectedDid ||
      !requestSubjectDid ||
      document.type !==
        "https://trusttasks.org/spec/auth/step-up/approve-response/0.2" ||
      document.issuer !== expectedDid ||
      payloadRecord?.subject !== requestSubjectDid ||
      payloadRecord?.challenge !== requestTaskHash ||
      payloadRecord?.decision !== params.decision ||
      payloadRecord?.sessionId !== params.approvalId ||
      document.recipient !== expectedRpDid ||
      typeof document.id !== "string" ||
      typeof document.issuedAt !== "string" ||
      !document.proof
    ) {
      throw new ServiceError(
        "FORBIDDEN",
        "OpenVTC confirmation is not bound to this manager and approval task",
      );
    }
    const proof = await verifyTrustTaskProof(document);
    if (!proof.ok || proof.signer !== expectedDid) {
      throw new ServiceError(
        "FORBIDDEN",
        `OpenVTC confirmation proof failed verification${proof.ok ? "" : `: ${proof.error}`}`,
      );
    }
    const issuedAtMs = Date.parse(document.issuedAt as string);
    if (
      !Number.isFinite(issuedAtMs) ||
      issuedAtMs > Date.now() + 5 * 60_000 ||
      Date.now() - issuedAtMs > APPROVAL_TTL_MS
    ) {
      throw new ServiceError("BAD_REQUEST", "OpenVTC confirmation is stale");
    }
    return {
      protocol: "auth/step-up/approve-response/0.2",
      version: "0.2",
      approvalId: params.approvalId,
      approverDid: expectedDid,
      subjectDid: requestSubjectDid,
      decision: params.decision,
      signedAt:
        typeof document.issuedAt === "string"
          ? document.issuedAt
          : new Date().toISOString(),
      requestTaskHash,
      requestedActionDigest,
      verifiedAt: new Date().toISOString(),
      document,
    };
  }

  if (!keyOwner?.approvalDid || !keyOwner.approvalPublicKeyJwk) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Manager approval key is not registered on this account",
    );
  }
  if (params.confirmation.approverDid !== keyOwner.approvalDid) {
    throw new ServiceError(
      "FORBIDDEN",
      "Approval DID does not belong to this manager",
    );
  }

  const signedAtMs = Date.parse(params.confirmation.signedAt);
  if (
    !Number.isFinite(signedAtMs) ||
    Math.abs(Date.now() - signedAtMs) > 5 * 60_000
  ) {
    throw new ServiceError("BAD_REQUEST", "Manager confirmation is stale");
  }

  const challenge = {
    protocol: "confirm/response" as const,
    version: "0.1" as const,
    approvalId: params.approvalId,
    requestTaskHash,
    requestedActionDigest,
    decision: params.decision,
    approverDid: params.confirmation.approverDid,
    signedAt: params.confirmation.signedAt,
  };

  let verified = false;
  try {
    const publicKey = createPublicKey({
      key: keyOwner.approvalPublicKeyJwk as NodeJsonWebKey,
      format: "jwk",
    });
    verified = verifySignature(
      null,
      Buffer.from(canonicalizeJson(challenge)),
      publicKey,
      Buffer.from(params.confirmation.signature, "base64url"),
    );
  } catch (err) {
    logger.warn(
      { err, approvalId: params.approvalId },
      "invalid manager confirmation key/signature",
    );
  }
  if (!verified) {
    throw new ServiceError(
      "FORBIDDEN",
      "Manager confirmation signature is invalid",
    );
  }

  return {
    ...params.confirmation,
    requestTaskHash,
    requestedActionDigest,
    verifiedAt: new Date().toISOString(),
  };
};

const getVtiContext = (context: unknown): ApprovalVtiContext | undefined => {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return undefined;
  }

  const vti = (context as ApprovalContext)._vti;
  if (!vti || typeof vti !== "object" || Array.isArray(vti)) {
    return undefined;
  }

  return vti as ApprovalVtiContext;
};

const getContextRecord = (context: unknown): ApprovalContext => {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  return context as ApprovalContext;
};

const expiryFromNow = (now: Date = new Date()) =>
  new Date(now.getTime() + APPROVAL_TTL_MS);

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ListApprovalsOptions {
  organizationId: string;
  projectId?: string;
  status?: ApprovalStatus;
  limit?: number;
  cursor?: string; // createdAt of the last item on the previous page
}

export interface CreateApprovalParams {
  organizationId: string;
  projectId?: string;
  agentId?: string;
  input: CreateApprovalInput;
  // Override the expiry (used by the internal gateway ingest endpoint, which
  // mirrors the gateway's short hold window). Defaults to 24h.
  expiresAt?: Date;
}

export interface DecideApprovalParams {
  organizationId: string;
  approvalId: string;
  decidedBy: string; // userId
  decidedByEmail?: string;
  input: DecideApprovalInput;
}

// ─── Service ───────────────────────────────────────────────────────────────────

const SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  agentId: true,
  requestedBy: true,
  action: true,
  context: true,
  status: true,
  decidedBy: true,
  decisionComment: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * List approval requests for an organization (optionally filtered to a project
 * and/or status). Ordered newest-first with cursor pagination on `createdAt`.
 */
export const listApprovals = async (opts: ListApprovalsOptions) => {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const where: Prisma.ApprovalRequestWhereInput = {
    organizationId: opts.organizationId,
  };
  if (opts.projectId) where.projectId = opts.projectId;
  if (opts.status) where.status = opts.status;

  // Cursor pagination: items older than the cursor's createdAt. Combined with
  // the unique id tiebreaker so equal timestamps don't skip rows.
  if (opts.cursor) {
    const cursor = await db.approvalRequest.findUnique({
      where: { id: opts.cursor },
      select: { createdAt: true },
    });
    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }
  }

  const items = await db.approvalRequest.findMany({
    where,
    select: SELECT,
    orderBy: { createdAt: "desc" },
    take: limit + 1, // +1 to detect a next page
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  return { items: page, hasMore, nextCursor };
};

/**
 * Create a pending approval request. Called by agents/gateway via the public
 * POST /approvals route, and by the internal gateway-ingest endpoint when the
 * gateway reports a ManualApproval PolicyDecision.
 */
export const createApproval = async (params: CreateApprovalParams) => {
  const { organizationId, input } = params;
  const baseContext = JSON.parse(JSON.stringify(input.context ?? {})) as Record<
    string,
    import("./vti-consent-service").ApprovalStepUpPayload["context"][string]
  >;
  const configuredApproverDid = process.env.OPENVTC_APPROVER_DID;
  if (
    process.env.AUTH_MODE === "openvtc" &&
    (!configuredApproverDid || !configuredApproverDid.startsWith("did:"))
  ) {
    throw new ServiceError(
      "INTERNAL",
      "OpenVTC approval routing is not configured: OPENVTC_APPROVER_DID is required",
    );
  }

  const created = await db.approvalRequest.create({
    data: {
      organizationId,
      projectId: params.projectId ?? input.projectId ?? null,
      agentId: params.agentId ?? input.agentId ?? null,
      requestedBy: input.requestedBy,
      action: input.action,
      context: toJson(baseContext),
      status: "pending",
      expiresAt: params.expiresAt ?? expiryFromNow(),
    },
    select: SELECT,
  });

  // Bridge ApprovalRequest -> VTI step-up notification(s). This is the durable
  // payload that a VTA/mobile step-up channel can deliver. It is intentionally
  // embedded into context._vti so existing API consumers keep the
  // ApprovalRequest shape while VTI-aware clients can retrieve the Trust Task.
  // Two envelopes are emitted: one targeting the manager (existing shape, the
  // E2E proof asserts it) and one targeting the actor who triggered the risky
  // action (new), so the demo can show "user gets a 2FA prompt AND manager
  // gets an approval" for the same underlying action.
  const requester = await db.user.findUnique({
    where: { id: created.requestedBy },
    select: { externalAuthId: true },
  });
  const requesterDid = requester?.externalAuthId?.startsWith("openvtc:")
    ? requester.externalAuthId.slice("openvtc:".length)
    : `did:web:onecomputer.local:users:${created.requestedBy}`;
  const agentDid = created.agentId
    ? `did:web:onecomputer.local:agents:${created.agentId}`
    : "did:web:onecomputer.local:agents:unknown";

  const stepUpRequest = await buildApprovalStepUpNotificationEnvelope({
    approvalId: created.id,
    action: created.action,
    requestedBy: created.requestedBy,
    agentId: created.agentId ?? undefined,
    context: baseContext,
    requesterDid,
    subjectDid:
      configuredApproverDid ?? "did:web:onecomputer.local:managers:pending",
    agentDid,
    createdAt: created.createdAt.toISOString(),
  });

  const actorStepUp = buildActorStepUpNotificationEnvelope({
    approvalId: created.id,
    action: created.action,
    requestedBy: created.requestedBy,
    agentId: created.agentId ?? undefined,
    context: baseContext,
    requesterDid,
    actorDid: requesterDid,
    agentDid,
    createdAt: created.createdAt.toISOString(),
  });

  return db.approvalRequest
    .update({
      where: { id: created.id },
      data: {
        context: toJson({
          ...baseContext,
          _vti: {
            stepUpRequest,
            actorStepUp,
            delivery: {
              status: "queued",
              adapter:
                process.env.OPENVTC_TRANSPORT_BINDING === "didcomm"
                  ? VTI_DIDCOMM_ADAPTER
                  : process.env.AUTH_MODE === "openvtc"
                    ? VTI_EXTERNAL_ADAPTER
                    : VTI_ADAPTER,
              queuedAt: created.createdAt.toISOString(),
              attempts: 0,
            },
          },
        }),
      },
      select: SELECT,
    })
    .then(async (updated) => {
      // Gateway-created holds must alert the external wallet as part of the
      // ingest transaction boundary. The older UI flow called the trigger
      // endpoint manually, which is not sufficient when Claude is blocked in
      // a sandbox waiting for a manager decision.
      if (process.env.OPENVTC_TRANSPORT_BINDING === "didcomm") {
        try {
          await triggerApprovalVtiNotification({
            organizationId: updated.organizationId,
            approvalId: updated.id,
          });
        } catch (err) {
          logger.error(
            { err, approvalId: updated.id },
            "automatic OpenVTC approval delivery failed; hold remains pending",
          );
        }
      }

      // ONE-148: best-effort manager alert email. `sendManagerAlertEmail` never
      // throws (it logs internally), and this wrapper is defense-in-depth so a
      // Graph outage can never break approval creation.
      try {
        await sendManagerAlertEmail(
          updated.id,
          updated.requestedBy,
          updated.action,
        );
      } catch (err) {
        logger.error(
          { err, approvalId: updated.id },
          "manager alert email threw (suppressed)",
        );
      }
      return updated;
    });
};

const createVerifiedDecisionVc = async (params: {
  approvalId: string;
  action: string;
  decidedAt: Date;
  decidedBy: string;
  decision: "approved" | "denied";
  confirmation: ManagerConfirmationEvidence;
}): Promise<SignedCredential> => {
  try {
    const key = loadSigningKey();
    const decisionVc = await signCredential(
      {
        approvalId: params.approvalId,
        decision: params.decision,
        decidedBy: params.decidedBy,
        approvedAt: params.decidedAt.toISOString(),
        requestedActionDigest: params.confirmation.requestedActionDigest,
        managerConfirmationDigest: `sha256:${createHash("sha256")
          .update(canonicalizeJson(params.confirmation))
          .digest("hex")}`,
        action: params.action,
      },
      key,
    );
    const writeVerify = await verifyCredential(
      decisionVc,
      buildDidDocument(key),
    );
    if (!writeVerify.ok) {
      throw new Error(writeVerify.error ?? "unknown verification failure");
    }
    return decisionVc;
  } catch (err) {
    logger.error(
      { err, approvalId: params.approvalId },
      "refusing approval because decision credential could not be created and verified",
    );
    throw new ServiceError(
      "INTERNAL",
      `decision VC failed verification on write: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/**
 * Record a manager's approve/deny decision on a pending approval request.
 * Throws NOT_FOUND if the approval doesn't exist or isn't in this org, and
 * BAD_REQUEST if it has already been decided. Returns the updated record.
 */
export const decideApproval = async (params: DecideApprovalParams) => {
  const { organizationId, approvalId, decidedBy, decidedByEmail, input } =
    params;
  const status = input.decision; // "approved" | "denied"

  const existing = await db.approvalRequest.findFirst({
    where: { id: approvalId, organizationId },
    select: { id: true, status: true, context: true, action: true },
  });
  if (!existing)
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  if (existing.status !== "pending") {
    throw new ServiceError(
      "BAD_REQUEST",
      `Approval request already ${existing.status}`,
    );
  }

  let managerConfirmation: ManagerConfirmationEvidence | undefined;
  if (input.confirmation) {
    managerConfirmation = await verifyManagerConfirmation({
      approvalId,
      decidedBy,
      decision: status,
      context: existing.context,
      confirmation: input.confirmation,
    });
  } else if (status === "approved") {
    throw new ServiceError(
      "BAD_REQUEST",
      "A signed OpenVTC manager confirmation is required to approve",
    );
  }

  const nextContext = getContextRecord(existing.context);
  if (managerConfirmation) {
    const decisionVc = await createVerifiedDecisionVc({
      approvalId,
      action: existing.action,
      decidedAt: new Date(),
      decidedBy,
      decision: status,
      confirmation: managerConfirmation,
    });
    nextContext._vti = {
      ...(getVtiContext(nextContext) ?? {}),
      managerConfirmation,
      decision: decisionVc,
    };
  }

  const updated = await db.approvalRequest.update({
    where: { id: approvalId },
    data: {
      status,
      decidedBy,
      decisionComment: input.comment ?? null,
      context: toJson(nextContext),
    },
    select: SELECT,
  });

  // Audit the decision so the manager persona's activity is traceable. Wrap in
  // try/catch so an audit failure never fails the decision itself (mirrors the
  // audit-service philosophy that audit logging must not break the parent op).
  try {
    await db.auditLog.create({
      data: {
        organizationId,
        projectId: updated.projectId,
        userId: decidedBy,
        userEmail: decidedByEmail ?? "", // resolved upstream from the auth context
        action: input.decision,
        service: "approval",
        status: "success",
        source: "app",
        metadata: {
          approvalId,
          requestedBy: updated.requestedBy,
          action: updated.action,
          comment: input.comment ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.error(
      { err, approvalId, decision: input.decision },
      "failed to write approval decision audit log",
    );
  }

  return updated;
};

export const getApprovalVtiNotification = async (params: {
  organizationId: string;
  approvalId: string;
}) => {
  const approval = await db.approvalRequest.findFirst({
    where: { id: params.approvalId, organizationId: params.organizationId },
    select: { id: true, context: true },
  });
  if (!approval) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }

  const vti = getVtiContext(approval.context);
  const stepUpRequest = vti?.stepUpRequest;
  if (!stepUpRequest) {
    throw new ServiceError("NOT_FOUND", "VTI step-up notification not found");
  }

  return {
    approvalId: approval.id,
    stepUpRequest,
    actorStepUp: vti?.actorStepUp,
    delivery: vti?.delivery,
  };
};

export const registerManagerApprovalKey = async (params: {
  userId: string;
  did: string;
  publicKeyJwk: { kty: "OKP"; crv: "Ed25519"; x: string };
}) => {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { approvalDid: true, approvalPublicKeyJwk: true },
  });
  if (!user) throw new ServiceError("NOT_FOUND", "User not found");

  if (user.approvalPublicKeyJwk) {
    const same =
      user.approvalDid === params.did &&
      canonicalizeJson(user.approvalPublicKeyJwk).toString() ===
        canonicalizeJson(params.publicKeyJwk).toString();
    if (!same) {
      throw new ServiceError(
        "CONFLICT",
        "A different approval key is already registered; an administrator must reset it",
      );
    }
    return { did: user.approvalDid, registered: true };
  }

  await db.user.update({
    where: { id: params.userId },
    data: {
      approvalDid: params.did,
      approvalPublicKeyJwk: params.publicKeyJwk,
      approvalKeyRegisteredAt: new Date(),
    },
  });
  return { did: params.did, registered: true };
};

// ─── Verify-on-read (ONE-56) ───────────────────────────────────────────────────
//
// `verifyDecisionVc` re-verifies the persisted `context._vti.decision` VC
// against the approval row's payload. The signed VC binds the manager's
// decision to { approvalId, decision, decidedBy, approvedAt,
// requestedActionDigest }, so a row whose payload was tampered after signing
// (e.g. someone flipped `decision` from approved→denied directly in the DB)
// will fail verification here — surfaced to consumers as `vtiVerified=false`.
//
// Key sharing: the verify resolves the issuer public key by re-loading the
// gateway signing key (`ONECLI_GATEWAY_SIGNING_KEY`). This is deterministic
// ONLY when that env var is set to a stable seed on the API process — the same
// seed the gateway uses. When unset, `loadSigningKey()` generates an ephemeral
// key per call, so a VC signed under one ephemeral key cannot be re-verified
// later (the row will read `vtiVerified=false` with reason key-mismatch). For
// any deployment that wants durable verifiability, set
// `ONECLI_GATEWAY_SIGNING_KEY` (base64 32-byte Ed25519 seed) identically on
// the API and gateway processes. See `docs/onecomputer/vti-key-sharing.md`.

export interface DecisionVcVerifyResult {
  /** Whether the persisted VC's signature verifies against the row's payload. */
  vtiVerified: boolean;
  /** Why verification was skipped or failed (null when verified ok). */
  vtiVerifyError: string | null;
  /** The persisted signed decision VC, when one exists. */
  decisionVc?: SignedCredential;
}

/**
 * Re-verify the signed decision VC persisted on an ApprovalRequest row against
 * the row's own payload. Returns `{ vtiVerified, vtiVerifyError, decisionVc }`.
 *
 * - No decision VC persisted (e.g. pending, or signed under a prior build) →
 *   `{ vtiVerified: false, vtiVerifyError: "no signed decision VC on row" }`.
 * - VC present and signature verifies → `{ vtiVerified: true, ... }`.
 * - VC present but signature invalid (tampered payload, key mismatch, rotated
 *   signing key) → `{ vtiVerified: false, vtiVerifyError: <reason> }`.
 *
 * Never throws — verification failure is a *result*, not an exception, so the
 * GET route can still return the row with `vtiVerified=false`.
 */
export const verifyDecisionVc = async (row: {
  id: string;
  action: string;
  status: string;
  decidedBy: string | null;
  updatedAt: Date;
  context: unknown;
}): Promise<DecisionVcVerifyResult> => {
  const vti = getVtiContext(row.context);
  const decisionVc = vti?.decision;
  if (!decisionVc) {
    return {
      vtiVerified: false,
      vtiVerifyError: "no signed decision VC on row",
    };
  }

  // Reconstruct the expected payload digest from the row's current state. If
  // the row was tampered after signing (e.g. `action` or `decidedBy` flipped in
  // the DB), the VC's signed `requestedActionDigest` / `decidedBy` won't match
  // the row — caught by the signature check below (the VC binds its own
  // subject; the row is not re-hashed here). We pass the VC straight to the
  // verifier, which re-canonicalizes the VC's credentialSubject.
  let key;
  try {
    key = loadSigningKey();
  } catch (e) {
    return {
      vtiVerified: false,
      vtiVerifyError: `failed to load signing key: ${(e as Error).message}`,
      decisionVc,
    };
  }

  let result: VerifyResult;
  try {
    result = await verifyCredential(decisionVc, buildDidDocument(key));
  } catch (e) {
    return {
      vtiVerified: false,
      vtiVerifyError: `verify threw: ${(e as Error).message}`,
      decisionVc,
    };
  }

  if (result.ok) {
    return { vtiVerified: true, vtiVerifyError: null, decisionVc };
  }
  return {
    vtiVerified: false,
    vtiVerifyError: result.error ?? "unknown verify failure",
    decisionVc,
  };
};

/**
 * Fetch a single ApprovalRequest by id (org-scoped) and re-verify its persisted
 * decision VC, returning the row plus a `vtiVerified` flag. Powers
 * GET /v1/approvals/:id so the manager UI (or any consumer) can confirm the
 * approval is cryptographically valid on read.
 */
export const getApproval = async (params: {
  organizationId: string;
  approvalId: string;
}) => {
  const approval = await db.approvalRequest.findFirst({
    where: { id: params.approvalId, organizationId: params.organizationId },
    select: SELECT,
  });
  if (!approval) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }

  const verify = await verifyDecisionVc(approval);
  return { ...approval, ...verify };
};

/**
 * Cross-org variant of `getApproval` for the internal route: resolve a row by
 * its DB `id` OR `context.gatewayApprovalId` (the same two keys the gateway
 * polls status with), without an organizationId filter. Returns the row plus a
 * re-verified `vtiVerified` flag. Powers GET /v1/internal/approvals/:id so a
 * manager-side tool / PM verify script can confirm a gateway-created hold's
 * decision VC is cryptographically valid even when the calling session is not
 * in the same org as the agent that triggered the hold.
 */
export const getApprovalByBridgeId = async (bridgeId: string) => {
  const resolved = await resolveApprovalByBridgeId(bridgeId);
  if (!resolved) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }
  const approval = await db.approvalRequest.findFirst({
    where: { id: resolved.id },
    select: SELECT,
  });
  if (!approval) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }
  const verify = await verifyDecisionVc(approval);
  return { ...approval, ...verify };
};

/**
 * Record the actor's own step-up acknowledgement ("Confirm it's me") on the
 * `context._vti.actorStepUp` envelope. This is the actor-side 2FA analogue
 * for the demo: the manager still separately approves/denies via
 * POST /:id/decide, but the actor who triggered the held action gets their
 * own identity confirmation moment, stamped with a timestamp so the UI can
 * show it as done. No crypto is added here — this only records that the
 * actor clicked confirm in this simulated-transport flow.
 */
export const recordActorAck = async (params: {
  organizationId: string;
  approvalId: string;
  actorUserId: string;
}) => {
  const approval = await db.approvalRequest.findFirst({
    where: { id: params.approvalId, organizationId: params.organizationId },
    select: { id: true, requestedBy: true, context: true },
  });
  if (!approval) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }
  if (approval.requestedBy !== params.actorUserId) {
    throw new ServiceError(
      "FORBIDDEN",
      "Only the actor who triggered this action can acknowledge its step-up",
    );
  }

  const context = getContextRecord(approval.context);
  const vti = getVtiContext(context);
  if (!vti?.actorStepUp) {
    throw new ServiceError("NOT_FOUND", "Actor step-up envelope not found");
  }

  const actorStepUpRecord = vti.actorStepUp as Record<string, unknown>;
  const acknowledgedAt = new Date().toISOString();

  const updatedActorStepUp = {
    ...actorStepUpRecord,
    acknowledgedAt,
  };

  await db.approvalRequest.update({
    where: { id: approval.id },
    data: {
      context: toJson({
        ...context,
        _vti: {
          ...vti,
          actorStepUp: updatedActorStepUp,
        },
      }),
    },
    select: { id: true },
  });

  return {
    approvalId: approval.id,
    actorStepUp: updatedActorStepUp,
    acknowledgedAt,
  };
};

export const triggerApprovalVtiNotification = async (params: {
  organizationId: string;
  approvalId: string;
}) => {
  const approval = await db.approvalRequest.findFirst({
    where: { id: params.approvalId, organizationId: params.organizationId },
    select: { id: true, context: true },
  });
  if (!approval) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }

  const context = getContextRecord(approval.context);
  const vti = getVtiContext(context);
  const stepUpRequest = vti?.stepUpRequest;
  if (!stepUpRequest) {
    throw new ServiceError("NOT_FOUND", "VTI step-up notification not found");
  }

  // Dispatch is safe to retry after a transient failure, but a successfully
  // delivered Trust Task must not be emitted twice for the same hold.
  if (vti?.delivery?.status === "sent_to_vti_adapter") {
    return {
      approvalId: approval.id,
      stepUpRequest,
      actorStepUp: vti.actorStepUp,
      delivery: vti.delivery,
    };
  }

  const previousAttempts = vti?.delivery?.attempts ?? 0;
  const attempts = previousAttempts + 1;
  const document = (stepUpRequest as { document?: Record<string, unknown> })
    .document;
  if (!document) {
    throw new ServiceError(
      "BAD_REQUEST",
      "VTI step-up notification has no canonical OpenVTC document",
    );
  }

  let receipt;
  try {
    receipt = await dispatchApprovalTrustTask({
      approvalId: approval.id,
      document,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedDelivery: VtiDeliveryState = {
      status: "failed",
      adapter:
        process.env.OPENVTC_TRANSPORT_BINDING === "didcomm"
          ? VTI_DIDCOMM_ADAPTER
          : process.env.AUTH_MODE === "openvtc"
            ? VTI_EXTERNAL_ADAPTER
            : VTI_ADAPTER,
      sentAt: new Date().toISOString(),
      attempts,
      error: message,
    };
    await db.approvalRequest.update({
      where: { id: approval.id },
      data: {
        context: toJson({
          ...context,
          _vti: { ...vti, stepUpRequest, delivery: failedDelivery },
        }),
      },
      select: { id: true },
    });
    throw new ServiceError("INTERNAL", message);
  }

  const delivery: VtiDeliveryState = {
    status: "sent_to_vti_adapter",
    adapter: receipt.adapter,
    sentAt: new Date().toISOString(),
    attempts,
  };

  await db.approvalRequest.update({
    where: { id: approval.id },
    data: {
      context: toJson({
        ...context,
        _vti: {
          ...vti,
          stepUpRequest,
          delivery,
        },
      }),
    },
    select: { id: true },
  });

  return {
    approvalId: approval.id,
    stepUpRequest,
    actorStepUp: vti?.actorStepUp,
    delivery,
  };
};

/**
 * Summary counts for the manager dashboard: pending total, plus approved and
 * denied counts in the last 24h. Auto-expired (timed-out) approvals remain
 * "pending" in the durable record — the gateway is the live hold source — so
 * the pending count reflects everything still awaiting a manager decision.
 */
export const getApprovalSummary = async (organizationId: string) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pending, approved24h, denied24h] = await Promise.all([
    db.approvalRequest.count({
      where: { organizationId, status: "pending" },
    }),
    db.approvalRequest.count({
      where: {
        organizationId,
        status: "approved",
        updatedAt: { gte: since },
      },
    }),
    db.approvalRequest.count({
      where: {
        organizationId,
        status: "denied",
        updatedAt: { gte: since },
      },
    }),
  ]);

  return { pending, approved24h, denied24h };
};

/**
 * Get the status of an ApprovalRequest, resolving by either its own DB `id`
 * or by the `gatewayApprovalId` stored in `context.gatewayApprovalId`.
 *
 * Used by GET /v1/internal/approvals/:id/status so the gateway can poll for
 * the manager's decision without a push channel.
 *
 * Returns `null` when no matching record is found (404 in the route handler).
 */
/**
 * Record a manager's approve/deny decision on a pending approval request,
 * resolving the row by its DB `id` OR by the `gatewayApprovalId` stashed in
 * `context.gatewayApprovalId` — the same two keys the gateway polls
 * `GET /v1/internal/approvals/:id/status` with.
 *
 * This is the **id-bridge** decide path: the gateway-created ApprovalRequest
 * lives in the agent token's organization (e.g. `demo-corp-org`), but the
 * manager session that wants to approve it (in local/demo mode, the
 * auto-authenticated `local-admin` user) belongs to a *different* bootstrapped
 * org. The public `decideApproval` filters by `auth.organizationId`, so it 404s
 * on gateway-created rows. This bridge variant resolves the org from the row
 * itself (no caller-supplied org filter) and is gated by the internal shared
 * secret (`X-Gateway-Secret`) at the route layer, not by a user session.
 *
 * Throws NOT_FOUND if no row matches either key, BAD_REQUEST if already decided.
 */
export const decideApprovalByBridgeId = async (params: {
  bridgeId: string; // DB id OR gatewayApprovalId
  decidedBy: string;
  decidedByEmail?: string;
  input: DecideApprovalInput;
}) => {
  const { bridgeId, decidedBy, decidedByEmail, input } = params;
  const status = input.decision; // "approved" | "denied"

  // Resolve the org from the row itself so the caller doesn't need to be in
  // the same org. Try the DB id fast path first, then the gatewayApprovalId
  // JSON path query (mirrors getApprovalStatus).
  const existing = await resolveApprovalByBridgeId(bridgeId);
  if (!existing)
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  if (existing.status !== "pending") {
    throw new ServiceError(
      "BAD_REQUEST",
      `Approval request already ${existing.status}`,
    );
  }

  let managerConfirmation: ManagerConfirmationEvidence | undefined;
  if (input.confirmation) {
    managerConfirmation = await verifyManagerConfirmation({
      approvalId: existing.id,
      decidedBy,
      decision: status,
      context: existing.context,
      confirmation: input.confirmation,
    });
  } else if (status === "approved") {
    throw new ServiceError(
      "BAD_REQUEST",
      "A signed OpenVTC manager confirmation is required to approve",
    );
  }

  const nextContext = getContextRecord(existing.context);
  if (managerConfirmation) {
    const decisionVc = await createVerifiedDecisionVc({
      approvalId: existing.id,
      action: existing.action,
      decidedAt: new Date(),
      decidedBy,
      decision: status,
      confirmation: managerConfirmation,
    });
    nextContext._vti = {
      ...(getVtiContext(nextContext) ?? {}),
      managerConfirmation,
      decision: decisionVc,
    };
  }

  const updated = await db.approvalRequest.update({
    where: { id: existing.id },
    data: {
      status,
      decidedBy,
      decisionComment: input.comment ?? null,
      context: toJson(nextContext),
    },
    select: SELECT,
  });

  // Audit the decision. Wrap in try/catch so an audit failure never fails the
  // decision itself (mirrors decideApproval).
  try {
    await db.auditLog.create({
      data: {
        organizationId: updated.organizationId,
        projectId: updated.projectId,
        userId: decidedBy,
        userEmail: decidedByEmail ?? "",
        action: input.decision,
        service: "approval",
        status: "success",
        source: "gateway-internal",
        metadata: {
          approvalId: updated.id,
          gatewayApprovalId: bridgeId,
          requestedBy: updated.requestedBy,
          action: updated.action,
          comment: input.comment ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.error(
      { err, approvalId: updated.id, decision: input.decision },
      "failed to write approval decision audit log (bridge decide)",
    );
  }

  return updated;
};

/**
 * Accept an OpenVTC wallet response without requiring a ONEComputer browser
 * session. The signed Trust-Task is the authentication factor; the gateway
 * performs the authoritative Data Integrity verification before releasing the
 * held request. This route only resolves the manager's existing OpenVTC
 * profile, checks its organization role, and persists the response for the
 * gateway's fail-closed verification path.
 */
export const decideApprovalByOpenVtc = async (params: {
  bridgeId: string;
  document: Record<string, unknown>;
  comment?: string;
}) => {
  const issuer = params.document.issuer;
  if (typeof issuer !== "string" || !issuer.startsWith("did:")) {
    throw new ServiceError("FORBIDDEN", "OpenVTC response issuer is invalid");
  }

  const manager = await db.user.findUnique({
    where: { externalAuthId: `openvtc:${issuer}` },
    select: { id: true, email: true },
  });
  if (!manager) {
    throw new ServiceError("FORBIDDEN", "OpenVTC approver is not provisioned");
  }

  // The external-wallet ingress must reject an unsigned or self-asserted
  // document before mutating the durable approval row. The gateway repeats
  // this verification before releasing the held request, but API ingress is
  // also a security boundary and must not report a false approval state.
  const proof = await verifyTrustTaskProof(params.document);
  if (!proof.ok || proof.signer !== issuer) {
    throw new ServiceError(
      "FORBIDDEN",
      `OpenVTC response proof failed verification${proof.ok ? "" : `: ${proof.error}`}`,
    );
  }

  const existing = await resolveApprovalByBridgeId(params.bridgeId);
  if (!existing) {
    throw new ServiceError("NOT_FOUND", "Approval request not found");
  }
  const membership = await db.organizationMember.findFirst({
    where: { organizationId: existing.organizationId, userId: manager.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin", "manager"].includes(membership.role)) {
    throw new ServiceError(
      "FORBIDDEN",
      "OpenVTC approver is not an authorized manager",
    );
  }

  const payload = params.document.payload;
  const payloadRecord =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const decision = payloadRecord?.decision;
  if (decision !== "approved" && decision !== "denied") {
    throw new ServiceError(
      "FORBIDDEN",
      "OpenVTC response decision must be approved or denied",
    );
  }

  return decideApprovalByBridgeId({
    bridgeId: params.bridgeId,
    decidedBy: manager.id,
    decidedByEmail: manager.email,
    input: {
      decision,
      comment: params.comment,
      confirmation: {
        protocol: "auth/step-up/approve-response/0.2",
        version: "0.2",
        document: params.document,
      },
    },
  });
};

/**
 * Resolve an ApprovalRequest by its DB `id` OR by `context.gatewayApprovalId`,
 * without an organizationId filter. Used by the internal decide route (the
 * gateway-side bridge) so a manager-side tool can approve a gateway-created
 * hold even when the calling session is not in the same org as the agent.
 *
 * Returns the identity, status, and confirmation context or `null`.
 */
const resolveApprovalByBridgeId = async (
  bridgeId: string,
): Promise<{
  id: string;
  organizationId: string;
  status: string;
  context: unknown;
  action: string;
} | null> => {
  // Fast path: DB id (UUID the API minted at create time).
  const byId = await db.approvalRequest.findFirst({
    where: { id: bridgeId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      context: true,
      action: true,
    },
  });
  if (byId) return byId;

  // Slow path: gatewayApprovalId embedded in context JSON.
  const byGatewayId = await db.approvalRequest.findFirst({
    where: {
      context: {
        path: ["gatewayApprovalId"],
        equals: bridgeId,
      },
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      context: true,
      action: true,
    },
  });
  return byGatewayId ?? null;
};

/**
 * List approval requests that have a `context.gatewayApprovalId` (i.e. were
 * created by the gateway via POST /v1/internal/approvals), optionally filtered
 * by status. **Not org-scoped** — the internal shared secret is the auth
 * boundary, and gateway-created holds may live in an org the calling manager
 * session does not belong to (the local-mode `local-admin` ↔ `demo-corp-org`
 * split that broke the public decide route).
 *
 * This is the manager-side "show me what the gateway is holding right now" list
 * for the approve→release bridge.
 */
export const listApprovalsByBridge = async (opts: {
  status?: ApprovalStatus;
  limit?: number;
}) => {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const where: Prisma.ApprovalRequestWhereInput = {};
  if (opts.status) where.status = opts.status;

  // Fetch (optionally status-filtered) rows then keep only those carrying a
  // `context.gatewayApprovalId` — i.e. created by the gateway via
  // POST /v1/internal/approvals. Prisma's JSON path "key exists" filter is
  // fragile across versions; an in-JS predicate on the small dev/demo table is
  // robust and keeps the query indexed on status.
  const rows = await db.approvalRequest.findMany({
    where,
    select: SELECT,
    orderBy: { createdAt: "desc" },
    take: limit * 4,
  });

  const items = rows.filter((row) => {
    const ctx = getContextRecord(row.context);
    return typeof ctx.gatewayApprovalId === "string" && ctx.gatewayApprovalId;
  });

  return { items: items.slice(0, limit), hasMore: items.length > limit };
};

export const getApprovalStatus = async (params: {
  organizationId: string;
  id: string; // either the DB id or the gatewayApprovalId
}): Promise<{
  id: string;
  status: ApprovalStatus;
  // The signed decision VC (context._vti.decision), if one is persisted on the
  // row. Surfaced so the gateway can cryptographically verify the manager's
  // decision BEFORE releasing a held request (ONE-142) instead of trusting the
  // bare `status` string. Absent when the row is still pending or was decided
  // under a build that did not persist a signed VC — the gateway falls back to
  // string-only behavior in that case.
  decisionVc?: SignedCredential;
  managerConfirmation?: ManagerConfirmationEvidence;
} | null> => {
  const { organizationId, id } = params;

  // Select the full context so we can extract context._vti.decision alongside
  // the status. The context JSON is already loaded by the row read; no extra
  // query cost.
  const selectCtx = { id: true, status: true, context: true } as const;

  // Fast path: try the DB id first (UUID from the API).
  const byId = await db.approvalRequest.findFirst({
    where: { id, organizationId },
    select: selectCtx,
  });
  if (byId) {
    if (!isApprovalStatus(byId.status)) return null;
    return {
      id: byId.id,
      status: byId.status,
      decisionVc: getVtiContext(byId.context)?.decision,
      managerConfirmation: getVtiContext(byId.context)?.managerConfirmation,
    };
  }

  // Slow path: search by gatewayApprovalId embedded in context JSON.
  // Uses a Postgres JSON path query so no full-table scan.
  const byGatewayId = await db.approvalRequest.findFirst({
    where: {
      organizationId,
      context: {
        path: ["gatewayApprovalId"],
        equals: id,
      },
    },
    select: selectCtx,
  });
  if (!byGatewayId) return null;
  if (!isApprovalStatus(byGatewayId.status)) return null;
  return {
    id: byGatewayId.id,
    status: byGatewayId.status,
    decisionVc: getVtiContext(byGatewayId.context)?.decision,
    managerConfirmation: getVtiContext(byGatewayId.context)
      ?.managerConfirmation,
  };
};

export { isApprovalStatus };
