import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { IdentityContext, WorkspaceState } from "@onecomputer/contracts";

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

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresWorkspaceStore(new pg.Pool({ connectionString, max: 10 }));
  }

  async migrate() {
    const migrationPath = fileURLToPath(new URL("../migrations/001_workspaces.sql", import.meta.url));
    await this.pool.query(await readFile(migrationPath, "utf8"));
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

  async remove(identity: IdentityContext, workspaceId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspaces WHERE id=$1 AND tenant_id=$2 AND subject_id=$3",
      [workspaceId, identity.tenantId, identity.subjectId],
    );
    return Boolean(result.rowCount);
  }
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private records = new Map<string, WorkspaceRecord>();

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
    return this.records.delete(workspaceId);
  }
  private save(record: WorkspaceRecord, patch: Partial<WorkspaceRecord>) {
    const next = { ...record, ...patch, updatedAt: new Date() };
    this.records.set(record.id, next);
    return next;
  }
}
