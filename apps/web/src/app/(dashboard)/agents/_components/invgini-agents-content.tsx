"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileText,
  Fingerprint,
  Gauge,
  KeyRound,
  Layers3,
  Loader2,
  Network,
  PackageCheck,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { PageHeader } from "@dashboard/page-header";
import {
  useCreateInvginiControlAction,
  useInvginiEvidencePack,
  useInvginiAgents,
  useResolveInvginiControlAction,
} from "@/hooks/use-invgini-agents";
import type {
  CreateInvginiControlActionInput,
  InvginiAgentActionReceipt,
  InvginiAgentActionRequest,
  InvginiAgentControlActionName,
  InvginiAgentEvidencePack,
  InvginiAgentEventLog,
  InvginiAgentRegistryEntry,
  InvginiAgentResourceGrant,
  InvginiVtiBridgeMetadata,
  ResolveInvginiControlActionInput,
} from "@/lib/api/invgini";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { Input } from "@onecli/ui/components/input";
import { Progress } from "@onecli/ui/components/progress";
import { Separator } from "@onecli/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";

const shortDid = (did: string) => {
  const suffix = did.split(":").at(-1) ?? did;
  return suffix.length > 14
    ? `${suffix.slice(0, 6)}…${suffix.slice(-6)}`
    : suffix;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatResource = (resource: Record<string, unknown>) => {
  const opaqueHandle = resource.opaqueHandle;
  if (opaqueHandle && typeof opaqueHandle === "object") {
    const id = (opaqueHandle as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id;
  }

  const preferredKeys = [
    "name",
    "path",
    "url",
    "opaqueHandle",
    "opaque_handle",
    "project_id",
    "projectId",
    "resource_id",
    "resourceId",
    // Raw platform/chat/user IDs must not reach this layer; display opaque handles only.
  ];
  for (const key of preferredKeys) {
    const value = resource[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const entries = Object.entries(resource);
  if (!entries.length) return "Unspecified resource";
  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
};

const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

type FleetFilter = "all" | "pending" | "high-risk" | "local-stub";
type ProjectFilter = "all" | string;

type ApprovalRow = {
  agent: InvginiAgentRegistryEntry;
  request: InvginiAgentActionRequest;
};

type ReceiptRow = {
  agent: InvginiAgentRegistryEntry;
  receipt: InvginiAgentActionReceipt;
};

type ConnectorStat = {
  connector: string;
  grantCount: number;
  pendingCount: number;
  highRiskCount: number;
  permissions: string[];
  resources: string[];
};

type Severity = "critical" | "high" | "medium" | "info";

type IncidentRow = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  agent: InvginiAgentRegistryEntry;
  connector?: string | null;
  timestamp?: string | null;
};

type PolicySignalRow = {
  id: string;
  source: string;
  severity: Severity;
  disposition: string;
  message: string;
  agent: InvginiAgentRegistryEntry;
  connector: string;
  createdAt: string;
};

const riskRank = (riskTier: string) => {
  const normalized = riskTier.toLowerCase();
  if (normalized.includes("critical")) return 4;
  if (normalized.includes("high")) return 3;
  if (normalized.includes("medium")) return 2;
  if (normalized.includes("low")) return 1;
  return 0;
};

const requestRiskScore = (request: InvginiAgentActionRequest) =>
  request.riskScore || riskRank(request.riskTier) * 20;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown, fallback = "unknown") =>
  typeof value === "string" && value.trim() ? value : fallback;

const formatMaybeString = (value: unknown, fallback = "—") =>
  typeof value === "string" && value.trim() ? value : fallback;

const vtiArtifactsForAgent = (agent: InvginiAgentRegistryEntry) => [
  ...agent.actionRequests
    .map((request) => request.vtiBridge)
    .filter((artifact): artifact is InvginiVtiBridgeMetadata =>
      Boolean(artifact),
    ),
  ...agent.actionReceipts
    .map((receipt) => receipt.vtiBridge)
    .filter((artifact): artifact is InvginiVtiBridgeMetadata =>
      Boolean(artifact),
    ),
];

const latestVtiArtifact = (agent: InvginiAgentRegistryEntry) =>
  vtiArtifactsForAgent(agent)[0];

const vtiOpaqueHandleLabel = (
  artifact: InvginiVtiBridgeMetadata | undefined,
) => {
  if (!artifact?.opaqueHandle) return "No opaque handle";
  return [
    artifact.opaqueHandle.kind,
    artifact.opaqueHandle.displayName ?? artifact.opaqueHandle.id,
  ]
    .filter(Boolean)
    .join(" · ");
};

const vtiPosture = (agent: InvginiAgentRegistryEntry) => {
  const artifacts = vtiArtifactsForAgent(agent);
  const latest = artifacts[0];
  if (!latest)
    return {
      label: "Native only",
      description: "No VTI bridge metadata received yet.",
      ok: false,
    };
  if (
    latest.connectorCustodyMode === "opaque_handle" &&
    latest.rawConnectorIdPresent === false
  ) {
    return {
      label: "Opaque custody",
      description: `${artifacts.length} VTI artifact${artifacts.length === 1 ? "" : "s"} preserved.`,
      ok: true,
    };
  }
  return {
    label: "Review custody",
    description: "VTI metadata exists but custody flags need review.",
    ok: false,
  };
};

const evidencePackFilename = (agent: InvginiAgentRegistryEntry) =>
  `invgini-evidence-pack-${shortDid(agent.principal.did).replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;

const principalMetadataString = (
  agent: InvginiAgentRegistryEntry,
  key: string,
): string | undefined => {
  const value = agent.principal.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const trustProviderLabel = (agent: InvginiAgentRegistryEntry) => {
  const provider = agent.principal.trustProvider;
  const affinidiStatus = principalMetadataString(agent, "affinidi_status");
  if (provider === "affinidi" && affinidiStatus === "issued")
    return "Affinidi issued";
  if (affinidiStatus === "fallback_local") return "Affinidi fallback";
  if (affinidiStatus === "not_configured") return "Affinidi not configured";
  if (provider === "local-stub") return "Affinidi pending";
  return provider;
};

const isLocalOrFallbackIdentity = (agent: InvginiAgentRegistryEntry) => {
  const affinidiStatus = principalMetadataString(agent, "affinidi_status");
  return (
    agent.principal.trustProvider === "local-stub" ||
    affinidiStatus === "fallback_local" ||
    affinidiStatus === "not_configured"
  );
};

const signalSeverity = (value: unknown): Severity => {
  const normalized = asString(value, "info").toLowerCase();
  if (normalized.includes("critical") || normalized.includes("block"))
    return "critical";
  if (normalized.includes("high") || normalized.includes("deny")) return "high";
  if (normalized.includes("medium") || normalized.includes("warn"))
    return "medium";
  return "info";
};

const severityRank = (severity: Severity) =>
  ({ critical: 4, high: 3, medium: 2, info: 1 })[severity];

const severityBadgeVariant = (severity: Severity) =>
  severity === "critical" || severity === "high"
    ? "destructive"
    : severity === "medium"
      ? "outline"
      : "secondary";

const policySignalSource = (
  policySignals: Record<string, unknown> | null | undefined,
) => {
  if (!policySignals) return "runtime";
  return asString(
    policySignals.source ??
      policySignals.provider ??
      policySignals.engine ??
      policySignals.policy_engine,
    "runtime",
  );
};

const policySignalMessages = (
  policySignals: Record<string, unknown> | null | undefined,
) => {
  const signals = policySignals?.signals;
  if (!Array.isArray(signals)) return [];
  return signals
    .map((signal) => {
      if (!signal || typeof signal !== "object") return null;
      const message = (signal as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    })
    .filter((message): message is string => Boolean(message));
};

const receiptPolicySignals = (
  details: Record<string, unknown> | null | undefined,
) => {
  const detailsRecord = asRecord(details);
  if (!detailsRecord) return null;
  return asRecord(detailsRecord.policySignals ?? detailsRecord.policy_signals);
};

const receiptSignalSource = (receipt: InvginiAgentActionReceipt) =>
  policySignalSource(receiptPolicySignals(receipt.details));

const hoursSince = (value: string | null | undefined) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
};

const isApprovalOverSla = (request: InvginiAgentActionRequest) => {
  const age = hoursSince(request.createdAt);
  return age !== null && age >= 24;
};

const openControlActions = (agent: InvginiAgentRegistryEntry) =>
  agent.controlActions.filter(
    (control) => control.status.toLowerCase() === "open",
  );

const controlSeverity = (action: InvginiAgentControlActionName): Severity => {
  if (action === "FREEZE_AGENT" || action === "QUARANTINE_CONNECTOR")
    return "critical";
  if (action === "REVOKE_GRANTS" || action === "REQUIRE_APPROVAL")
    return "high";
  return "medium";
};

const buildIncidentRows = (
  agents: InvginiAgentRegistryEntry[],
): IncidentRow[] => {
  const rows: IncidentRow[] = [];

  agents.forEach((agent) => {
    openControlActions(agent).forEach((control) => {
      rows.push({
        id: `control:${control.id}`,
        title: controlActionLabel(control.action),
        description: control.reason,
        severity: controlSeverity(control.action),
        agent,
        connector: control.connector,
        timestamp: control.createdAt,
      });
    });

    agent.pendingActionRequests.forEach((request) => {
      const score = requestRiskScore(request);
      if (score < 55 && !isApprovalOverSla(request)) return;
      rows.push({
        id: `request:${request.id}`,
        title: isApprovalOverSla(request)
          ? "Approval SLA breach"
          : "High-risk action held",
        description: `${request.connector}:${request.action} · score ${score} · ${formatResource(
          request.resource,
        )}`,
        severity: isApprovalOverSla(request) ? "critical" : "high",
        agent,
        connector: request.connector,
        timestamp: request.createdAt,
      });
    });

    agent.actionReceipts
      .filter((receipt) => receipt.outcome !== "SUCCESS")
      .slice(0, 2)
      .forEach((receipt) => {
        rows.push({
          id: `receipt:${receipt.id}`,
          title: "Non-success receipt",
          description: `${receipt.connector}:${receipt.action} recorded ${receipt.outcome}`,
          severity: "medium",
          agent,
          connector: receipt.connector,
          timestamp: receipt.createdAt,
        });
      });
  });

  return rows.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      new Date(b.timestamp ?? 0).getTime() -
        new Date(a.timestamp ?? 0).getTime(),
  );
};

const collectPolicySignalRows = (
  agents: InvginiAgentRegistryEntry[],
): PolicySignalRow[] => {
  const rows: PolicySignalRow[] = [];

  const pushSignals = ({
    idPrefix,
    agent,
    connector,
    createdAt,
    policySignals,
  }: {
    idPrefix: string;
    agent: InvginiAgentRegistryEntry;
    connector: string;
    createdAt: string;
    policySignals: Record<string, unknown> | null | undefined;
  }) => {
    const signals = policySignals?.signals;
    if (!Array.isArray(signals)) return;
    signals.forEach((signal, index) => {
      const record = asRecord(signal);
      if (!record) return;
      rows.push({
        id: `${idPrefix}:${index}`,
        source: policySignalSource(policySignals),
        severity: signalSeverity(record.severity ?? record.disposition),
        disposition: asString(record.disposition, "observed"),
        message: asString(record.message, "Policy signal recorded"),
        agent,
        connector,
        createdAt,
      });
    });
  };

  agents.forEach((agent) => {
    agent.actionRequests.forEach((request) =>
      pushSignals({
        idPrefix: `request:${request.id}`,
        agent,
        connector: request.connector,
        createdAt: request.createdAt,
        policySignals: request.policySignals,
      }),
    );
    agent.actionReceipts.forEach((receipt) =>
      pushSignals({
        idPrefix: `receipt:${receipt.id}`,
        agent,
        connector: receipt.connector,
        createdAt: receipt.createdAt,
        policySignals: receiptPolicySignals(receipt.details),
      }),
    );
  });

  return rows.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};

const agentLabel = (agent: InvginiAgentRegistryEntry) =>
  agent.principal.displayName ?? shortDid(agent.principal.did);

const statusBadgeVariant = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "approved") return "secondary";
  if (normalized === "pending") return "destructive";
  if (normalized === "rejected" || normalized === "inactive") return "outline";
  return "outline";
};

const controlActionLabel = (action: string) =>
  action
    .toLowerCase()
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const latestControlAction = (
  agent: InvginiAgentRegistryEntry,
  action: InvginiAgentControlActionName,
) => agent.controlActions.find((control) => control.action === action);

const buildConnectorStats = (
  agents: InvginiAgentRegistryEntry[],
): ConnectorStat[] => {
  const stats = new Map<string, ConnectorStat>();

  const ensure = (connector: string) => {
    const key = connector || "invgini";
    const existing = stats.get(key);
    if (existing) return existing;
    const created: ConnectorStat = {
      connector: key,
      grantCount: 0,
      pendingCount: 0,
      highRiskCount: 0,
      permissions: [],
      resources: [],
    };
    stats.set(key, created);
    return created;
  };

  const addUnique = (list: string[], value: string) => {
    if (value && !list.includes(value)) list.push(value);
  };

  agents.forEach((agent) => {
    agent.resourceGrants.forEach((grant: InvginiAgentResourceGrant) => {
      const connector = String(grant.constraints.connector ?? "invgini");
      const stat = ensure(connector);
      stat.grantCount += 1;
      addUnique(stat.permissions, grant.permission);
      addUnique(stat.resources, `${grant.resourceType}:${grant.resourceId}`);
    });

    agent.pendingActionRequests.forEach((request) => {
      const stat = ensure(request.connector);
      stat.pendingCount += 1;
      if (requestRiskScore(request) >= 55) stat.highRiskCount += 1;
    });
  });

  return [...stats.values()].sort(
    (a, b) =>
      b.highRiskCount - a.highRiskCount || b.pendingCount - a.pendingCount,
  );
};

const EmptyState = () => (
  <Card className="flex flex-col items-center justify-center py-16 text-center">
    <div className="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
      <ShieldCheck className="text-muted-foreground size-6" />
    </div>
    <p className="text-sm font-medium">No InvGini agents received yet</p>
    <p className="text-muted-foreground mt-1 max-w-md text-xs">
      Configure InvGini with the ONEComputer governance endpoint, API key, and
      project ID. AgentRegistered events will appear here.
    </p>
  </Card>
);

const MetricCard = ({
  title,
  value,
  description,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof ShieldCheck;
  tone?: "default" | "warning" | "danger" | "success";
}) => {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
  }[tone];

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="text-muted-foreground mt-1 text-xs">{description}</p>
        </div>
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );
};

const ApprovalQueue = ({ rows }: { rows: ApprovalRow[] }) => (
  <Card className="p-5">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">Approval queue</h2>
        <p className="text-muted-foreground text-xs">
          Risky autonomous actions waiting for owner or SecOps review.
        </p>
      </div>
      <Badge variant={rows.length ? "destructive" : "secondary"}>
        {rows.length} pending
      </Badge>
    </div>

    <div className="mt-4 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Connector</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Policy</TableHead>
            <TableHead>Resource</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Requested</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={10}
                className="text-muted-foreground py-8 text-center text-xs"
              >
                No pending approvals. Keep risky actions routed here before
                execution.
              </TableCell>
            </TableRow>
          ) : (
            rows.slice(0, 8).map(({ agent, request }) => {
              const stale = isApprovalOverSla(request);
              return (
                <TableRow key={request.id}>
                  <TableCell className="max-w-[180px] truncate font-medium">
                    {agentLabel(agent)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-muted-foreground">
                    {agent.project.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.connector}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {request.action}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        requestRiskScore(request) >= 55
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {request.riskTier}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {requestRiskScore(request)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        policySignalSource(
                          request.policySignals,
                        ).toLowerCase() === "onecli"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {policySignalSource(request.policySignals)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">
                    {formatResource(request.resource)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stale ? "destructive" : "secondary"}>
                      {stale ? "breach" : "ok"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(request.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  </Card>
);

const ReceiptLedger = ({ rows }: { rows: ReceiptRow[] }) => (
  <Card className="p-5">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">Audit receipt ledger</h2>
        <p className="text-muted-foreground text-xs">
          Append-only evidence for completed, denied, or approval-blocked agent
          actions.
        </p>
      </div>
      <Badge variant="outline">{rows.length} receipts</Badge>
    </div>

    <div className="mt-4 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Connector</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Policy</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Recorded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-muted-foreground py-8 text-center text-xs"
              >
                No execution receipts yet. Receipts will prove exactly what an
                autonomous agent attempted or completed.
              </TableCell>
            </TableRow>
          ) : (
            rows.slice(0, 8).map(({ agent, receipt }) => (
              <TableRow key={receipt.id}>
                <TableCell className="max-w-[180px] truncate font-medium">
                  {agentLabel(agent)}
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-muted-foreground">
                  {agent.project.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{receipt.connector}</Badge>
                </TableCell>
                <TableCell className="max-w-[180px] truncate">
                  {receipt.action}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      receipt.outcome === "SUCCESS" ? "secondary" : "outline"
                    }
                  >
                    {receipt.outcome}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      receiptSignalSource(receipt).toLowerCase() === "onecli"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {receiptSignalSource(receipt)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-muted-foreground">
                  {formatResource(receipt.resource)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(receipt.createdAt)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  </Card>
);

const ConnectorMatrix = ({ connectors }: { connectors: ConnectorStat[] }) => (
  <Card className="p-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">Connector exposure matrix</h2>
        <p className="text-muted-foreground text-xs">
          Grants and pending actions grouped by connector surface.
        </p>
      </div>
      <Layers3 className="text-muted-foreground size-4" />
    </div>

    <div className="mt-4 grid gap-3">
      {connectors.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
          No connector grants or approval requests received yet.
        </div>
      ) : (
        connectors.map((connector) => (
          <div key={connector.connector} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge>{connector.connector}</Badge>
                <span className="text-xs text-muted-foreground">
                  {connector.grantCount} grants · {connector.resources.length}{" "}
                  resources
                </span>
              </div>
              <div className="flex gap-2">
                <Badge
                  variant={connector.pendingCount ? "destructive" : "secondary"}
                >
                  {connector.pendingCount} pending
                </Badge>
                <Badge
                  variant={connector.highRiskCount ? "destructive" : "outline"}
                >
                  {connector.highRiskCount} high risk
                </Badge>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              Permissions: {connector.permissions.join(", ") || "none"}
            </p>
          </div>
        ))
      )}
    </div>
  </Card>
);

const MissionControlBar = ({
  riskScore,
  incidents,
  approvalBacklog,
  slaBreaches,
  oneCliSignals,
  openControls,
}: {
  riskScore: number;
  incidents: IncidentRow[];
  approvalBacklog: number;
  slaBreaches: number;
  oneCliSignals: number;
  openControls: number;
}) => {
  const criticalIncidents = incidents.filter(
    (incident) => incident.severity === "critical",
  ).length;
  const posture = criticalIncidents
    ? "Containment"
    : approvalBacklog || openControls
      ? "Watchlist"
      : "Normal";

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-background via-background to-primary/5 p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={criticalIncidents ? "destructive" : "secondary"}>
              <Siren className="size-3" />
              {posture}
            </Badge>
            <Badge variant="outline">SecOps command net</Badge>
            <Badge variant="outline">Autonomous coworker fleet</Badge>
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">
            Mission control: detect, contain, approve, evidence
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-xs">
            ONEComputer is the cybersecurity plane for InvGini agents: identity
            and project scope are visible, risky connector actions queue for
            approval, control intents are durable, and receipts provide an audit
            trail when autonomous work is denied or completed.
          </p>
        </div>

        <div className="grid min-w-[280px] gap-2 sm:grid-cols-2">
          {[
            {
              label: "Risk",
              value: `${riskScore}/100`,
              icon: Gauge,
              tone: riskScore >= 70 ? "text-destructive" : "text-foreground",
            },
            {
              label: "Open controls",
              value: openControls,
              icon: Ban,
              tone: openControls ? "text-destructive" : "text-green-600",
            },
            {
              label: "Approval SLA",
              value: slaBreaches,
              icon: Clock3,
              tone: slaBreaches ? "text-destructive" : "text-green-600",
            },
            {
              label: "ONEComputer signals",
              value: oneCliSignals,
              icon: Network,
              tone: oneCliSignals ? "text-green-600" : "text-muted-foreground",
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border bg-card/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  {item.label}
                </p>
                <item.icon className={`size-3.5 ${item.tone}`} />
              </div>
              <p className="mt-1 text-xl font-semibold">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

const IncidentCommandBoard = ({ rows }: { rows: IncidentRow[] }) => (
  <Card className="p-5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Siren className="size-4 text-destructive" />
          <h2 className="text-sm font-semibold">Incident command board</h2>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          Highest priority controls, approval breaches, and denied execution
          evidence across the selected project scope.
        </p>
      </div>
      <Badge variant={rows.length ? "destructive" : "secondary"}>
        {rows.length} active signals
      </Badge>
    </div>

    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground lg:col-span-2">
          No incident signals in the current scope. Continue routing high-risk
          writes through the approval queue before execution.
        </div>
      ) : (
        rows.slice(0, 6).map((row) => (
          <div key={row.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={severityBadgeVariant(row.severity)}>
                  {row.severity}
                </Badge>
                {row.connector ? (
                  <Badge variant="outline">{row.connector}</Badge>
                ) : null}
              </div>
              <span className="text-muted-foreground text-[11px]">
                {formatDateTime(row.timestamp)}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold">{row.title}</p>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {row.description}
            </p>
            <p className="text-muted-foreground mt-2 truncate text-[11px]">
              {row.agent.project.name} · {agentLabel(row.agent)}
            </p>
          </div>
        ))
      )}
    </div>
  </Card>
);

const RulesTelemetryPanel = ({ rows }: { rows: PolicySignalRow[] }) => {
  const oneCliRows = rows.filter(
    (row) => row.source.toLowerCase() === "onecli",
  ).length;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              Rules and telemetry intelligence
            </h2>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Policy-engine explanations, dispositions, and source attribution
            from requests and receipts.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{rows.length} signals</Badge>
          <Badge variant={oneCliRows ? "secondary" : "outline"}>
            {oneCliRows} ONEComputer
          </Badge>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            No policy telemetry received yet. InvGini should send rule IDs,
            severity, disposition, and messages with each gated action.
          </div>
        ) : (
          rows.slice(0, 6).map((row) => (
            <div key={row.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityBadgeVariant(row.severity)}>
                    {row.severity}
                  </Badge>
                  <Badge variant="outline">{row.disposition}</Badge>
                  <Badge
                    variant={
                      row.source.toLowerCase() === "onecli"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {row.source}
                  </Badge>
                </div>
                <span className="text-muted-foreground text-[11px]">
                  {formatDateTime(row.createdAt)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs">{row.message}</p>
              <p className="text-muted-foreground mt-2 truncate text-[11px]">
                {row.connector} · {row.agent.project.name} ·{" "}
                {agentLabel(row.agent)}
              </p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

const ControlCoveragePanel = ({
  agents,
}: {
  agents: InvginiAgentRegistryEntry[];
}) => {
  const actions: {
    action: InvginiAgentControlActionName;
    label: string;
    description: string;
    icon: typeof ShieldCheck;
  }[] = [
    {
      action: "FREEZE_AGENT",
      label: "Freeze",
      description: "Stop autonomous execution immediately.",
      icon: Ban,
    },
    {
      action: "REQUIRE_APPROVAL",
      label: "Approval gate",
      description: "Route risky work to human/SecOps approval.",
      icon: ShieldAlert,
    },
    {
      action: "REVOKE_GRANTS",
      label: "Revoke",
      description: "Remove currently delegated authority.",
      icon: KeyRound,
    },
    {
      action: "QUARANTINE_CONNECTOR",
      label: "Quarantine",
      description: "Contain a connector such as Graph or Telegram.",
      icon: Network,
    },
    {
      action: "EXPORT_RECEIPTS",
      label: "Export",
      description: "Prepare evidence pack for audit review.",
      icon: FileText,
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Control coverage matrix</h2>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Operational readiness for the control actions ONEComputer can record and
        the InvGini backend enforcement bridge can consume.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {actions.map((item) => {
          const matchingControls = agents.flatMap((agent) =>
            agent.controlActions.filter(
              (control) => control.action === item.action,
            ),
          );
          const openCount = matchingControls.filter(
            (control) => control.status.toLowerCase() === "open",
          ).length;
          return (
            <div key={item.action} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="bg-muted flex size-8 items-center justify-center rounded-lg">
                  <item.icon className="text-muted-foreground size-4" />
                </div>
                <Badge variant={openCount ? "destructive" : "outline"}>
                  {openCount} open
                </Badge>
              </div>
              <p className="mt-3 text-xs font-semibold">{item.label}</p>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-[11px]">
                {item.description}
              </p>
              <p className="text-muted-foreground mt-2 text-[11px]">
                {matchingControls.length} total intents
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const AgentPassportPanel = ({
  agent,
}: {
  agent: InvginiAgentRegistryEntry;
}) => {
  const posture = vtiPosture(agent);
  const latestArtifact = latestVtiArtifact(agent);
  const affinidiStatus =
    principalMetadataString(agent, "affinidi_status") ?? "not reported";

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Fingerprint className="size-4 text-muted-foreground" />
            <p className="font-medium">Agent Passport</p>
          </div>
          <p className="mt-1 text-muted-foreground">
            DID identity, trust issuer status, and VTI connector-custody posture
            for this autonomous coworker.
          </p>
        </div>
        <Badge variant={posture.ok ? "secondary" : "outline"}>
          {posture.label}
        </Badge>
      </div>

      <dl className="mt-3 grid gap-2 text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>DID</dt>
          <dd className="max-w-[220px] truncate font-mono text-foreground">
            {agent.principal.did}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Trust provider</dt>
          <dd>{trustProviderLabel(agent)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Affinidi status</dt>
          <dd>{affinidiStatus}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>VTI custody</dt>
          <dd>{posture.description}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Opaque handle</dt>
          <dd className="max-w-[220px] truncate">
            {vtiOpaqueHandleLabel(latestArtifact)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Trust Task</dt>
          <dd className="max-w-[220px] truncate font-mono">
            {formatMaybeString(latestArtifact?.trustTaskId)}
          </dd>
        </div>
      </dl>
    </div>
  );
};

const eventHashLabel = (hash: string | null | undefined) =>
  hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—";

const TrustFlightRecorderPanel = ({
  agent,
  eventLogs,
}: {
  agent: InvginiAgentRegistryEntry;
  eventLogs: InvginiAgentEventLog[] | undefined;
}) => {
  const logs = eventLogs ?? [];
  const latest = logs[0];

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <p className="font-medium">Trust Flight Recorder</p>
          </div>
          <p className="mt-1 text-muted-foreground">
            Persisted event hashes from ingest. Use this to prove the dashboard
            is backed by append-only governance facts, not reconstructed UI
            state.
          </p>
        </div>
        <Badge variant={agent.eventLogCount ? "secondary" : "outline"}>
          {agent.eventLogCount ?? logs.length} events
        </Badge>
      </div>

      <dl className="mt-3 grid gap-2 text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>Latest hash</dt>
          <dd className="font-mono text-foreground">
            {eventHashLabel(latest?.eventHash ?? agent.lastEventHash)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Latest event</dt>
          <dd>{latest?.eventType ?? agent.lastEventType}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Ingested</dt>
          <dd>{formatDateTime(latest?.ingestedAt ?? agent.lastSeenAt)}</dd>
        </div>
      </dl>

      {logs.length ? (
        <div className="mt-3 space-y-2">
          {logs.slice(0, 5).map((eventLog) => (
            <div key={eventLog.id} className="rounded-md bg-muted/50 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{eventLog.eventType}</p>
                <Badge variant="outline" className="font-mono">
                  {eventHashLabel(eventLog.eventHash)}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatDateTime(eventLog.occurredAt)} · {eventLog.principalDid}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
          Open the evidence pack to load full event rows. Fleet summary already
          exposes the latest event hash and count when available.
        </p>
      )}
    </div>
  );
};

const EvidencePackPanel = ({
  agent,
  evidencePack,
  isLoading,
  error,
  onRefresh,
}: {
  agent: InvginiAgentRegistryEntry;
  evidencePack: InvginiAgentEvidencePack | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
}) => {
  const vtiArtifactCount =
    evidencePack?.vtiBridgeArtifacts.length ??
    vtiArtifactsForAgent(agent).length;
  const receiptCount =
    evidencePack?.actionReceipts.length ?? agent.actionReceipts.length;
  const eventLogCount =
    evidencePack?.eventLogs.length ?? agent.eventLogCount ?? 0;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck className="size-4 text-muted-foreground" />
            <p className="font-medium">Evidence Pack</p>
          </div>
          <p className="mt-1 text-muted-foreground">
            Exportable audit bundle with passport, mandates, grants, receipts,
            controls, and VTI bridge artifacts.
          </p>
        </div>
        <Badge variant={vtiArtifactCount ? "secondary" : "outline"}>
          {vtiArtifactCount} VTI artifacts
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Receipts</p>
          <p className="text-sm font-semibold">{receiptCount}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Events</p>
          <p className="text-sm font-semibold">{eventLogCount}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Controls</p>
          <p className="text-sm font-semibold">
            {evidencePack?.controlActions.length ?? agent.controlActions.length}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Generated</p>
          <p className="text-sm font-semibold">
            {formatDateTime(evidencePack?.generatedAt)}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
          {error.message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw
            className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          Refresh pack
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!evidencePack}
          onClick={() => {
            if (evidencePack)
              downloadJson(evidencePackFilename(agent), evidencePack);
          }}
        >
          <Download className="size-3.5" />
          Download JSON
        </Button>
      </div>
    </div>
  );
};

const AgentDetailPanel = ({
  agent,
  evidencePack,
  evidencePackError,
  isEvidencePackLoading,
  onRefreshEvidencePack,
  onCreateControl,
  onResolveControl,
  isCreatingControl,
  isResolvingControl,
}: {
  agent: InvginiAgentRegistryEntry | null;
  evidencePack: InvginiAgentEvidencePack | undefined;
  evidencePackError: Error | null;
  isEvidencePackLoading: boolean;
  onRefreshEvidencePack: () => void;
  onCreateControl: (input: CreateInvginiControlActionInput) => void;
  onResolveControl: (input: ResolveInvginiControlActionInput) => void;
  isCreatingControl: boolean;
  isResolvingControl: boolean;
}) => {
  if (!agent) {
    return (
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Agent detail</h2>
        <p className="text-muted-foreground mt-2 text-xs">
          Select an agent to inspect its DID, grants, mandates, and recent
          action history.
        </p>
      </Card>
    );
  }

  const recentRequests = agent.actionRequests.length
    ? agent.actionRequests
    : agent.pendingActionRequests;
  const connectorToQuarantine =
    agent.pendingActionRequests[0]?.connector ??
    agent.actionReceipts[0]?.connector ??
    agent.resourceGrants
      .map((grant) => grant.constraints.connector)
      .find(
        (connector): connector is string => typeof connector === "string",
      ) ??
    "invgini";
  const controlButtons: {
    action: InvginiAgentControlActionName;
    label: string;
    reason: string;
    connector?: string | null;
    resource?: Record<string, unknown>;
    variant?: "default" | "outline" | "destructive";
  }[] = [
    {
      action: "FREEZE_AGENT",
      label: "Freeze agent",
      reason: "SecOps requested an immediate freeze pending governance review.",
      variant: "destructive",
    },
    {
      action: "REQUIRE_APPROVAL",
      label: "Force approval",
      reason: "SecOps requires manual approval for subsequent risky actions.",
      variant: "outline",
    },
    {
      action: "REVOKE_GRANTS",
      label: "Revoke grants",
      reason: "SecOps requested grant revocation for this agent principal.",
      variant: "outline",
    },
    {
      action: "QUARANTINE_CONNECTOR",
      label: `Quarantine ${connectorToQuarantine}`,
      reason: `SecOps quarantined connector ${connectorToQuarantine} for this agent.`,
      connector: connectorToQuarantine,
      variant: "outline",
    },
    {
      action: "EXPORT_RECEIPTS",
      label: "Export receipts",
      reason: "SecOps requested an audit receipt export pack for this agent.",
      resource: { receiptCount: agent.actionReceipts.length },
      variant: "default",
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {agentLabel(agent)}
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
            {agent.principal.did}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(agent.principal.status)}>
          {agent.principal.status}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 text-xs">
        <div className="rounded-lg border p-3">
          <p className="font-medium">Accountability</p>
          <dl className="mt-2 grid gap-2 text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>Project</dt>
              <dd className="truncate">{agent.project.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Owner</dt>
              <dd className="truncate">
                {agent.principal.ownerEmail ?? "Not supplied"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Trust</dt>
              <dd>{trustProviderLabel(agent)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Latest event</dt>
              <dd>{agent.lastEventType}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Event hash</dt>
              <dd className="font-mono text-foreground">
                {eventHashLabel(agent.lastEventHash)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Last seen</dt>
              <dd>{formatDateTime(agent.lastSeenAt)}</dd>
            </div>
          </dl>
        </div>

        <AgentPassportPanel agent={agent} />

        <EvidencePackPanel
          agent={agent}
          evidencePack={evidencePack}
          error={evidencePackError}
          isLoading={isEvidencePackLoading}
          onRefresh={onRefreshEvidencePack}
        />

        <TrustFlightRecorderPanel
          agent={agent}
          eventLogs={evidencePack?.eventLogs}
        />

        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">SecOps controls</p>
              <p className="mt-1 text-muted-foreground">
                Durable control intents recorded in ONEComputer before the
                backend enforcement bridge consumes them.
              </p>
            </div>
            <Badge
              variant={agent.controlActions.length ? "destructive" : "outline"}
            >
              {agent.controlActions.length} controls
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {controlButtons.map((control) => {
              const latest = latestControlAction(agent, control.action);
              return (
                <Button
                  key={control.action}
                  type="button"
                  size="sm"
                  variant={control.variant ?? "outline"}
                  disabled={isCreatingControl || isResolvingControl}
                  onClick={() =>
                    onCreateControl({
                      principalId: agent.principal.id,
                      action: control.action,
                      reason: control.reason,
                      connector: control.connector,
                      resource: control.resource,
                    })
                  }
                >
                  {control.label}
                  {latest ? (
                    <span className="ml-1 text-[10px] opacity-70">
                      · {latest.status}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          <div className="mt-3 space-y-2">
            {agent.controlActions.slice(0, 4).map((control) => (
              <div key={control.id} className="rounded-md bg-muted/50 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {controlActionLabel(control.action)}
                  </span>
                  <Badge variant="outline">{control.status}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground">
                  {control.reason}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDateTime(control.createdAt)} ·{" "}
                  {control.requestedByEmail}
                </p>
                {control.resolvedAt ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Resolved {formatDateTime(control.resolvedAt)} ·{" "}
                    {control.resolutionReason ?? "No resolution reason"}
                  </p>
                ) : control.status === "OPEN" ||
                  control.status === "APPLIED" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-[11px]"
                    disabled={isResolvingControl}
                    onClick={() =>
                      onResolveControl({
                        principalId: agent.principal.id,
                        controlId: control.id,
                        status: "RESOLVED",
                        reason:
                          "SecOps marked this control resolved from the ONEComputer dashboard.",
                      })
                    }
                  >
                    Mark resolved
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="font-medium">Mandates</p>
          <div className="mt-2 space-y-2">
            {agent.mandates.length === 0 ? (
              <p className="text-muted-foreground">
                No mandate snapshot received.
              </p>
            ) : (
              agent.mandates.map((mandate) => (
                <div key={mandate.id} className="rounded-md bg-muted/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{mandate.title}</span>
                    <Badge variant="outline">{mandate.status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-3 text-muted-foreground">
                    {mandate.description}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="font-medium">Resource grants</p>
          <div className="mt-2 space-y-2">
            {agent.resourceGrants.length === 0 ? (
              <p className="text-muted-foreground">No grants received.</p>
            ) : (
              agent.resourceGrants.slice(0, 6).map((grant) => (
                <div
                  key={grant.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2"
                >
                  <span className="min-w-0 truncate">
                    {grant.permission} · {grant.resourceType}
                  </span>
                  <Badge variant="outline">{grant.status}</Badge>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="font-medium">Recent action requests</p>
          <div className="mt-2 space-y-2">
            {recentRequests.length === 0 ? (
              <p className="text-muted-foreground">
                No action requests recorded.
              </p>
            ) : (
              recentRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="rounded-md bg-muted/50 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {request.connector}:{request.action}
                    </span>
                    <Badge
                      variant={
                        request.status === "PENDING" ? "destructive" : "outline"
                      }
                    >
                      {request.status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">
                    Score {requestRiskScore(request)} ·{" "}
                    {formatResource(request.resource)}
                  </p>
                  {policySignalMessages(request.policySignals)
                    .slice(0, 1)
                    .map((message) => (
                      <p
                        key={message}
                        className="mt-1 line-clamp-2 text-muted-foreground"
                      >
                        Rule: {message}
                      </p>
                    ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="font-medium">Recent receipts</p>
          <div className="mt-2 space-y-2">
            {agent.actionReceipts.length === 0 ? (
              <p className="text-muted-foreground">
                No execution receipts recorded.
              </p>
            ) : (
              agent.actionReceipts.slice(0, 5).map((receipt) => (
                <div key={receipt.id} className="rounded-md bg-muted/50 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {receipt.connector}:{receipt.action}
                    </span>
                    <Badge
                      variant={
                        receipt.outcome === "SUCCESS" ? "secondary" : "outline"
                      }
                    >
                      {receipt.outcome}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">
                    {formatResource(receipt.resource)}
                  </p>
                  {receipt.receiptHash ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {receipt.receiptHash}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export const InvginiAgentsContent = () => {
  const {
    data: agents = [],
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useInvginiAgents();
  const createControlAction = useCreateInvginiControlAction();
  const resolveControlAction = useResolveInvginiControlAction();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [selectedProjectId, setSelectedProjectId] =
    useState<ProjectFilter>("all");
  const [selectedDid, setSelectedDid] = useState<string | null>(null);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, InvginiAgentRegistryEntry["project"]>();
    agents.forEach((agent) => projects.set(agent.project.id, agent.project));
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [agents]);

  const scopedAgents = useMemo(() => {
    if (selectedProjectId === "all") return agents;
    return agents.filter((agent) => agent.project.id === selectedProjectId);
  }, [agents, selectedProjectId]);

  const pendingRows = useMemo<ApprovalRow[]>(() => {
    return scopedAgents
      .flatMap((agent) =>
        agent.pendingActionRequests.map((request) => ({ agent, request })),
      )
      .sort(
        (a, b) => requestRiskScore(b.request) - requestRiskScore(a.request),
      );
  }, [scopedAgents]);

  const receiptRows = useMemo<ReceiptRow[]>(() => {
    return scopedAgents
      .flatMap((agent) =>
        agent.actionReceipts.map((receipt) => ({ agent, receipt })),
      )
      .sort(
        (a, b) =>
          new Date(b.receipt.createdAt).getTime() -
          new Date(a.receipt.createdAt).getTime(),
      );
  }, [scopedAgents]);

  const stats = useMemo(() => {
    const activeAgents = scopedAgents.filter(
      (agent) => agent.principal.status.toLowerCase() === "active",
    ).length;
    const localStubAgents = scopedAgents.filter((agent) =>
      isLocalOrFallbackIdentity(agent),
    ).length;
    const highRiskPending = pendingRows.filter(
      ({ request }) => requestRiskScore(request) >= 55,
    ).length;
    const connectors = buildConnectorStats(scopedAgents);
    const deniedReceipts = receiptRows.filter(
      ({ receipt }) => receipt.outcome !== "SUCCESS",
    ).length;
    const slaBreaches = pendingRows.filter(({ request }) =>
      isApprovalOverSla(request),
    ).length;
    const oneCliSignals =
      pendingRows.filter(
        ({ request }) =>
          policySignalSource(request.policySignals).toLowerCase() === "onecli",
      ).length +
      receiptRows.filter(
        ({ receipt }) =>
          receiptSignalSource(receipt).toLowerCase() === "onecli",
      ).length;
    const openControls = scopedAgents.reduce(
      (count, agent) => count + openControlActions(agent).length,
      0,
    );
    const riskScore = Math.min(
      100,
      highRiskPending * 22 +
        pendingRows.length * 8 +
        slaBreaches * 18 +
        deniedReceipts * 3 +
        openControls * 10 +
        localStubAgents * 4 +
        Math.max(0, scopedAgents.length - activeAgents) * 15,
    );

    return {
      activeAgents,
      localStubAgents,
      highRiskPending,
      connectors,
      deniedReceipts,
      slaBreaches,
      oneCliSignals,
      openControls,
      riskScore,
    };
  }, [scopedAgents, pendingRows, receiptRows]);

  const incidentRows = useMemo(
    () => buildIncidentRows(scopedAgents),
    [scopedAgents],
  );

  const policySignalRows = useMemo(
    () => collectPolicySignalRows(scopedAgents),
    [scopedAgents],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedAgents.filter((agent) => {
      const matchesSearch =
        !q ||
        [
          agent.principal.displayName,
          agent.principal.did,
          agent.project.name,
          agent.project.slug,
          agent.principal.ownerEmail,
          agent.principal.sourceRefId,
          agent.lastEventType,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));

      const matchesFilter =
        filter === "all" ||
        (filter === "pending" && agent.pendingActionRequests.length > 0) ||
        (filter === "high-risk" &&
          agent.pendingActionRequests.some(
            (request) => requestRiskScore(request) >= 55,
          )) ||
        (filter === "local-stub" && isLocalOrFallbackIdentity(agent));

      return matchesSearch && matchesFilter;
    });
  }, [filter, scopedAgents, search]);

  const selectedAgent = useMemo<InvginiAgentRegistryEntry | null>(() => {
    if (!scopedAgents.length) return null;
    return (
      scopedAgents.find((agent) => agent.principal.did === selectedDid) ??
      filteredAgents[0] ??
      scopedAgents[0] ??
      null
    );
  }, [filteredAgents, scopedAgents, selectedDid]);

  const evidencePackQuery = useInvginiEvidencePack(selectedAgent?.principal.id);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        title="InvGini Agent Command Center"
        description="SecOps cockpit for InvestmentGini agent identities, mandates, grants, connector exposure, approvals, and governance posture."
      />

      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/40 bg-destructive/5 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-lg">
                <AlertTriangle className="size-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">
                  InvGini governance feed unavailable
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  ONEComputer could not load the InvGini agent registry. Verify
                  that the API route is deployed, the project context is
                  available, and the InvGini governance sync key is configured.
                </p>
                <p className="text-destructive mt-3 max-w-2xl font-mono text-xs break-all">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
              Retry
            </Button>
          </div>
        </Card>
      ) : agents.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="text-muted-foreground size-4" />
                  <h2 className="text-sm font-semibold">Project scope</h2>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Fleet view is organization-wide; narrow it to one InvGini
                  project when investigating a specific mandate or owner.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedProjectId === "all" ? "default" : "outline"}
                  onClick={() => setSelectedProjectId("all")}
                >
                  All projects
                </Button>
                {projectOptions.map((project) => (
                  <Button
                    key={project.id}
                    type="button"
                    size="sm"
                    variant={
                      selectedProjectId === project.id ? "default" : "outline"
                    }
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    {project.name}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Fleet size"
              value={scopedAgents.length}
              description={`${stats.activeAgents} active across ${projectOptions.length} projects`}
              icon={Bot}
              tone="success"
            />
            <MetricCard
              title="Pending approvals"
              value={pendingRows.length}
              description="Actions blocked before execution"
              icon={Clock3}
              tone={pendingRows.length ? "danger" : "success"}
            />
            <MetricCard
              title="High-risk queue"
              value={stats.highRiskPending}
              description="Delete/send/permission-class actions"
              icon={ShieldAlert}
              tone={stats.highRiskPending ? "danger" : "success"}
            />
            <MetricCard
              title="Projects covered"
              value={projectOptions.length}
              description={`${stats.localStubAgents} local-stub identities`}
              icon={Building2}
              tone={stats.localStubAgents ? "warning" : "success"}
            />
            <MetricCard
              title="Audit receipts"
              value={receiptRows.length}
              description={`${stats.deniedReceipts} non-success outcomes`}
              icon={Database}
              tone={stats.deniedReceipts ? "warning" : "success"}
            />
          </section>

          <MissionControlBar
            riskScore={stats.riskScore}
            incidents={incidentRows}
            approvalBacklog={pendingRows.length}
            slaBreaches={stats.slaBreaches}
            oneCliSignals={stats.oneCliSignals}
            openControls={stats.openControls}
          />

          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <IncidentCommandBoard rows={incidentRows} />
            <RulesTelemetryPanel rows={policySignalRows} />
          </section>

          <ControlCoveragePanel agents={scopedAgents} />

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="overflow-hidden p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-green-600 dark:text-green-400" />
                    <h2 className="text-sm font-semibold">
                      Governance posture
                    </h2>
                  </div>
                  <p className="text-muted-foreground mt-2 text-xs">
                    ONEComputer is acting as the SecOps plane: it tracks DID
                    identities, highlights risky autonomous work, and gives
                    reviewers a queue before agents touch privileged connectors.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw
                    className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="rounded-xl border p-4">
                  <p className="text-muted-foreground text-xs font-medium">
                    Risk score
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {stats.riskScore}
                    <span className="text-muted-foreground text-sm">/100</span>
                  </p>
                  <Progress value={stats.riskScore} className="mt-3" />
                  <p className="text-muted-foreground mt-2 text-xs">
                    Derived from pending, high-risk, inactive, and stub-trust
                    signals.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    {
                      label: "Agents have accountable DIDs",
                      ok: scopedAgents.every((agent) => agent.principal.did),
                    },
                    {
                      label: "Risky actions enter approval queue",
                      ok: true,
                    },
                    {
                      label: "Authority grants are scoped",
                      ok: scopedAgents.every(
                        (agent) => agent.resourceGrants.length > 0,
                      ),
                    },
                    {
                      label: "Affinidi trust provider enabled",
                      ok: stats.localStubAgents === 0,
                    },
                    {
                      label: "SecOps control intents recorded",
                      ok: scopedAgents.some(
                        (agent) => agent.controlActions.length > 0,
                      ),
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      {item.ok ? (
                        <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                      )}
                      <span className="text-xs font-medium">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-green-600 dark:text-green-400" />
                <h2 className="text-sm font-semibold">
                  Live operating signals
                </h2>
              </div>
              <div className="mt-4 space-y-3">
                {scopedAgents.slice(0, 5).map((agent) => (
                  <button
                    key={agent.principal.did}
                    type="button"
                    onClick={() => setSelectedDid(agent.principal.did)}
                    className="hover:bg-muted/60 flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {agentLabel(agent)}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {agent.lastEventType} ·{" "}
                        {formatDateTime(agent.lastSeenAt)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        agent.pendingActionRequests.length
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {agent.pendingActionRequests.length}
                    </Badge>
                  </button>
                ))}
              </div>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,380px)]">
            <div className="min-w-0 space-y-4">
              <ApprovalQueue rows={pendingRows} />
              <ReceiptLedger rows={receiptRows} />

              <Card className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Agent fleet</h2>
                    <p className="text-muted-foreground text-xs">
                      Search by DID, owner, event type, source reference, or
                      display name.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-[240px]">
                      <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-2.5 size-4" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search agents…"
                        className="pl-8"
                      />
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border p-1">
                      {[
                        ["all", "All"],
                        ["pending", "Pending"],
                        ["high-risk", "High risk"],
                        ["local-stub", "Stub trust"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFilter(value as FleetFilter)}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                            filter === value
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {filteredAgents.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                      No agents match the current search/filter.
                    </div>
                  ) : (
                    filteredAgents.map((agent) => {
                      const selected =
                        selectedAgent?.principal.did === agent.principal.did;
                      return (
                        <button
                          key={agent.principal.did}
                          type="button"
                          onClick={() => setSelectedDid(agent.principal.did)}
                          className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 ${
                            selected ? "border-primary/50 bg-muted/40" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-sm font-semibold">
                                  {agentLabel(agent)}
                                </h3>
                                <Badge
                                  variant={statusBadgeVariant(
                                    agent.principal.status,
                                  )}
                                >
                                  {agent.principal.status}
                                </Badge>
                                <Badge variant="secondary">
                                  {trustProviderLabel(agent)}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground font-mono text-xs break-all">
                                {agent.principal.did}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                Source {agent.principal.sourceRefType}:{" "}
                                {agent.principal.sourceRefId}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <Badge>{shortDid(agent.principal.did)}</Badge>
                              <Badge variant="outline">
                                {agent.mandates.length} mandates
                              </Badge>
                              <Badge variant="outline">
                                {agent.resourceGrants.length} grants
                              </Badge>
                              <Badge
                                variant={
                                  agent.pendingActionRequests.length
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {agent.pendingActionRequests.length} pending
                              </Badge>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            <div className="min-w-0 space-y-4">
              <ConnectorMatrix connectors={stats.connectors} />
              <AgentDetailPanel
                agent={selectedAgent}
                evidencePack={evidencePackQuery.data}
                evidencePackError={
                  evidencePackQuery.error instanceof Error
                    ? evidencePackQuery.error
                    : null
                }
                isEvidencePackLoading={evidencePackQuery.isFetching}
                onRefreshEvidencePack={() => {
                  void evidencePackQuery.refetch();
                }}
                isCreatingControl={createControlAction.isPending}
                isResolvingControl={resolveControlAction.isPending}
                onCreateControl={(input) => createControlAction.mutate(input)}
                onResolveControl={(input) => resolveControlAction.mutate(input)}
              />
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    Next controls to wire
                  </h2>
                </div>
                <Separator className="my-3" />
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p className="flex gap-2">
                    <Fingerprint className="mt-0.5 size-3.5 shrink-0" />
                    Affinidi-backed DID/VTA/VTC verifier status per agent.
                  </p>
                  <p className="flex gap-2">
                    <Database className="mt-0.5 size-3.5 shrink-0" />
                    Receipt export packs for completed/denied actions.
                  </p>
                  <p className="flex gap-2">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0" />
                    Bulk policy actions: freeze, revoke, require approval,
                    rotate grants.
                  </p>
                </div>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
