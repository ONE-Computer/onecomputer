import { apiFetch } from "@/lib/api-fetch";
import { apiGet } from "./client";

// Mirrors packages/api/src/services/audit-timeline-service.ts. Merges three
// already-populated sources (RequestLog, AuditLog, ApprovalRequest) into one
// ordered evidence feed for the Ops/Audit persona — see routes/audit.ts.

export type TimelineKind = "gateway" | "admin" | "approval";

interface TimelineEventBase {
  id: string;
  ts: string; // ISO timestamp
}

export interface GatewayTimelineEvent extends TimelineEventBase {
  kind: "gateway";
  decision: string | null;
  host: string;
  path: string;
  method: string;
  agentId: string;
  agentName: string | null;
  ruleName: string | null;
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
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  vtiTaskHash?: string;
}

export type TimelineEvent =
  | GatewayTimelineEvent
  | AdminTimelineEvent
  | ApprovalTimelineEvent;

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: string | null;
}

export interface TimelineQueryParams {
  from?: string; // ISO
  to?: string; // ISO
  kind?: TimelineKind;
  agentId?: string;
  limit?: number;
  cursor?: string;
}

// GET /v1/audit/timeline
export const getAuditTimeline = (params: TimelineQueryParams = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.kind) qs.set("kind", params.kind);
  if (params.agentId) qs.set("agentId", params.agentId);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString();
  return apiGet<TimelinePage>(
    `/v1/audit/timeline${suffix ? `?${suffix}` : ""}`,
  );
};

// GET /v1/audit/timeline/export — same filter shape as getAuditTimeline
// (minus limit/cursor: the export drains the whole filtered slice server-side,
// see EXPORT_MAX_EVENTS in audit-timeline-service.ts). Returns the raw Response
// so the caller can stream it straight into a file download without buffering
// the JSON body through an intermediate parse/stringify round-trip.
export interface TimelineExportParams {
  from?: string;
  to?: string;
  kind?: TimelineKind;
  agentId?: string;
}

export const exportAuditTimeline = (params: TimelineExportParams = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.kind) qs.set("kind", params.kind);
  if (params.agentId) qs.set("agentId", params.agentId);
  const suffix = qs.toString();
  return apiFetch(`/v1/audit/timeline/export${suffix ? `?${suffix}` : ""}`);
};
