import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { GovernedOperationState, IdentityContext, OwnedJson, WorkspaceState } from "@onecomputer/contracts";

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
  expiresAt: Date;
};

export type GovernedOperationRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  workspaceId: string;
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
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  approval: null | { decision: "approve" | "deny"; channel: "local-fixture"; decidedAt: Date };
  receipt: null | { status: "succeeded"; upstreamReference: string; resultSummary: string; executedAt: Date };
};

export type CreateGovernedOperationRecord = Omit<GovernedOperationRecord,
  "tenantId" | "subjectId" | "state" | "policyDecision" | "leaseId" | "leaseExpiresAt" | "failureCode" | "createdAt" | "updatedAt" | "approval" | "receipt"
> & {
  identity: IdentityContext;
  idempotencyKey: string;
  createdAt: Date;
};

export type ApprovalRecordInput = {
  identity: IdentityContext;
  operationId: string;
  approvalId: string;
  decision: "approve" | "deny";
  channel: "local-fixture";
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

export interface GovernanceStore {
  createGovernedOperation(input: CreateGovernedOperationRecord): Promise<GovernedOperationRecord | null>;
  getOwnedOperation(identity: IdentityContext, operationId: string): Promise<GovernedOperationRecord | null>;
  getRecentOperation(identity: IdentityContext): Promise<GovernedOperationRecord | null>;
  recordApproval(input: ApprovalRecordInput): Promise<GovernedOperationRecord | null>;
  claimExecution(identity: IdentityContext, operationId: string, leaseId: string, leaseExpiresAt: Date, correlationId: string): Promise<GovernedOperationRecord | null>;
  completeExecution(identity: IdentityContext, operationId: string, leaseId: string, receipt: { id: string; upstreamReference: string; resultSummary: string; resultHash: string; executedAt: Date }, correlationId: string): Promise<GovernedOperationRecord | null>;
  failExecution(identity: IdentityContext, operationId: string, leaseId: string, failureCode: string, correlationId: string): Promise<GovernedOperationRecord | null>;
  recoverOperation(identity: IdentityContext, operationId: string, now: Date, correlationId: string): Promise<GovernedOperationRecord | null>;
}

export interface WorkspaceStore {
  getCurrent(identity: IdentityContext, grantId: string): Promise<WorkspaceRecord | null>;
  getOwned(identity: IdentityContext, workspaceId: string): Promise<WorkspaceRecord | null>;
  createOrGet(identity: IdentityContext, grantId: string, idempotencyKey: string, expiresAt: Date): Promise<WorkspaceRecord>;
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
  expiresAt: new Date(String(row.expires_at)),
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
  failureCode: row.failure_code ? String(row.failure_code) : null,
  createdAt: new Date(String(row.created_at)),
  updatedAt: new Date(String(row.updated_at)),
  expiresAt: new Date(String(row.expires_at)),
  approval: row.approval_decision ? {
    decision: row.approval_decision as "approve" | "deny",
    channel: row.approval_channel as "local-fixture",
    decidedAt: new Date(String(row.approval_decided_at)),
  } : null,
  receipt: row.receipt_status ? {
    status: "succeeded",
    upstreamReference: String(row.upstream_reference),
    resultSummary: String(row.result_summary),
    executedAt: new Date(String(row.executed_at)),
  } : null,
});

export class PostgresWorkspaceStore implements WorkspaceStore, GovernanceStore {
  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresWorkspaceStore(new pg.Pool({ connectionString, max: 10 }));
  }

  async migrate() {
    for (const migration of ["001_workspaces.sql", "002_governed_operations.sql"]) {
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

  async createOrGet(identity: IdentityContext, grantId: string, idempotencyKey: string, expiresAt: Date) {
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
          "INSERT INTO workspaces (id,tenant_id,subject_id,grant_id,state,created_at,updated_at,expires_at) VALUES ($1,$2,$3,$4,'not_created',$5,$5,$6) RETURNING *",
          [id, identity.tenantId, identity.subjectId, grantId, now, expiresAt],
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
          id,tenant_id,subject_id,workspace_id,capability_id,server_name,tool_name,schema_id,arguments_json,
          operation_digest,nonce,state,policy_decision,safe_summary,resource_name,resource_location,
          idempotency_key,correlation_id,created_at,updated_at,expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'approval_required','approval_required',$12,$13,$14,$15,$16,$17,$17,$18)`,
        [
          input.id, input.identity.tenantId, input.identity.subjectId, input.workspaceId, input.capabilityId,
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

  async remove(identity: IdentityContext, workspaceId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspaces WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
      [workspaceId, identity.tenantId, identity.subjectId],
    );
    return Boolean(result.rowCount);
  }
}

export class MemoryWorkspaceStore implements WorkspaceStore, GovernanceStore {
  private records = new Map<string, WorkspaceRecord>();
  private operations = new Map<string, GovernedOperationRecord>();
  private operationKeys = new Map<string, string>();

  async getCurrent(identity: IdentityContext, grantId: string) {
    return [...this.records.values()].find((item) => item.tenantId === identity.tenantId && item.subjectId === identity.subjectId && item.grantId === grantId) ?? null;
  }
  async getOwned(identity: IdentityContext, workspaceId: string) {
    const item = this.records.get(workspaceId);
    return item?.tenantId === identity.tenantId && item.subjectId === identity.subjectId ? item : null;
  }
  async createOrGet(identity: IdentityContext, grantId: string, _key: string, expiresAt: Date) {
    const existing = [...this.records.values()].find((item) => item.tenantId === identity.tenantId && item.subjectId === identity.subjectId && item.grantId === grantId);
    if (existing) return existing;
    const now = new Date();
    const record: WorkspaceRecord = { id: randomUUID(), ...identity, grantId, state: "not_created", providerId: null, failureCode: null, operationToken: null, createdAt: now, updatedAt: now, expiresAt };
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
  private save(record: WorkspaceRecord, patch: Partial<WorkspaceRecord>) {
    const next = { ...record, ...patch, updatedAt: new Date() };
    this.records.set(record.id, next);
    return next;
  }
}
