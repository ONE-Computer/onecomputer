import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  createReadOnlyPersonalConnectorGrant,
  samplePersonalConnectorRegistryPayload,
} from "../services/personal-connector-broker-service";
import { personalConnectorGrantPreviewSchema } from "../validations/personal-connector";

export const personalConnectorRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) => c.json(samplePersonalConnectorRegistryPayload()));

  app.post("/grants/preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = personalConnectorGrantPreviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    return c.json({
      grant: createReadOnlyPersonalConnectorGrant(parsed.data),
      enforcement: "preview_only_not_persisted",
      next: "Send consent/request to VTI/VTA before activation in P3",
    });
  });

  return app;
};
