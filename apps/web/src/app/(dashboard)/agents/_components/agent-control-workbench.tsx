"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Fingerprint,
  Hash,
  LucideIcon,
  MessageSquareText,
  Network,
  PauseCircle,
  Route,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { Input } from "@onecli/ui/components/input";

export type AgentControlRecord = {
  name: string;
  kind: string;
  tenant: string;
  identity: string;
  owner: string;
  mandate: string;
  computers: readonly string[];
  risk: "High" | "Medium";
  status: string;
  verifier: string;
  policyHash: string;
  evidence: string;
};

const controls = [
  {
    label: "Pause agent",
    state: "preview",
    note: "Requires P6 action wiring before live enforcement.",
  },
  {
    label: "Revoke grant",
    state: "preview",
    note: "Requires P6 action wiring before live enforcement.",
  },
  {
    label: "View passport",
    state: "preview",
    note: "Draft passport summary is visible; high-exposure agent detail is now available in P6.3.",
  },
  {
    label: "Export evidence",
    state: "preview",
    note: "Metadata-only agent manifest export is live for the high-exposure pattern; full evidence API remains gated.",
  },
] as const;

const filterOptions = [
  { label: "All", value: "all" },
  { label: "High exposure", value: "risk:High" },
  { label: "Medium", value: "risk:Medium" },
  { label: "Live", value: "status:Live" },
  { label: "Approval required", value: "status:Needs approval" },
  { label: "Design track", value: "status:Design" },
] as const;

const riskTone = {
  High: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Medium: "border-sky-500/30 bg-sky-500/10 text-sky-300",
} as const;

const legalMfaEvidenceTimeline = [
  {
    title: "Mandate issued",
    detail:
      "Agent may review new MFA folders, copy scoped files, and annotate drafts only.",
    time: "T-05",
    hash: "sha256:legal-mfa-mandate",
    icon: UserRound,
  },
  {
    title: "Scope mapped",
    detail:
      "Write surface limited to SharePoint MFA workspace and evidence gateway.",
    time: "T-04",
    hash: "sha256:legal-mfa-scope",
    icon: Network,
  },
  {
    title: "Policy attached",
    detail:
      "P5 policy hash links mandate, owner, verifier seam, and approval gate.",
    time: "T-03",
    hash: "sha256:p5-policy-hash",
    icon: ScrollText,
  },
  {
    title: "Evidence head recorded",
    detail:
      "Current evidence head is visible; export includes only metadata and hashes.",
    time: "T-02",
    hash: "sha256:8e087c…",
    icon: Activity,
  },
  {
    title: "Approval gate pending",
    detail:
      "Autonomous write actions remain blocked until approval UX is wired.",
    time: "T-01",
    hash: "sha256:approval-required",
    icon: AlertTriangle,
  },
] as const;

export const AgentControlWorkbench = ({
  agents,
}: {
  agents: readonly AgentControlRecord[];
}) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] =
    useState<(typeof filterOptions)[number]["value"]>("all");
  const [question, setQuestion] = useState(
    "Which agents have the highest exposure this week?",
  );

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return agents.filter((agent) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          agent.name,
          agent.kind,
          agent.tenant,
          agent.identity,
          agent.owner,
          agent.mandate,
          agent.risk,
          agent.status,
          agent.verifier,
          agent.policyHash,
          agent.evidence,
          ...agent.computers,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      const matchesFilter =
        filter === "all" ||
        (filter.startsWith("risk:") && agent.risk === filter.slice(5)) ||
        (filter.startsWith("status:") &&
          agent.status.toLowerCase().includes(filter.slice(7).toLowerCase()));

      return matchesQuery && matchesFilter;
    });
  }, [agents, filter, query]);

  const highRiskCount = filteredAgents.filter(
    (agent) => agent.risk === "High",
  ).length;
  const activeVerifierCount = filteredAgents.filter((agent) =>
    agent.verifier.toLowerCase().includes("vti"),
  ).length;
  const localAnswer = buildLocalAnswer(question, filteredAgents);
  const legalMfaAgent =
    agents.find((agent) => agent.name === "Legal MFA reviewer") ?? agents[0];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-brand" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Search and filter agents
              </h2>
              <p className="text-xs text-muted-foreground">
                Operator controls for finding exposed agents by owner, DID,
                verifier, status, mandate, computer, policy, or evidence.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search agents"
                className="pl-9"
                placeholder="Search agent, owner, DID, computer, policy, evidence..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Reset
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={filter === option.value ? "default" : "outline"}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <Metric
              label="Matched agents"
              value={String(filteredAgents.length)}
            />
            <Metric label="High exposure" value={String(highRiskCount)} />
            <Metric label="VTI-related" value={String(activeVerifierCount)} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-brand" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Ask controls data
              </h2>
              <p className="text-xs text-muted-foreground">
                Preview: local summaries only. Later this becomes an audited
                cyber/compliance copilot over registry, policy, and evidence
                data.
              </p>
            </div>
          </div>
          <textarea
            aria-label="Ask a question about agent controls"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 mt-4 min-h-24 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Show high exposure agents",
              "Which verifiers are pending?",
              "Any owner concentration?",
              "Turn MFA policy doc into controls",
            ].map((prompt) => (
              <Button
                key={prompt}
                size="sm"
                variant="outline"
                onClick={() => setQuestion(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
          <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-sm leading-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Send className="size-3.5" /> Local answer
            </div>
            {localAnswer}
          </div>
        </Card>
      </div>

      {legalMfaAgent && <AgentEvidenceDetail agent={legalMfaAgent} />}

      {filteredAgents.length === 0 ? (
        <Card className="p-8 text-center">
          <Search className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold tracking-tight">
            No agents match the current filters
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Clear the query or reset filters to return to the full inventory.
          </p>
        </Card>
      ) : (
        filteredAgents.map((agent) => (
          <AgentCard key={agent.identity} agent={agent} />
        ))
      )}
    </div>
  );
};

const AgentEvidenceDetail = ({ agent }: { agent: AgentControlRecord }) => {
  const [exportedAt, setExportedAt] = useState<string | null>(null);

  const downloadManifest = () => {
    const manifest = {
      schema: "onecomputer.agentEvidenceManifest.v1",
      exportedAt: new Date().toISOString(),
      agent: {
        name: agent.name,
        kind: agent.kind,
        tenant: agent.tenant,
        did: agent.identity,
        owner: agent.owner,
        mandate: agent.mandate,
        computers: agent.computers,
        risk: agent.risk,
        status: agent.status,
        verifier: agent.verifier,
        policyHash: agent.policyHash,
        evidenceHead: agent.evidence,
      },
      timeline: legalMfaEvidenceTimeline.map((event) => ({
        title: event.title,
        detail: event.detail,
        time: event.time,
        hash: event.hash,
      })),
      guardrails: [
        "Metadata and hashes only; no raw document payloads in this export.",
        "Autonomous write actions remain blocked until approval UX and audit append are wired.",
        "Policy and evidence records are draft/dashboard-level until backed by VTI signing.",
      ],
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "onecomputer-legal-mfa-reviewer-evidence-manifest.json";
    link.click();
    URL.revokeObjectURL(url);
    setExportedAt(new Date().toLocaleTimeString());
  };

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-brand">
              <Route className="size-3.5" /> Agent evidence detail
            </Badge>
            <Badge variant="outline">Selected: {agent.name}</Badge>
            <Badge variant="outline">P6.3 timeline</Badge>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            Accountability trail for a high-exposure agent.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This turns the Legal MFA reviewer from a row of hashes into a
            reviewer-readable story: mandate, scope, policy, evidence head, and
            approval state. The export contains metadata and hashes only.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={downloadManifest}>
              <Download className="size-3.5" /> Download manifest
            </Button>
            <Button size="sm" variant="outline" disabled>
              Open evidence API{" "}
              <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
            </Button>
            {exportedAt && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" /> Exported {exportedAt}
              </Badge>
            )}
          </div>
        </div>
        <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-xs sm:grid-cols-2 xl:w-[460px]">
          <MiniFact icon={UserRound} label="Owner" value={agent.owner} />
          <MiniFact
            icon={Fingerprint}
            label="Agent DID"
            value={agent.identity}
            mono
          />
          <MiniFact
            icon={ShieldCheck}
            label="Verifier"
            value={agent.verifier}
          />
          <MiniFact
            icon={Activity}
            label="Evidence head"
            value={agent.evidence}
            mono
          />
        </div>
      </div>

      <div className="mt-5 rounded-xl border bg-background/60 p-4">
        <div className="flex items-center gap-2">
          <Route className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Agent evidence timeline</h3>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-5">
          {legalMfaEvidenceTimeline.map((event, index) => (
            <div
              key={event.title}
              className="rounded-lg border bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-8 items-center justify-center rounded-full border bg-background">
                  <event.icon className="size-4 text-brand" />
                </span>
                <Badge variant="outline" className="gap-1">
                  <Clock className="size-3" /> {event.time}
                </Badge>
              </div>
              <p className="mt-3 text-sm font-medium">
                {index + 1}. {event.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {event.detail}
              </p>
              <p className="mt-2 flex items-center gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
                <Hash className="size-3.5" /> {event.hash}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

const AgentCard = ({ agent }: { agent: AgentControlRecord }) => (
  <Card className="p-5">
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={riskTone[agent.risk]}>
            {agent.risk} risk
          </Badge>
          <Badge variant="secondary">{agent.tenant}</Badge>
          <Badge variant="outline">{agent.status}</Badge>
        </div>
        <div className="mt-4 flex gap-3">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Bot className="size-5 text-brand" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight">
              {agent.name}
            </h3>
            <p className="text-sm text-muted-foreground">{agent.kind}</p>
            <p className="mt-3 text-sm leading-6">{agent.mandate}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Fact icon={UserRound} label="Owner" value={agent.owner} />
        <Fact icon={ShieldCheck} label="Verifier" value={agent.verifier} />
        <Fact
          icon={Fingerprint}
          label="Agent DID"
          value={agent.identity}
          mono
        />
        <Fact icon={ScrollText} label="Policy" value={agent.policyHash} mono />
        <Fact
          icon={Activity}
          label="Evidence head"
          value={agent.evidence}
          mono
        />
        <Fact
          icon={Network}
          label="Computers"
          value={agent.computers.join(", ")}
        />
      </div>
    </div>

    <div className="mt-5 grid gap-3 border-t pt-4 lg:grid-cols-3">
      <EvidenceTile
        icon={Fingerprint}
        label="Agent passport"
        value={agent.identity}
        status="Draft visible"
      />
      <EvidenceTile
        icon={ScrollText}
        label="Policy artifact"
        value={agent.policyHash}
        status={agent.policyHash === "pending" ? "Pending" : "Hash visible"}
      />
      <EvidenceTile
        icon={Activity}
        label="Evidence chain"
        value={agent.evidence}
        status={agent.evidence === "pending" ? "Pending" : "Head visible"}
      />
    </div>

    <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
      {controls.map((control) => (
        <Button
          key={control.label}
          variant="outline"
          size="sm"
          disabled={control.state === "preview"}
          title={control.note}
        >
          {control.label === "Pause agent" ? (
            <PauseCircle className="size-3.5" />
          ) : control.label === "Export evidence" ? (
            <ExternalLink className="size-3.5" />
          ) : control.label === "View passport" ? (
            <FileText className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          {control.label}
          <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Preview
          </span>
        </Button>
      ))}
    </div>
  </Card>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border bg-muted/20 p-3">
    <p className="text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);

const Fact = ({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="rounded-lg border bg-muted/20 p-3">
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </p>
    <p
      className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono text-[11px]" : ""}`}
    >
      {value}
    </p>
  </div>
);

const EvidenceTile = ({
  icon: Icon,
  label,
  value,
  status,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  status: string;
}) => (
  <div className="rounded-lg border bg-background/60 p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 text-brand" />
        {label}
      </p>
      <Badge variant="outline">{status}</Badge>
    </div>
    <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
      {value}
    </p>
  </div>
);

const MiniFact = ({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="rounded-lg border bg-background/70 p-3">
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </p>
    <p
      className={`mt-1 break-words font-medium ${mono ? "font-mono text-[11px]" : ""}`}
    >
      {value}
    </p>
  </div>
);

const buildLocalAnswer = (
  question: string,
  agents: readonly AgentControlRecord[],
): string => {
  const normalized = question.toLowerCase();
  const highRisk = agents.filter((agent) => agent.risk === "High");
  const pendingVerifier = agents.filter((agent) =>
    [agent.verifier, agent.policyHash, agent.evidence, agent.status]
      .join(" ")
      .toLowerCase()
      .includes("pending"),
  );
  const owners = Array.from(new Set(agents.map((agent) => agent.owner)));

  if (normalized.includes("owner")) {
    return `${owners.length} owner(s) are represented in the current result set: ${owners.join(", ")}. Owner concentration remains a useful CISO signal for accountability and approval routing.`;
  }

  if (
    normalized.includes("document") ||
    normalized.includes("doc") ||
    normalized.includes("policy")
  ) {
    return "Planned P7 Policy Engine: upload compliance documents, extract obligations, map them to agents/computers/data classes, then generate draft policy artifacts with citations for human approval before enforcement.";
  }

  if (normalized.includes("verifier") || normalized.includes("pending")) {
    return `${pendingVerifier.length} agent(s) have pending verifier, policy, evidence, or design-track state in the current result set. Prioritize these before expanding autonomous access.`;
  }

  if (
    normalized.includes("high") ||
    normalized.includes("risk") ||
    normalized.includes("exposure")
  ) {
    return `${highRisk.length} high-exposure agent(s) are visible: ${highRisk.map((agent) => agent.name).join(", ") || "none"}. Review linked computers and require approval for write actions.`;
  }

  return `${agents.length} agent(s) match the current filter. Current trend view is local-only; P7 should connect this panel to evidence-chain and registry events for real time-series analysis.`;
};
