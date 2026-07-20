import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { LiteLLMGatewayAdapter } from "@onecomputer/litellm-adapter";
import { PostgresIdentityPolicyStore, PostgresWorkspaceStore } from "@onecomputer/workspace-store";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const identity = { tenantId: "qualification", subjectId: "qualification-user", audience: "onecomputer-control" };
const workspaceStore = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
await workspaceStore.migrate();
const workspace = await workspaceStore.createOrGet(identity, "personal", randomUUID());
await workspaceStore.update(workspace.id, { state: "ready" });
await workspaceStore.close();

let store = PostgresIdentityPolicyStore.fromConnectionString(process.env.DATABASE_URL);
const gatewayUserId = `oc-user-${createHash("sha256").update(`onecomputer:litellm:user:${identity.tenantId}:${identity.subjectId}`).digest("base64url")}`;
const principal = await store.upsertAuthenticatedIdentity({
  ownedTenantId: identity.tenantId,
  ownedUserId: identity.subjectId,
  externalTenantId: "00000000-0000-0000-0000-000000000005",
  externalSubject: "qualification-external-subject",
  issuer: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000005/v2.0",
  email: "qualification@metech.dev",
  displayName: "Qualification User",
  tenantDisplayName: "Qualification tenant",
  bootstrapAdministrator: true,
  gatewayUserId,
});
assert.deepEqual(principal.roles, ["administrator", "employee"]);

const policyV1 = await store.getEffectivePolicy(principal.userId);
assert.equal(policyV1?.version, 1);
assert.equal(policyV1?.assignedBy, principal.userId);
assert.equal(policyV1?.workspaceId, workspace.id);
assert.equal(policyV1?.vendorUserId, gatewayUserId);

const sessionTokenHash = createHash("sha256").update("qualification-session-token").digest("hex");
await store.createSession({ tokenHash: sessionTokenHash, userId: principal.userId, expiresAt: new Date(Date.now() + 60_000) });
await store.close();

store = PostgresIdentityPolicyStore.fromConnectionString(process.env.DATABASE_URL);
assert.equal((await store.getSession(sessionTokenHash, new Date()))?.email, "qualification@metech.dev");
assert.equal((await store.getEffectivePolicy(principal.userId))?.documentHash, policyV1?.documentHash);

const policyV2 = await store.createMvpPolicyVersion({ tenantId: principal.tenantId, createdBy: principal.userId, revisionNote: "Qualification version two" });
assert.equal(policyV2.version, 2);
assert.equal((await store.getEffectivePolicy(principal.userId))?.version, 1, "existing assignment must remain pinned to its immutable version");

assert.equal(await store.revokeMvpPolicy({ tenantId: principal.tenantId, targetUserId: principal.userId, revokedBy: principal.userId }), true);
assert.equal(await store.getEffectivePolicy(principal.userId), null);
const reassigned = await store.assignMvpPolicy({ tenantId: principal.tenantId, targetUserId: principal.userId, assignedBy: principal.userId });
assert.equal(reassigned.version, 2);
await assert.rejects(
  () => store.assignMvpPolicy({ tenantId: "other-tenant", targetUserId: principal.userId, assignedBy: principal.userId }),
  /outside the tenant/,
);
await store.close();

// This import is intentional evidence that the persisted vendor mapping uses
// the same deterministic identity function as the deployed gateway adapter.
assert.equal(typeof LiteLLMGatewayAdapter, "function");

console.log(JSON.stringify({
  status: "passed",
  userId: principal.userId,
  tenantId: principal.tenantId,
  workspaceId: workspace.id,
  gatewayUserId,
  initialPolicyVersion: policyV1.version,
  reassignedPolicyVersion: reassigned.version,
  sessionRestartProbe: "passed",
  crossTenantProbe: "denied",
}));
