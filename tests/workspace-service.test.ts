import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityContext, Launch, RuntimePolicy, Sandbox } from "@onecomputer/contracts";
import { MemoryWorkspaceStore } from "@onecomputer/workspace-store";
import type { GatewayClient, GatewayGrant } from "@onecomputer/litellm-adapter";
import { WorkspaceService, type ControllerClient } from "../apps/control-api/src/service.js";

class FakeController implements ControllerClient {
  creates = 0;
  destroys = 0;
  purges = 0;
  lastGateway: GatewayGrant | undefined;
  lastPolicy: RuntimePolicy | undefined;
  async create(input: { workspaceId: string; policy: RuntimePolicy; gateway?: GatewayGrant }): Promise<Sandbox> {
    this.creates += 1;
    this.lastGateway = input.gateway;
    this.lastPolicy = input.policy;
    return { providerId: `sandbox-${input.workspaceId}`, state: "ready", failureCode: null };
  }
  async status(providerId: string): Promise<Sandbox> { return { providerId, state: "ready", failureCode: null }; }
  async open(_providerId: string): Promise<Launch> { return { launchUrl: "https://kasm.example/session", expiresAt: new Date(Date.now() + 60_000).toISOString() }; }
  async destroy(_providerId: string) { this.destroys += 1; }
  async purgeWorkspace(_workspaceId: string) { this.purges += 1; }
}

class FakeGateway implements GatewayClient {
  grants = 0;
  revocations = 0;
  lastPolicy: RuntimePolicy | undefined;
  async ensureGrant(input: { workspaceId: string; policy?: RuntimePolicy }): Promise<GatewayGrant> {
    this.grants += 1;
    this.lastPolicy = input.policy;
    return { baseUrl: "http://litellm:4000", credential: `sk-${input.workspaceId}`, modelAlias: "onecomputer-assistant", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  async readiness() { return { models: "ready" as const, tools: "ready" as const, modelRoute: fakeModelRoute }; }
  async test() {
    return {
      model: "onecomputer-assistant",
      availability: "ready" as const,
      modelRoute: fakeModelRoute,
      tools: [{ name: "search_files", description: "Search files" }],
      apiBaseUrl: "http://litellm:4000/v1",
      mcpUrl: "http://litellm:4000/mcp",
    };
  }
  async revoke() { this.revocations += 1; }
}

const fakeModelRoute = {
  alias: "onecomputer-assistant",
  status: "ready" as const,
  fallback: "none" as const,
  budget: { limitUsd: 1, spentUsd: 0.25, remainingUsd: 0.75, duration: "30d" as const, resetsAt: null },
  limits: { requestsPerMinute: 30, tokensPerMinute: 50_000, maxParallelRequests: 4 },
};

const alex: IdentityContext = { tenantId: "acme", subjectId: "alex", audience: "onecomputer-control" };
const policy: RuntimePolicy = {
  schemaVersion: 1,
  policyVersionId: "policy-version-1",
  policyVersion: 1,
  policyHash: "a".repeat(64),
  workspaceProfile: "kasm-persistent-standard",
  agentId: "agent-alex",
  agentProfile: "onecomputer-default-agent",
  networkProfile: "controlled-egress-v1",
  modelAlias: "onecomputer-assistant",
  mcpServer: "onecomputer_ms365",
  allowedTools: ["list-mail-folders", "list-calendars", "list-drives"],
};

test("concurrent create calls reuse one workspace and one sandbox", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const [first, second] = await Promise.all([
    service.create(alex, policy, "personal", "same-key-0001", "correlation-1"),
    service.create(alex, policy, "personal", "same-key-0001", "correlation-2"),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(controller.creates, 1);
  assert.equal(first.state, "ready");
});

test("workspace identifiers do not confer cross-tenant access", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const workspace = await service.create(alex, policy, "personal", "tenant-key-0001", "correlation-1");
  await assert.rejects(
    service.open({ tenantId: "other", subjectId: "alex", audience: "onecomputer-control" }, policy, workspace.id),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND"),
  );
});

test("workspace identifiers do not confer cross-subject access", async () => {
  const service = new WorkspaceService(new MemoryWorkspaceStore(), new FakeController());
  const workspace = await service.create(alex, policy, "personal", "subject-key-001", "correlation-1");
  await assert.rejects(
    service.open({ tenantId: "acme", subjectId: "mallory", audience: "onecomputer-control" }, policy, workspace.id),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND"),
  );
});

test("workspace lifetime remains UI-managed while its gateway grant can renew", async () => {
  const controller = new FakeController();
  const store = new MemoryWorkspaceStore();
  const gateway = new FakeGateway();
  const service = new WorkspaceService(store, controller, gateway);
  const created = await service.create(alex, policy, "personal", "persistent-create-1", "correlation-1");
  const current = await service.current(alex, policy);
  assert.equal(current?.id, created.id);
  assert.equal(current?.state, "ready");
  assert.equal(controller.creates, 1);
  assert.equal(gateway.grants, 2);
});

test("restart destroys the prior sandbox and retains product identity", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const workspace = await service.create(alex, policy, "personal", "restart-key-01", "correlation-1");
  const restarted = await service.restart(alex, policy, workspace.id, "correlation-2");
  assert.equal(restarted.id, workspace.id);
  assert.equal(restarted.state, "ready");
  assert.equal(controller.creates, 2);
  assert.equal(controller.destroys, 1);
});

test("stop removes provider authority while retaining an owned stopped record", async () => {
  const controller = new FakeController();
  const store = new MemoryWorkspaceStore();
  const service = new WorkspaceService(store, controller);
  const workspace = await service.create(alex, policy, "personal", "stop-key-00001", "correlation-1");
  const stopped = await service.stop(alex, policy, workspace.id);
  assert.equal(stopped.state, "stopped");
  assert.equal((await store.getOwned(alex, workspace.id))?.providerId, null);
  assert.equal(controller.destroys, 1);
  assert.equal(controller.purges, 0);
});

test("delete purges persistent storage after removing the runtime", async () => {
  const controller = new FakeController();
  const store = new MemoryWorkspaceStore();
  const service = new WorkspaceService(store, controller);
  const workspace = await service.create(alex, policy, "personal", "delete-key-0001", "correlation-1");
  await service.delete(alex, policy, workspace.id);
  assert.equal(controller.destroys, 1);
  assert.equal(controller.purges, 1);
  assert.equal(await store.getOwned(alex, workspace.id), null);
});

test("workspace lifecycle provisions, reports, tests, and revokes a scoped gateway grant", async () => {
  const controller = new FakeController();
  const gateway = new FakeGateway();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller, gateway);
  const workspace = await service.create(alex, policy, "personal", "gateway-key-0001", "correlation-002");
  assert.equal(workspace.readiness.models, "ready");
  assert.equal(workspace.readiness.tools, "ready");
  assert.equal(workspace.modelRoute?.budget.remainingUsd, 0.75);
  assert.equal(controller.lastGateway?.modelAlias, "onecomputer-assistant");
  assert.equal(gateway.grants, 1);
  assert.equal(controller.lastPolicy?.policyHash, policy.policyHash);
  assert.deepEqual(gateway.lastPolicy?.allowedTools, policy.allowedTools);
  assert.deepEqual((await service.testGateway(alex, policy, workspace.id)).tools.map((tool) => tool.name), ["search_files"]);
  await service.stop(alex, policy, workspace.id);
  assert.equal(gateway.revocations, 1);
});
