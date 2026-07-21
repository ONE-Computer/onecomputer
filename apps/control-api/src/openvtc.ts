import { createHash, randomBytes, randomUUID } from "node:crypto";
import { OneComputerError, type IdentityContext, type OwnedJson } from "@onecomputer/contracts";
import {
  Ed25519DidKeySigner,
  ONECOMPUTER_APPROVER_ENROLLMENT_TYPE,
  buildTaskConsentRequest,
  jcsCanonicalize,
  taskConsentPayloadDigest,
  verifyApproverEnrollment,
  verifyTaskConsentDecision,
} from "@onecomputer/openvtc-adapter";
import type {
  GovernanceStore,
  GovernedOperationRecord,
  OpenVtcApprovalStore,
  OpenVtcApproverRecord,
  OpenVtcConsentTaskRecord,
  WorkspaceStore,
} from "@onecomputer/workspace-store";

const DELETE_ONEDRIVE_TASK_TYPE = "https://onecomputer.dev/spec/microsoft365/delete-onedrive-file/0.1";
const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

type ApprovalStore = WorkspaceStore & GovernanceStore & OpenVtcApprovalStore;

const publicApprover = (record: OpenVtcApproverRecord) => ({
  id: record.id,
  approverDid: record.approverDid,
  verificationMethod: record.verificationMethod,
  displayName: record.displayName,
  status: record.status,
  enrolledAt: record.enrolledAt.toISOString(),
});

const taskPayloadFor = (record: GovernedOperationRecord): OwnedJson => ({
  version: "1",
  tenantId: record.tenantId,
  subjectId: record.subjectId,
  workspaceId: record.workspaceId,
  agentId: record.agentId,
  capabilityId: record.capabilityId,
  serverName: record.serverName,
  toolName: record.toolName,
  schemaId: record.schemaId,
  arguments: record.arguments,
  operationDigest: record.operationDigest,
  nonce: record.nonce,
  expiresAt: record.expiresAt.toISOString(),
});

const transportIdentity = (approver: OpenVtcApproverRecord): IdentityContext => ({
  tenantId: approver.tenantId,
  subjectId: approver.subjectId,
  audience: "onecomputer-control",
});

export class OpenVtcApprovalCoordinator {
  constructor(
    private readonly store: ApprovalStore,
    readonly executor: Ed25519DidKeySigner,
  ) {}

  async createEnrollmentChallenge(identity: IdentityContext) {
    const createdAt = new Date();
    const record = await this.store.createOpenVtcEnrollmentChallenge({
      id: randomUUID(),
      identity,
      executorDid: this.executor.did,
      challenge: randomBytes(24).toString("base64url"),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + ENROLLMENT_TTL_MS),
    });
    return {
      id: record.id,
      type: ONECOMPUTER_APPROVER_ENROLLMENT_TYPE,
      recipientDid: record.executorDid,
      challenge: record.challenge,
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      issuedAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  async enroll(identity: IdentityContext, challengeId: string, document: unknown) {
    const challenge = await this.store.getOpenVtcEnrollmentChallenge(identity, challengeId);
    const now = new Date();
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new OneComputerError("OPENVTC_ENROLLMENT_CHALLENGE_INVALID", "The enrollment challenge is missing, expired, or already used", 409);
    }
    const proof = verifyApproverEnrollment({
      document,
      expected: {
        recipientDid: challenge.executorDid,
        challenge: challenge.challenge,
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
      },
      now,
    });
    if (!proof.verified) throw new OneComputerError("OPENVTC_ENROLLMENT_PROOF_INVALID", proof.reason, 403);
    if (!await this.store.consumeOpenVtcEnrollmentChallenge(identity, challenge.id, challenge.challenge, now)) {
      throw new OneComputerError("OPENVTC_ENROLLMENT_CHALLENGE_INVALID", "The enrollment challenge is missing, expired, or already used", 409);
    }
    const payload = isObject(document) && isObject(document.payload) ? document.payload : {};
    const transportToken = `ocvta_${randomBytes(32).toString("base64url")}`;
    const approver = await this.store.enrollOpenVtcApprover({
      id: randomUUID(),
      identity,
      approverDid: proof.signerDid,
      verificationMethod: proof.verificationMethod,
      displayName: String(payload.displayName),
      transportTokenHash: sha256(transportToken),
      enrolledAt: now,
    });
    const recent = await this.store.getRecentOperation(identity);
    if (recent?.state === "approval_required") await this.ensureTask(identity, recent);
    return { approver: publicApprover(approver), transportToken };
  }

  async status(identity: IdentityContext) {
    const approver = await this.store.getActiveOpenVtcApprover(identity);
    return { connected: Boolean(approver), approver: approver ? publicApprover(approver) : null, executorDid: this.executor.did };
  }

  async revoke(identity: IdentityContext) {
    const approver = await this.store.getActiveOpenVtcApprover(identity);
    if (!approver) return false;
    return this.store.revokeOpenVtcApprover(identity, approver.id, new Date());
  }

  async ensureTask(identity: IdentityContext, operation: GovernedOperationRecord) {
    const existing = await this.store.getOpenVtcConsentTask(identity, operation.id);
    if (existing) return existing;
    const approver = await this.store.getActiveOpenVtcApprover(identity);
    if (!approver || operation.state !== "approval_required" || operation.expiresAt <= new Date()) return null;
    const createdAt = new Date();
    const challenge = randomBytes(24).toString("base64url");
    const taskPayload = taskPayloadFor(operation);
    const taskId = randomUUID();
    const request = await buildTaskConsentRequest({
      id: `urn:uuid:${taskId}`,
      issuerDid: this.executor.did,
      recipientDid: approver.approverDid,
      verificationMethod: this.executor.verificationMethod,
      issuedAt: createdAt.toISOString(),
      expiresAt: operation.expiresAt.toISOString(),
      challenge,
      taskType: DELETE_ONEDRIVE_TASK_TYPE,
      taskPayload,
      requesterDid: `did:onecomputer:agent:${operation.agentId ?? "workspace-agent"}`,
      approverSet: "onecomputer-workspace-owners",
      minApprovals: 1,
      excludeRequester: true,
      sideEffects: "destructive",
      exposure: { discloses: "none", actsAsSubject: true },
      effects: [{ kind: "delete", summary: operation.safeSummary, path: operation.resourceLocation }],
      consequences: ["This operation permanently removes the selected Microsoft 365 resource."],
      subject: `urn:onecomputer:operation:${operation.id}`,
      origin: "ONEComputer Control",
      statePin: { resource: operation.resourceName, version: operation.operationDigest },
      sign: (input) => this.executor.sign(input),
    });
    const payloadDigest = taskConsentPayloadDigest(DELETE_ONEDRIVE_TASK_TYPE, taskPayload, challenge);
    return this.store.createOpenVtcConsentTask({
      id: taskId,
      outboxId: randomUUID(),
      identity,
      operationId: operation.id,
      approverId: approver.id,
      executorDid: this.executor.did,
      challenge,
      taskType: DELETE_ONEDRIVE_TASK_TYPE,
      payloadDigest,
      requestDocument: request as OwnedJson,
      requestHash: sha256(jcsCanonicalize(request)),
      createdAt,
      expiresAt: operation.expiresAt,
    });
  }

  async inbox(transportToken: string) {
    const approver = await this.requireTransportApprover(transportToken);
    const task = await this.store.deliverNextOpenVtcConsentTask(approver.id, new Date());
    return task?.requestDocument ?? null;
  }

  async submitDecision(transportToken: string, document: unknown, correlationId: string) {
    const approver = await this.requireTransportApprover(transportToken);
    const payload = isObject(document) && isObject(document.payload) ? document.payload : null;
    const payloadDigest = payload?.payloadDigest;
    if (typeof payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(payloadDigest)) {
      throw new OneComputerError("OPENVTC_DECISION_INVALID", "The decision payload digest is invalid", 400);
    }
    const task = await this.store.getOpenVtcConsentTaskByPayloadDigest(approver.id, payloadDigest);
    if (!task) throw new OneComputerError("OPENVTC_TASK_NOT_FOUND", "No live consent task matches this decision", 404);
    const identity = transportIdentity(approver);
    const operation = await this.store.getOwnedOperation(identity, task.operationId);
    if (!operation) throw new OneComputerError("OPERATION_NOT_FOUND", "Governed operation not found", 404);
    this.assertStoredRequest(task, approver, operation);
    const request = task.requestDocument as Record<string, unknown>;
    const requestPayload = request.payload as Record<string, unknown>;
    const verified = verifyTaskConsentDecision({
      document,
      expected: {
        recipientDid: this.executor.did,
        challenge: task.challenge,
        payloadDigest: task.payloadDigest,
        enrolledApproverDids: [approver.approverDid],
        requestIssuedAt: String(request.issuedAt),
        requestExpiresAt: task.expiresAt.toISOString(),
        requesterDid: String(requestPayload.requester),
        excludeRequester: requestPayload.excludeRequester === true,
      },
    });
    if (!verified.verified) throw new OneComputerError("OPENVTC_DECISION_INVALID", `${verified.code}: ${verified.reason}`, 403);
    if (["approved", "denied"].includes(task.state)) {
      if (task.decisionHash === verified.documentHash) return { identity, operation };
      throw new OneComputerError("APPROVAL_CONFLICT", "This task already has a different signed decision", 409);
    }
    const recorded = await this.store.recordOpenVtcDecision({
      identity,
      taskId: task.id,
      approvalId: randomUUID(),
      approverId: approver.id,
      signerDid: verified.signerDid,
      verificationMethod: approver.verificationMethod,
      challenge: verified.challenge,
      payloadDigest: verified.payloadDigest,
      decision: verified.decision,
      decisionDocument: document as OwnedJson,
      decisionHash: verified.documentHash,
      proofHash: verified.proofHash,
      issuedAt: new Date(verified.issuedAt),
      decidedAt: new Date(),
      correlationId,
    });
    if (!recorded) {
      const decidedTask = await this.store.getOpenVtcConsentTask(identity, task.operationId);
      const decidedOperation = await this.store.getOwnedOperation(identity, task.operationId);
      if (decidedTask?.decisionHash === verified.documentHash && decidedOperation) return { identity, operation: decidedOperation };
      throw new OneComputerError("APPROVAL_STATE_INVALID", "The consent task is no longer live", 409);
    }
    return { identity, operation: recorded };
  }

  private async requireTransportApprover(transportToken: string) {
    if (!/^ocvta_[A-Za-z0-9_-]{43}$/.test(transportToken)) {
      throw new OneComputerError("UNAUTHENTICATED", "Browser agent authentication is required", 401);
    }
    const approver = await this.store.getOpenVtcApproverByTransportTokenHash(sha256(transportToken));
    if (!approver) throw new OneComputerError("UNAUTHENTICATED", "Browser agent authentication is required", 401);
    return approver;
  }

  private assertStoredRequest(task: OpenVtcConsentTaskRecord, approver: OpenVtcApproverRecord, operation: GovernedOperationRecord) {
    const request = task.requestDocument;
    if (!isObject(request) || request.issuer !== this.executor.did || request.recipient !== approver.approverDid
      || sha256(jcsCanonicalize(request)) !== task.requestHash
      || task.taskType !== DELETE_ONEDRIVE_TASK_TYPE
      || task.payloadDigest !== taskConsentPayloadDigest(task.taskType, taskPayloadFor(operation), task.challenge)) {
      throw new OneComputerError("OPENVTC_TASK_BINDING_INVALID", "The persisted consent request no longer matches its governed operation", 409);
    }
  }
}
