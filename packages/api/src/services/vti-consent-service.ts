import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PersonalConnectorGrant } from "./personal-connector-broker-service";
import { loadSigningKey, signTrustTask } from "../lib/vti-credential-signer";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export type VtiTrustTaskType =
  | "consent/request"
  | "consent/decision"
  | "auth/step-up/approve-request"
  | "auth/step-up/approve-response"
  | "auth/step-up/verify-actor";

export interface VtiTrustTaskEnvelope<TPayload> {
  schemaVersion: "onecomputer.vti-trust-task-envelope.v1";
  taskType: VtiTrustTaskType;
  taskId: string;
  taskHash: string;
  createdAt: string;
  requesterDid: string;
  subjectDid: string;
  agentDid: string;
  payload: TPayload;
  proofMode: "external_vti_required";
  note: "Adapter seam only. VTI/OpenVTC/Affinidi must perform DID/key/proof verification.";
  /** Canonical OpenVTC document for transports that support it. */
  document?: Record<string, unknown>;
}

export interface PersonalConnectorConsentPayload {
  grantHash: string;
  connectorId: string;
  connectorKind: PersonalConnectorGrant["connectorKind"];
  agentId: string;
  purpose: string;
  scopeHash: string;
  accessMode: "read_only";
  expiresAt: string;
  maxItems: number;
  requestedActionDigest: string;
}

export interface PersonalConnectorConsentDecisionPayload {
  requestTaskHash: string;
  grantHash: string;
  approved: boolean;
  approverDid: string;
  approvedAt: string;
  expiresAt: string;
  reason?: string;
}

export interface VtiConsentBinding {
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  stepUpRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  requiredTrustTasks: ["consent/request", "auth/step-up/approve-request"];
  failClosedIfUnavailable: true;
}

export interface VerifyConsentDecisionInput {
  grant: PersonalConnectorGrant;
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  decision?: VtiTrustTaskEnvelope<PersonalConnectorConsentDecisionPayload>;
  now: string;
}

export interface ConsentDecisionVerification {
  allowed: boolean;
  reason: string;
  decisionHash?: string;
  failClosed: true;
}

const buildEnvelope = <TPayload>(input: {
  taskType: VtiTrustTaskType;
  createdAt: string;
  requesterDid: string;
  subjectDid: string;
  agentDid: string;
  payload: TPayload;
}): VtiTrustTaskEnvelope<TPayload> => {
  const seed = {
    schemaVersion: "onecomputer.vti-trust-task-envelope.v1" as const,
    taskType: input.taskType,
    createdAt: input.createdAt,
    requesterDid: input.requesterDid,
    subjectDid: input.subjectDid,
    agentDid: input.agentDid,
    payload: input.payload,
    proofMode: "external_vti_required" as const,
  };
  const taskHash = sha256(canonicalJson(asJson(seed)));

  return {
    ...seed,
    taskId: taskHash.slice("sha256:".length, "sha256:".length + 16),
    taskHash,
    note: "Adapter seam only. VTI/OpenVTC/Affinidi must perform DID/key/proof verification.",
  };
};

export interface ApprovalStepUpPayload {
  approvalId: string;
  action: string;
  requestedBy: string;
  agentId?: string;
  context: Record<string, JsonValue>;
  humanSummary: string;
  requestedActionDigest: string;
  /** Canonical OpenVTC approve-request fields retained in the adapter view. */
  subject?: string;
  sessionId?: string;
  challenge?: string;
  reason?: string;
  targetAcr?: "aal2";
  acceptableEvidence?: ["did-signed", "webauthn"];
  ttl?: number;
  ext?: Record<string, JsonValue>;
}

const summarizeApprovalContext = (
  action: string,
  context: Record<string, JsonValue>,
): string => {
  const recipient =
    typeof context.to === "string"
      ? context.to
      : typeof context.recipient === "string"
        ? context.recipient
        : undefined;
  const subject =
    typeof context.subject === "string" ? context.subject : undefined;
  if (recipient && subject) return `${action}: ${subject} → ${recipient}`;
  if (recipient) return `${action}: recipient ${recipient}`;
  if (subject) return `${action}: ${subject}`;
  return action;
};

/**
 * Build a generic VTI step-up notification envelope for manager approvals.
 * This is the bridge between OneComputer's durable ApprovalRequest record and
 * the VTI/OpenVTC approval channel. It intentionally produces an
 * `auth/step-up/approve-request` envelope with `proofMode: external_vti_required`;
 * the actual DID/key/proof verification remains owned by the VTI signer/VTA.
 */
export const buildApprovalStepUpNotificationEnvelope = async (input: {
  approvalId: string;
  action: string;
  requestedBy: string;
  agentId?: string;
  context: Record<string, JsonValue>;
  requesterDid: string;
  subjectDid: string;
  agentDid: string;
  createdAt: string;
}): Promise<
  VtiTrustTaskEnvelope<ApprovalStepUpPayload> & {
    /** Exact OpenVTC document delivered to the external wallet/VTA. */
    document: Record<string, unknown>;
  }
> => {
  const requestedActionDigest = sha256(
    canonicalJson(
      asJson({
        approvalId: input.approvalId,
        action: input.action,
        requestedBy: input.requestedBy,
        agentId: input.agentId,
        context: input.context,
      }),
    ),
  );

  const challenge = randomBytes(32).toString("base64url");
  const recipientDid = process.env.OPENVTC_APPROVER_DID ?? input.subjectDid;
  if (
    process.env.AUTH_MODE === "openvtc" &&
    (!process.env.OPENVTC_APPROVER_DID ||
      !process.env.OPENVTC_APPROVER_DID.startsWith("did:"))
  ) {
    throw new Error(
      "OPENVTC_APPROVER_DID is required when AUTH_MODE=openvtc; approval routing cannot fall back to a synthetic manager DID",
    );
  }
  const rpKey = loadSigningKey();
  const rpDid = process.env.OPENVTC_RP_DID ?? rpKey.did;
  if (rpDid !== rpKey.did) {
    throw new Error(
      `OPENVTC_RP_DID (${rpDid}) must match the RP signing key DID (${rpKey.did})`,
    );
  }
  const authorizationContext = {
    approvalId: input.approvalId,
    action: input.action,
    requestedBy: input.requestedBy,
    agentId: input.agentId ?? null,
    context: input.context,
    requestedActionDigest,
  } satisfies Record<string, JsonValue>;

  const adapterEnvelope = buildEnvelope({
    taskType: "auth/step-up/approve-request",
    createdAt: input.createdAt,
    requesterDid: input.requesterDid,
    subjectDid: input.subjectDid,
    agentDid: input.agentDid,
    payload: {
      approvalId: input.approvalId,
      action: input.action,
      requestedBy: input.requestedBy,
      agentId: input.agentId,
      context: input.context,
      humanSummary: summarizeApprovalContext(input.action, input.context),
      requestedActionDigest,
      subject: input.requesterDid,
      sessionId: input.approvalId,
      challenge,
      reason: summarizeApprovalContext(input.action, input.context),
      targetAcr: "aal2" as const,
      acceptableEvidence: ["did-signed", "webauthn"] as [
        "did-signed",
        "webauthn",
      ],
      ttl: 300,
      ext: {
        "org.openvtc.authorization-context": authorizationContext,
      },
    },
  });

  // The strict OpenVTC document contains only spec-defined fields. The
  // OneComputer adapter envelope above remains a local correlation view for
  // existing API consumers; VTA/wallet transports must use `document`.
  const document = await signTrustTask(
    {
      id: `urn:uuid:${randomUUID()}`,
      type: "https://trusttasks.org/spec/auth/step-up/approve-request/0.1",
      issuer: rpDid,
      recipient: recipientDid,
      issuedAt: input.createdAt,
      payload: {
        subject: input.requesterDid,
        sessionId: input.approvalId,
        challenge,
        reason: summarizeApprovalContext(input.action, input.context),
        targetAcr: "aal2",
        acceptableEvidence: ["did-signed", "webauthn"],
        ttl: 300,
        ext: {
          "org.openvtc.authorization-context": authorizationContext,
        },
      },
    },
    rpKey,
  );

  return { ...adapterEnvelope, document };
};

/**
 * Build a VTI step-up notification envelope targeting the ACTOR (the user who
 * triggered the risky action), rather than their manager. This is the second
 * half of the "user gets a 2FA prompt AND manager gets an approval" demo flow:
 * the manager envelope (`buildApprovalStepUpNotificationEnvelope`) still
 * targets the manager as `subjectDid`; this builder targets the actor as
 * `subjectDid` (they verify themselves) using the `auth/step-up/verify-actor`
 * Trust Task type so the two envelopes remain structurally distinguishable.
 * Both envelopes share `requestedActionDigest` so they can be correlated back
 * to the same underlying action.
 */
export const buildActorStepUpNotificationEnvelope = (input: {
  approvalId: string;
  action: string;
  requestedBy: string;
  agentId?: string;
  context: Record<string, JsonValue>;
  requesterDid: string;
  actorDid: string;
  agentDid: string;
  createdAt: string;
}): VtiTrustTaskEnvelope<ApprovalStepUpPayload> => {
  const requestedActionDigest = sha256(
    canonicalJson(
      asJson({
        approvalId: input.approvalId,
        action: input.action,
        requestedBy: input.requestedBy,
        agentId: input.agentId,
        context: input.context,
      }),
    ),
  );

  return buildEnvelope({
    taskType: "auth/step-up/verify-actor",
    createdAt: input.createdAt,
    requesterDid: input.requesterDid,
    subjectDid: input.actorDid,
    agentDid: input.agentDid,
    payload: {
      approvalId: input.approvalId,
      action: input.action,
      requestedBy: input.requestedBy,
      agentId: input.agentId,
      context: input.context,
      humanSummary: summarizeApprovalContext(input.action, input.context),
      requestedActionDigest,
    },
  });
};

export const buildPersonalConnectorConsentBinding = (input: {
  grant: PersonalConnectorGrant;
  requesterDid: string;
  subjectDid: string;
  agentDid: string;
  requestedActionDigest: string;
  createdAt: string;
}): VtiConsentBinding => {
  const payload: PersonalConnectorConsentPayload = {
    grantHash: input.grant.grantHash,
    connectorId: input.grant.connectorId,
    connectorKind: input.grant.connectorKind,
    agentId: input.grant.agentId,
    purpose: input.grant.purpose,
    scopeHash: sha256(canonicalJson(asJson(input.grant.scope))),
    accessMode: "read_only",
    expiresAt: input.grant.expiresAt,
    maxItems: input.grant.maxItems,
    requestedActionDigest: input.requestedActionDigest,
  };

  return {
    consentRequest: buildEnvelope({
      taskType: "consent/request",
      createdAt: input.createdAt,
      requesterDid: input.requesterDid,
      subjectDid: input.subjectDid,
      agentDid: input.agentDid,
      payload,
    }),
    stepUpRequest: buildEnvelope({
      taskType: "auth/step-up/approve-request",
      createdAt: input.createdAt,
      requesterDid: input.requesterDid,
      subjectDid: input.subjectDid,
      agentDid: input.agentDid,
      payload,
    }),
    requiredTrustTasks: ["consent/request", "auth/step-up/approve-request"],
    failClosedIfUnavailable: true,
  };
};

export const buildConsentDecisionEnvelope = (input: {
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  approverDid: string;
  approved: boolean;
  approvedAt: string;
  expiresAt: string;
  reason?: string;
}): VtiTrustTaskEnvelope<PersonalConnectorConsentDecisionPayload> =>
  buildEnvelope({
    taskType: "consent/decision",
    createdAt: input.approvedAt,
    requesterDid: input.consentRequest.requesterDid,
    subjectDid: input.approverDid,
    agentDid: input.consentRequest.agentDid,
    payload: {
      requestTaskHash: input.consentRequest.taskHash,
      grantHash: input.consentRequest.payload.grantHash,
      approved: input.approved,
      approverDid: input.approverDid,
      approvedAt: input.approvedAt,
      expiresAt: input.expiresAt,
      reason: input.reason,
    },
  });

export const verifyConsentDecision = (
  input: VerifyConsentDecisionInput,
): ConsentDecisionVerification => {
  if (!input.decision) {
    return {
      allowed: false,
      reason: "VTI consent decision unavailable; fail closed",
      failClosed: true,
    };
  }

  const payload = input.decision.payload;
  if (!payload.approved) {
    return {
      allowed: false,
      reason: "VTI consent decision denied",
      decisionHash: input.decision.taskHash,
      failClosed: true,
    };
  }
  if (payload.requestTaskHash !== input.consentRequest.taskHash) {
    return {
      allowed: false,
      reason: "VTI consent decision does not match request task hash",
      decisionHash: input.decision.taskHash,
      failClosed: true,
    };
  }
  if (payload.grantHash !== input.grant.grantHash) {
    return {
      allowed: false,
      reason: "VTI consent decision does not match connector grant hash",
      decisionHash: input.decision.taskHash,
      failClosed: true,
    };
  }
  if (new Date(input.now).getTime() > new Date(payload.expiresAt).getTime()) {
    return {
      allowed: false,
      reason: "VTI consent decision expired",
      decisionHash: input.decision.taskHash,
      failClosed: true,
    };
  }

  return {
    allowed: true,
    reason: "VTI consent decision approved for matching grant and request",
    decisionHash: input.decision.taskHash,
    failClosed: true,
  };
};

export interface StepUpApprovalResponsePayload {
  stepUpRequestTaskHash: string;
  consentRequestTaskHash: string;
  requestedActionDigest: string;
  approved: boolean;
  approverDid: string;
  approvedAt: string;
  expiresAt: string;
  assuranceLevel: "aal2" | "aal3";
  method: "passkey" | "biometric" | "vta_mobile" | "webauthn";
}

export interface VerifyStepUpResponseInput {
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  stepUpRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  response?: VtiTrustTaskEnvelope<StepUpApprovalResponsePayload>;
  now: string;
}

export interface StepUpResponseVerification {
  allowed: boolean;
  reason: string;
  responseHash?: string;
  failClosed: true;
}

export const buildStepUpApprovalResponseEnvelope = (input: {
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  stepUpRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  approverDid: string;
  approved: boolean;
  approvedAt: string;
  expiresAt: string;
  assuranceLevel: "aal2" | "aal3";
  method: "passkey" | "biometric" | "vta_mobile" | "webauthn";
}): VtiTrustTaskEnvelope<StepUpApprovalResponsePayload> =>
  buildEnvelope({
    taskType: "auth/step-up/approve-response",
    createdAt: input.approvedAt,
    requesterDid: input.stepUpRequest.requesterDid,
    subjectDid: input.approverDid,
    agentDid: input.stepUpRequest.agentDid,
    payload: {
      stepUpRequestTaskHash: input.stepUpRequest.taskHash,
      consentRequestTaskHash: input.consentRequest.taskHash,
      requestedActionDigest: input.stepUpRequest.payload.requestedActionDigest,
      approved: input.approved,
      approverDid: input.approverDid,
      approvedAt: input.approvedAt,
      expiresAt: input.expiresAt,
      assuranceLevel: input.assuranceLevel,
      method: input.method,
    },
  });

export const verifyStepUpResponse = (
  input: VerifyStepUpResponseInput,
): StepUpResponseVerification => {
  if (!input.response) {
    return {
      allowed: false,
      reason: "VTI step-up response unavailable; fail closed",
      failClosed: true,
    };
  }

  const payload = input.response.payload;
  if (!payload.approved) {
    return {
      allowed: false,
      reason: "VTI step-up response denied",
      responseHash: input.response.taskHash,
      failClosed: true,
    };
  }
  if (payload.stepUpRequestTaskHash !== input.stepUpRequest.taskHash) {
    return {
      allowed: false,
      reason: "VTI step-up response does not match step-up request task hash",
      responseHash: input.response.taskHash,
      failClosed: true,
    };
  }
  if (payload.consentRequestTaskHash !== input.consentRequest.taskHash) {
    return {
      allowed: false,
      reason: "VTI step-up response does not match consent request task hash",
      responseHash: input.response.taskHash,
      failClosed: true,
    };
  }
  if (
    payload.requestedActionDigest !==
    input.stepUpRequest.payload.requestedActionDigest
  ) {
    return {
      allowed: false,
      reason: "VTI step-up response does not match requested action digest",
      responseHash: input.response.taskHash,
      failClosed: true,
    };
  }
  if (new Date(input.now).getTime() > new Date(payload.expiresAt).getTime()) {
    return {
      allowed: false,
      reason: "VTI step-up response expired",
      responseHash: input.response.taskHash,
      failClosed: true,
    };
  }

  return {
    allowed: true,
    reason:
      "VTI step-up response approved for matching consent, request, and action digest",
    responseHash: input.response.taskHash,
    failClosed: true,
  };
};

export interface AuthorizeRetrievalWithVtiConsentInput {
  grant: PersonalConnectorGrant;
  consentRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  consentDecision?: VtiTrustTaskEnvelope<PersonalConnectorConsentDecisionPayload>;
  stepUpRequest: VtiTrustTaskEnvelope<PersonalConnectorConsentPayload>;
  stepUpResponse?: VtiTrustTaskEnvelope<StepUpApprovalResponsePayload>;
  now: string;
}

export interface AuthorizeRetrievalWithVtiConsentResult {
  allowed: boolean;
  reason: string;
  failClosed: true;
  consentDecisionHash?: string;
  stepUpResponseHash?: string;
}

export const authorizePersonalConnectorRetrievalWithVtiConsent = (
  input: AuthorizeRetrievalWithVtiConsentInput,
): AuthorizeRetrievalWithVtiConsentResult => {
  const consent = verifyConsentDecision({
    grant: input.grant,
    consentRequest: input.consentRequest,
    decision: input.consentDecision,
    now: input.now,
  });
  if (!consent.allowed) {
    return {
      allowed: false,
      reason: consent.reason,
      failClosed: true,
      consentDecisionHash: consent.decisionHash,
    };
  }

  const stepUp = verifyStepUpResponse({
    consentRequest: input.consentRequest,
    stepUpRequest: input.stepUpRequest,
    response: input.stepUpResponse,
    now: input.now,
  });
  if (!stepUp.allowed) {
    return {
      allowed: false,
      reason: stepUp.reason,
      failClosed: true,
      consentDecisionHash: consent.decisionHash,
      stepUpResponseHash: stepUp.responseHash,
    };
  }

  return {
    allowed: true,
    reason:
      "Personal connector retrieval authorized after matching VTI consent and step-up response",
    failClosed: true,
    consentDecisionHash: consent.decisionHash,
    stepUpResponseHash: stepUp.responseHash,
  };
};
