import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { GovernedOperationState, IdentityContext, OwnedJson, WorkspaceState } from "@onecomputer/contracts";
export * from "./identity-policy.js";

export type WorkspaceRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  grantId: string;
  state: WorkspaceState;
  providerId: string | null;
  failureCode: string | null;
  operationToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GovernedOperationRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  workspaceId: string;
  agentId: string | null;
  capabilityId: string;
  serverName: string;
  toolName: string;
  schemaId: string;
  arguments: OwnedJson;
  operationDigest: string;
  nonce: string;
  state: GovernedOperationState;
  policyDecision: "approval_required" | "deny";
  safeSummary: string;
  resourceName: string;
  resourceLocation: string;
  correlationId: string;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  dispatchStartedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  approval: null | { decision: "approve" | "deny"; channel: "local-fixture" | "openvtc-task-consent"; decidedAt: Date };
  receipt: null | { status: "succeeded"; upstreamReference: string; resultSummary: string; executedAt: Date };
};

export type CreateGovernedOperationRecord = Omit<GovernedOperationRecord,
  "tenantId" | "subjectId" | "agentId" | "state" | "policyDecision" | "leaseId" | "leaseExpiresAt" | "dispatchStartedAt" | "failureCode" | "createdAt" | "updatedAt" | "approval" | "receipt"
> & {
  identity: IdentityContext;
  agentId?: string;
  idempotencyKey: string;
  createdAt: Date;
};

export type ApprovalRecordInput = {
  identity: IdentityContext;
  operationId: string;
  approvalId: string;
  decision: "approve" | "deny";
  channel: "local-fixture" | "openvtc-task-consent";
  issuer: string;
  keyId: string;
  operationDigest: string;
  nonce: string;
  proofHash: string;
  issuedAt: Date;
  expiresAt: Date;
  decidedAt: Date;
  correlationId: string;
};

export type OpenVtcApproverRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  approverDid: string;
  verificationMethod: string;
  displayName: string;
  status: "active" | "revoked";
  enrolledAt: Date;
  revokedAt: Date | null;
};

export type OpenVtcConsentTaskRecord = {
  id: string;
  operationId: string;
  tenantId: string;
  subjectId: string;
  approverId: string;
  executorDid: string;
  challenge: string;
  taskType: string;
  payloadDigest: string;
  requestDocument: OwnedJson;
  requestHash: string;
  state: "queued" | "delivered" | "approved" | "denied" | "expired" | "failed";
  createdAt: Date;
  expiresAt: Date;
  deliveredAt: Date | null;
  decidedAt: Date | null;
  decisionDocument: OwnedJson | null;
  decisionHash: string | null;
  proofHash: string | null;
};

export type OpenVtcEnrollmentChallengeRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  executorDid: string;
  challenge: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type CreateOpenVtcConsentTaskInput = Omit<OpenVtcConsentTaskRecord,
  "tenantId" | "subjectId" | "state" | "deliveredAt" | "decidedAt" | "decisionDocument" | "decisionHash" | "proofHash"
> & { identity: IdentityContext; outboxId: string };

export type RecordOpenVtcDecisionInput = {
  identity: IdentityContext;
  taskId: string;
  approvalId: string;
  approverId: string;
  signerDid: string;
  verificationMethod: string;
  challenge: string;
  payloadDigest: string;
  decision: "approve" | "deny";
  decisionDocument: OwnedJson;
  decisionHash: string;
  proofHash: string;
  issuedAt: Date;
  decidedAt: Date;
  correlationId: string;
};

export interface OpenVtcApprovalStore {
  createOpenVtcEnrollmentChallenge(input: Omit<OpenVtcEnrollmentChallengeRecord, "tenantId" | "subjectId" | "consumedAt"> & { identity: IdentityContext }): Promise<OpenVtcEnrollmentChallengeRecord>;
  getOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string): Promise<OpenVtcEnrollmentChallengeRecord | null>;
  consumeOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string, challenge: string, consumedAt: Date): Promise<boolean>;
  enrollOpenVtcApprover(input: {
    id: string;
    identity: IdentityContext;
    approverDid: string;
    verificationMethod: string;
    displayName: string;
    transportTokenHash: string;
    enrolledAt: Date;
  }): Promise<OpenVtcApproverRecord>;
  getActiveOpenVtcApprover(identity: IdentityContext): Promise<OpenVtcApproverRecord | null>;
  getOpenVtcApproverByTransportTokenHash(tokenHash: string): Promise<OpenVtcApproverRecord | null>;
  revokeOpenVtcApprover(identity: IdentityContext, approverId: string, revokedAt: Date): Promise<boolean>;
  createOpenVtcConsentTask(input: CreateOpenVtcConsentTaskInput): Promise<OpenVtcConsentTaskRecord | null>;
  getOpenVtcConsentTask(identity: IdentityContext, operationId: string): Promise<OpenVtcConsentTaskRecord | null>;
  getOpenVtcConsentTaskByPayloadDigest(approverId: string, payloadDigest: string): Promise<OpenVtcConsentTaskRecord | null>;
  deliverNextOpenVtcConsentTask(approverId: string, deliveredAt: Date): Promise<OpenVtcConsentTaskRecord | null>;
  recordOpenVtcDecision(input: RecordOpenVtcDecisionInput): Promise<GovernedOperationRecord | null>;
}

export interface GovernanceStore {
  createGovernedOperation(input: CreateGovernedOperationRecord): Promise<GovernedOperationRecord | null>;
  getOwnedOperation(identity: IdentityContext, operationId: string): Promise<GovernedOperationRecord | null>;
  getRecentOperation(identity: IdentityContext): Promise<GovernedOperationRecord | null>;
  recordApproval(input: ApprovalRecordInput): Promise<GovernedOperationRecord | null>;
  claimExecution(identity: IdentityContext, operationId: string, leaseId: string, leaseExpiresAt: Date, correlationId: string): Promise<GovernedOperationRecord | null>;
  claimToolDispatch(identity: IdentityContext, input: {
    operationId: string;
    operationDigest: string;
    leaseId: string;
    workspaceId: string;
    agentId: string;
    serverName: string;
    toolName: string;
    arguments: OwnedJson;
    dispatchedAt: Date;
    correlationId: string;
  }): Promise<boolean>;
  completeExecution(identity: IdentityContext, operationId: string, leaseId: string, receipt: { id: string; upstreamReference: string; resultSummary: string; resultHash: string; executedAt: Date }, correlationId: string): Promise<GovernedOperationRecord | null>;
  failExecution(identity: IdentityContext, operationId: string, leaseId: string, failureCode: string, correlationId: string): Promise<GovernedOperationRecord | null>;
  recoverOperation(identity: IdentityContext, operationId: string, now: Date, correlationId: string): Promise<GovernedOperationRecord | null>;
}

export interface WorkspaceStore {
  getCurrent(identity: IdentityContext, grantId: string): Promise<WorkspaceRecord | null>;
  getOwned(identity: IdentityContext, workspaceId: string): Promise<WorkspaceRecord | null>;
  createOrGet(identity: IdentityContext, grantId: string, idempotencyKey: string): Promise<WorkspaceRecord>;
  claim(workspaceId: string, allowed: WorkspaceState[], next: WorkspaceState): Promise<WorkspaceRecord | null>;
  finish(workspaceId: string, operationToken: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>): Promise<WorkspaceRecord>;
  update(workspaceId: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>): Promise<WorkspaceRecord>;
  remove(identity: IdentityContext, workspaceId: string): Promise<boolean>;
}

const mapRow = (row: Record<string, unknown>): WorkspaceRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  subjectId: String(row.subject_id),
  grantId: String(row.grant_id),
  state: row.state as WorkspaceState,
  providerId: row.provider_id ? String(row.provider_id) : null,
  failureCode: row.failure_code ? String(row.failure_code) : null,
  operationToken: row.operation_token ? String(row.operation_token) : null,
  createdAt: new Date(String(row.created_at)),
  updatedAt: new Date(String(row.updated_at)),
});

const operationSelect = `
  SELECT o.*,
    a.decision AS approval_decision, a.channel AS approval_channel, a.decided_at AS approval_decided_at,
    r.status AS receipt_status, r.upstream_reference, r.result_summary, r.executed_at
  FROM governed_operations o
  LEFT JOIN governed_approvals a ON a.operation_id=o.id
  LEFT JOIN governed_receipts r ON r.operation_id=o.id`;

const mapOperationRow = (row: Record<string, unknown>): GovernedOperationRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  subjectId: String(row.subject_id),
  workspaceId: String(row.workspace_id),
  agentId: row.agent_id ? String(row.agent_id) : null,
  capabilityId: String(row.capability_id),
  serverName: String(row.server_name),
  toolName: String(row.tool_name),
  schemaId: String(row.schema_id),
  arguments: row.arguments_json as OwnedJson,
  operationDigest: String(row.operation_digest),
  nonce: String(row.nonce),
  state: row.state as GovernedOperationState,
  policyDecision: row.policy_decision as "approval_required" | "deny",
  safeSummary: String(row.safe_summary),
  resourceName: String(row.resource_name),
  resourceLocation: String(row.resource_location),
  correlationId: String(row.correlation_id),
  leaseId: row.lease_id ? String(row.lease_id) : null,
  leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)) : null,
  dispatchStartedAt: row.dispatch_started_at ? new Date(String(row.dispatch_started_at)) : null,
  failureCode: row.failure_code ? String(row.failure_code) : null,
  createdAt: new Date(String(row.created_at)),
  updatedAt: new Date(String(row.updated_at)),
  expiresAt: new Date(String(row.expires_at)),
  approval: row.approval_decision ? {
    decision: row.approval_decision as "approve" | "deny",
    channel: row.approval_channel as "local-fixture" | "openvtc-task-consent",
    decidedAt: new Date(String(row.approval_decided_at)),
  } : null,
  receipt: row.receipt_status ? {
    status: "succeeded",
    upstreamReference: String(row.upstream_reference),
    resultSummary: String(row.result_summary),
    executedAt: new Date(String(row.executed_at)),
  } : null,
});

const mapOpenVtcApproverRow = (row: Record<string, unknown>): OpenVtcApproverRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  subjectId: String(row.subject_id),
  approverDid: String(row.approver_did),
  verificationMethod: String(row.verification_method),
  displayName: String(row.display_name),
  status: row.status as "active" | "revoked",
  enrolledAt: new Date(String(row.enrolled_at)),
  revokedAt: row.revoked_at ? new Date(String(row.revoked_at)) : null,
});

const mapOpenVtcConsentTaskRow = (row: Record<string, unknown>): OpenVtcConsentTaskRecord => ({
  id: String(row.id),
  operationId: String(row.operation_id),
  tenantId: String(row.tenant_id),
  subjectId: String(row.subject_id),
  approverId: String(row.approver_id),
  executorDid: String(row.executor_did),
  challenge: String(row.challenge),
  taskType: String(row.task_type),
  payloadDigest: String(row.payload_digest),
  requestDocument: row.request_document as OwnedJson,
  requestHash: String(row.request_hash),
  state: row.state as OpenVtcConsentTaskRecord["state"],
  createdAt: new Date(String(row.created_at)),
  expiresAt: new Date(String(row.expires_at)),
  deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)) : null,
  decidedAt: row.decided_at ? new Date(String(row.decided_at)) : null,
  decisionDocument: row.decision_document ? row.decision_document as OwnedJson : null,
  decisionHash: row.decision_hash ? String(row.decision_hash) : null,
  proofHash: row.proof_hash ? String(row.proof_hash) : null,
});

const mapOpenVtcEnrollmentChallengeRow = (row: Record<string, unknown>): OpenVtcEnrollmentChallengeRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  subjectId: String(row.subject_id),
  executorDid: String(row.executor_did),
  challenge: String(row.challenge),
  createdAt: new Date(String(row.created_at)),
  expiresAt: new Date(String(row.expires_at)),
  consumedAt: row.consumed_at ? new Date(String(row.consumed_at)) : null,
});

export class PostgresWorkspaceStore implements WorkspaceStore, GovernanceStore, OpenVtcApprovalStore {
  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresWorkspaceStore(new pg.Pool({ connectionString, max: 10 }));
  }

  async migrate() {
    for (const migration of ["001_workspaces.sql", "002_governed_operations.sql", "003_persistent_workspaces.sql", "004_identity_policy.sql", "005_mcp_policy.sql", "006_openvtc_approval.sql", "007_openvtc_browser_enrollment.sql"]) {
      const migrationPath = fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url));
      await this.pool.query(await readFile(migrationPath, "utf8"));
    }
  }

  async close() { await this.pool.end(); }

  async getCurrent(identity: IdentityContext, grantId: string) {
    const result = await this.pool.query(
      "SELECT * FROM workspaces WHERE tenant_id=$1 AND subject_id=$2 AND grant_id=$3",
      [identity.tenantId, identity.subjectId, grantId],
    );
    return result.rowCount ? mapRow(result.rows[0]) : null;
  }

  async getOwned(identity: IdentityContext, workspaceId: string) {
    const result = await this.pool.query(
      "SELECT * FROM workspaces WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
      [workspaceId, identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapRow(result.rows[0]) : null;
  }

  async createOrGet(identity: IdentityContext, grantId: string, idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${identity.tenantId}:${identity.subjectId}:${grantId}`]);
      const existing = await client.query(
        "SELECT * FROM workspaces WHERE tenant_id=$1 AND subject_id=$2 AND grant_id=$3 FOR UPDATE",
        [identity.tenantId, identity.subjectId, grantId],
      );
      let record: WorkspaceRecord;
      if (existing.rowCount) {
        record = mapRow(existing.rows[0]);
      } else {
        const id = randomUUID();
        const now = new Date();
        const inserted = await client.query(
          "INSERT INTO workspaces (id,tenant_id,subject_id,grant_id,state,created_at,updated_at) VALUES ($1,$2,$3,$4,'not_created',$5,$5) RETURNING *",
          [id, identity.tenantId, identity.subjectId, grantId, now],
        );
        record = mapRow(inserted.rows[0]);
      }
      await client.query(
        "INSERT INTO workspace_idempotency (tenant_id,subject_id,operation,idempotency_key,workspace_id) VALUES ($1,$2,'create',$3,$4) ON CONFLICT DO NOTHING",
        [identity.tenantId, identity.subjectId, idempotencyKey, record.id],
      );
      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(workspaceId: string, allowed: WorkspaceState[], next: WorkspaceState) {
    const token = randomUUID();
    const result = await this.pool.query(
      "UPDATE workspaces SET state=$2, operation_token=$3, failure_code=NULL, updated_at=now() WHERE id=$1 AND state=ANY($4::text[]) RETURNING *",
      [workspaceId, next, token, allowed],
    );
    return result.rowCount ? mapRow(result.rows[0]) : null;
  }

  async finish(workspaceId: string, operationToken: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>) {
    const result = await this.pool.query(
      "UPDATE workspaces SET state=COALESCE($3,state), provider_id=CASE WHEN $5 THEN $4 ELSE provider_id END, failure_code=$6, operation_token=NULL, updated_at=now() WHERE id=$1 AND operation_token=$2 RETURNING *",
      [workspaceId, operationToken, patch.state ?? null, patch.providerId ?? null, Object.hasOwn(patch, "providerId"), patch.failureCode ?? null],
    );
    if (!result.rowCount) throw new Error("Workspace operation ownership was lost");
    return mapRow(result.rows[0]);
  }

  async update(workspaceId: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>) {
    const result = await this.pool.query(
      "UPDATE workspaces SET state=COALESCE($2,state), provider_id=CASE WHEN $4 THEN $3 ELSE provider_id END, failure_code=$5, updated_at=now() WHERE id=$1 RETURNING *",
      [workspaceId, patch.state ?? null, patch.providerId ?? null, Object.hasOwn(patch, "providerId"), patch.failureCode ?? null],
    );
    if (!result.rowCount) throw new Error("Workspace not found");
    return mapRow(result.rows[0]);
  }

  async createGovernedOperation(input: CreateGovernedOperationRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`governed:${input.identity.tenantId}:${input.identity.subjectId}:${input.idempotencyKey}`]);
      const existing = await client.query(
        "SELECT id FROM governed_operations WHERE tenant_id=$1 AND subject_id=$2 AND idempotency_key=$3",
        [input.identity.tenantId, input.identity.subjectId, input.idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return this.getOwnedOperation(input.identity, String(existing.rows[0].id));
      }
      const workspace = await client.query(
        "SELECT id FROM workspaces WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
        [input.workspaceId, input.identity.tenantId, input.identity.subjectId],
      );
      if (!workspace.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `INSERT INTO governed_operations (
          id,tenant_id,subject_id,workspace_id,agent_id,capability_id,server_name,tool_name,schema_id,arguments_json,
          operation_digest,nonce,state,policy_decision,safe_summary,resource_name,resource_location,
          idempotency_key,correlation_id,created_at,updated_at,expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'approval_required','approval_required',$13,$14,$15,$16,$17,$18,$18,$19)`,
        [
          input.id, input.identity.tenantId, input.identity.subjectId, input.workspaceId, input.agentId ?? null, input.capabilityId,
          input.serverName, input.toolName, input.schemaId, JSON.stringify(input.arguments), input.operationDigest,
          input.nonce, input.safeSummary, input.resourceName, input.resourceLocation, input.idempotencyKey,
          input.correlationId, input.createdAt, input.expiresAt,
        ],
      );
      await client.query(
        "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id,safe_detail) VALUES ($1,$2,'approval_required',$3,$4::jsonb)",
        [input.id, input.identity.tenantId, input.correlationId, JSON.stringify({ capabilityId: input.capabilityId, toolName: input.toolName })],
      );
      await client.query("COMMIT");
      return this.getOwnedOperation(input.identity, input.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOwnedOperation(identity: IdentityContext, operationId: string) {
    const result = await this.pool.query(
      `${operationSelect} WHERE o.id=$1 AND o.tenant_id=$2 AND o.subject_id=$3`,
      [operationId, identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapOperationRow(result.rows[0]) : null;
  }

  async getRecentOperation(identity: IdentityContext) {
    const result = await this.pool.query(
      `${operationSelect} WHERE o.tenant_id=$1 AND o.subject_id=$2 ORDER BY o.created_at DESC LIMIT 1`,
      [identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapOperationRow(result.rows[0]) : null;
  }

  async recordApproval(input: ApprovalRecordInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `SELECT id FROM governed_operations
         WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND state='approval_required'
           AND operation_digest=$4 AND nonce=$5 AND expires_at>$6
         FOR UPDATE`,
        [input.operationId, input.identity.tenantId, input.identity.subjectId, input.operationDigest, input.nonce, input.decidedAt],
      );
      if (!claimed.rowCount) {
        await client.query("COMMIT");
        return this.getOwnedOperation(input.identity, input.operationId);
      }
      await client.query(
        `INSERT INTO governed_approvals (
          id,operation_id,decision,channel,issuer,key_id,operation_digest,nonce,proof_hash,issued_at,expires_at,decided_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [input.approvalId, input.operationId, input.decision, input.channel, input.issuer, input.keyId, input.operationDigest, input.nonce, input.proofHash, input.issuedAt, input.expiresAt, input.decidedAt],
      );
      await client.query(
        "UPDATE governed_operations SET state=$2, updated_at=$3 WHERE id=$1",
        [input.operationId, input.decision === "approve" ? "approved" : "denied", input.decidedAt],
      );
      await client.query(
        "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id,safe_detail) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [input.operationId, input.identity.tenantId, input.decision === "approve" ? "approved" : "denied", input.correlationId, JSON.stringify({ channel: input.channel })],
      );
      await client.query("COMMIT");
      return this.getOwnedOperation(input.identity, input.operationId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimExecution(identity: IdentityContext, operationId: string, leaseId: string, leaseExpiresAt: Date, correlationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE governed_operations SET state='executing',lease_id=$4,lease_expires_at=$5,updated_at=now()
         WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND state='approved' AND expires_at>now()
         RETURNING id`,
        [operationId, identity.tenantId, identity.subjectId, leaseId, leaseExpiresAt],
      );
      if (result.rowCount) await client.query(
        "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id) VALUES ($1,$2,'executing',$3)",
        [operationId, identity.tenantId, correlationId],
      );
      await client.query("COMMIT");
      return this.getOwnedOperation(identity, operationId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimToolDispatch(identity: IdentityContext, input: {
    operationId: string; operationDigest: string; leaseId: string; workspaceId: string; agentId: string; serverName: string;
    toolName: string; arguments: OwnedJson; dispatchedAt: Date; correlationId: string;
  }) {
    const result = await this.pool.query(
      `UPDATE governed_operations SET dispatch_started_at=$11,updated_at=$11
       WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND workspace_id=$4 AND state='executing'
         AND agent_id=$5 AND operation_digest=$6 AND lease_id=$7 AND lease_expires_at>$11
         AND server_name=$8 AND tool_name=$9 AND arguments_json=$10::jsonb
         AND dispatch_started_at IS NULL RETURNING id`,
      [input.operationId, identity.tenantId, identity.subjectId, input.workspaceId, input.agentId, input.operationDigest,
        input.leaseId, input.serverName, input.toolName, JSON.stringify(input.arguments), input.dispatchedAt],
    );
    if (result.rowCount) await this.pool.query(
      "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id) VALUES ($1,$2,'dispatch_started',$3)",
      [input.operationId, identity.tenantId, input.correlationId],
    );
    return Boolean(result.rowCount);
  }

  async completeExecution(identity: IdentityContext, operationId: string, leaseId: string, receipt: { id: string; upstreamReference: string; resultSummary: string; resultHash: string; executedAt: Date }, correlationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ownedLease = await client.query(
        "SELECT id FROM governed_operations WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND state='executing' AND lease_id=$4 FOR UPDATE",
        [operationId, identity.tenantId, identity.subjectId, leaseId],
      );
      if (!ownedLease.rowCount) {
        await client.query("COMMIT");
        return this.getOwnedOperation(identity, operationId);
      }
      await client.query(
        "INSERT INTO governed_receipts (id,operation_id,lease_id,status,upstream_reference,result_summary,result_hash,executed_at) VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7)",
        [receipt.id, operationId, leaseId, receipt.upstreamReference, receipt.resultSummary, receipt.resultHash, receipt.executedAt],
      );
      await client.query("UPDATE governed_operations SET state='succeeded',updated_at=$2 WHERE id=$1", [operationId, receipt.executedAt]);
      await client.query(
        "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id) VALUES ($1,$2,'succeeded',$3)",
        [operationId, identity.tenantId, correlationId],
      );
      await client.query("COMMIT");
      return this.getOwnedOperation(identity, operationId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failExecution(identity: IdentityContext, operationId: string, leaseId: string, failureCode: string, correlationId: string) {
    const result = await this.pool.query(
      `UPDATE governed_operations SET state='failed',failure_code=$5,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND state='executing' AND lease_id=$4 RETURNING id`,
      [operationId, identity.tenantId, identity.subjectId, leaseId, failureCode],
    );
    if (result.rowCount) await this.pool.query(
      "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id,safe_detail) VALUES ($1,$2,'failed',$3,$4::jsonb)",
      [operationId, identity.tenantId, correlationId, JSON.stringify({ failureCode })],
    );
    return this.getOwnedOperation(identity, operationId);
  }

  async recoverOperation(identity: IdentityContext, operationId: string, now: Date, correlationId: string) {
    const result = await this.pool.query(
      `UPDATE governed_operations
       SET state=CASE WHEN state='executing' THEN 'failed' ELSE 'expired' END,
           failure_code=CASE WHEN state='executing' THEN 'EXECUTION_LEASE_EXPIRED' ELSE failure_code END,
           updated_at=$4
       WHERE id=$1 AND tenant_id=$2 AND subject_id=$3
         AND ((state IN ('approval_required','approved') AND expires_at<=$4)
           OR (state='executing' AND lease_expires_at<=$4))
       RETURNING state`,
      [operationId, identity.tenantId, identity.subjectId, now],
    );
    if (result.rowCount) await this.pool.query(
      "INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id) VALUES ($1,$2,$3,$4)",
      [operationId, identity.tenantId, result.rows[0].state === "expired" ? "expired" : "lease_expired", correlationId],
    );
    return this.getOwnedOperation(identity, operationId);
  }

  async createOpenVtcEnrollmentChallenge(input: Omit<OpenVtcEnrollmentChallengeRecord, "tenantId" | "subjectId" | "consumedAt"> & { identity: IdentityContext }) {
    const result = await this.pool.query(
      `INSERT INTO openvtc_enrollment_challenges (id,tenant_id,subject_id,executor_did,challenge,created_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.id, input.identity.tenantId, input.identity.subjectId, input.executorDid, input.challenge, input.createdAt, input.expiresAt],
    );
    return mapOpenVtcEnrollmentChallengeRow(result.rows[0]);
  }

  async getOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string) {
    const result = await this.pool.query(
      "SELECT * FROM openvtc_enrollment_challenges WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
      [challengeId, identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapOpenVtcEnrollmentChallengeRow(result.rows[0]) : null;
  }

  async consumeOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string, challenge: string, consumedAt: Date) {
    const result = await this.pool.query(
      `UPDATE openvtc_enrollment_challenges SET consumed_at=$5
       WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND challenge=$4 AND consumed_at IS NULL AND expires_at>$5`,
      [challengeId, identity.tenantId, identity.subjectId, challenge, consumedAt],
    );
    return Boolean(result.rowCount);
  }

  async enrollOpenVtcApprover(input: {
    id: string; identity: IdentityContext; approverDid: string; verificationMethod: string; displayName: string;
    transportTokenHash: string; enrolledAt: Date;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE openvtc_approvers SET status='revoked',revoked_at=$3
         WHERE tenant_id=$1 AND subject_id=$2 AND status='active' AND approver_did<>$4`,
        [input.identity.tenantId, input.identity.subjectId, input.enrolledAt, input.approverDid],
      );
      const result = await client.query(
        `INSERT INTO openvtc_approvers (
          id,tenant_id,subject_id,approver_did,verification_method,display_name,transport_token_hash,status,enrolled_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
        ON CONFLICT (tenant_id,subject_id,approver_did) DO UPDATE SET
          verification_method=EXCLUDED.verification_method,display_name=EXCLUDED.display_name,
          transport_token_hash=EXCLUDED.transport_token_hash,status='active',enrolled_at=EXCLUDED.enrolled_at,revoked_at=NULL
        RETURNING *`,
        [input.id, input.identity.tenantId, input.identity.subjectId, input.approverDid, input.verificationMethod,
          input.displayName, input.transportTokenHash, input.enrolledAt],
      );
      await client.query("COMMIT");
      return mapOpenVtcApproverRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveOpenVtcApprover(identity: IdentityContext) {
    const result = await this.pool.query(
      "SELECT * FROM openvtc_approvers WHERE tenant_id=$1 AND subject_id=$2 AND status='active'",
      [identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapOpenVtcApproverRow(result.rows[0]) : null;
  }

  async getOpenVtcApproverByTransportTokenHash(tokenHash: string) {
    const result = await this.pool.query(
      "SELECT * FROM openvtc_approvers WHERE transport_token_hash=$1 AND status='active'",
      [tokenHash],
    );
    return result.rowCount ? mapOpenVtcApproverRow(result.rows[0]) : null;
  }

  async revokeOpenVtcApprover(identity: IdentityContext, approverId: string, revokedAt: Date) {
    const result = await this.pool.query(
      `UPDATE openvtc_approvers SET status='revoked',revoked_at=$4
       WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 AND status='active'`,
      [approverId, identity.tenantId, identity.subjectId, revokedAt],
    );
    return Boolean(result.rowCount);
  }

  async createOpenVtcConsentTask(input: CreateOpenVtcConsentTaskInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operation = await client.query(
        `SELECT id,state,expires_at FROM governed_operations
         WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 FOR UPDATE`,
        [input.operationId, input.identity.tenantId, input.identity.subjectId],
      );
      const existing = await client.query(
        "SELECT * FROM openvtc_consent_tasks WHERE operation_id=$1 AND tenant_id=$2 AND subject_id=$3",
        [input.operationId, input.identity.tenantId, input.identity.subjectId],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return mapOpenVtcConsentTaskRow(existing.rows[0]);
      }
      const operationRow = operation.rows[0] as Record<string, unknown> | undefined;
      const approver = await client.query(
        `SELECT id FROM openvtc_approvers WHERE id=$1 AND tenant_id=$2 AND subject_id=$3
         AND status='active' FOR UPDATE`,
        [input.approverId, input.identity.tenantId, input.identity.subjectId],
      );
      if (!operationRow || operationRow.state !== "approval_required" || new Date(String(operationRow.expires_at)) <= input.createdAt || !approver.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const inserted = await client.query(
        `INSERT INTO openvtc_consent_tasks (
          id,operation_id,tenant_id,subject_id,approver_id,executor_did,challenge,task_type,payload_digest,
          request_document,request_hash,state,created_at,expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'queued',$12,$13) RETURNING *`,
        [input.id, input.operationId, input.identity.tenantId, input.identity.subjectId, input.approverId,
          input.executorDid, input.challenge, input.taskType, input.payloadDigest, JSON.stringify(input.requestDocument),
          input.requestHash, input.createdAt, input.expiresAt],
      );
      await client.query(
        `INSERT INTO openvtc_delivery_outbox (
          id,task_id,transport,state,available_at,created_at,updated_at
        ) VALUES ($1,$2,'https-poll-0.1','queued',$3,$3,$3)`,
        [input.outboxId, input.id, input.createdAt],
      );
      await client.query(
        `INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id,safe_detail)
         VALUES ($1,$2,'approval_delivery_queued','openvtc-task-create',$3::jsonb)`,
        [input.operationId, input.identity.tenantId, JSON.stringify({ channel: "openvtc-task-consent", taskId: input.id })],
      );
      await client.query("COMMIT");
      return mapOpenVtcConsentTaskRow(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOpenVtcConsentTask(identity: IdentityContext, operationId: string) {
    const result = await this.pool.query(
      "SELECT * FROM openvtc_consent_tasks WHERE operation_id=$1 AND tenant_id=$2 AND subject_id=$3",
      [operationId, identity.tenantId, identity.subjectId],
    );
    return result.rowCount ? mapOpenVtcConsentTaskRow(result.rows[0]) : null;
  }

  async getOpenVtcConsentTaskByPayloadDigest(approverId: string, payloadDigest: string) {
    const result = await this.pool.query(
      "SELECT * FROM openvtc_consent_tasks WHERE approver_id=$1 AND payload_digest=$2",
      [approverId, payloadDigest],
    );
    return result.rowCount ? mapOpenVtcConsentTaskRow(result.rows[0]) : null;
  }

  async deliverNextOpenVtcConsentTask(approverId: string, deliveredAt: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE openvtc_consent_tasks SET state='expired'
         WHERE approver_id=$1 AND state IN ('queued','delivered') AND expires_at<=$2`,
        [approverId, deliveredAt],
      );
      const result = await client.query(
        `SELECT t.*,o.id AS outbox_id,o.attempt_count
         FROM openvtc_consent_tasks t
         JOIN openvtc_delivery_outbox o ON o.task_id=t.id
         JOIN openvtc_approvers a ON a.id=t.approver_id AND a.status='active'
         WHERE t.approver_id=$1 AND t.state IN ('queued','delivered') AND t.expires_at>$2
         ORDER BY t.created_at LIMIT 1 FOR UPDATE OF t,o`,
        [approverId, deliveredAt],
      );
      if (!result.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const row = result.rows[0] as Record<string, unknown>;
      const attempt = Number(row.attempt_count) + 1;
      await client.query(
        "UPDATE openvtc_consent_tasks SET state='delivered',delivered_at=COALESCE(delivered_at,$2) WHERE id=$1",
        [row.id, deliveredAt],
      );
      await client.query(
        `UPDATE openvtc_delivery_outbox SET state='delivered',attempt_count=$2,delivered_at=COALESCE(delivered_at,$3),
         updated_at=$3,lease_id=NULL,lease_expires_at=NULL WHERE id=$1`,
        [row.outbox_id, attempt, deliveredAt],
      );
      await client.query(
        `INSERT INTO openvtc_delivery_attempts (outbox_id,attempt,outcome,attempted_at)
         VALUES ($1,$2,'delivered',$3)`,
        [row.outbox_id, attempt, deliveredAt],
      );
      await client.query("COMMIT");
      return mapOpenVtcConsentTaskRow({ ...row, state: "delivered", delivered_at: row.delivered_at ?? deliveredAt });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordOpenVtcDecision(input: RecordOpenVtcDecisionInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `SELECT t.operation_id,t.expires_at,t.state AS task_state,a.approver_did,a.verification_method,a.status,
           o.operation_digest,o.nonce,o.state
         FROM openvtc_consent_tasks t
         JOIN openvtc_approvers a ON a.id=t.approver_id
         JOIN governed_operations o ON o.id=t.operation_id
         WHERE t.id=$1 AND t.tenant_id=$2 AND t.subject_id=$3 AND t.approver_id=$4
           AND t.challenge=$5 AND t.payload_digest=$6
         FOR UPDATE OF t,a,o`,
        [input.taskId, input.identity.tenantId, input.identity.subjectId, input.approverId, input.challenge, input.payloadDigest],
      );
      if (!claimed.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const row = claimed.rows[0] as Record<string, unknown>;
      const valid = row.status === "active" && row.approver_did === input.signerDid
        && row.verification_method === input.verificationMethod && row.state === "approval_required"
        && (row.task_state === "queued" || row.task_state === "delivered")
        && new Date(String(row.expires_at)) > input.decidedAt;
      if (!valid) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `INSERT INTO governed_approvals (
          id,operation_id,decision,channel,issuer,key_id,operation_digest,nonce,proof_hash,issued_at,expires_at,decided_at
        ) VALUES ($1,$2,$3,'openvtc-task-consent',$4,$5,$6,$7,$8,$9,$10,$11)`,
        [input.approvalId, row.operation_id, input.decision, input.signerDid, input.verificationMethod,
          row.operation_digest, row.nonce, input.proofHash, input.issuedAt, row.expires_at, input.decidedAt],
      );
      await client.query(
        `UPDATE openvtc_consent_tasks SET state=$2,decided_at=$3,decision_document=$4::jsonb,decision_hash=$5,proof_hash=$6
         WHERE id=$1`,
        [input.taskId, input.decision === "approve" ? "approved" : "denied", input.decidedAt,
          JSON.stringify(input.decisionDocument), input.decisionHash, input.proofHash],
      );
      await client.query(
        "UPDATE governed_operations SET state=$2,updated_at=$3 WHERE id=$1",
        [row.operation_id, input.decision === "approve" ? "approved" : "denied", input.decidedAt],
      );
      await client.query(
        `INSERT INTO governed_operation_events (operation_id,tenant_id,event_type,correlation_id,safe_detail)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [row.operation_id, input.identity.tenantId, input.decision === "approve" ? "approved" : "denied",
          input.correlationId, JSON.stringify({ channel: "openvtc-task-consent", decisionHash: input.decisionHash })],
      );
      await client.query("COMMIT");
      return this.getOwnedOperation(input.identity, String(row.operation_id));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(identity: IdentityContext, workspaceId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspaces WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
      [workspaceId, identity.tenantId, identity.subjectId],
    );
    return Boolean(result.rowCount);
  }
}

export class MemoryWorkspaceStore implements WorkspaceStore, GovernanceStore, OpenVtcApprovalStore {
  private records = new Map<string, WorkspaceRecord>();
  private operations = new Map<string, GovernedOperationRecord>();
  private operationKeys = new Map<string, string>();
  private openVtcApprovers = new Map<string, { record: OpenVtcApproverRecord; transportTokenHash: string }>();
  private openVtcTasks = new Map<string, OpenVtcConsentTaskRecord>();
  private openVtcTaskByOperation = new Map<string, string>();
  private openVtcDeliveryAttempts = new Map<string, number>();
  private openVtcEnrollmentChallenges = new Map<string, OpenVtcEnrollmentChallengeRecord>();

  async getCurrent(identity: IdentityContext, grantId: string) {
    return [...this.records.values()].find((item) => item.tenantId === identity.tenantId && item.subjectId === identity.subjectId && item.grantId === grantId) ?? null;
  }
  async getOwned(identity: IdentityContext, workspaceId: string) {
    const item = this.records.get(workspaceId);
    return item?.tenantId === identity.tenantId && item.subjectId === identity.subjectId ? item : null;
  }
  async createOrGet(identity: IdentityContext, grantId: string, _key: string) {
    const existing = [...this.records.values()].find((item) => item.tenantId === identity.tenantId && item.subjectId === identity.subjectId && item.grantId === grantId);
    if (existing) return existing;
    const now = new Date();
    const record: WorkspaceRecord = { id: randomUUID(), ...identity, grantId, state: "not_created", providerId: null, failureCode: null, operationToken: null, createdAt: now, updatedAt: now };
    this.records.set(record.id, record);
    return record;
  }
  async claim(workspaceId: string, allowed: WorkspaceState[], next: WorkspaceState) {
    const record = this.records.get(workspaceId);
    if (!record || !allowed.includes(record.state)) return null;
    const claimed = { ...record, state: next, operationToken: randomUUID(), updatedAt: new Date() };
    this.records.set(workspaceId, claimed);
    return claimed;
  }
  async finish(workspaceId: string, token: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>) {
    const record = this.records.get(workspaceId);
    if (!record || record.operationToken !== token) throw new Error("Workspace operation ownership was lost");
    return this.save(record, { ...patch, operationToken: null });
  }
  async update(workspaceId: string, patch: Partial<Pick<WorkspaceRecord, "state" | "providerId" | "failureCode">>) {
    const record = this.records.get(workspaceId);
    if (!record) throw new Error("Workspace not found");
    return this.save(record, patch);
  }
  async remove(identity: IdentityContext, workspaceId: string) {
    if (!await this.getOwned(identity, workspaceId)) return false;
    for (const [operationId, operation] of this.operations) {
      if (operation.workspaceId === workspaceId) this.operations.delete(operationId);
    }
    return this.records.delete(workspaceId);
  }

  async createGovernedOperation(input: CreateGovernedOperationRecord) {
    if (!await this.getOwned(input.identity, input.workspaceId)) return null;
    const key = `${input.identity.tenantId}:${input.identity.subjectId}:${input.idempotencyKey}`;
    const existingId = this.operationKeys.get(key);
    if (existingId) return this.operations.get(existingId) ?? null;
    const record: GovernedOperationRecord = {
      id: input.id,
      tenantId: input.identity.tenantId,
      subjectId: input.identity.subjectId,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      capabilityId: input.capabilityId,
      serverName: input.serverName,
      toolName: input.toolName,
      schemaId: input.schemaId,
      arguments: input.arguments,
      operationDigest: input.operationDigest,
      nonce: input.nonce,
      state: "approval_required",
      policyDecision: "approval_required",
      safeSummary: input.safeSummary,
      resourceName: input.resourceName,
      resourceLocation: input.resourceLocation,
      correlationId: input.correlationId,
      leaseId: null,
      leaseExpiresAt: null,
      dispatchStartedAt: null,
      failureCode: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
      approval: null,
      receipt: null,
    };
    this.operations.set(record.id, record);
    this.operationKeys.set(key, record.id);
    return record;
  }

  async getOwnedOperation(identity: IdentityContext, operationId: string) {
    const record = this.operations.get(operationId);
    return record?.tenantId === identity.tenantId && record.subjectId === identity.subjectId ? record : null;
  }

  async getRecentOperation(identity: IdentityContext) {
    return [...this.operations.values()]
      .filter((item) => item.tenantId === identity.tenantId && item.subjectId === identity.subjectId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async recordApproval(input: ApprovalRecordInput) {
    const record = this.operations.get(input.operationId);
    if (!record || record.tenantId !== input.identity.tenantId || record.subjectId !== input.identity.subjectId) return null;
    if (record.state !== "approval_required") return record;
    if (record.operationDigest !== input.operationDigest || record.nonce !== input.nonce || record.expiresAt <= input.decidedAt) return record;
    const next: GovernedOperationRecord = {
      ...record,
      state: input.decision === "approve" ? "approved" : "denied",
      updatedAt: input.decidedAt,
      approval: { decision: input.decision, channel: input.channel, decidedAt: input.decidedAt },
    };
    this.operations.set(record.id, next);
    return next;
  }

  async claimExecution(identity: IdentityContext, operationId: string, leaseId: string, leaseExpiresAt: Date, _correlationId: string) {
    const record = this.operations.get(operationId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId) return null;
    if (record.state !== "approved" || record.expiresAt <= new Date()) return record;
    const next: GovernedOperationRecord = { ...record, state: "executing", leaseId, leaseExpiresAt, updatedAt: new Date() };
    this.operations.set(record.id, next);
    return next;
  }

  async claimToolDispatch(identity: IdentityContext, input: {
    operationId: string; operationDigest: string; leaseId: string; workspaceId: string; agentId: string; serverName: string;
    toolName: string; arguments: OwnedJson; dispatchedAt: Date; correlationId: string;
  }) {
    const record = this.operations.get(input.operationId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId) return false;
    const matches = record.state === "executing"
      && record.workspaceId === input.workspaceId
      && record.agentId === input.agentId
      && record.operationDigest === input.operationDigest
      && record.leaseId === input.leaseId
      && record.leaseExpiresAt !== null
      && record.leaseExpiresAt > input.dispatchedAt
      && record.serverName === input.serverName
      && record.toolName === input.toolName
      && JSON.stringify(record.arguments) === JSON.stringify(input.arguments)
      && record.dispatchStartedAt === null;
    if (!matches) return false;
    this.operations.set(record.id, { ...record, dispatchStartedAt: input.dispatchedAt, updatedAt: input.dispatchedAt });
    return true;
  }

  async completeExecution(identity: IdentityContext, operationId: string, leaseId: string, receipt: { id: string; upstreamReference: string; resultSummary: string; resultHash: string; executedAt: Date }, _correlationId: string) {
    const record = this.operations.get(operationId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId) return null;
    if (record.state !== "executing" || record.leaseId !== leaseId) return record;
    const next: GovernedOperationRecord = {
      ...record,
      state: "succeeded",
      updatedAt: receipt.executedAt,
      receipt: { status: "succeeded", upstreamReference: receipt.upstreamReference, resultSummary: receipt.resultSummary, executedAt: receipt.executedAt },
    };
    this.operations.set(record.id, next);
    return next;
  }

  async failExecution(identity: IdentityContext, operationId: string, leaseId: string, failureCode: string, _correlationId: string) {
    const record = this.operations.get(operationId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId) return null;
    if (record.state !== "executing" || record.leaseId !== leaseId) return record;
    const next: GovernedOperationRecord = { ...record, state: "failed", failureCode, updatedAt: new Date() };
    this.operations.set(record.id, next);
    return next;
  }

  async recoverOperation(identity: IdentityContext, operationId: string, now: Date, _correlationId: string) {
    const record = this.operations.get(operationId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId) return null;
    const operationExpired = ["approval_required", "approved"].includes(record.state) && record.expiresAt <= now;
    const leaseExpired = record.state === "executing" && record.leaseExpiresAt !== null && record.leaseExpiresAt <= now;
    if (!operationExpired && !leaseExpired) return record;
    const next: GovernedOperationRecord = {
      ...record,
      state: leaseExpired ? "failed" : "expired",
      failureCode: leaseExpired ? "EXECUTION_LEASE_EXPIRED" : record.failureCode,
      updatedAt: now,
    };
    this.operations.set(record.id, next);
    return next;
  }

  async createOpenVtcEnrollmentChallenge(input: Omit<OpenVtcEnrollmentChallengeRecord, "tenantId" | "subjectId" | "consumedAt"> & { identity: IdentityContext }) {
    const record: OpenVtcEnrollmentChallengeRecord = {
      id: input.id,
      tenantId: input.identity.tenantId,
      subjectId: input.identity.subjectId,
      executorDid: input.executorDid,
      challenge: input.challenge,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      consumedAt: null,
    };
    this.openVtcEnrollmentChallenges.set(record.id, record);
    return record;
  }

  async getOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string) {
    const record = this.openVtcEnrollmentChallenges.get(challengeId);
    return record?.tenantId === identity.tenantId && record.subjectId === identity.subjectId ? record : null;
  }

  async consumeOpenVtcEnrollmentChallenge(identity: IdentityContext, challengeId: string, challenge: string, consumedAt: Date) {
    const record = this.openVtcEnrollmentChallenges.get(challengeId);
    if (!record || record.tenantId !== identity.tenantId || record.subjectId !== identity.subjectId
      || record.challenge !== challenge || record.consumedAt !== null || record.expiresAt <= consumedAt) return false;
    this.openVtcEnrollmentChallenges.set(record.id, { ...record, consumedAt });
    return true;
  }

  async enrollOpenVtcApprover(input: {
    id: string; identity: IdentityContext; approverDid: string; verificationMethod: string; displayName: string;
    transportTokenHash: string; enrolledAt: Date;
  }) {
    for (const [id, stored] of this.openVtcApprovers) {
      if (stored.record.tenantId === input.identity.tenantId && stored.record.subjectId === input.identity.subjectId
        && stored.record.status === "active" && stored.record.approverDid !== input.approverDid) {
        this.openVtcApprovers.set(id, { ...stored, record: { ...stored.record, status: "revoked", revokedAt: input.enrolledAt } });
      }
    }
    const prior = [...this.openVtcApprovers.values()].find((stored) => stored.record.tenantId === input.identity.tenantId
      && stored.record.subjectId === input.identity.subjectId && stored.record.approverDid === input.approverDid);
    const record: OpenVtcApproverRecord = {
      id: prior?.record.id ?? input.id,
      tenantId: input.identity.tenantId,
      subjectId: input.identity.subjectId,
      approverDid: input.approverDid,
      verificationMethod: input.verificationMethod,
      displayName: input.displayName,
      status: "active",
      enrolledAt: input.enrolledAt,
      revokedAt: null,
    };
    this.openVtcApprovers.set(record.id, { record, transportTokenHash: input.transportTokenHash });
    return record;
  }

  async getActiveOpenVtcApprover(identity: IdentityContext) {
    return [...this.openVtcApprovers.values()].map((stored) => stored.record)
      .find((record) => record.tenantId === identity.tenantId && record.subjectId === identity.subjectId && record.status === "active") ?? null;
  }

  async getOpenVtcApproverByTransportTokenHash(tokenHash: string) {
    const stored = [...this.openVtcApprovers.values()].find((candidate) => candidate.transportTokenHash === tokenHash && candidate.record.status === "active");
    return stored?.record ?? null;
  }

  async revokeOpenVtcApprover(identity: IdentityContext, approverId: string, revokedAt: Date) {
    const stored = this.openVtcApprovers.get(approverId);
    if (!stored || stored.record.tenantId !== identity.tenantId || stored.record.subjectId !== identity.subjectId || stored.record.status !== "active") return false;
    this.openVtcApprovers.set(approverId, { ...stored, record: { ...stored.record, status: "revoked", revokedAt } });
    return true;
  }

  async createOpenVtcConsentTask(input: CreateOpenVtcConsentTaskInput) {
    const existingId = this.openVtcTaskByOperation.get(input.operationId);
    if (existingId) return this.openVtcTasks.get(existingId) ?? null;
    const operation = await this.getOwnedOperation(input.identity, input.operationId);
    const racedExistingId = this.openVtcTaskByOperation.get(input.operationId);
    if (racedExistingId) return this.openVtcTasks.get(racedExistingId) ?? null;
    const approver = this.openVtcApprovers.get(input.approverId)?.record;
    if (!operation || operation.state !== "approval_required" || operation.expiresAt <= input.createdAt
      || !approver || approver.status !== "active" || approver.tenantId !== input.identity.tenantId || approver.subjectId !== input.identity.subjectId) return null;
    const task: OpenVtcConsentTaskRecord = {
      id: input.id,
      operationId: input.operationId,
      tenantId: input.identity.tenantId,
      subjectId: input.identity.subjectId,
      approverId: input.approverId,
      executorDid: input.executorDid,
      challenge: input.challenge,
      taskType: input.taskType,
      payloadDigest: input.payloadDigest,
      requestDocument: input.requestDocument,
      requestHash: input.requestHash,
      state: "queued",
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      deliveredAt: null,
      decidedAt: null,
      decisionDocument: null,
      decisionHash: null,
      proofHash: null,
    };
    this.openVtcTasks.set(task.id, task);
    this.openVtcTaskByOperation.set(task.operationId, task.id);
    this.openVtcDeliveryAttempts.set(task.id, 0);
    return task;
  }

  async getOpenVtcConsentTask(identity: IdentityContext, operationId: string) {
    const taskId = this.openVtcTaskByOperation.get(operationId);
    const task = taskId ? this.openVtcTasks.get(taskId) : null;
    return task?.tenantId === identity.tenantId && task.subjectId === identity.subjectId ? task : null;
  }

  async getOpenVtcConsentTaskByPayloadDigest(approverId: string, payloadDigest: string) {
    return [...this.openVtcTasks.values()].find((task) => task.approverId === approverId && task.payloadDigest === payloadDigest) ?? null;
  }

  async deliverNextOpenVtcConsentTask(approverId: string, deliveredAt: Date) {
    const approver = this.openVtcApprovers.get(approverId)?.record;
    if (!approver || approver.status !== "active") return null;
    const candidates = [...this.openVtcTasks.values()]
      .filter((task) => task.approverId === approverId && ["queued", "delivered"].includes(task.state))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    for (const task of candidates) {
      if (task.expiresAt <= deliveredAt) {
        this.openVtcTasks.set(task.id, { ...task, state: "expired" });
        continue;
      }
      const delivered: OpenVtcConsentTaskRecord = { ...task, state: "delivered", deliveredAt: task.deliveredAt ?? deliveredAt };
      this.openVtcTasks.set(task.id, delivered);
      this.openVtcDeliveryAttempts.set(task.id, (this.openVtcDeliveryAttempts.get(task.id) ?? 0) + 1);
      return delivered;
    }
    return null;
  }

  async recordOpenVtcDecision(input: RecordOpenVtcDecisionInput) {
    const task = this.openVtcTasks.get(input.taskId);
    const approver = this.openVtcApprovers.get(input.approverId)?.record;
    const operation = task ? this.operations.get(task.operationId) : null;
    if (!task || !approver || !operation || task.tenantId !== input.identity.tenantId || task.subjectId !== input.identity.subjectId
      || task.approverId !== input.approverId || task.challenge !== input.challenge || task.payloadDigest !== input.payloadDigest
      || approver.status !== "active" || approver.approverDid !== input.signerDid || approver.verificationMethod !== input.verificationMethod
      || operation.state !== "approval_required" || !["queued", "delivered"].includes(task.state)
      || task.expiresAt <= input.decidedAt) return null;
    const nextTask: OpenVtcConsentTaskRecord = {
      ...task,
      state: input.decision === "approve" ? "approved" : "denied",
      decidedAt: input.decidedAt,
      decisionDocument: input.decisionDocument,
      decisionHash: input.decisionHash,
      proofHash: input.proofHash,
    };
    const nextOperation: GovernedOperationRecord = {
      ...operation,
      state: input.decision === "approve" ? "approved" : "denied",
      updatedAt: input.decidedAt,
      approval: { decision: input.decision, channel: "openvtc-task-consent", decidedAt: input.decidedAt },
    };
    this.openVtcTasks.set(task.id, nextTask);
    this.operations.set(operation.id, nextOperation);
    return nextOperation;
  }
  private save(record: WorkspaceRecord, patch: Partial<WorkspaceRecord>) {
    const next = { ...record, ...patch, updatedAt: new Date() };
    this.records.set(record.id, next);
    return next;
  }
}
