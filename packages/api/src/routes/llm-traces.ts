import { Hono } from "hono";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { getLlmTraces } from "../services/request-log-service";

// LLM traces — read-only LLM-observability view for the admin/CISO persona.
// Surfaces the LLM-call subset of the gateway's Postgres telemetry
// (request_logs): every MITM intercept of api.anthropic.com + the rewrite to
// the local LiteLLM upstream (127.0.0.1:47821), with timestamp, model/host,
// agent, status, latency. Source choice is documented in
// services/request-log-service.ts#getLlmTraces.
//
// Mounted at /v1/llm-traces in app.ts.
//   GET /llm-traces — query: limit (default 100, cap 500)

export const llmTracesRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  app.use("*", withAbility);

  // GET /llm-traces — RBAC: same gate as the audit timeline + activity reads
  // (RequestLog is readable by owner/admin/manager). Read-only by design —
  // there is no POST/PUT/DELETE here.
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "RequestLog");

    const projectId = requireProjectId(auth);

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || limit! <= 0)) {
      return c.json({ error: "limit must be a positive integer" }, 400);
    }

    const traces = await getLlmTraces(projectId, limit ?? 100);
    return c.json({ traces });
  });

  return app;
};
