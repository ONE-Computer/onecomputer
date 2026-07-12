import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  buildMailroomEvidenceManifest,
  normalizeInboundEmailToTrustTaskPreview,
  sampleM365AgentDirectoryPayload,
  sampleRevokedM365AgentDirectoryPayload,
} from "../services/m365-agent-directory-service";
import { mailroomNormalizePreviewSchema } from "../validations/m365-agent-directory";

export const m365AgentDirectoryRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) => c.json(sampleM365AgentDirectoryPayload()));
  app.get("/sample-revoked", (c) =>
    c.json(sampleRevokedM365AgentDirectoryPayload()),
  );

  app.post("/mailroom/normalize-preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = mailroomNormalizePreviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const sample = sampleM365AgentDirectoryPayload();
    const trustTask = normalizeInboundEmailToTrustTaskPreview({
      passport: sample.passport,
      email: parsed.data,
    });
    return c.json({
      trustTask,
      evidenceManifest: buildMailroomEvidenceManifest({
        passport: sample.passport,
        trustTask,
      }),
      enforcement: "preview_only_not_delivered",
      next: "Persist Agent Passport/projection state and wire Graph/Teams adapters after P4.",
    });
  });

  return app;
};
