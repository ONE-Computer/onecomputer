import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../types";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import { IS_CLOUD } from "../lib/env";
import { exportToCloud } from "../services/migrate-export-service";
import { logger } from "../lib/logger";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";

const CLOUD_API_URL = "https://api.onecli.sh";

const exportSchema = z.object({
  cloudApiKey: z.string().min(1, "Cloud API key is required"),
  cloudUrl: z.string().url().optional(),
});

export const migrateRoutes = () => {
  const app = new Hono<ApiEnv>();

  // POST /migrate/export
  app.post("/export", authMiddleware, async (c) => {
    if (IS_CLOUD) {
      return c.json({ error: "Not found" }, 404);
    }

    const auth = c.get("auth");
    const projectId = requireProjectId(auth);

    const body = await c.req.json().catch(() => null);
    const parsed = exportSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const cloudUrl = parsed.data.cloudUrl ?? CLOUD_API_URL;
    // Audited as PROJECT/CONNECT: this pushes the project's secrets, agents,
    // and rules to an external cloud API — a security-sensitive, user-
    // triggered export, not an internal/background op. Never log
    // cloudApiKey or secret values in metadata.
    const result = await withAudit(
      () => exportToCloud(projectId, parsed.data.cloudApiKey, cloudUrl),
      (exportResult) => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CONNECT,
        service: AUDIT_SERVICES.PROJECT,
        source: AUDIT_SOURCE.API,
        metadata: { cloudUrl, imported: { ...exportResult.imported } },
      }),
    );

    logger.info(
      { projectId, imported: result.imported },
      "migration export completed",
    );

    return c.json(result);
  });

  return app;
};
