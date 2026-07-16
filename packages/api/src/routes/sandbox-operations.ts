import { Hono } from "hono";
import { db } from "@onecli/db";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import type { AbilityEnv } from "../middleware/ability";
import { ServiceError } from "../services/errors";

const ORG_WIDE_ROLES = new Set(["owner", "admin", "manager"]);

/**
 * Read-only operation receipts for allocation recovery. This route never
 * exposes provider errors or credentials; it only returns bounded lifecycle
 * metadata that lets a server-side caller decide whether it may reconcile.
 */
export const sandboxOperationRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);

  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const projectId = requireProjectId(auth);
    const operation = await db.sandboxAllocationOperation.findFirst({
      where: {
        id: c.req.param("id"),
        organizationId: auth.organizationId,
        projectId,
      },
    });
    if (
      !operation ||
      (!ORG_WIDE_ROLES.has(auth.role ?? "member") &&
        operation.requesterId !== auth.userId)
    ) {
      throw new ServiceError(
        "NOT_FOUND",
        "Sandbox allocation operation not found",
      );
    }
    return c.json({
      operationId: operation.id,
      idempotencyKey: operation.idempotencyKey,
      status: operation.status,
      sandboxId: operation.sandboxId ?? undefined,
      provider: operation.provider ?? undefined,
      errorCode: operation.errorCode ?? undefined,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    });
  });

  return app;
};
