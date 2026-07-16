import { Hono } from "hono";
import { db } from "@onecli/db";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import {
  getSandboxProvider,
  type SandboxInfo,
} from "../services/sandbox-providers";

/**
 * Live CISO console routes — real org-wide data for the security operations
 * dashboard. One aggregated call so the page doesn't fan out to five
 * endpoints. Mounted under /v1/console-live.
 *
 * North star: the CISO answers "what is running?", "is anything bad
 * happening?", and "can I stop it?" from this one view. No sample data.
 */
export const consoleLiveRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  app.use("*", withAbility);

  // GET /console-live/overview — aggregates sandbox fleet, agent count,
  // rule summary, and recent policy violations into a single payload.
  app.get("/overview", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "Sandbox");
    requireAbility(ability, "read", "Agent");
    requireAbility(ability, "read", "PolicyRule");
    requireAbility(ability, "read", "RequestLog");

    const projectId = requireProjectId(auth);
    const organizationId = auth.organizationId;

    // Sandboxes — Daytona is an external dependency; degrade to empty fleet
    // when the control plane is down rather than 500 the whole console.
    let sandboxes: SandboxInfo[] = [];
    try {
      sandboxes = await getSandboxProvider().listSandboxes();
    } catch {
      // Daytona unreachable — show 0/0/0 so the console still renders.
    }
    const running = sandboxes.filter((s) => s.state === "started").length;
    const error = sandboxes.filter((s) => s.state === "error").length;

    // Agents — DB count for this project, plus the lightweight items the CISO
    // console needs to render per-agent kill-switch (revoke) controls.
    const agentsTotal = await db.agent.count({
      where: { projectId },
    });
    const agentFleetRows = await db.agent.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        identifier: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    const agentItems: ConsoleAgentItem[] = agentFleetRows.map((a) => ({
      id: a.id,
      name: a.name,
      identifier: a.identifier,
      isDefault: a.isDefault,
      createdAt: a.createdAt.toISOString(),
    }));

    // Rules — DB counts for this project + org-scoped rules, split by action.
    // block -> deny rules; manual_approval -> approval rules.
    const ruleWhere = {
      OR: [{ projectId }, { organizationId, scope: "organization" }],
    };
    const rulesTotal = await db.policyRule.count({ where: ruleWhere });
    const blockRules = await db.policyRule.count({
      where: { ...ruleWhere, action: "block" },
    });
    const approvalRules = await db.policyRule.count({
      where: { ...ruleWhere, action: "manual_approval" },
    });

    // Violations — RequestLog rows where the gateway decision was blocked,
    // last 24h. The decision lives in extraData.decision; we match the
    // "blocked" / "blocked_by_default_policy" values the gateway writes.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const blockedWhere = {
      projectId,
      createdAt: { gte: since },
      OR: [
        { extraData: { path: ["decision"], equals: "blocked" } },
        {
          extraData: {
            path: ["decision"],
            equals: "blocked_by_default_policy",
          },
        },
      ],
    };
    const violationsLast24h = await db.requestLog.count({
      where: blockedWhere,
    });

    // Recent 10 violations for the feed — resolve agent names for display.
    const recentLogs = await db.requestLog.findMany({
      where: blockedWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    });
    const agentIds = [
      ...new Set(recentLogs.map((l) => l.agentId).filter(Boolean)),
    ];
    const agentNameRows = await db.agent.findMany({
      where: { id: { in: agentIds }, projectId },
      select: { id: true, name: true },
    });
    const agentNames = new Map(agentNameRows.map((a) => [a.id, a.name]));

    const recent: RecentViolation[] = recentLogs.map((log) => {
      const data = (log.extraData as Record<string, unknown> | null) ?? {};
      const ruleName =
        (typeof data.blocked_by_rule === "string" && data.blocked_by_rule) ||
        (typeof data.rule === "string" && data.rule) ||
        "policy";
      const decision =
        typeof data.decision === "string" ? data.decision : "blocked";
      return {
        id: log.id,
        agentId: log.agentId || undefined,
        agentName: agentNames.get(log.agentId) ?? undefined,
        host: log.host,
        path: log.path,
        method: log.method,
        ruleName,
        status: `${log.status} ${decision}`,
        timestamp: log.createdAt.toISOString(),
      };
    });

    const overview: ConsoleOverview = {
      sandboxes: {
        total: sandboxes.length,
        running,
        error,
        items: sandboxes,
      },
      agents: { total: agentsTotal, items: agentItems },
      rules: {
        total: rulesTotal,
        blockRules,
        approvalRules,
      },
      violations: {
        last24h: violationsLast24h,
        recent,
      },
      lastUpdated: new Date().toISOString(),
    };

    return c.json(overview);
  });

  return app;
};

export type { SandboxInfo };

export interface ConsoleAgentItem {
  id: string;
  name: string;
  identifier: string;
  isDefault: boolean;
  createdAt: string;
}

export interface RecentViolation {
  id: string;
  agentId?: string;
  agentName?: string;
  host: string;
  path: string;
  method: string;
  ruleName: string;
  /** "<httpStatus> <decision>" e.g. "403 blocked". */
  status: string;
  timestamp: string;
}

export interface ConsoleOverview {
  sandboxes: {
    total: number;
    running: number;
    error: number;
    items: SandboxInfo[];
  };
  agents: {
    total: number;
    items: ConsoleAgentItem[];
  };
  rules: {
    total: number;
    blockRules: number;
    approvalRules: number;
  };
  violations: {
    last24h: number;
    recent: RecentViolation[];
  };
  lastUpdated: string;
}
