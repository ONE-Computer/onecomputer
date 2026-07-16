"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Check, CheckCheck, ChevronDown, Clock, X } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Card, CardContent, CardTitle } from "@onecli/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@onecli/ui/components/collapsible";
import { Skeleton } from "@onecli/ui/components/skeleton";
import {
  type ApprovalRequest,
  type ApprovalSummary,
  list,
  summary,
} from "@/lib/api/approvals";

// ─── Action → human-readable label ────────────────────────────────────────────
// Maps the canonical capability string (e.g. "outlook.send_email") to a short
// phrase a manager can scan in one glance. Falls back to a cleaned-up form of
// the raw action for unknown capabilities.
const ACTION_LABELS: Record<string, string> = {
  "outlook.send_email": "Wants to send email",
  "outlook.send_email.create": "Wants to send email",
  "outlook.calendar_write": "Wants to create a calendar event",
  "outlook.calendar.write": "Wants to create a calendar event",
  "sharepoint.write": "Wants to write to SharePoint",
  "sharepoint.delete": "Wants to delete from SharePoint",
  "data.export": "Wants to export data",
  "data.export.large": "Wants to export a large dataset",
  "slack.send_message": "Wants to send a Slack message",
  "github.write": "Wants to write to a GitHub repo",
  "github.merge": "Wants to merge a pull request",
  "fs.delete": "Wants to delete a file",
  "fs.write": "Wants to write a file",
};

const humanAction = (action: string): string => {
  const exact = ACTION_LABELS[action];
  if (exact) return exact;
  // Heuristic: drop the provider prefix and title-case the rest.
  const dot = action.lastIndexOf(".");
  const tail = dot >= 0 ? action.slice(dot + 1) : action;
  return `Wants to ${tail.replace(/_/g, " ")}`;
};

// Agent display name — `requestedBy` is a userId or agentId. We show a
// shortened form; the backend doesn't currently join a name, so we derive a
// readable handle from the string.
const agentDisplay = (a: ApprovalRequest): string => {
  const by = a.requestedBy;
  if (!by) return "An agent";
  // If it looks like an id, shorten to first 6 chars; otherwise use as-is.
  return by.length > 12 ? `${by.slice(0, 6)}…` : by;
};

const initialOf = (name: string): string =>
  (name.trim()[0] ?? "?").toUpperCase();

// ─── Countdown ────────────────────────────────────────────────────────────────
// Pending approvals auto-deny after their `expiresAt` (24h TTL per the
// manager persona spec). We render a live countdown that ticks every 30s —
// precise enough for a review window without hammering re-renders.
const formatCountdown = (ms: number): string => {
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m left`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h left`;
};

const truncate = (s: unknown, n = 80): string => {
  if (typeof s !== "string") return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// ─── Pending card ──────────────────────────────────────────────────────────────

interface PendingCardProps {
  approval: ApprovalRequest;
}

function PendingCard({ approval }: PendingCardProps) {
  // Live countdown.
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const ctx = approval.context ?? {};
  const recipient =
    (ctx.recipient as string | undefined) ??
    (ctx.to as string | undefined) ??
    null;
  const subject =
    (ctx.subject as string | undefined) ??
    (ctx.title as string | undefined) ??
    null;
  const preview =
    (ctx.preview as string | undefined) ??
    (ctx.summary as string | undefined) ??
    null;

  const timeLeft = formatCountdown(
    new Date(approval.expiresAt).getTime() - now,
  );

  const agentName = agentDisplay(approval);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
            {initialOf(agentName)}
          </div>

          {/* Main */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-sm">{agentName}</span>
              <span className="text-muted-foreground text-sm">
                {humanAction(approval.action)}
              </span>
            </div>

            {/* Context preview */}
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {recipient && (
                <div>
                  <span className="text-foreground/70">To: </span>
                  {truncate(recipient, 60)}
                </div>
              )}
              {subject && (
                <div>
                  <span className="text-foreground/70">Subject: </span>
                  {truncate(subject, 80)}
                </div>
              )}
              {preview && (
                <div className="italic">{truncate(preview, 120)}</div>
              )}
              <div className="flex items-center gap-1 pt-0.5">
                <Clock className="size-3" />
                <span>{formatWhen(approval.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>{timeLeft}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 text-right">
            <Badge variant="outline" className="text-sky-600">
              OpenVTC Wallet required
            </Badge>
            <span className="max-w-40 text-[11px] text-muted-foreground">
              Read-only in ONEComputer
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Recent decision row ──────────────────────────────────────────────────────

function DecisionRow({ approval }: { approval: ApprovalRequest }) {
  const isApproved = approval.status === "approved";
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <span
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
          isApproved
            ? "bg-green-500/15 text-green-700 dark:text-green-400"
            : "bg-red-500/15 text-red-700 dark:text-red-400"
        }`}
      >
        {isApproved ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{agentDisplay(approval)}</span>{" "}
        <span className="text-muted-foreground">
          {humanAction(approval.action)}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {approval.decidedBy ? `by ${truncate(approval.decidedBy, 12)}` : ""}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatWhen(approval.updatedAt)}
      </span>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

interface ApprovalsContentProps {
  initialItems: ApprovalRequest[];
  summaryCounts: ApprovalSummary;
}

export function ApprovalsContent({
  initialItems,
  summaryCounts: initialSummary,
}: ApprovalsContentProps) {
  const [items, setItems] = useState<ApprovalRequest[]>(initialItems);
  const [summaryCounts, setSummaryCounts] =
    useState<ApprovalSummary>(initialSummary);
  const [recentOpen, setRecentOpen] = useState(false);
  const [now, setNow] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      mountedRef.current = false;
      clearInterval(clock);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [all, counts] = await Promise.all([list(undefined, 50), summary()]);
      if (!mountedRef.current) return;
      setItems(all.items);
      setSummaryCounts(counts);
    } catch {
      // Keep existing state on transient fetch errors.
    }
  }, []);

  // Poll for live updates after mount (manager queue is live). 15s cadence —
  // frequent enough to surface new agent requests promptly without thrash.
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // Split pending vs decided. Decided = approved or denied, newest first by
  // updatedAt. Pending = status === "pending", newest first by createdAt (the
  // list endpoint already orders by createdAt desc).
  const pending = useMemo(
    () => items.filter((i) => i.status === "pending"),
    [items],
  );
  const decided = useMemo(
    () =>
      items
        .filter((i) => i.status === "approved" || i.status === "denied")
        // Last 24h, newest first.
        .filter((i) => {
          const since = now - 24 * 60 * 60 * 1000;
          return new Date(i.updatedAt).getTime() >= since;
        })
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 10),
    [items, now],
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* A. Header with summary badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={pending.length > 0 ? "default" : "secondary"}
          className="gap-1"
        >
          {summaryCounts.pending} pending
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <Check className="size-3 text-green-600 dark:text-green-400" />
          {summaryCounts.approved24h} approved today
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <X className="size-3 text-red-600 dark:text-red-400" />
          {summaryCounts.denied24h} denied today
        </Badge>
      </div>

      {/* B. Pending queue */}
      {pending.length === 0 ? (
        // D. Empty state
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <CheckCheck className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No pending approvals</p>
              <p className="text-sm text-muted-foreground">
                Your team&apos;s agents are operating within policy.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((a) => (
            <PendingCard key={a.id} approval={a} />
          ))}
        </div>
      )}

      {/* C. Recent decisions (collapsed) */}
      {decided.length > 0 && (
        <Collapsible open={recentOpen} onOpenChange={setRecentOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recent decisions · last 24h
                </CardTitle>
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    recentOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y border-t">
                {decided.map((a) => (
                  <DecisionRow key={a.id} approval={a} />
                ))}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  );
}

// Loading skeleton used by Suspense fallback when this component suspends on
// initial server fetch.
export function ApprovalsSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
