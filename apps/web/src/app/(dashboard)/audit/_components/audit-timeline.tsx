"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, ScrollText } from "lucide-react";
import { Button } from "@onecli/ui/components/button";
import { Card, CardContent } from "@onecli/ui/components/card";
import { getAuditTimeline, exportAuditTimeline } from "@/lib/api/audit";
import type { TimelineEvent } from "@/lib/api/audit";
import {
  AuditFilters,
  type AuditFiltersState,
  type TimeRange,
} from "./audit-filters";
import { AuditEventRow, summaryFor } from "./audit-event-row";
import { AuditDetailSheet } from "./audit-detail-sheet";

const RANGE_MS: Record<TimeRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const DEFAULT_FILTERS: AuditFiltersState = {
  range: "24h",
  kind: "all",
  agentId: "",
  query: "",
};

export const AuditTimeline = () => {
  const [filters, setFilters] = useState<AuditFiltersState>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - RANGE_MS[filters.range]).toISOString();
      const page = await getAuditTimeline({
        from,
        kind: filters.kind === "all" ? undefined : filters.kind,
        agentId: filters.agentId.trim() || undefined,
        limit: 100,
      });
      setEvents(page.events);
      setNextCursor(page.nextCursor);
    } catch {
      setEvents([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [filters.range, filters.kind, filters.agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const from = new Date(Date.now() - RANGE_MS[filters.range]).toISOString();
      const page = await getAuditTimeline({
        from,
        kind: filters.kind === "all" ? undefined : filters.kind,
        agentId: filters.agentId.trim() || undefined,
        limit: 100,
        cursor: nextCursor,
      });
      setEvents((prev) => [...prev, ...page.events]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  // Free-text filter applied client-side over the loaded page (the API
  // doesn't index a free-text search across three heterogeneous sources).
  const visibleEvents = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => summaryFor(e).toLowerCase().includes(q));
  }, [events, filters.query]);

  // Exports the CURRENTLY FILTERED slice (same query params as the on-screen
  // load()) via GET /v1/audit/timeline/export, which drains the whole
  // matching set server-side (not just the loaded page) and streams it back
  // as a downloadable JSON file — see routes/audit.ts.
  const handleExport = async () => {
    setExporting(true);
    try {
      const from = new Date(Date.now() - RANGE_MS[filters.range]).toISOString();
      const res = await exportAuditTimeline({
        from,
        kind: filters.kind === "all" ? undefined : filters.kind,
        agentId: filters.agentId.trim() || undefined,
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `audit-timeline-${Date.now()}.json`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort UX affordance — no toast system wired here; a failed
      // export simply doesn't download anything.
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AuditFilters value={filters} onChange={setFilters} />
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Export evidence (JSON)
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : visibleEvents.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <ScrollText className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No audit events in this window.</p>
              <p className="text-sm text-muted-foreground">
                Try widening the time range or clearing filters.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-4">
          <ol className="flex flex-col">
            {visibleEvents.map((event) => (
              <AuditEventRow
                key={`${event.kind}:${event.id}`}
                event={event}
                onOpen={setSelected}
              />
            ))}
          </ol>
        </Card>
      )}

      {nextCursor && !loading && (
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

      <AuditDetailSheet event={selected} onClose={() => setSelected(null)} />
    </div>
  );
};
