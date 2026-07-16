import { CheckCircle2, Gavel, ShieldAlert, XCircle } from "lucide-react";
import type { TimelineEvent } from "@/lib/api/audit";

// One-line human summary + icon/color per event kind, per the "Row shows a
// one-line human summary" spec. Kept as pure formatting logic (no JSX
// side-conditions) so audit-timeline.tsx and the detail sheet can share it.

interface KindStyle {
  icon: React.ComponentType<{ className?: string }>;
  dot: string; // background for the timeline dot
}

const KIND_STYLES: Record<TimelineEvent["kind"], KindStyle> = {
  gateway: { icon: ShieldAlert, dot: "bg-amber-500" },
  admin: { icon: Gavel, dot: "bg-blue-500" },
  approval: { icon: CheckCircle2, dot: "bg-purple-500" },
};

export const kindStyleFor = (kind: TimelineEvent["kind"]): KindStyle =>
  KIND_STYLES[kind];

const gatewaySummary = (e: Extract<TimelineEvent, { kind: "gateway" }>) => {
  const agent = e.agentName ?? e.agentId;
  const decision = e.decision ?? (e.status >= 400 ? "blocked" : "allowed");
  const suffix = e.ruleName ? ` (rule: ${e.ruleName})` : "";
  return `${agent} → ${e.method} ${e.host}${e.path} — ${decision}${suffix}`;
};

const adminSummary = (e: Extract<TimelineEvent, { kind: "admin" }>) =>
  `${e.actorEmail} ${e.action.toLowerCase()}d ${e.service.toLowerCase()}`;

const approvalSummary = (e: Extract<TimelineEvent, { kind: "approval" }>) => {
  const who = e.decidedBy ? ` by ${e.decidedBy}` : "";
  return `${e.requestedBy} requested ${e.action} — ${e.status}${who}`;
};

export const summaryFor = (event: TimelineEvent): string => {
  switch (event.kind) {
    case "gateway":
      return gatewaySummary(event);
    case "admin":
      return adminSummary(event);
    case "approval":
      return approvalSummary(event);
  }
};

export const isDenied = (event: TimelineEvent): boolean => {
  if (event.kind === "gateway") return event.status >= 400;
  if (event.kind === "approval") return event.status === "denied";
  return false;
};

interface AuditEventRowProps {
  event: TimelineEvent;
  onOpen: (event: TimelineEvent) => void;
}

export const AuditEventRow = ({ event, onOpen }: AuditEventRowProps) => {
  const { icon: Icon, dot } = kindStyleFor(event.kind);
  const denied = isDenied(event);

  return (
    <li className="relative flex gap-3 pb-6 pl-8 last:pb-0">
      {/* Vertical line */}
      <span
        aria-hidden
        className="absolute left-[9px] top-5 h-full w-px bg-border"
      />
      {/* Dot + icon */}
      <span
        className={`absolute left-0 top-0.5 flex size-[18px] items-center justify-center rounded-full ${dot}`}
      >
        <Icon className="size-3 text-white" />
      </span>

      <button
        type="button"
        onClick={() => onOpen(event)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{summaryFor(event)}</span>
          {denied && <XCircle className="size-3.5 shrink-0 text-destructive" />}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(event.ts).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
          {" · "}
          {event.kind}
        </span>
      </button>
    </li>
  );
};
