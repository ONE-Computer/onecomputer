import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const auditOrder: string[] = [];
  const provider = {
    createSandbox: vi.fn(async () => {
      auditOrder.push("create");
      return {
        id: "sandbox-provisioning",
        name: "sandbox-provisioning",
        state: "provisioning",
        provider: "kasm-local" as const,
        bootstrapped: false,
      };
    }),
    bootstrapSandbox: vi.fn(async () => {
      auditOrder.push("bootstrap");
      return {
        id: "sandbox-provisioning",
        name: "sandbox-provisioning",
        state: "started",
        provider: "kasm-local" as const,
        bootstrapped: true,
      };
    }),
    listSandboxes: vi.fn(async () => []),
    getSandbox: vi.fn(),
    execInSandbox: vi.fn(),
    deleteSandbox: vi.fn(async () => undefined),
    getSandboxDesktop: vi.fn(),
    restartSandboxDesktop: vi.fn(),
    ensureVisualRuntime: vi.fn(),
    captureScreenshot: vi.fn(),
  };
  const db = {
    agent: { findFirst: vi.fn(async () => ({ accessToken: "gateway-token" })) },
    sandbox: {
      upsert: vi.fn(async () => {
        auditOrder.push("persist");
      }),
      update: vi.fn(async () => undefined),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    sandboxAllocationOperation: {
      findUnique: vi.fn(async () => undefined),
      findFirst: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    },
  };
  return { auditOrder, provider, db };
});

vi.mock("@onecli/db", () => ({ db: mocks.db }));
vi.mock("../services/sandbox-providers", () => ({
  getSandboxProvider: () => mocks.provider,
}));
vi.mock("../middleware/auth", () => {
  const authMiddleware: MiddlewareHandler = async (c, next) => {
    c.set("auth", {
      userId: "user-1",
      userEmail: "user@example.com",
      organizationId: "org-1",
      projectId: "project-1",
      role: "admin",
    });
    await next();
  };
  return { authMiddleware, requireProjectId: () => "project-1" };
});
vi.mock("../middleware/ability", () => ({
  withAbility: (async (_c, next) => next()) as MiddlewareHandler,
  requireAbility: vi.fn(),
}));
vi.mock("../lib/ability", () => ({ subject: vi.fn() }));
vi.mock("../services/audit-service", () => ({
  withAudit: async <T>(operation: () => Promise<T>) => operation(),
  AUDIT_ACTIONS: {
    CREATE: "create",
    UPDATE: "update",
    DELETE: "delete",
    CONNECT: "connect",
  },
  AUDIT_SERVICES: { SANDBOX: "sandbox" },
  AUDIT_SOURCE: { API: "api" },
}));
vi.mock("../services/governed-action-service", () => ({
  triggerGovernedAction: vi.fn(),
}));

afterEach(async () => {
  mocks.auditOrder.splice(0);
  vi.clearAllMocks();
  delete process.env.ONECOMPUTER_TEST_MODE;
  delete process.env.ONECOMPUTER_TEST_INJECT_ALLOCATION_RESPONSE_FAILURE_ONCE;
  const { resetAllocationResponseFailureForTests } =
    await import("../services/allocation-failure-injection");
  resetAllocationResponseFailureForTests();
});

describe("sandbox provisioning lifecycle", () => {
  it("persists a provisioning identity before starting long bootstrap", async () => {
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();
    app.route("/v1/sandboxes", sandboxRoutes());

    const response = await app.request("/v1/sandboxes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Lifecycle proof" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "sandbox-provisioning",
      state: "provisioning",
    });
    await vi.waitFor(() =>
      expect(mocks.provider.bootstrapSandbox).toHaveBeenCalledOnce(),
    );
    expect(mocks.auditOrder).toEqual(["create", "persist", "bootstrap"]);
    await vi.waitFor(() =>
      expect(mocks.db.sandbox.update).toHaveBeenCalledWith({
        where: { id: "sandbox-provisioning" },
        data: { status: "started" },
      }),
    );
  });

  it("removes the provider resource when bootstrap fails", async () => {
    mocks.provider.bootstrapSandbox.mockRejectedValueOnce(
      new Error("bootstrap failed"),
    );
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();
    app.route("/v1/sandboxes", sandboxRoutes());

    const response = await app.request("/v1/sandboxes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Failure proof" }),
    });

    expect(response.status).toBe(201);
    await vi.waitFor(() =>
      expect(mocks.provider.deleteSandbox).toHaveBeenCalledWith(
        "sandbox-provisioning",
      ),
    );
    await vi.waitFor(() =>
      expect(mocks.db.sandbox.update).toHaveBeenCalledWith({
        where: { id: "sandbox-provisioning" },
        data: { status: "failed" },
      }),
    );
  });

  it("keeps single-sandbox reads in provisioning until persisted bootstrap completes", async () => {
    mocks.db.sandbox.findFirst.mockResolvedValueOnce({ ownerId: "user-1" });
    mocks.db.sandbox.findUnique.mockResolvedValueOnce({
      id: "sandbox-provisioning",
      name: "Lifecycle proof",
      provider: "kasm-local",
      status: "provisioning",
    });
    mocks.provider.getSandbox.mockResolvedValueOnce({
      id: "sandbox-provisioning",
      state: "started",
      provider: "kasm-local",
      bootstrapped: true,
      desktopReady: true,
    });
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();
    app.route("/v1/sandboxes", sandboxRoutes());

    const response = await app.request("/v1/sandboxes/sandbox-provisioning");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "sandbox-provisioning",
      state: "provisioning",
      bootstrapped: false,
      desktopReady: false,
    });
  });

  it("mounts the authenticated visual-runtime start route for an owned sandbox", async () => {
    mocks.db.sandbox.findFirst.mockResolvedValueOnce({ ownerId: "user-1" });
    mocks.provider.ensureVisualRuntime.mockResolvedValueOnce({
      display: ":1",
      width: 1440,
      height: 900,
      browserReady: true,
    });
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();
    app.route("/v1/sandboxes", sandboxRoutes());

    const response = await app.request(
      "/v1/sandboxes/sandbox-visual/visual/start",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      display: ":1",
      width: 1440,
      height: 900,
      browserReady: true,
    });
    expect(mocks.provider.ensureVisualRuntime).toHaveBeenCalledWith(
      "sandbox-visual",
    );
  });

  it("persists allocation identity and replays a completed idempotent request", async () => {
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();
    app.route("/v1/sandboxes", sandboxRoutes());
    const headers = {
      "content-type": "application/json",
      "Idempotency-Key": "conversation-1-generation-1",
      "X-Allocation-Operation-Id": "allocate-1",
    };

    const first = await app.request("/v1/sandboxes", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Replay proof" }),
    });
    expect(first.status).toBe(201);
    expect(mocks.provider.createSandbox).toHaveBeenCalledWith(
      "Replay proof",
      expect.objectContaining({
        allocationOperationId: "allocate-1",
        allocationIdempotencyKey: "conversation-1-generation-1",
      }),
    );
    const operationData = (
      mocks.db.sandboxAllocationOperation.create as unknown as {
        mock: { calls: Array<Array<{ data: Record<string, unknown> }>> };
      }
    ).mock.calls[0]?.[0]?.data;
    expect(operationData).toMatchObject({
      id: "allocate-1",
      idempotencyKey: "conversation-1-generation-1",
      status: "pending",
    });

    (
      mocks.db.sandboxAllocationOperation.findUnique as unknown as {
        mockResolvedValueOnce(value: unknown): void;
      }
    ).mockResolvedValueOnce({
      ...operationData,
      status: "completed",
      sandboxId: "sandbox-provisioning",
      provider: "kasm-local",
    });
    mocks.db.sandbox.findFirst.mockResolvedValueOnce({
      id: "sandbox-provisioning",
      organizationId: "org-1",
      ownerId: "user-1",
      provider: "kasm-local",
      providerSandboxId: "sandbox-provisioning",
      name: "Replay proof",
      status: "provisioning",
      allocationOperationId: "allocate-1",
      allocationIdempotencyKey: "conversation-1-generation-1",
    });
    mocks.provider.getSandbox.mockRejectedValueOnce(
      new Error("provider lookup unavailable"),
    );

    const replay = await app.request("/v1/sandboxes", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Replay proof" }),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      id: "sandbox-provisioning",
      allocationOperationId: "allocate-1",
      allocationIdempotencyKey: "conversation-1-generation-1",
    });
    expect(mocks.provider.createSandbox).toHaveBeenCalledOnce();
  });

  it("can inject one post-persistence response failure only in explicit test mode", async () => {
    process.env.ONECOMPUTER_TEST_MODE = "1";
    process.env.ONECOMPUTER_TEST_INJECT_ALLOCATION_RESPONSE_FAILURE_ONCE = "1";
    const { sandboxRoutes } = await import("./sandboxes");
    const app = new Hono();

    app.route("/v1/sandboxes", sandboxRoutes());
    const headers = {
      "content-type": "application/json",
      "Idempotency-Key": "failure-injection-1",
      "X-Allocation-Operation-Id": "allocate-failure-1",
    };
    const response = await app.request("/v1/sandboxes", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Failure injection proof" }),
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error: "sandbox allocation response unavailable",
    });
    expect(mocks.db.sandbox.upsert).toHaveBeenCalledOnce();
    expect(mocks.db.sandboxAllocationOperation.update).toHaveBeenCalled();

    const second = await app.request("/v1/sandboxes", {
      method: "POST",
      headers: {
        ...headers,
        "Idempotency-Key": "failure-injection-2",
        "X-Allocation-Operation-Id": "allocate-failure-2",
      },
      body: JSON.stringify({ name: "Failure injection second request" }),
    });
    expect(second.status).toBe(201);
  });
});
