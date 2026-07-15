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
      delete: vi.fn(),
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

afterEach(() => {
  mocks.auditOrder.splice(0);
  vi.clearAllMocks();
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
});
