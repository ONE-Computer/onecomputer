import { db, Prisma } from "@onecli/db";

export interface RequestLogEntry {
  id: string;
  agentId: string;
  agentName: string | null;
  method: string;
  host: string;
  path: string;
  provider: string;
  status: number;
  latencyMs: number;
  injectionCount: number;
  extraData: unknown;
  createdAt: string;
}

const DECISION_BLOCKED = "blocked";
const DECISION_RATE_LIMITED = "rate_limited";
const BLOCKED_BY_RULE_KEY = "blocked_by_rule";

export const isBlockedRequest = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === DECISION_BLOCKED;
};

export const isRateLimitedRequest = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === DECISION_RATE_LIMITED;
};

export const isOwnKey = (log: RequestLogEntry): boolean => {
  if (log.injectionCount !== 0) return false;
  const data = log.extraData as Record<string, unknown> | null;
  return !data?.decision;
};

export const isDefaultDenied = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === "blocked_by_default_policy";
};

export const getBlockedByRule = (log: RequestLogEntry): string | null => {
  const data = log.extraData as Record<string, unknown> | null;
  if (typeof data?.[BLOCKED_BY_RULE_KEY] === "string") {
    return data[BLOCKED_BY_RULE_KEY];
  }
  return null;
};

export type ApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "timed_out"
  | "cancelled";

export const getApprovalDecision = (
  log: RequestLogEntry,
): ApprovalDecision | null => {
  const data = log.extraData as Record<string, unknown> | null;
  const decision = data?.decision;
  if (decision === "approval_pending") return "pending";
  if (decision === "approval_approved") return "approved";
  if (decision === "approval_denied") {
    return data?.approval_reason === "timed out" ? "timed_out" : "denied";
  }
  if (decision === "approval_cancelled") return "cancelled";
  return null;
};

export const isApprovalPending = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === "approval_pending";
};

export const isApprovalDenied = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === "approval_denied";
};

export const isApprovalApproved = (log: RequestLogEntry): boolean => {
  const data = log.extraData as Record<string, unknown> | null;
  return data?.decision === "approval_approved";
};

export const getApprovalReason = (log: RequestLogEntry): string | null => {
  const data = log.extraData as Record<string, unknown> | null;
  const reason = data?.approval_reason;
  return typeof reason === "string" ? reason : null;
};

export const getConnectionLabel = (log: RequestLogEntry): string | null => {
  const data = log.extraData as Record<string, unknown> | null;
  const label = data?.connection_label;
  return typeof label === "string" ? label : null;
};

export interface RequestLogPage {
  logs: RequestLogEntry[];
  nextCursor: { createdAt: string; id: string } | null;
}

export interface ActivityPageParams {
  cursor?: { createdAt: string; id: string };
  limit?: number;
  statusFilter?: "all" | "errors";
}

const resolveAgentNames = async (
  projectId: string,
  agentIds: string[],
): Promise<Map<string, string>> => {
  if (agentIds.length === 0) return new Map();
  const agents = await db.agent.findMany({
    where: { id: { in: agentIds }, projectId },
    select: { id: true, name: true },
  });
  return new Map(agents.map((a) => [a.id, a.name]));
};

type RequestLogRow = Prisma.RequestLogGetPayload<object>;

const toEntry = (
  log: RequestLogRow,
  agentMap: Map<string, string>,
): RequestLogEntry => ({
  id: log.id,
  agentId: log.agentId,
  agentName: agentMap.get(log.agentId) ?? null,
  method: log.method,
  host: log.host,
  path: log.path,
  provider: log.provider,
  status: log.status,
  latencyMs: log.latencyMs,
  injectionCount: log.injectionCount,
  extraData: log.extraData,
  createdAt: log.createdAt.toISOString(),
});

// Count gateway-blocked requests in the last 24h. A request is "blocked" when
// its extraData.decision is "blocked" (rule or default-policy denial). We read
// the decision via a Postgres JSON path filter so we don't have to hydrate
// every row. Returns 0 on any error so the overview degrades to "--"→0
// gracefully instead of crashing the panel.
export const getBlockedRequestCount24h = async (
  projectId: string,
): Promise<number> => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await db.requestLog.count({
      where: {
        projectId,
        createdAt: { gte: since },
        // extraData.decision === "blocked" or "blocked_by_default_policy"
        OR: [
          {
            extraData: {
              path: ["decision"],
              equals: DECISION_BLOCKED,
            },
          },
          {
            extraData: {
              path: ["decision"],
              equals: "blocked_by_default_policy",
            },
          },
        ],
      },
    });
  } catch {
    return 0;
  }
};

// LLM traces: the subset of request_logs that are LLM calls. A request is
// treated as an LLM call when its host is the Anthropic API, when it was
// rewritten to the local LLM upstream (LiteLLM at 127.0.0.1:47821), or when
// it hits a /v1/messages path. This is the LLM-observability slice of the
// same Postgres-backed telemetry the gateway writes on every MITM intercept
// (see apps/gateway/src/telemetry.rs). The raw LiteLLM /v1/logs endpoint is
// NOT reachable from this VM — the pxpipe reverse tunnel only forwards
// /v1 chat-completion routes — so request_logs is the richest source here.

export interface LlmTraceEntry {
  id: string;
  agentId: string;
  agentName: string | null;
  method: string;
  host: string;
  path: string;
  provider: string;
  status: number;
  latencyMs: number;
  injectionCount: number;
  createdAt: string;
}

export const getLlmTraces = async (
  projectId: string,
  limit = 100,
): Promise<LlmTraceEntry[]> => {
  const capped = Math.min(limit, 500);
  // Filter in SQL so we don't hydrate non-LLM rows (graph.microsoft.com
  // tunnels, registry fetches, etc.). Hosts in request_logs carry the port
  // suffix (e.g. "api.anthropic.com:443", "127.0.0.1:47821").
  const logs = await db.requestLog.findMany({
    where: {
      projectId,
      OR: [
        { host: { contains: "anthropic" } },
        { host: { contains: "127.0.0.1:47821" } },
        { host: { contains: "localhost:47821" } },
        { path: { contains: "/v1/messages" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: capped,
  });

  const agentIds = [...new Set(logs.map((l) => l.agentId))];
  const agentMap = await resolveAgentNames(projectId, agentIds);

  return logs.map((l) => ({
    id: l.id,
    agentId: l.agentId,
    agentName: agentMap.get(l.agentId) ?? null,
    method: l.method,
    host: l.host,
    path: l.path,
    provider: l.provider,
    status: l.status,
    latencyMs: l.latencyMs,
    injectionCount: l.injectionCount,
    createdAt: l.createdAt.toISOString(),
  }));
};

export const getRecentRequestLogs = async (
  projectId: string,
  limit = 5,
): Promise<RequestLogEntry[]> => {
  const logs = await db.requestLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const agentIds = [...new Set(logs.map((l) => l.agentId))];
  const agentMap = await resolveAgentNames(projectId, agentIds);

  return logs.map((l) => toEntry(l, agentMap));
};

export const getRequestLogs = async (
  projectId: string,
  params: ActivityPageParams = {},
): Promise<RequestLogPage> => {
  const limit = Math.min(params.limit ?? 50, 200);
  const { cursor, statusFilter } = params;

  const where: Prisma.RequestLogWhereInput = { projectId };

  if (statusFilter === "errors") {
    where.status = { gte: 400 };
  }

  if (cursor) {
    where.OR = [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ];
  }

  const logs = await db.requestLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;

  const agentIds = [...new Set(page.map((l) => l.agentId))];
  const agentMap = await resolveAgentNames(projectId, agentIds);

  const lastLog = page[page.length - 1];
  const nextCursor =
    hasMore && lastLog
      ? { createdAt: lastLog.createdAt.toISOString(), id: lastLog.id }
      : null;

  return {
    logs: page.map((l) => toEntry(l, agentMap)),
    nextCursor,
  };
};
