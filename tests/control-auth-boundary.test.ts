import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityContext } from "@onecomputer/contracts";
import type { GatewayClient } from "@onecomputer/litellm-adapter";
import { MemoryWorkspaceStore, type EffectivePolicy, type IdentityPolicyStore, type SessionPrincipal } from "@onecomputer/workspace-store";
import { createControlServer } from "../apps/control-api/src/server.js";
import type { ControllerClient } from "../apps/control-api/src/service.js";

const proxyToken = "proxy-test-token-at-least-24-characters";
const alpha: IdentityContext = { tenantId: "acme", subjectId: "alpha", audience: "onecomputer-control" };
const principal: SessionPrincipal = {
  userId: "alpha",
  tenantId: "acme",
  email: "alpha@metech.dev",
  displayName: "Alpha User",
  tenantDisplayName: "ME TECH",
  roles: ["employee"],
  identity: alpha,
};

const authentication = (authenticated: SessionPrincipal | null) => ({
  begin: async () => ({ location: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize", cookie: "state=opaque" }),
  complete: async () => { throw new Error("not used"); },
  authenticate: async (cookie: string | undefined) => cookie === "onecomputer_session=valid" ? authenticated : null,
  logout: async () => "onecomputer_session=; Max-Age=0",
});

test("runtime identity comes only from the authenticated server session", async () => {
  const store = new MemoryWorkspaceStore();
  const owned = await store.createOrGet(alpha, "personal", "identity-boundary-workspace");
  await store.update(owned.id, { state: "ready" });
  const app = createControlServer(store, {} as ControllerClient, proxyToken, undefined, undefined, {}, { authentication: authentication(principal) });
  try {
    const spoofedOnly = await app.inject({
      method: "GET",
      url: "/v1/workspaces/current",
      headers: {
        "x-onecomputer-proxy-token": proxyToken,
        "x-onecomputer-tenant-id": "acme",
        "x-onecomputer-subject-id": "alpha",
        "x-onecomputer-role": "administrator",
      },
    });
    assert.equal(spoofedOnly.statusCode, 401);

    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/workspaces/current",
      headers: {
        "x-onecomputer-proxy-token": proxyToken,
        cookie: "onecomputer_session=valid",
        "x-onecomputer-tenant-id": "other",
        "x-onecomputer-subject-id": "attacker",
        "x-onecomputer-role": "administrator",
      },
    });
    assert.equal(authenticated.statusCode, 200);
    assert.equal(authenticated.json().id, owned.id);

    const admin = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { "x-onecomputer-proxy-token": proxyToken, cookie: "onecomputer_session=valid", "x-onecomputer-role": "administrator" },
    });
    assert.equal(admin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("test identities require an explicit test-only server mode", async () => {
  assert.throws(
    () => createControlServer(new MemoryWorkspaceStore(), {} as ControllerClient, proxyToken),
    /test identity mode must be enabled explicitly/,
  );
});

test("only an administrator can assign and revoke the tenant policy through Control", async () => {
  const administrator = { ...principal, roles: ["employee", "administrator"] as const } as SessionPrincipal;
  const effectivePolicy: EffectivePolicy = {
    assignmentId: "assignment-1", policyBundleId: "mvp-standard:acme", policyVersionId: "version-1", version: 1,
    documentHash: "a".repeat(64), assignedBy: "alpha", assignedAt: new Date().toISOString(), agentId: "agent-1",
    workspaceIdentityId: "workspace-identity-1", workspaceId: "11111111-1111-4111-8111-111111111111",
    vendorUserId: "oc-user-test", document: { schemaVersion: 1 },
  };
  let assigned = false;
  let revoked = false;
  const identityPolicyStore = {
    listUsers: async (tenantId) => tenantId === "acme" ? [{ userId: "alpha", email: principal.email, displayName: principal.displayName, roles: principal.roles, effectivePolicy: assigned && !revoked ? effectivePolicy : null }] : [],
    assignMvpPolicy: async () => { assigned = true; revoked = false; return effectivePolicy; },
    getEffectivePolicy: async () => assigned && !revoked ? effectivePolicy : null,
    revokeMvpPolicy: async () => { revoked = true; return true; },
  } as unknown as IdentityPolicyStore;
  const revokedKeys: string[] = [];
  const gateway = {
    revoke: async (workspaceId, agentId) => { revokedKeys.push(`${workspaceId}:${agentId ?? "default"}`); },
  } as unknown as GatewayClient;
  const app = createControlServer(new MemoryWorkspaceStore(), {} as ControllerClient, proxyToken, gateway, undefined, {}, {
    authentication: authentication(administrator), identityPolicyStore,
  });
  const headers = { "x-onecomputer-proxy-token": proxyToken, cookie: "onecomputer_session=valid" };
  try {
    const assign = await app.inject({ method: "POST", url: "/v1/admin/users/alpha/policy", headers });
    assert.equal(assign.statusCode, 200);
    assert.equal(assign.json().version, 1);

    const crossTenantTarget = await app.inject({ method: "POST", url: "/v1/admin/users/outsider/policy", headers });
    assert.equal(crossTenantTarget.statusCode, 404);
    const crossTenantRevoke = await app.inject({ method: "DELETE", url: "/v1/admin/users/outsider/policy", headers });
    assert.equal(crossTenantRevoke.statusCode, 404);

    const revoke = await app.inject({ method: "DELETE", url: "/v1/admin/users/alpha/policy", headers });
    assert.equal(revoke.statusCode, 204);
    assert.deepEqual(revokedKeys.sort(), [
      "11111111-1111-4111-8111-111111111111:agent-1",
      "11111111-1111-4111-8111-111111111111:default",
    ]);
  } finally {
    await app.close();
  }
});
