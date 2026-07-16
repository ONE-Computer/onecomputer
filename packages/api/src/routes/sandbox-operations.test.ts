import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operation: {
    id: "allocate-1",
    organizationId: "org-1",
    projectId: "project-1",
    requesterId: "user-1",
    idempotencyKey: "conversation-1-generation-1",
    status: "completed",
    sandboxId: "sandbox-1",
    provider: "kasm-local",
    errorCode: null,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:01.000Z"),
  },
  db: {
    sandboxAllocationOperation: {
      findFirst: vi.fn(async () => mocks.operation),
    },
  },
}));

vi.mock("@onecli/db", () => ({ db: mocks.db }));
vi.mock("../middleware/auth", () => {
  const authMiddleware: MiddlewareHandler = async (c, next) => {
    c.set("auth", {
      userId: "user-1",
      userEmail: "user@example.com",
      organizationId: "org-1",
      projectId: "project-1",
      role: "member",
    });
    await next();
  };
  return { authMiddleware, requireProjectId: () => "project-1" };
});

describe("sandbox allocation operation routes", () => {
  it("returns bounded lifecycle metadata to the owning requester", async () => {
    const { sandboxOperationRoutes } = await import("./sandbox-operations");
    const app = new Hono();
    app.route("/v1/sandbox-operations", sandboxOperationRoutes());

    const response = await app.request("/v1/sandbox-operations/allocate-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      operationId: "allocate-1",
      idempotencyKey: "conversation-1-generation-1",
      status: "completed",
      sandboxId: "sandbox-1",
      provider: "kasm-local",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:01.000Z",
    });
  });

  it("does not reveal another organization's operation", async () => {
    (
      mocks.db.sandboxAllocationOperation.findFirst as unknown as {
        mockResolvedValueOnce(value: unknown): void;
      }
    ).mockResolvedValueOnce(null);
    const { sandboxOperationRoutes } = await import("./sandbox-operations");
    const app = new Hono();
    app.onError((error, c) => c.json({ error: error.message }, 404));
    app.route("/v1/sandbox-operations", sandboxOperationRoutes());

    const response = await app.request("/v1/sandbox-operations/other");

    expect(response.status).toBe(404);
  });
});
