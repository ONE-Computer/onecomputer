import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import {
  getAuditTimeline,
  exportAuditTimeline,
  type TimelineKind,
} from "../services/audit-timeline-service";
import { ServiceError } from "../services/errors";

// Unified evidence timeline for the Ops/Audit persona — read-only. Merges
// three existing, already-populated sources (does NOT create new logging):
//   - RequestLog:      gateway allow/block/approval decisions (routes/console-live.ts
//                       only ever surfaces the last-24h *blocked* subset of this;
//                       this endpoint is a proper cross-source superset)
//   - AuditLog:        admin/state-change events written via withAudit()
//   - ApprovalRequest: approval requests + decisions (+ VTI step-up)
//
// Mounted at /v1/audit in app.ts.
//   GET /audit/timeline — query: from, to (ISO), kind (gateway|admin|approval),
//                          agentId, limit (default 100, cap 500), cursor

const TIMELINE_KINDS = new Set<TimelineKind>(["gateway", "admin", "approval"]);

const isTimelineKind = (value: string): value is TimelineKind =>
  TIMELINE_KINDS.has(value as TimelineKind);

const parseDate = (
  value: string | undefined,
  field: string,
): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError("BAD_REQUEST", `${field} must be a valid ISO date`);
  }
  return parsed;
};

export const auditRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  app.use("*", withAbility);

  // GET /audit/timeline — RBAC: same gate as the console/audit reads
  // (RequestLog + AuditLog are both readable by owner/admin/manager; members
  // are restricted to their own AuditLog rows by defineAbilityFor). We check
  // both subjects so a role that can read one but not the other still gets a
  // clear 403 rather than a partially-filtered payload.
  app.get("/timeline", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "RequestLog");
    requireAbility(ability, "read", "AuditLog");
    requireAbility(ability, "read", "ApprovalRequest");

    const kindParam = c.req.query("kind");
    if (kindParam && !isTimelineKind(kindParam)) {
      return c.json(
        { error: "kind must be one of: gateway, admin, approval" },
        400,
      );
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || limit! <= 0)) {
      return c.json({ error: "limit must be a positive integer" }, 400);
    }

    const from = parseDate(c.req.query("from"), "from");
    const to = parseDate(c.req.query("to"), "to");

    const result = await getAuditTimeline({
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      from,
      to,
      kind: kindParam as TimelineKind | undefined,
      agentId: c.req.query("agentId") ?? undefined,
      limit,
      cursor: c.req.query("cursor") ?? undefined,
    });

    return c.json(result);
  });

  // GET /audit/timeline/export — same filters as /timeline (from, to, kind,
  // agentId) minus limit/cursor, but drains the whole matching slice (capped,
  // see EXPORT_MAX_EVENTS in the service) instead of one page, and returns it
  // as a downloadable JSON file rather than a paginated JSON body. Reuses the
  // 16-A timeline service — no new data source, no new logging.
  app.get("/timeline/export", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "RequestLog");
    requireAbility(ability, "read", "AuditLog");
    requireAbility(ability, "read", "ApprovalRequest");

    const kindParam = c.req.query("kind");
    if (kindParam && !isTimelineKind(kindParam)) {
      return c.json(
        { error: "kind must be one of: gateway, admin, approval" },
        400,
      );
    }

    const from = parseDate(c.req.query("from"), "from");
    const to = parseDate(c.req.query("to"), "to");
    const agentId = c.req.query("agentId") ?? undefined;

    const filter = {
      from: from?.toISOString(),
      to: to?.toISOString(),
      kind: kindParam as TimelineKind | undefined,
      agentId,
    };

    const { events, truncated } = await exportAuditTimeline({
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      from,
      to,
      kind: kindParam as TimelineKind | undefined,
      agentId,
    });

    const envelope = {
      exportedAt: new Date().toISOString(),
      filter,
      count: events.length,
      truncated,
      events,
    };

    const filename = `audit-timeline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    return c.body(JSON.stringify(envelope, null, 2), 200, {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    });
  });

  return app;
};
