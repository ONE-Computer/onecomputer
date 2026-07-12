"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, FileText, Loader2, Radio, ShieldAlert } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card, CardContent } from "@onecli/ui/components/card";
import { PageHeader } from "@dashboard/page-header";
import { getActivityPage } from "@/lib/actions/request-logs";
import { ActivityTable } from "./activity-table";
import { ActivityDetailDialog } from "./activity-detail-dialog";
import type { RequestLogEntry } from "@onecli/api/services/request-log-service";

type StatusFilter = "all" | "errors";

const ActivityCommandBrief = ({
  totalLogs,
  blockedLogs,
  liveMode,
}: {
  totalLogs: number;
  blockedLogs: number;
  liveMode: boolean;
}) => (
  <Card className="p-4">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">Audit evidence stream</h2>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Gateway activity shows which agent called which provider, the control
          decision, latency, and status — without storing request bodies or
          query strings.
        </p>
      </div>
      <Badge variant={liveMode ? "secondary" : "outline"}>
        {liveMode ? "Live polling" : "Paused"}
      </Badge>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-[11px] text-muted-foreground">Loaded events</p>
        <p className="mt-1 text-lg font-semibold">{totalLogs}</p>
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-[11px] text-muted-foreground">Blocked/errors</p>
        <p className="mt-1 text-lg font-semibold">{blockedLogs}</p>
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-[11px] text-muted-foreground">Privacy stance</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
          <ShieldAlert className="size-3.5 text-brand" /> Bodies omitted
        </p>
      </div>
    </div>
  </Card>
);

export const ActivityContent = () => {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<{
    createdAt: string;
    id: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [liveMode, setLiveMode] = useState(true);
  const [selected, setSelected] = useState<RequestLogEntry | null>(null);
  const initializedRef = useRef(false);

  const loadInitial = useCallback(async (filter: StatusFilter) => {
    setLoading(true);
    try {
      const data = await getActivityPage({ statusFilter: filter });
      setLogs(data.logs);
      setNextCursor(data.nextCursor);
      initializedRef.current = true;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initializedRef.current = false;
    loadInitial(statusFilter);
  }, [statusFilter, loadInitial]);

  useEffect(() => {
    if (!liveMode || loading) return;
    const id = setInterval(async () => {
      if (!initializedRef.current) return;
      try {
        const data = await getActivityPage({ statusFilter });
        setLogs((prev) => {
          if (
            prev.length === data.logs.length &&
            prev[0]?.id === data.logs[0]?.id
          )
            return prev;
          return data.logs;
        });
        setNextCursor(data.nextCursor);
      } catch {
        // Best-effort polling — stale data shown until next successful tick
      }
    }, 3000);
    return () => clearInterval(id);
  }, [liveMode, statusFilter, loading]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLiveMode(false);
    setLoadingMore(true);
    try {
      const data = await getActivityPage({ cursor: nextCursor, statusFilter });
      setLogs((prev) => [...prev, ...data.logs]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        title="Activity"
        description="Audit evidence for agent requests, control decisions, and gateway outcomes."
      />
      <ActivityCommandBrief
        totalLogs={logs.length}
        blockedLogs={logs.filter((log) => log.status >= 400).length}
        liveMode={liveMode}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("errors")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === "errors"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Blocked
          </button>
        </div>

        <button
          type="button"
          onClick={() => setLiveMode((v) => !v)}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Radio
            className={`size-3.5 ${liveMode ? "text-green-500 animate-pulse" : "text-muted-foreground"}`}
          />
          Live
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <Activity className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No activity yet</p>
              <p className="text-sm text-muted-foreground">
                Agent activity will appear here once sandboxes are running.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ActivityTable logs={logs} onRowClick={setSelected} />

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <ActivityDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  );
};
