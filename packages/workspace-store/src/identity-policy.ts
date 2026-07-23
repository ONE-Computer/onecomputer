import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { defaultClipboardPolicy, OneComputerError, m365ToolCatalog, runtimePolicySchema, type IdentityContext, type McpToolPolicyDecision, type OwnedJson, type RuntimePolicy } from "@onecomputer/contracts";

export type OneComputerRole = "employee" | "administrator";

export type SessionPrincipal = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  tenantDisplayName: string;
  roles: OneComputerRole[];
  identity: IdentityContext;
};

export type OidcLoginAttempt = {
  verifierCiphertext: string;
  nonce: string;
  returnPath: string;
};

export type EffectivePolicy = {
  assignmentId: string;
  policyBundleId: string;
  policyVersionId: string;
  version: number;
  documentHash: string;
  assignedBy: string;
  assignedAt: string;
  agentId: string;
  workspaceIdentityId: string;
  workspaceId: string | null;
  vendorUserId: string;
  document: OwnedJson;
};

export const runtimePolicyFor = (policy: EffectivePolicy, selectedModelAlias?: string, selectedWorkspaceProfile?: string): RuntimePolicy => {
  const document = policy.document as Record<string, unknown>;
  const mcp = document.mcp as Record<string, unknown> | undefined;
  const servers = mcp?.servers as Record<string, unknown> | undefined;
  const entries = Object.entries(servers ?? {});
  if (entries.length !== 1) throw new OneComputerError("POLICY_INVALID", "The active workspace policy must assign exactly one MCP server", 500);
  const [mcpServer, serverPolicy] = entries[0]!;
  const tools = (serverPolicy as Record<string, unknown>)?.tools;
  const configuredToolPolicies = (serverPolicy as Record<string, unknown>)?.toolPolicies as Record<string, unknown> | undefined;
  const toolPolicies = Object.fromEntries((Array.isArray(tools) ? tools : []).map((tool) => {
    const name = String(tool) as keyof typeof m365ToolCatalog;
    return [name, configuredToolPolicies?.[name] ?? m365ToolCatalog[name]?.decision ?? "deny"];
  }));
  const modelAliases = document.modelAliases;
  const allowedModelAliases = Array.isArray(modelAliases) ? modelAliases.filter((value): value is string => typeof value === "string") : [];
  const workspaceProfiles = Array.isArray(document.workspaceProfiles)
    ? document.workspaceProfiles.filter((value): value is string => typeof value === "string")
    : typeof document.workspaceProfile === "string" ? [document.workspaceProfile] : [];
  const modelAlias = selectedModelAlias ?? allowedModelAliases[0];
  const workspaceProfile = selectedWorkspaceProfile ?? workspaceProfiles[0];
  const clipboard = document.clipboard && typeof document.clipboard === "object" && !Array.isArray(document.clipboard)
    ? document.clipboard as Record<string, unknown>
    : defaultClipboardPolicy;
  if (!modelAlias || !allowedModelAliases.includes(modelAlias)) throw new OneComputerError("MODEL_NOT_ASSIGNED", "The selected model route is not assigned by the active policy", 403);
  if (!workspaceProfile || !workspaceProfiles.includes(workspaceProfile)) throw new OneComputerError("PROFILE_NOT_ASSIGNED", "The selected sandbox profile is not assigned by the active policy", 403);
  return runtimePolicySchema.parse({
    schemaVersion: 1,
    policyVersionId: policy.policyVersionId,
    policyVersion: policy.version,
    policyHash: policy.documentHash,
    workspaceProfile,
    agentId: policy.agentId,
    agentProfile: document.agentProfile,
    networkProfile: document.networkProfile,
    clipboard: {
      enabled: clipboard.enabled ?? defaultClipboardPolicy.enabled,
      localToWorkspace: clipboard.localToWorkspace ?? defaultClipboardPolicy.localToWorkspace,
      workspaceToLocal: clipboard.workspaceToLocal ?? defaultClipboardPolicy.workspaceToLocal,
      maxBytes: clipboard.maxBytes ?? defaultClipboardPolicy.maxBytes,
    },
    modelAlias,
    mcpServer,
    allowedTools: tools,
    toolPolicies,
  });
};

export type AdminUserSummary = {
  userId: string;
  email: string;
  displayName: string;
  roles: OneComputerRole[];
  effectivePolicy: EffectivePolicy | null;
};

export interface IdentityPolicyStore {
  createLoginAttempt(input: { stateHash: string; verifierCiphertext: string; nonce: string; returnPath: string; expiresAt: Date }): Promise<void>;
  consumeLoginAttempt(stateHash: string, now: Date): Promise<OidcLoginAttempt | null>;
  upsertAuthenticatedIdentity(input: {
    ownedTenantId: string;
    ownedUserId: string;
    externalTenantId: string;
    externalSubject: string;
    issuer: string;
    email: string;
    displayName: string;
    tenantDisplayName: string;
    bootstrapAdministrator: boolean;
    gatewayUserId: string;
  }): Promise<SessionPrincipal>;
  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  getSession(tokenHash: string, now: Date): Promise<SessionPrincipal | null>;
  revokeSession(tokenHash: string): Promise<void>;
  getPrincipal(userId: string): Promise<SessionPrincipal | null>;
  getEffectivePolicy(userId: string): Promise<EffectivePolicy | null>;
  listUsers(tenantId: string): Promise<AdminUserSummary[]>;
  assignMvpPolicy(input: { tenantId: string; targetUserId: string; assignedBy: string }): Promise<EffectivePolicy>;
  revokeMvpPolicy(input: { tenantId: string; targetUserId: string; revokedBy: string }): Promise<boolean>;
  createMvpPolicyVersion(input: { tenantId: string; createdBy: string; revisionNote: string }): Promise<{ id: string; version: number; documentHash: string }>;
  updateMvpToolPolicy(input: { tenantId: string; updatedBy: string; tools: Record<string, McpToolPolicyDecision> }): Promise<{ id: string; version: number; documentHash: string }>;
  bindWorkspaceIdentity(userId: string, workspaceId: string): Promise<void>;
}

const mvpPolicyDocument = (revisionNote = "Initial MVP policy") => ({
  schemaVersion: 1,
  revisionNote,
  workspaceProfile: "claude-desktop-standard-v1",
  workspaceProfiles: ["claude-desktop-standard-v1"],
  agentProfile: "claude-desktop-managed-v1",
  modelAliases: ["onecomputer-claude", "onecomputer-openai", "onecomputer-glm"],
  networkProfile: "controlled-egress-v1",
  clipboard: defaultClipboardPolicy,
  mcp: {
    servers: {
      onecomputer_ms365: {
        tools: Object.keys(m365ToolCatalog),
        toolPolicies: Object.fromEntries(Object.entries(m365ToolCatalog).map(([name, tool]) => [name, tool.decision])),
      },
    },
  },
  capabilities: ["ai-assistant", "coding-tools", "m365-read", "m365-write-protected"],
  protectedOperations: {
    "m365-write-protected": "approval_required",
    defaultWrite: "deny",
  },
}) satisfies OwnedJson;

const stableJson = (value: OwnedJson): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(",")}}`;
};

const policyHash = (document: OwnedJson) => createHash("sha256").update(stableJson(document)).digest("hex");
const mvpPolicyBundleId = (tenantId: string) => `mvp-standard:${tenantId}`;

const mapPrincipal = (row: Record<string, unknown>): SessionPrincipal => ({
  userId: String(row.user_id),
  tenantId: String(row.tenant_id),
  email: String(row.email),
  displayName: String(row.display_name),
  tenantDisplayName: String(row.tenant_display_name),
  roles: (row.roles as OneComputerRole[] | null) ?? [],
  identity: { tenantId: String(row.tenant_id), subjectId: String(row.user_id), audience: "onecomputer-control" },
});

const principalSelect = `
  SELECT u.id AS user_id, u.tenant_id, u.email, u.display_name, t.display_name AS tenant_display_name,
    COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM users u
  JOIN tenants t ON t.id=u.tenant_id
  LEFT JOIN user_roles ur ON ur.user_id=u.id`;

const effectivePolicySelect = `
  SELECT pa.id AS assignment_id, pb.id AS policy_bundle_id, pv.id AS policy_version_id, pv.version,
    pv.document_hash, pv.document, pa.assigned_by, pa.assigned_at, pa.agent_id,
    pa.workspace_identity_id, wi.workspace_id, vim.vendor_user_id
  FROM policy_assignments pa
  JOIN policy_versions pv ON pv.id=pa.policy_version_id
  JOIN policy_bundles pb ON pb.id=pv.policy_bundle_id
  JOIN workspace_identities wi ON wi.id=pa.workspace_identity_id
  JOIN vendor_identity_mappings vim ON vim.user_id=pa.user_id AND vim.vendor='litellm' AND vim.mapping_kind='user'
  WHERE pa.user_id=$1 AND pa.revoked_at IS NULL
  ORDER BY pa.assigned_at DESC LIMIT 1`;

const mapPolicy = (row: Record<string, unknown>): EffectivePolicy => ({
  assignmentId: String(row.assignment_id),
  policyBundleId: String(row.policy_bundle_id),
  policyVersionId: String(row.policy_version_id),
  version: Number(row.version),
  documentHash: String(row.document_hash),
  assignedBy: String(row.assigned_by),
  assignedAt: new Date(String(row.assigned_at)).toISOString(),
  agentId: String(row.agent_id),
  workspaceIdentityId: String(row.workspace_identity_id),
  workspaceId: row.workspace_id ? String(row.workspace_id) : null,
  vendorUserId: String(row.vendor_user_id),
  document: row.document as OwnedJson,
});

export class PostgresIdentityPolicyStore implements IdentityPolicyStore {
  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresIdentityPolicyStore(new pg.Pool({ connectionString, max: 5 }));
  }

  async close() { await this.pool.end(); }

  async createLoginAttempt(input: { stateHash: string; verifierCiphertext: string; nonce: string; returnPath: string; expiresAt: Date }) {
    await this.pool.query("DELETE FROM oidc_login_attempts WHERE expires_at<=now()");
    await this.pool.query(
      "INSERT INTO oidc_login_attempts (state_hash,verifier_ciphertext,nonce,return_path,expires_at) VALUES ($1,$2,$3,$4,$5)",
      [input.stateHash, input.verifierCiphertext, input.nonce, input.returnPath, input.expiresAt],
    );
  }

  async consumeLoginAttempt(stateHash: string, now: Date) {
    const result = await this.pool.query(
      "DELETE FROM oidc_login_attempts WHERE state_hash=$1 AND expires_at>$2 RETURNING verifier_ciphertext,nonce,return_path",
      [stateHash, now],
    );
    return result.rowCount ? {
      verifierCiphertext: String(result.rows[0].verifier_ciphertext),
      nonce: String(result.rows[0].nonce),
      returnPath: String(result.rows[0].return_path),
    } : null;
  }

  async upsertAuthenticatedIdentity(input: {
    ownedTenantId: string;
    ownedUserId: string;
    externalTenantId: string;
    externalSubject: string;
    issuer: string;
    email: string;
    displayName: string;
    tenantDisplayName: string;
    bootstrapAdministrator: boolean;
    gatewayUserId: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`identity:${input.issuer}:${input.externalSubject}`]);
      const mapped = await client.query(
        "SELECT u.id,u.tenant_id FROM external_identities ei JOIN users u ON u.id=ei.user_id WHERE ei.provider='entra' AND ei.issuer=$1 AND ei.external_subject=$2",
        [input.issuer, input.externalSubject],
      );
      const tenantId = mapped.rowCount ? String(mapped.rows[0].tenant_id) : input.ownedTenantId;
      const userId = mapped.rowCount ? String(mapped.rows[0].id) : input.ownedUserId;
      await client.query(
        "INSERT INTO tenants (id,external_tenant_id,display_name) VALUES ($1,$2,$3) ON CONFLICT (external_tenant_id) DO UPDATE SET display_name=EXCLUDED.display_name",
        [tenantId, input.externalTenantId, input.tenantDisplayName],
      );
      const tenant = await client.query("SELECT administrator_bootstrapped_at FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
      const shouldBootstrapAdministrator = input.bootstrapAdministrator && !tenant.rows[0]?.administrator_bootstrapped_at;
      await client.query(
        `INSERT INTO users (id,tenant_id,email,display_name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,updated_at=now()`,
        [userId, tenantId, input.email.toLowerCase(), input.displayName],
      );
      await client.query(
        `INSERT INTO external_identities (id,user_id,provider,issuer,external_subject,external_tenant_id,email,last_authenticated_at)
         VALUES ($1,$2,'entra',$3,$4,$5,$6,now())
         ON CONFLICT (provider,issuer,external_subject) DO UPDATE SET email=EXCLUDED.email,last_authenticated_at=now()`,
        [randomUUID(), userId, input.issuer, input.externalSubject, input.externalTenantId, input.email.toLowerCase()],
      );
      await client.query(
        "INSERT INTO user_roles (user_id,role,assigned_by) VALUES ($1,'employee',$1) ON CONFLICT DO NOTHING",
        [userId],
      );
      if (shouldBootstrapAdministrator) {
        await client.query("INSERT INTO user_roles (user_id,role,assigned_by) VALUES ($1,'administrator',$1) ON CONFLICT DO NOTHING", [userId]);
        await client.query("UPDATE tenants SET administrator_bootstrapped_at=now() WHERE id=$1", [tenantId]);
      }
      const agentId = randomUUID();
      const workspaceIdentityId = randomUUID();
      await client.query(
        "INSERT INTO agent_identities (id,tenant_id,owner_user_id,name) VALUES ($1,$2,$3,'Default agent') ON CONFLICT (owner_user_id,name) DO NOTHING",
        [agentId, tenantId, userId],
      );
      await client.query(
        `INSERT INTO workspace_identities (id,tenant_id,owner_user_id,grant_id,workspace_id)
         VALUES ($1,$2,$3,'personal',(SELECT id FROM workspaces WHERE tenant_id=$2 AND subject_id=$3 AND grant_id='personal' LIMIT 1))
         ON CONFLICT (owner_user_id,grant_id) DO NOTHING`,
        [workspaceIdentityId, tenantId, userId],
      );
      await client.query(
        `INSERT INTO vendor_identity_mappings (id,tenant_id,user_id,vendor,vendor_user_id,mapping_kind,verified_at)
         VALUES ($1,$2,$3,'litellm',$4,'user',now())
         ON CONFLICT (user_id,vendor,mapping_kind) DO UPDATE SET vendor_user_id=EXCLUDED.vendor_user_id,verified_at=now()`,
        [randomUUID(), tenantId, userId, input.gatewayUserId],
      );
      if (shouldBootstrapAdministrator) {
        await this.ensurePolicyFoundation(client, tenantId, userId);
        await this.assignMvpPolicyWithClient(client, tenantId, userId, userId);
      }
      await client.query("COMMIT");
      return (await this.getPrincipal(userId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }) {
    await this.pool.query("DELETE FROM browser_sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL");
    await this.pool.query(
      "INSERT INTO browser_sessions (id,token_hash,user_id,expires_at) VALUES ($1,$2,$3,$4)",
      [randomUUID(), input.tokenHash, input.userId, input.expiresAt],
    );
  }

  async getSession(tokenHash: string, now: Date) {
    const result = await this.pool.query(
      `${principalSelect} JOIN browser_sessions s ON s.user_id=u.id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND u.status='active'
       GROUP BY u.id,t.display_name`,
      [tokenHash, now],
    );
    if (!result.rowCount) return null;
    await this.pool.query("UPDATE browser_sessions SET last_seen_at=$2 WHERE token_hash=$1", [tokenHash, now]);
    return mapPrincipal(result.rows[0]);
  }

  async revokeSession(tokenHash: string) {
    await this.pool.query("UPDATE browser_sessions SET revoked_at=now() WHERE token_hash=$1", [tokenHash]);
  }

  async getPrincipal(userId: string) {
    const result = await this.pool.query(`${principalSelect} WHERE u.id=$1 AND u.status='active' GROUP BY u.id,t.display_name`, [userId]);
    return result.rowCount ? mapPrincipal(result.rows[0]) : null;
  }

  async getEffectivePolicy(userId: string) {
    const result = await this.pool.query(effectivePolicySelect, [userId]);
    return result.rowCount ? mapPolicy(result.rows[0]) : null;
  }

  async listUsers(tenantId: string) {
    const result = await this.pool.query(
      `SELECT u.id AS user_id,u.email,u.display_name,
       COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.tenant_id=$1 GROUP BY u.id ORDER BY u.email`,
      [tenantId],
    );
    return Promise.all(result.rows.map(async (row) => ({
      userId: String(row.user_id), email: String(row.email), displayName: String(row.display_name),
      roles: (row.roles as OneComputerRole[] | null) ?? [], effectivePolicy: await this.getEffectivePolicy(String(row.user_id)),
    })));
  }

  async assignMvpPolicy(input: { tenantId: string; targetUserId: string; assignedBy: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const policy = await this.assignMvpPolicyWithClient(client, input.tenantId, input.targetUserId, input.assignedBy);
      await client.query("COMMIT");
      return policy;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async revokeMvpPolicy(input: { tenantId: string; targetUserId: string; revokedBy: string }) {
    const result = await this.pool.query(
      `UPDATE policy_assignments SET revoked_at=now(),revoked_by=$3
       WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
      [input.tenantId, input.targetUserId, input.revokedBy],
    );
    return Boolean(result.rowCount);
  }

  async createMvpPolicyVersion(input: { tenantId: string; createdBy: string; revisionNote: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query("SELECT id FROM users WHERE id=$1 AND tenant_id=$2", [input.createdBy, input.tenantId]);
      if (!user.rowCount) throw new Error("Policy creator is outside the tenant");
      const bundleId = mvpPolicyBundleId(input.tenantId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`policy-version:${bundleId}`]);
      await this.ensurePolicyFoundation(client, input.tenantId, input.createdBy);
      const latest = await client.query("SELECT COALESCE(max(version),0) AS version FROM policy_versions WHERE policy_bundle_id=$1", [bundleId]);
      const version = Number(latest.rows[0].version) + 1;
      const document = mvpPolicyDocument(input.revisionNote);
      const documentHash = policyHash(document);
      const id = randomUUID();
      await client.query(
        "INSERT INTO policy_versions (id,policy_bundle_id,version,document,document_hash,created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
        [id, bundleId, version, JSON.stringify(document), documentHash, input.createdBy],
      );
      await client.query("COMMIT");
      return { id, version, documentHash };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async updateMvpToolPolicy(input: { tenantId: string; updatedBy: string; tools: Record<string, McpToolPolicyDecision> }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const bundleId = mvpPolicyBundleId(input.tenantId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`policy-version:${bundleId}`]);
      await this.ensurePolicyFoundation(client, input.tenantId, input.updatedBy);
      const latest = await client.query(
        "SELECT id,version,document FROM policy_versions WHERE policy_bundle_id=$1 ORDER BY version DESC LIMIT 1",
        [bundleId],
      );
      const document = structuredClone((latest.rows[0]?.document ?? mvpPolicyDocument()) as OwnedJson) as Record<string, OwnedJson>;
      document.revisionNote = "Updated Microsoft 365 tool approval rules";
      const mcp = document.mcp as Record<string, OwnedJson>;
      const servers = mcp.servers as Record<string, OwnedJson>;
      const server = servers.onecomputer_ms365 as Record<string, OwnedJson>;
      server.tools = Object.keys(input.tools);
      server.toolPolicies = input.tools;
      const documentHash = policyHash(document);
      const existing = await client.query(
        "SELECT id,version FROM policy_versions WHERE policy_bundle_id=$1 AND document_hash=$2",
        [bundleId, documentHash],
      );
      let id: string;
      let version: number;
      if (existing.rowCount) {
        id = String(existing.rows[0].id);
        version = Number(existing.rows[0].version);
      } else {
        version = Number(latest.rows[0]?.version ?? 0) + 1;
        id = randomUUID();
        await client.query(
          "INSERT INTO policy_versions (id,policy_bundle_id,version,document,document_hash,created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
          [id, bundleId, version, JSON.stringify(document), documentHash, input.updatedBy],
        );
      }
      const assignments = await client.query(
        `SELECT pa.id,pa.tenant_id,pa.user_id,pa.agent_id,pa.workspace_identity_id
         FROM policy_assignments pa JOIN policy_versions pv ON pv.id=pa.policy_version_id
         WHERE pa.tenant_id=$1 AND pv.policy_bundle_id=$2 AND pa.revoked_at IS NULL FOR UPDATE`,
        [input.tenantId, bundleId],
      );
      for (const assignment of assignments.rows) {
        await client.query("UPDATE policy_assignments SET revoked_at=now(),revoked_by=$2 WHERE id=$1", [assignment.id, input.updatedBy]);
        const replacementId = randomUUID();
        await client.query(
          `INSERT INTO policy_assignments (id,tenant_id,user_id,agent_id,workspace_identity_id,policy_version_id,assigned_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [replacementId, assignment.tenant_id, assignment.user_id, assignment.agent_id, assignment.workspace_identity_id, id, input.updatedBy],
        );
        await client.query(
          "INSERT INTO capability_assignments (policy_assignment_id,capability_id) SELECT $1,capability_id FROM capability_assignments WHERE policy_assignment_id=$2",
          [replacementId, assignment.id],
        );
      }
      await client.query("COMMIT");
      return { id, version, documentHash };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async bindWorkspaceIdentity(userId: string, workspaceId: string) {
    await this.pool.query(
      `UPDATE workspace_identities wi SET workspace_id=$2
       FROM workspaces w WHERE wi.owner_user_id=$1 AND wi.grant_id=w.grant_id AND w.id=$2
       AND w.tenant_id=wi.tenant_id AND w.subject_id=wi.owner_user_id`,
      [userId, workspaceId],
    );
  }

  private async ensurePolicyFoundation(client: pg.PoolClient, tenantId: string, createdBy: string) {
    const bundleId = mvpPolicyBundleId(tenantId);
    await client.query("INSERT INTO policy_bundles (id,tenant_id,display_name) VALUES ($1,$2,'MVP standard workspace') ON CONFLICT DO NOTHING", [bundleId, tenantId]);
    for (const capability of [
      ["ai-assistant", "AI assistant", "standard"],
      ["coding-tools", "Coding tools", "standard"],
      ["m365-read", "Microsoft 365 read", "standard"],
      ["m365-write-protected", "Microsoft 365 protected writes", "protected"],
    ]) {
      await client.query("INSERT INTO capabilities (id,display_name,risk) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", capability);
    }
    const document = mvpPolicyDocument();
    await client.query(
      `INSERT INTO policy_versions (id,policy_bundle_id,version,document,document_hash,created_by)
       VALUES ($1,$2,1,$3::jsonb,$4,$5) ON CONFLICT DO NOTHING`,
      [randomUUID(), bundleId, JSON.stringify(document), policyHash(document), createdBy],
    );
  }

  private async assignMvpPolicyWithClient(client: pg.PoolClient, tenantId: string, targetUserId: string, assignedBy: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`policy-assignment:${tenantId}:${targetUserId}`]);
    const owned = await client.query("SELECT id FROM users WHERE id=$1 AND tenant_id=$2", [targetUserId, tenantId]);
    if (!owned.rowCount) throw new Error("Policy target is outside the tenant");
    await this.ensurePolicyFoundation(client, tenantId, assignedBy);
    const existing = await client.query(`${effectivePolicySelect} FOR UPDATE`, [targetUserId]);
    if (existing.rowCount) return mapPolicy(existing.rows[0]);
    const resources = await client.query(
      `SELECT a.id AS agent_id,wi.id AS workspace_identity_id,pv.id AS policy_version_id
       FROM agent_identities a JOIN workspace_identities wi ON wi.owner_user_id=a.owner_user_id
       CROSS JOIN LATERAL (SELECT id FROM policy_versions WHERE policy_bundle_id=$2 ORDER BY version DESC LIMIT 1) pv
       WHERE a.owner_user_id=$1 AND a.status='active' AND wi.status='active' LIMIT 1`,
      [targetUserId, mvpPolicyBundleId(tenantId)],
    );
    if (!resources.rowCount) throw new Error("Policy target identities are missing");
    const assignmentId = randomUUID();
    await client.query(
      `INSERT INTO policy_assignments (id,tenant_id,user_id,agent_id,workspace_identity_id,policy_version_id,assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [assignmentId, tenantId, targetUserId, resources.rows[0].agent_id, resources.rows[0].workspace_identity_id, resources.rows[0].policy_version_id, assignedBy],
    );
    await client.query(
      "INSERT INTO capability_assignments (policy_assignment_id,capability_id) SELECT $1,id FROM capabilities ON CONFLICT DO NOTHING",
      [assignmentId],
    );
    const result = await client.query(effectivePolicySelect, [targetUserId]);
    return mapPolicy(result.rows[0]);
  }
}
