import { db, Prisma } from "@onecli/db";

// ─── Unified audit timeline ────────────────────────────────────────────────
//
// Merges three existing, already-populated sources into one ordered feed for
// the Ops/Audit persona's defensible evidence trail. This does NOT create any
// new logging path — it joins:
//   - RequestLog:      gateway allow/block/approval decisions on outbound calls
//   - AuditLog:        admin/state-change events written via withAudit()
//   - ApprovalRequest: manager approval requests + decisions (+ VTI step-up)
//
// The console page (`routes/console-live.ts`) only ever shows the last 24h of
// *blocked* RequestLog rows. This timeline is a superset: all three sources,
// any status, filterable by kind/agent/time range, paginated.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Export is a bounded full-drain of the filtered slice (not a single page) —
// bounded so a pathological filter (e.g. no time window) can't hang the
// request or produce an unbounded response body.
const EXPORT_MAX_EVENTS = 5000;
const EXPORT_PAGE_SIZE = MAX_LIMIT;

export type TimelineKind = "gateway" | "admin" | "approval";

interface TimelineEventBase {
  id: string;
  kind: TimelineKind;
  ts: string; // ISO timestamp — sort key
}

export interface GatewayTimelineEvent extends TimelineEventBase {
  kind: "gateway";
  decision: string | null; // extraData.decision, e.g. "blocked", "approval_pending"
  host: string;
  path: string;
  method: string;
  agentId: string;
  agentName: string | null;
  ruleName: string | null; // extraData.blocked_by_rule / extraData.rule
  status: number;
}

export interface AdminTimelineEvent extends TimelineEventBase {
  kind: "admin";
  action: string;
  service: string;
  actorEmail: string;
  metadata: unknown;
}

export interface ApprovalTimelineEvent extends TimelineEventBase {
  kind: "approval";
  action: string;
  status: string; // "pending" | "approved" | "denied"
  requestedBy: string;
  decidedBy: string | null;
  vtiTaskHash?: string;
}

export type TimelineEvent =
  | GatewayTimelineEvent
  | AdminTimelineEvent
  | ApprovalTimelineEvent;

export interface TimelineQuery {
  organizationId: string;
  projectId?: string;
  from?: Date;
  to?: Date;
  kind?: TimelineKind;
  agentId?: string;
  limit?: number;
  cursor?: string; // opaque: `${epochMillis}:${id}` of the last event on the previous page
}

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: string | null;
}

interface DecodedCursor {
  ts: Date;
  id: string;
}

const decodeCursor = (cursor: string): DecodedCursor | null => {
  const idx = cursor.lastIndexOf(":");
  if (idx <= 0) return null;
  const millis = Number(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (!Number.isFinite(millis) || !id) return null;
  return { ts: new Date(millis), id };
};

const encodeCursor = (event: TimelineEvent): string =>
  `${new Date(event.ts).getTime()}:${event.id}`;

const extractString = (
  data: Record<string, unknown> | null | undefined,
  key: string,
): string | null => {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
};

// ─── Per-source fetchers ────────────────────────────────────────────────────
// Each fetcher applies the shared window/cursor/limit so we only hydrate what
// we might need for this page, then the caller merges + re-slices.

const fetchGatewayEvents = async (
  q: TimelineQuery,
  fetchLimit: number,
  cursor: DecodedCursor | null,
): Promise<GatewayTimelineEvent[]> => {
  if (!q.projectId) return [];

  const where: Prisma.RequestLogWhereInput = { projectId: q.projectId };
  if (q.agentId) where.agentId = q.agentId;

  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from) createdAt.gte = q.from;
  if (q.to) createdAt.lte = q.to;
  if (cursor) createdAt.lt = cursor.ts;
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

  const logs = await db.requestLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: fetchLimit,
  });

  const agentIds = [...new Set(logs.map((l) => l.agentId).filter(Boolean))];
  const agentMap = agentIds.length
    ? new Map(
        (
          await db.agent.findMany({
            where: { id: { in: agentIds }, projectId: q.projectId },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      )
    : new Map<string, string>();

  return logs.map((log) => {
    const data = (log.extraData as Record<string, unknown> | null) ?? null;
    return {
      id: log.id,
      kind: "gateway",
      ts: log.createdAt.toISOString(),
      decision: extractString(data, "decision"),
      host: log.host,
      path: log.path,
      method: log.method,
      agentId: log.agentId,
      agentName: agentMap.get(log.agentId) ?? null,
      ruleName:
        extractString(data, "blocked_by_rule") ?? extractString(data, "rule"),
      status: log.status,
    };
  });
};

const fetchAdminEvents = async (
  q: TimelineQuery,
  fetchLimit: number,
  cursor: DecodedCursor | null,
): Promise<AdminTimelineEvent[]> => {
  const where: Prisma.AuditLogWhereInput = {
    organizationId: q.organizationId,
  };
  if (q.projectId) where.projectId = q.projectId;
  if (q.agentId) {
    // AuditLog has no dedicated agentId column — agent-scoped admin actions
    // (e.g. agent create/delete/revoke) stash it in metadata.agentId.
    where.metadata = { path: ["agentId"], equals: q.agentId };
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from) createdAt.gte = q.from;
  if (q.to) createdAt.lte = q.to;
  if (cursor) createdAt.lt = cursor.ts;
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

  const logs = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: fetchLimit,
  });

  return logs.map((log) => ({
    id: log.id,
    kind: "admin",
    ts: log.createdAt.toISOString(),
    action: log.action,
    service: log.service,
    actorEmail: log.userEmail,
    metadata: log.metadata,
  }));
};

const fetchApprovalEvents = async (
  q: TimelineQuery,
  fetchLimit: number,
  cursor: DecodedCursor | null,
): Promise<ApprovalTimelineEvent[]> => {
  const where: Prisma.ApprovalRequestWhereInput = {
    organizationId: q.organizationId,
  };
  if (q.projectId) where.projectId = q.projectId;
  if (q.agentId) where.agentId = q.agentId;

  // Approval requests don't have a single canonical "event timestamp" the way
  // RequestLog/AuditLog do — a decided request's most audit-relevant moment
  // is when it was last updated (created for pending, decided for resolved).
  // We use updatedAt so the timeline reflects decisions, not just creation.
  const updatedAt: Prisma.DateTimeFilter = {};
  if (q.from) updatedAt.gte = q.from;
  if (q.to) updatedAt.lte = q.to;
  if (cursor) updatedAt.lt = cursor.ts;
  if (Object.keys(updatedAt).length > 0) where.updatedAt = updatedAt;

  const requests = await db.approvalRequest.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: fetchLimit,
  });

  return requests.map((req) => {
    const context = (req.context as Record<string, unknown> | null) ?? null;
    const vti = context?._vti as Record<string, unknown> | undefined;
    const vtiTaskHash =
      typeof vti?.taskHash === "string" ? vti.taskHash : undefined;
    return {
      id: req.id,
      kind: "approval",
      ts: req.updatedAt.toISOString(),
      action: req.action,
      status: req.status,
      requestedBy: req.requestedBy,
      decidedBy: req.decidedBy,
      ...(vtiTaskHash ? { vtiTaskHash } : {}),
    };
  });
};

// ─── Merge ───────────────────────────────────────────────────────────────────

/**
 * Fetch a single ordered (desc by ts), paginated timeline merged from
 * RequestLog + AuditLog + ApprovalRequest. Each source is fetched independently
 * with the same window/cursor/limit, then merged and re-sliced client-side —
 * simplest correct approach for three heterogeneous Prisma models without a
 * shared table/view.
 */
export const getAuditTimeline = async (
  q: TimelineQuery,
): Promise<TimelinePage> => {
  const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;

  // Overfetch per source by `limit` (not limit+1) since we don't know ahead
  // of time how the three sources interleave; we detect "hasMore" per source
  // by fetching limit+1 rows so we only include a source's contribution to the
  // synthetic hasMore flag when it actually had more beyond what we're taking.
  const fetchLimit = limit + 1;

  const sources: Array<Promise<TimelineEvent[]>> = [];
  if (!q.kind || q.kind === "gateway") {
    sources.push(fetchGatewayEvents(q, fetchLimit, cursor));
  }
  if (!q.kind || q.kind === "admin") {
    sources.push(fetchAdminEvents(q, fetchLimit, cursor));
  }
  if (!q.kind || q.kind === "approval") {
    sources.push(fetchApprovalEvents(q, fetchLimit, cursor));
  }

  const results = await Promise.all(sources);
  const merged = results
    .flat()
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const hasMore = merged.length > limit;
  const page = hasMore ? merged.slice(0, limit) : merged;
  const lastEvent = page[page.length - 1];
  const nextCursor = hasMore && lastEvent ? encodeCursor(lastEvent) : null;

  return { events: page, nextCursor };
};

// ─── Export ─────────────────────────────────────────────────────────────────

export type TimelineExportQuery = Omit<TimelineQuery, "limit" | "cursor">;

/**
 * Drain the same filtered timeline (same query params as getAuditTimeline,
 * minus limit/cursor which the caller doesn't control for an export) across
 * as many pages as needed, capped at EXPORT_MAX_EVENTS so an unfiltered
 * export can't balloon into an unbounded response. Used by the evidence
 * export route (GET /v1/audit/timeline/export) — no new data source, just a
 * bulk read over the same three-source join.
 */
export const exportAuditTimeline = async (
  q: TimelineExportQuery,
): Promise<{ events: TimelineEvent[]; truncated: boolean }> => {
  const events: TimelineEvent[] = [];
  let cursor: string | undefined;
  let truncated = false;

  for (;;) {
    const page = await getAuditTimeline({
      ...q,
      limit: EXPORT_PAGE_SIZE,
      cursor,
    });
    events.push(...page.events);

    if (events.length >= EXPORT_MAX_EVENTS) {
      truncated = events.length > EXPORT_MAX_EVENTS || Boolean(page.nextCursor);
      events.length = EXPORT_MAX_EVENTS;
      break;
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return { events, truncated };
};
