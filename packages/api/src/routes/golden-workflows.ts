import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { buildExecutiveBriefingWorkflowContract } from "../services/executive-briefing-workflow-service";
import { buildGoldenWorkflowEvidenceIndex } from "../services/golden-workflow-evidence-service";
import { buildLegalMfaReviewerWorkflowContract } from "../services/legal-mfa-workflow-service";

export const goldenWorkflowRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) => {
    const legalMfa = buildLegalMfaReviewerWorkflowContract();
    const executiveBriefing = buildExecutiveBriefingWorkflowContract();
    return c.json({
      workflows: {
        legalMfa,
        executiveBriefing,
      },
      evidenceIndex: buildGoldenWorkflowEvidenceIndex({
        legalMfa,
        executiveBriefing,
      }),
      enforcement: "preview_only_not_executed",
      next: "Expose these workflows in CISO/User Privacy Console during P6.",
    });
  });

  return app;
};
