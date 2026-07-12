"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  Eye,
  Loader2,
  Power,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@onecli/ui/components/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onecli/ui/components/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";
import { PageHeader } from "@dashboard/page-header";
import { formatRelative, formatUTC } from "@onecli/api/lib/format";
import { sandboxesApi } from "@/lib/api/sandboxes";
import { agentsApi } from "@/lib/api/agents";
import { useCanCyberAdmin } from "@/hooks/use-persona-role";

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const OVERVIEW_URL = "/v1/console-live/overview";

interface SandboxItem {
  id: string;
  name: string;
  state: string;
  toolboxUrl: string;
  claudeVersion?: string;
  bootstrapped: boolean;
  /** Optional associated agent id — present when a sandbox was spawned for a
   * specific agent. The kill switch revokes this agent's token after stopping
   * the sandbox. Null/absent when there is no agent link. */
  agentId?: string;
}

interface ConsoleAgentItem {
  id: string;
  name: string;
  identifier: string;
  isDefault: boolean;
  createdAt: string;
}

interface RecentViolation {
  id: string;
  agentId?: string;
  agentName?: string;
  host: string;
  path: string;
  method: string;
  ruleName: string;
  status: string;
  timestamp: string;
}

interface ConsoleOverview {
  sandboxes: {
    total: number;
    running: number;
    error: number;
    items: SandboxItem[];
  };
  agents: { total: number; items: ConsoleAgentItem[] };
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

// --- Fleet status bar ----------------------------------------------------

const STAT_CARD_BASE = "flex flex-col gap-1 rounded-lg border p-4";

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "red" | "amber" | "neutral";
}) {
  const toneClass = {
    green: "border-green-500/30 bg-green-500/5",
    red: "border-red-500/30 bg-red-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    neutral: "border-border bg-card",
  }[tone];
  const valueClass = {
    green: "text-green-700 dark:text-green-400",
    red: "text-red-700 dark:text-red-400",
    amber: "text-amber-700 dark:text-amber-400",
    neutral: "text-foreground",
  }[tone];
  return (
    <div className={`${STAT_CARD_BASE} ${toneClass}`}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function FleetStatusBar({ data }: { data: ConsoleOverview }) {
  const runningTone =
    data.sandboxes.running > 0 ? "green" : ("neutral" as const);
  const errorTone = data.sandboxes.error > 0 ? "red" : ("neutral" as const);
  const violationTone =
    data.violations.last24h > 0 ? "amber" : ("neutral" as const);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Sandboxes running"
        value={data.sandboxes.running}
        tone={runningTone}
      />
      <StatCard
        label="Sandboxes with errors"
        value={data.sandboxes.error}
        tone={errorTone}
      />
      <StatCard
        label="Agents active"
        value={data.agents.total}
        tone="neutral"
      />
      <StatCard
        label="Policy violations (24h)"
        value={data.violations.last24h}
        tone={violationTone}
      />
    </div>
  );
}

// --- Sandbox fleet table -------------------------------------------------

const STATE_BADGE: Record<string, { label: string; className: string }> = {
  started: {
    label: "Running",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  creating: {
    label: "Starting…",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
};

function StateBadge({ state }: { state: string }) {
  const cfg = STATE_BADGE[state] ?? STATE_BADGE["stopped"]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {state === "creating" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {cfg.label}
    </span>
  );
}

function exportEvidence(sandbox: SandboxItem) {
  const evidence = {
    exportedAt: new Date().toISOString(),
    sandbox: {
      id: sandbox.id,
      name: sandbox.name,
      state: sandbox.state,
      toolboxUrl: sandbox.toolboxUrl,
      claudeVersion: sandbox.claudeVersion ?? null,
      bootstrapped: sandbox.bootstrapped,
    },
    note: "Request log count and rule evaluation summary require per-sandbox endpoints not yet available (Sprint A).",
  };
  const blob = new Blob([JSON.stringify(evidence, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evidence-${sandbox.name}-${sandbox.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function KillDialog({
  sandbox,
  onConfirm,
}: {
  sandbox: SandboxItem;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <Power className="size-4 text-destructive" /> Kill sandbox
        </AlertDialogTitle>
        <AlertDialogDescription>
          This will immediately stop sandbox{" "}
          <span className="font-semibold text-foreground">{sandbox.name}</span>{" "}
          and revoke all access. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Stopping…
            </>
          ) : (
            "Kill sandbox"
          )}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function SandboxFleetTable({
  sandboxes,
  onKilled,
  onStatus,
  canCyberAdmin,
}: {
  sandboxes: SandboxItem[];
  onKilled: (id: string) => void;
  onStatus: (msg: string) => void;
  canCyberAdmin: boolean;
}) {
  const [killTarget, setKillTarget] = useState<SandboxItem | null>(null);

  const kill = async (sandbox: SandboxItem) => {
    // Kill switch — two levels:
    //   1. Stop the sandbox (DELETE /v1/sandboxes/:id).
    //   2. If a sandbox is associated with an agent, revoke that agent's
    //      access token (POST /v1/agents/:agentId/revoke) so it can no longer
    //      call the gateway. Best-effort: a revoke failure does not un-stop the
    //      sandbox.
    try {
      await sandboxesApi.delete(sandbox.id);
      onKilled(sandbox.id);

      if (sandbox.agentId) {
        try {
          await agentsApi.revoke(
            sandbox.agentId,
            `sandbox ${sandbox.id} killed via CISO console`,
          );
        } catch {
          /* revoke failed — sandbox is still stopped; surface below */
          onStatus(
            `Sandbox stopped, but agent revoke failed for ${sandbox.name}.`,
          );
          return;
        }
        onStatus("Sandbox stopped and agent access revoked");
      } else {
        onStatus(`Sandbox ${sandbox.name} stopped.`);
      }
    } catch {
      onStatus(`Failed to stop sandbox ${sandbox.name}.`);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">Sandbox fleet</h2>
          <Badge variant="outline" className="ml-auto">
            {sandboxes.length} total
          </Badge>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="w-24">State</TableHead>
            <TableHead className="w-44">Claude</TableHead>
            <TableHead className="w-28">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sandboxes.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="text-muted-foreground py-12 text-center text-sm"
              >
                No sandboxes. Daytona control plane may be unreachable.
              </TableCell>
            </TableRow>
          ) : (
            sandboxes.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {s.id.slice(0, 8)}…
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <StateBadge state={s.state} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.claudeVersion ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {/* View detail — not yet built, always disabled */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-not-allowed">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="pointer-events-none h-8 px-2"
                            disabled
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        View sandbox detail (Sprint A)
                      </TooltipContent>
                    </Tooltip>

                    {/* Kill sandbox — Cyber Admin only */}
                    {canCyberAdmin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        title="Kill sandbox"
                        onClick={() => setKillTarget(s)}
                      >
                        <Power className="size-3.5" />
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-not-allowed">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="pointer-events-none h-8 px-2 text-destructive"
                              disabled
                            >
                              <Power className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Requires Cyber Admin</TooltipContent>
                      </Tooltip>
                    )}

                    {/* Export evidence — Cyber Admin only */}
                    {canCyberAdmin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        title="Export evidence (JSON)"
                        onClick={() => exportEvidence(s)}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-not-allowed">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="pointer-events-none h-8 px-2"
                              disabled
                            >
                              <Download className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Requires Cyber Admin</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AlertDialog
        open={killTarget !== null}
        onOpenChange={(o) => !o && setKillTarget(null)}
      >
        {killTarget && (
          <KillDialog
            sandbox={killTarget}
            onConfirm={() => {
              const target = killTarget;
              setKillTarget(null);
              return kill(target);
            }}
          />
        )}
      </AlertDialog>
    </Card>
  );
}

// --- Agent fleet table (kill switch: revoke access) ---------------------

function RevokeAgentDialog({
  agent,
  onConfirm,
}: {
  agent: ConsoleAgentItem;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-destructive" /> Revoke agent
          access
        </AlertDialogTitle>
        <AlertDialogDescription>
          This instantly revokes the access token for agent{" "}
          <span className="font-semibold text-foreground">{agent.name}</span> (
          {agent.identifier}). It will no longer be able to authenticate to the
          gateway. This cannot be undone — rotate a new token from the Agents
          page to restore access.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Revoking…
            </>
          ) : (
            "Revoke access"
          )}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function AgentFleetTable({
  agents,
  onRevoked,
  onStatus,
  canCyberAdmin,
}: {
  agents: ConsoleAgentItem[];
  onRevoked: (id: string) => void;
  onStatus: (msg: string) => void;
  canCyberAdmin: boolean;
}) {
  const [revokeTarget, setRevokeTarget] = useState<ConsoleAgentItem | null>(
    null,
  );

  const revoke = async (agent: ConsoleAgentItem) => {
    // Standalone kill switch — revoke just the agent's access token.
    try {
      await agentsApi.revoke(agent.id, `revoked via CISO console by operator`);
      onRevoked(agent.id);
      onStatus(`Agent "${agent.name}" access revoked.`);
    } catch {
      onStatus(`Failed to revoke agent "${agent.name}".`);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">Agent fleet</h2>
          <Badge variant="outline" className="ml-auto">
            {agents.length} total
          </Badge>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="w-40">Identifier</TableHead>
            <TableHead className="w-28">Role</TableHead>
            <TableHead className="w-28">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="text-muted-foreground py-12 text-center text-sm"
              >
                No agents in this project.
              </TableCell>
            </TableRow>
          ) : (
            agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {a.id.slice(0, 8)}…
                    </p>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.identifier}
                </TableCell>
                <TableCell>
                  {a.isDefault ? (
                    <Badge variant="secondary">Default</Badge>
                  ) : (
                    <Badge variant="outline">Custom</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canCyberAdmin ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      title="Revoke agent access token"
                      onClick={() => setRevokeTarget(a)}
                    >
                      <ShieldAlert className="size-3.5" /> Revoke
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-not-allowed">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="pointer-events-none h-8 px-2 text-destructive"
                            disabled
                          >
                            <ShieldAlert className="size-3.5" /> Revoke
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Requires Cyber Admin</TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        {revokeTarget && (
          <RevokeAgentDialog
            agent={revokeTarget}
            onConfirm={() => {
              const target = revokeTarget;
              setRevokeTarget(null);
              return revoke(target);
            }}
          />
        )}
      </AlertDialog>
    </Card>
  );
}

// --- Violations feed -----------------------------------------------------

function ViolationsFeed({ violations }: { violations: RecentViolation[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-red-600" />
          <h2 className="text-sm font-semibold">Policy violations feed</h2>
          <a
            href="/activity?status=errors"
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            View full activity →
          </a>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">Time</TableHead>
            <TableHead className="w-32">Agent</TableHead>
            <TableHead className="max-w-[14rem]">Endpoint</TableHead>
            <TableHead className="w-36">Rule</TableHead>
            <TableHead className="w-28">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {violations.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-muted-foreground py-12 text-center text-sm"
              >
                No blocked requests in the last 24h.
              </TableCell>
            </TableRow>
          ) : (
            violations.map((v) => (
              <TableRow key={v.id} className="bg-red-500/[0.02]">
                <TableCell
                  className="text-xs text-muted-foreground tabular-nums"
                  title={`${formatUTC(v.timestamp)} (${localTz})`}
                >
                  {formatRelative(v.timestamp)}
                </TableCell>
                <TableCell>
                  <span className="block max-w-[8rem] truncate text-sm">
                    {v.agentName ?? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {v.agentId ? v.agentId.slice(0, 8) : "—"}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-red-700 dark:text-red-400">
                      {v.host.replace(/:(?:443|80)$/, "")}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {v.method} {v.path || "/"}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-amber-700 dark:text-amber-400">
                    {v.ruleName}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                    {v.status}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// --- Page ----------------------------------------------------------------

export function CisoConsoleLive() {
  const [data, setData] = useState<ConsoleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const canCyberAdmin = useCanCyberAdmin();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(OVERVIEW_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const overview: ConsoleOverview = await res.json();
      setData(overview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load console");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleKilled = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sandboxes: {
          ...prev.sandboxes,
          total: Math.max(0, prev.sandboxes.total - 1),
          running: Math.max(0, prev.sandboxes.running - 1),
          items: prev.sandboxes.items.filter((s) => s.id !== id),
        },
      };
    });
  }, []);

  const handleStatus = useCallback((msg: string) => {
    setStatus(msg);
    // Auto-clear the status banner after 6s so it doesn't linger.
    window.setTimeout(() => setStatus(null), 6_000);
  }, []);

  const handleAgentRevoked = useCallback((agentId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: {
          ...prev.agents,
          items: prev.agents.items.filter((a) => a.id !== agentId),
        },
      };
    });
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-x-hidden">
      <PageHeader
        title="CISO Console"
        description="Live org-wide view of the sandbox fleet, policy enforcement, and blocked requests. What is running, is anything bad happening, and can I stop it."
      />

      {loading && !data ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error && !data ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle className="size-4" /> Failed to load console: {error}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            Retry
          </Button>
        </Card>
      ) : data ? (
        <>
          {status && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
              <ShieldAlert className="size-4 text-brand" />
              <span>{status}</span>
            </div>
          )}

          <FleetStatusBar data={data} />

          <SandboxFleetTable
            sandboxes={data.sandboxes.items}
            onKilled={handleKilled}
            onStatus={handleStatus}
            canCyberAdmin={canCyberAdmin}
          />

          <AgentFleetTable
            agents={data.agents.items}
            onRevoked={handleAgentRevoked}
            onStatus={handleStatus}
            canCyberAdmin={canCyberAdmin}
          />

          <ViolationsFeed violations={data.violations.recent} />

          <p className="text-xs text-muted-foreground">
            Last updated {formatRelative(data.lastUpdated)}. Polls every 30s.
            {data.rules.total > 0 && (
              <>
                {" "}
                {data.rules.total} rules ({data.rules.blockRules} block,{" "}
                {data.rules.approvalRules} approval).
              </>
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}
