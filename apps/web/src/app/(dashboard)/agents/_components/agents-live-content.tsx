"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@dashboard/page-header";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card, CardContent } from "@onecli/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";
import {
  AgentControlWorkbench,
  type AgentControlRecord,
} from "./agent-control-workbench";
import { agentsApi, type AgentInfo } from "@/lib/api/agents";

const POLL_INTERVAL_MS = 10_000;

const mapToControlRecord = (agent: AgentInfo): AgentControlRecord => ({
  name: agent.name,
  kind: "Agent",
  tenant: agent.isDefault ? "Default" : "Custom",
  identity: agent.did ?? agent.identifier ?? agent.id,
  owner: "—",
  mandate: "—",
  computers: [],
  risk: "Medium",
  status: agent.isDefault ? "Default agent" : "Live",
  verifier: "—",
  policyHash: "pending",
  evidence: "pending",
});

const formatCreated = (createdAt?: string): string => {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString();
};

export const AgentsLiveContent = () => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const data = await agentsApi.list();
      setAgents(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    const interval = setInterval(() => void loadAgents(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAgents]);

  const controlRecords = agents.map(mapToControlRecord);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Agent Control Pane"
        description="Live inventory and control state for AI agents from /v1/agents. Identity, owner, mandate, linked computers, active grants, policy, response actions, and evidence."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadAgents()}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
        {/* RBAC: if ability.can('create', 'Agent') show New Agent.
            Sprint F (ability lib) not yet wired — show unconditionally for now. */}
        <Button size="sm">
          <Plus className="size-3.5" /> New Agent
        </Button>
      </div>

      {agents.length === 0 && !isLoading && !error ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <Bot className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No agents yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first agent to get started.
              </p>
            </div>
            {/* RBAC: if ability.can('create', 'Agent') show New Agent.
                Sprint F (ability lib) not yet wired — show unconditionally for now. */}
            <Button size="sm">
              <Plus className="size-3.5" /> New Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-5">
          {error ? (
            <div className="text-sm text-destructive">
              Failed to load agents: {error}
            </div>
          ) : isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading agents…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>DID</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {agent.identifier ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {agent.did ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatCreated(agent.createdAt)}
                    </TableCell>
                    <TableCell>
                      {agent.isDefault ? (
                        <Badge variant="secondary">Default</Badge>
                      ) : (
                        <Button size="sm" variant="ghost">
                          Manage
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <AgentControlWorkbench agents={controlRecords} />
    </div>
  );
};
