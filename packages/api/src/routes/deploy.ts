import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { ApiEnv } from "../types";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import { logger } from "../lib/logger";

/**
 * Deploy route — POST /v1/apps/deploy
 *
 * This is the API stub for the deploy wizard. It accepts the three governance
 * answers (owner, data classification, intended users) plus the source URL and
 * detected app type, validates them, and queues a "deploy" job.
 *
 * NOTE: This endpoint does NOT execute a real ECS deploy. The actual container
 * rollout is performed by scripts/secure-apps/deploy-ecs-express-sandbox.sh,
 * which is wired into this route in a later sprint. For now we acknowledge the
 * request, mint a jobId, and return "deploying" so the wizard can surface a
 * queued status to the operator. Persisting the job and polling its progress is
 * also deferred.
 */

const log = logger.child({ component: "deploy" });

export type DeployAppType = "streamlit" | "react" | "node" | "python";

export type DeployDataClass =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

interface DeployRequestBody {
  sourceUrl?: unknown;
  appType?: unknown;
  owner?: unknown;
  dataClass?: unknown;
  users?: unknown;
}

interface DeployResponse {
  ok: true;
  jobId: string;
  status: "deploying";
  message: string;
}

const APP_TYPES: readonly DeployAppType[] = [
  "streamlit",
  "react",
  "node",
  "python",
];

const DATA_CLASSES: readonly DeployDataClass[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

export const deployRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  // POST / — queue a deploy from the wizard.
  app.post("/", async (c) => {
    const auth = c.get("auth");
    // Touch the project id so a missing X-Project-Id header fails closed with
    // a clear 400 instead of silently proceeding.
    requireProjectId(auth);

    const body = (await c.req
      .json()
      .catch(() => null)) as DeployRequestBody | null;

    const { sourceUrl, appType, owner, dataClass, users } = body ?? {};

    // --- Validate ----------------------------------------------------------
    if (!isNonEmptyString(sourceUrl)) {
      return c.json({ error: "sourceUrl is required" }, 400);
    }
    if (
      !isNonEmptyString(appType) ||
      !APP_TYPES.includes(appType as DeployAppType)
    ) {
      return c.json(
        {
          error: `appType must be one of: ${APP_TYPES.join(", ")}`,
        },
        400,
      );
    }
    if (!isNonEmptyString(owner)) {
      return c.json({ error: "owner is required" }, 400);
    }
    if (
      !isNonEmptyString(dataClass) ||
      !DATA_CLASSES.includes(dataClass as DeployDataClass)
    ) {
      return c.json(
        {
          error: `dataClass must be one of: ${DATA_CLASSES.join(", ")}`,
        },
        400,
      );
    }
    // `users` is optional free text ("Finance team"); when present it must be a
    // non-empty string.
    if (users !== undefined && !isNonEmptyString(users)) {
      return c.json(
        { error: "users must be a non-empty string when provided" },
        400,
      );
    }

    // --- Queue (stub) ------------------------------------------------------
    // Real execution is performed by
    // scripts/secure-apps/deploy-ecs-express-sandbox.sh and will be wired here
    // in a later sprint. For now mint a job id and return "deploying".
    const jobId = randomUUID();
    log.info(
      {
        jobId,
        projectId: auth.projectId,
        sourceUrl,
        appType,
        owner,
        dataClass,
        users: users ?? null,
      },
      "deploy queued (stub)",
    );

    const response: DeployResponse = {
      ok: true,
      jobId,
      status: "deploying",
      message: "Deploy queued",
    };
    return c.json(response, 202);
  });

  return app;
};
