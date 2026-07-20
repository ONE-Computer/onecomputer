import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityContext, Launch, Sandbox } from "@onecomputer/contracts";
import { MemoryWorkspaceStore } from "@onecomputer/workspace-store";
import type { GatewayClient, GatewayGrant } from "@onecomputer/litellm-adapter";
import { WorkspaceService, type ControllerClient } from "../apps/control-api/src/service.js";

class FakeController implements ControllerClient {
  creates = 0;
  destroys = 0;
  lastGateway: GatewayGrant | undefined;
  async create(input: { workspaceId: string; gateway?: GatewayGrant }): Promise<Sandbox> {
    this.creates += 1;
    this.lastGateway = input.gateway;
    return { providerId: `sandbox-${input.workspaceId}`, state: "ready", failureCode: null };
  }
  async status(providerId: string): Promise<Sandbox> { return { providerId, state: "ready", failureCode: null }; }
  async open(_providerId: string): Promise<Launch> { return { launchUrl: "https://kasm.example/session", expiresAt: new Date(Date.now() + 60_000).toISOString() }; }
  async destroy(_providerId: string) { this.destroys += 1; }
}

class FakeGateway implements GatewayClient {
  grants = 0;
  revocations = 0;
  async ensureGrant(input: { workspaceId: string }): Promise<GatewayGrant> {
    this.grants += 1;
    return { baseUrl: "http://litellm:4000", credential: `sk-${input.workspaceId}`, modelAlias: "onecomputer-assistant", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  async readiness() { return { models: "ready" as const, tools: "ready" as const }; }
  async test() {
    return {
      model: "onecomputer-assistant",
      response: "ready",
      tools: [{ name: "search_files", description: "Search files" }],
      apiBaseUrl: "http://litellm:4000/v1",
      mcpUrl: "http://litellm:4000/mcp",
    };
  }
  async revoke() { this.revocations += 1; }
}

const alex: IdentityContext = { tenantId: "acme", subjectId: "alex", audience: "onecomputer-control" };

test("concurrent create calls reuse one workspace and one sandbox", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const [first, second] = await Promise.all([
    service.create(alex, "personal", "same-key-0001", "correlation-1"),
    service.create(alex, "personal", "same-key-0001", "correlation-2"),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(controller.creates, 1);
  assert.equal(first.state, "ready");
});

test("workspace identifiers do not confer cross-tenant access", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const workspace = await service.create(alex, "personal", "tenant-key-0001", "correlation-1");
  await assert.rejects(
    service.open({ tenantId: "other", subjectId: "alex", audience: "onecomputer-control" }, workspace.id),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND"),
  );
});

test("workspace identifiers do not confer cross-subject access", async () => {
  const service = new WorkspaceService(new MemoryWorkspaceStore(), new FakeController());
  const workspace = await service.create(alex, "personal", "subject-key-001", "correlation-1");
  await assert.rejects(
    service.open({ tenantId: "acme", subjectId: "mallory", audience: "onecomputer-control" }, workspace.id),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND"),
  );
});

test("workspace lifetime remains UI-managed while its gateway grant can renew", async () => {
  const controller = new FakeController();
  const store = new MemoryWorkspaceStore();
  const gateway = new FakeGateway();
  const service = new WorkspaceService(store, controller, gateway);
  const created = await service.create(alex, "personal", "persistent-create-1", "correlation-1");
  const current = await service.current(alex);
  assert.equal(current?.id, created.id);
  assert.equal(current?.state, "ready");
  assert.equal(controller.creates, 1);
  assert.equal(gateway.grants, 2);
});

test("restart destroys the prior sandbox and retains product identity", async () => {
  const controller = new FakeController();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller);
  const workspace = await service.create(alex, "personal", "restart-key-01", "correlation-1");
  const restarted = await service.restart(alex, workspace.id, "correlation-2");
  assert.equal(restarted.id, workspace.id);
  assert.equal(restarted.state, "ready");
  assert.equal(controller.creates, 2);
  assert.equal(controller.destroys, 1);
});

test("stop removes provider authority while retaining an owned stopped record", async () => {
  const controller = new FakeController();
  const store = new MemoryWorkspaceStore();
  const service = new WorkspaceService(store, controller);
  const workspace = await service.create(alex, "personal", "stop-key-00001", "correlation-1");
  const stopped = await service.stop(alex, workspace.id);
  assert.equal(stopped.state, "stopped");
  assert.equal((await store.getOwned(alex, workspace.id))?.providerId, null);
  assert.equal(controller.destroys, 1);
});

test("workspace lifecycle provisions, reports, tests, and revokes a scoped gateway grant", async () => {
  const controller = new FakeController();
  const gateway = new FakeGateway();
  const service = new WorkspaceService(new MemoryWorkspaceStore(), controller, gateway);
  const workspace = await service.create(alex, "personal", "gateway-key-0001", "correlation-002");
  assert.equal(workspace.readiness.models, "ready");
  assert.equal(workspace.readiness.tools, "ready");
  assert.equal(controller.lastGateway?.modelAlias, "onecomputer-assistant");
  assert.equal(gateway.grants, 1);
  assert.deepEqual((await service.testGateway(alex, workspace.id)).tools.map((tool) => tool.name), ["search_files"]);
  await service.stop(alex, workspace.id);
  assert.equal(gateway.revocations, 1);
});
