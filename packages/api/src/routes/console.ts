import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { buildCisoUserPrivacyConsolePayload } from "../services/ciso-privacy-console-service";

export const consoleRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) =>
    c.json({
      console: buildCisoUserPrivacyConsolePayload(),
      enforcement: "preview_only_not_persisted",
      next: "Render this in P6.2 CISO/User Privacy Console UI with screenshots.",
    }),
  );

  return app;
};
