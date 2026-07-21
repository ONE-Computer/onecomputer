import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { IdentityContext, McpPolicyRequest } from "@onecomputer/contracts";
import type { GovernedToolExecutor } from "@onecomputer/litellm-adapter";
import { MemoryWorkspaceStore, type EffectivePolicy, type IdentityPolicyStore, type SessionPrincipal } from "@onecomputer/workspace-store";
import { McpPolicyService } from "../apps/control-api/src/mcp-policy.js";
import { FixtureApprovalAuthority, GovernedOperationService } from "../apps/control-api/src/operations.js";

const identity: IdentityContext = { tenantId: "acme", subjectId: "alex", audience: "onecomputer-control" };
const agentId = randomUUID();
const policyVersionId = randomUUID();
const policyHash = "a".repeat(64);

const setup = async () => {
  const store = new MemoryWorkspaceStore();
  const workspace = await store.createOrGet(identity, "personal", randomUUID());
  await store.update(workspace.id, { state: "ready" });
  const principal: SessionPrincipal = {
    userId: identity.subjectId,
    tenantId: identity.tenantId,
    email: "alex@metech.dev",
    displayName: "Alex",
    tenantDisplayName: "ME TECH",
    roles: ["employee"],
    identity,
  };
  const effective: EffectivePolicy = {
    assignmentId: randomUUID(),
    policyBundleId: "mvp-standard:acme",
    policyVersionId,
    version: 2,
    documentHash: policyHash,
    assignedBy: "admin",
    assignedAt: new Date().toISOString(),
    agentId,
    workspaceIdentityId: randomUUID(),
    workspaceId: workspace.id,
    vendorUserId: "oc-user-alex",
    document: {
      schemaVersion: 1,
      workspaceProfile: "kasm-persistent-standard",
      agentProfile: "onecomputer-default-agent",
      modelAliases: ["onecomputer-assistant"],
      networkProfile: "controlled-egress-v1",
      mcp: { servers: { onecomputer_ms365: { tools: ["list-mail-folders", "list-calendars", "list-drives", "search-onedrive-files", "get-drive-item", "delete-onedrive-file"] } } },
      capabilities: ["m365-read", "onedrive-delete-protected"],
      protectedOperations: { "onedrive-delete-protected": "approval_required", defaultWrite: "deny" },
    },
  };
  const identityPolicies = {
    getPrincipal: async (userId) => userId === principal.userId ? principal : null,
    getEffectivePolicy: async (userId) => userId === principal.userId ? effective : null,
  } as unknown as IdentityPolicyStore;
  const executor = { executeGovernedTool: async () => ({ upstreamReference: "unused", resultSummary: "unused", result: {} }) } as GovernedToolExecutor;
  const operations = new GovernedOperationService(store, executor, new FixtureApprovalAuthority("mcp-policy-fixture-secret-at-least-32-characters"));
  const policy = new McpPolicyService(identityPolicies, store, operations);
  const base: McpPolicyRequest = {
    schemaVersion: 1,
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    workspaceId: workspace.id,
    agentId,
    policyVersionId,
    policyHash,
    operationId: null,
    operationDigest: null,
    leaseId: null,
    serverId: "9885e7f76089931fc5365104183af8ea",
    serverName: "onecomputer_ms365",
    toolName: "list-mail-folders",
    arguments: {},
  };
  return { store, workspace, policy, base };
};

test("Control auto-allows only an exact assigned bounded Microsoft 365 read", async () => {
  const { policy, base } = await setup();
  assert.equal((await policy.authorize(base, "read-allow")).decision, "allow");
  assert.equal((await policy.authorize({ ...base, arguments: { top: 25 } }, "read-limit")).decision, "allow");
  assert.equal((await policy.authorize({ ...base, arguments: { top: 26 } }, "read-over-limit")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
  assert.equal((await policy.authorize({ ...base, arguments: { fetchAllPages: true } }, "read-over-broad")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
  assert.equal((await policy.authorize({ ...base, policyHash: "b".repeat(64) }, "read-policy-mutation")).code, "MCP_POLICY_BINDING_MISMATCH");
  assert.equal((await policy.authorize({ ...base, serverName: "attacker" }, "read-server-mutation")).code, "MCP_TOOL_NOT_GOVERNED");
});

test("Control permits bounded OneDrive discovery but rejects broad search", async () => {
  const { policy, base } = await setup();
  const request = { ...base, toolName: "search-onedrive-files", arguments: { driveId: "drive-1", q: "disposable", select: "id,name,eTag,parentReference", top: 10 } };
  assert.equal((await policy.authorize(request, "drive-search")).decision, "allow");
  assert.equal((await policy.authorize({ ...request, arguments: { ...request.arguments, top: 11 } }, "drive-search-over-limit")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
  assert.equal((await policy.authorize({ ...request, arguments: { ...request.arguments, select: "*" } }, "drive-search-over-broad-select")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
  assert.equal((await policy.authorize({ ...request, arguments: { ...request.arguments, skip: 10 } }, "drive-search-extra-argument")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
});

test("Control permits only the exact version metadata projection for a drive item", async () => {
  const { policy, base } = await setup();
  const request = {
    ...base,
    toolName: "get-drive-item",
    arguments: {
      driveId: "drive-1",
      driveItemId: "item-1",
      includeHeaders: true,
      select: "id,name,eTag,parentReference",
    },
  };
  assert.equal((await policy.authorize(request, "drive-item-metadata")).decision, "allow");
  assert.equal((await policy.authorize({ ...request, arguments: { ...request.arguments, includeHeaders: false } }, "drive-item-no-headers")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
  assert.equal((await policy.authorize({ ...request, arguments: { ...request.arguments, select: "*" } }, "drive-item-broad-select")).code, "MCP_ARGUMENTS_OUT_OF_POLICY");
});

test("protected OneDrive delete persists before approval and an exact lease dispatches once", async () => {
  const { store, policy, base } = await setup();
  const requested = await policy.authorize({
    ...base,
    toolName: "delete-onedrive-file",
    arguments: { driveId: "drive-1", driveItemId: "item-1", "If-Match": "etag-1" },
  }, "delete-request");
  assert.equal(requested.decision, "approval_required");
  assert.ok(requested.operationId);
  const operation = await store.getOwnedOperation(identity, requested.operationId!);
  assert.deepEqual(operation?.arguments, {
    "If-Match": "etag-1",
    confirm: true,
    driveId: "drive-1",
    driveItemId: "item-1",
    excludeResponse: true,
  });

  const decidedAt = new Date();
  await store.recordApproval({
    identity,
    operationId: operation!.id,
    approvalId: randomUUID(),
    decision: "approve",
    channel: "local-fixture",
    issuer: "onecomputer-local-fixture",
    keyId: "fixture-hmac-v1",
    operationDigest: operation!.operationDigest,
    nonce: operation!.nonce,
    proofHash: "c".repeat(64),
    issuedAt: decidedAt,
    expiresAt: new Date(decidedAt.getTime() + 30_000),
    decidedAt,
    correlationId: "approve",
  });
  const leaseId = randomUUID();
  await store.claimExecution(identity, operation!.id, leaseId, new Date(Date.now() + 30_000), "lease");
  const executionRequest: McpPolicyRequest = {
    ...base,
    toolName: "delete-onedrive-file",
    arguments: operation!.arguments,
    agentId,
    operationId: operation!.id,
    operationDigest: operation!.operationDigest,
    leaseId,
  };
  assert.equal((await policy.authorize(executionRequest, "dispatch-1")).decision, "allow");
  assert.equal((await policy.authorize(executionRequest, "dispatch-replay")).code, "MCP_EXECUTION_BINDING_INVALID");
  assert.equal((await policy.authorize({ ...executionRequest, arguments: { ...operation!.arguments as object, driveItemId: "mutated" } }, "dispatch-mutation")).code, "MCP_EXECUTION_BINDING_INVALID");
});
