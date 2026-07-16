import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import { invalidateGatewayCache } from "../lib/gateway-invalidate";
import {
  listSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
} from "../services/secret-service";
import { createSecretSchema, updateSecretSchema } from "../validations/secret";
import { getResourceHooks } from "../providers";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";

export const secretRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  // GET /secrets
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const secrets = await listSecrets({
      projectId: requireProjectId(auth),
      organizationId: auth.organizationId,
    });
    return c.json(secrets);
  });

  // POST /secrets
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => null);
    const parsed = createSecretSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    await getResourceHooks().beforeCreateSecret(auth.organizationId);

    const projectId = requireProjectId(auth);
    const secret = await withAudit(
      () => createSecret({ projectId }, parsed.data),
      (result) => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CREATE,
        service: AUDIT_SERVICES.SECRET,
        source: AUDIT_SOURCE.API,
        metadata: { secretId: result.id, name: parsed.data.name },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.json(secret, 201);
  });

  // PATCH /secrets/:secretId
  app.patch("/:secretId", async (c) => {
    const auth = c.get("auth");
    const secretId = c.req.param("secretId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateSecretSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    await withAudit(
      () => updateSecret({ projectId }, secretId, parsed.data),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.SECRET,
        source: AUDIT_SOURCE.API,
        metadata: { secretId },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.json({ success: true });
  });

  // DELETE /secrets/:secretId
  app.delete("/:secretId", async (c) => {
    const auth = c.get("auth");
    const secretId = c.req.param("secretId");
    const projectId = requireProjectId(auth);
    await withAudit(
      () => deleteSecret({ projectId }, secretId),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.DELETE,
        service: AUDIT_SERVICES.SECRET,
        source: AUDIT_SOURCE.API,
        metadata: { secretId },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.body(null, 204);
  });

  return app;
};
