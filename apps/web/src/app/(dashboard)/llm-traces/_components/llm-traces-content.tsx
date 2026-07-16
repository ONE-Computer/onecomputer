"use client";

import { useEffect, useState } from "react";
import { Loader2, BrainCircuit } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";
import { PageHeader } from "@dashboard/page-header";
import { getLlmTracesPage } from "@/lib/actions/llm-traces";
import type { LlmTraceEntry } from "@onecli/api/services/request-log-service";
import { formatRelative, formatUTC } from "@onecli/api/lib/format";

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Derive a short "model" label for display. The gateway rewrites Anthropic
// calls to the local LiteLLM upstream; request_logs stores host/provider, not
// the requested model name, so we surface the upstream host as the model hint
// (api.anthropic.com for direct, 127.0.0.1:47821 for the LiteLLM rewrite).
const modelLabel = (trace: LlmTraceEntry): string => {
  if (trace.host.includes("anthropic")) return "claude (anthropic)";
  if (trace.host.includes("47821")) return "litellm upstream";
  return trace.provider || trace.host;
};

const statusVariant = (
  status: number,
): "default" | "secondary" | "destructive" | "outline" => {
  if (status >= 500) return "destructive";
  if (status >= 400) return "destructive";
  if (status >= 200 && status < 300) return "default";
  return "secondary";
};

const LlmTracesTable = ({ traces }: { traces: LlmTraceEntry[] }) => (
  <div className="rounded-lg border overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[7.5rem]">Timestamp</TableHead>
          <TableHead className="w-[10rem]">Model</TableHead>
          <TableHead className="w-[9rem]">Agent</TableHead>
          <TableHead className="w-[5rem]">Method</TableHead>
          <TableHead className="max-w-[16rem]">Endpoint</TableHead>
          <TableHead className="w-[5rem]">Status</TableHead>
          <TableHead className="w-[5rem] text-right">Latency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {traces.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={7}
              className="text-muted-foreground py-8 text-center text-sm"
            >
              No LLM calls intercepted yet. Trigger a call through the gateway
              (e.g. run Claude Code with the gateway MITM active) and refresh.
            </TableCell>
          </TableRow>
        ) : (
          traces.map((trace) => (
            <TableRow key={trace.id}>
              <TableCell
                title={`${formatUTC(trace.createdAt)} (${localTz})`}
                className="text-muted-foreground text-xs tabular-nums"
              >
                {formatRelative(trace.createdAt)}
              </TableCell>
              <TableCell className="text-xs">{modelLabel(trace)}</TableCell>
              <TableCell className="text-xs">
                {trace.agentName ?? trace.agentId.slice(0, 8)}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {trace.method}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {trace.host}
                {trace.path}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(trace.status)}>
                  {trace.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {trace.latencyMs > 0 ? `${trace.latencyMs}ms` : "—"}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  </div>
);

export const LlmTracesContent = () => {
  const [traces, setTraces] = useState<LlmTraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLlmTracesPage(100);
      setTraces(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load traces");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="LLM Traces"
        description="Recent LLM calls MITM-intercepted by the gateway and rewritten to LiteLLM. Read-only."
      />
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Source: gateway request_logs telemetry (Postgres). LiteLLM /v1/logs is
          not reachable from this VM via the pxpipe tunnel.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-2 size-3.5 animate-spin" />
          ) : (
            <BrainCircuit className="mr-2 size-3.5" />
          )}
          Refresh
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        <LlmTracesTable traces={traces} />
      )}
    </div>
  );
};
