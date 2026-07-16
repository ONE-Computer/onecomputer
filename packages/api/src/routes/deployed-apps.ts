import { Hono } from "hono";
import { db } from "@onecli/db";
import type { ApiEnv } from "../types";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import { logger } from "../lib/logger";

// GET /v1/apps/deployed — list apps deployed by this org/project
// Returns apps from the RequestLog + AuditLog evidence, plus any active ECS URLs
// stored in AppConfig (if exists) or fallback to empty list with mock example

export interface DeployedApp {
  id: string;
  name: string;
  type: "streamlit" | "react" | "node" | "python" | "unknown";
  status: "running" | "stopped" | "deploying" | "error";
  url?: string; // governed ECS URL if available
  owner: string; // user email or id
  dataClass: string; // e.g. "internal", "confidential"
  createdAt: string;
  evidenceHash?: string; // sha256 of evidence pack if available
}

const log = logger.child({ component: "deployed-apps" });

/**
 * Infer the deployed app type from a free-text hint (provider, name, or
 * metadata). Falls back to "unknown" when no signal is present.
 */
const inferAppType = (hint: string | null | undefined): DeployedApp["type"] => {
  const v = (hint ?? "").toLowerCase();
  if (v.includes("streamlit")) return "streamlit";
  if (v.includes("react") || v.includes("next")) return "react";
  if (v.includes("node") || v.includes("express")) return "node";
  if (v.includes("python") || v.includes("flask") || v.includes("fastapi")) {
    return "python";
  }
  return "unknown";
};

/**
 * Extract a governed ECS URL from a metadata blob. Looks for common key
 * names so we stay resilient to whatever the deploy step wrote.
 */
const extractUrl = (metadata: unknown): string | undefined => {
  if (!metadata || typeof metadata !== "object") return undefined;
  const m = metadata as Record<string, unknown>;
  const candidates = [
    "url",
    "ecsUrl",
    "endpoint",
    "serviceUrl",
    "deployedUrl",
    "publicUrl",
  ];
  for (const key of candidates) {
    const val = m[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
};

export const deployedAppsRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const projectId = requireProjectId(auth);

    try {
      // 1. Query AppConfig for deployed apps.
      //    AppConfig stores per-provider OAuth connector config (clientId /
      //    clientSecret / settings) and has no dedicated type/url columns for
      //    deployed apps, but a deploy step may have stashed an ECS URL inside
      //    the free-form `settings` JSON. Scan configs in this project whose
      //    settings carry a URL signal.
      const appConfigs = await db.appConfig.findMany({
        where: { projectId },
        select: {
          id: true,
          provider: true,
          settings: true,
          createdAt: true,
        },
      });

      const fromConfig: DeployedApp[] = appConfigs
        .map((cfg): DeployedApp | null => {
          const url = extractUrl(cfg.settings);
          // AppConfig is not a deploy record unless it carries a URL signal.
          if (!url) return null;
          const entry: DeployedApp = {
            id: cfg.id,
            name: cfg.provider,
            type: inferAppType(cfg.provider),
            status: "running",
            url,
            owner: auth.userEmail,
            dataClass: "internal",
            createdAt: cfg.createdAt.toISOString(),
          };
          return entry;
        })
        .filter((a): a is DeployedApp => a !== null);

      // 2. Query AuditLog for action="DEPLOY" (case-insensitive) events for
      //    this project. Each deploy event is one deployed app entry.
      const deployEvents = await db.auditLog.findMany({
        where: {
          projectId,
          action: { equals: "DEPLOY", mode: "insensitive" },
        },
        select: {
          id: true,
          action: true,
          service: true,
          status: true,
          userId: true,
          userEmail: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const seenIds = new Set(fromConfig.map((a) => a.id));
      const fromAudit: DeployedApp[] = [];

      for (const evt of deployEvents) {
        if (seenIds.has(evt.id)) continue;
        seenIds.add(evt.id);

        const meta = evt.metadata as unknown;
        const url = extractUrl(meta);
        const nameHint =
          (meta as Record<string, unknown> | null)?.name ?? evt.service;
        const dataClass =
          (meta as Record<string, unknown> | null)?.dataClass ?? "internal";
        const evidenceHash =
          typeof (meta as Record<string, unknown> | null)?.evidenceHash ===
          "string"
            ? ((meta as Record<string, unknown>).evidenceHash as string)
            : undefined;

        const status: DeployedApp["status"] =
          evt.status === "success" ? "running" : "error";

        fromAudit.push({
          id: evt.id,
          name: String(nameHint ?? evt.service ?? "deployed-app"),
          type: inferAppType(String(nameHint)),
          status,
          ...(url ? { url } : {}),
          owner: evt.userEmail || evt.userId,
          dataClass: String(dataClass),
          createdAt: evt.createdAt.toISOString(),
          ...(evidenceHash ? { evidenceHash } : {}),
        });
      }

      const apps = [...fromConfig, ...fromAudit];

      // 3. Neither AppConfig nor AuditLog had deploy evidence — return an empty
      //    array. Never fabricate mock data.
      return c.json({ apps });
    } catch (err) {
      log.error({ err, projectId }, "failed to list deployed apps");
      throw err;
    }
  });

  return app;
};
