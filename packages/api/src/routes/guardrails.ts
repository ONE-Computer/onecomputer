import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  buildGuardrailDecisionPreview,
  sampleGuardrailSimulatorPayload,
} from "../services/protective-guardrails-service";
import { simulateGuardrailSchema } from "../validations/protective-guardrail";

export const guardrailRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) => c.json(sampleGuardrailSimulatorPayload()));

  app.post("/simulate", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = simulateGuardrailSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    return c.json(
      buildGuardrailDecisionPreview(parsed.data.action, {
        previousHead: parsed.data.previousHead,
      }),
    );
  });

  return app;
};
