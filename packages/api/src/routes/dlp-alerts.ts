import { Hono } from "hono";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  requireAbility,
  withAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { listDlpAlerts } from "../services/dlp-alert-service";

export const dlpAlertRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  app.use("*", withAbility);

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "DlpAlert");
    const projectId = requireProjectId(auth);
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || limit! <= 0)) {
      return c.json({ error: "limit must be a positive integer" }, 400);
    }
    const riskLevel = c.req.query("riskLevel") || undefined;
    const alerts = await listDlpAlerts({ projectId, limit, riskLevel });
    return c.json({ alerts });
  });

  return app;
};
