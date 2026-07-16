import { Badge } from "@onecli/ui/components/badge";
import { Card } from "@onecli/ui/components/card";
import { PageHeader } from "@dashboard/page-header";
import {
  AgentControlWorkbench,
  type AgentControlRecord,
} from "./agent-control-workbench";
import { ShieldCheck } from "lucide-react";

const agents = [
  {
    name: "Legal MFA reviewer",
    kind: "Scheduled document agent",
    tenant: "InvestmentGini pilot",
    identity: "did:example:onecomputer:agent:legal-mfa-reviewer",
    owner: "Terence / InvGini team",
    mandate: "Review new MFA folders, copy scoped files, annotate drafts only.",
    computers: ["SharePoint MFA workspace", "OneComputer evidence gateway"],
    risk: "High",
    status: "Needs approval UX",
    verifier: "Affinidi/VTI seam",
    policyHash: "sha256:p5-policy-hash",
    evidence: "sha256:8e087c…",
  },
  {
    name: "Meeting tracker app agent",
    kind: "Builder app worker",
    tenant: "OneComputer demo",
    identity: "did:example:onecomputer:agent:meeting-tracker",
    owner: "Local builder",
    mandate: "Serve governed Streamlit app behind access gateway.",
    computers: ["Streamlit runtime", "Access Gateway"],
    risk: "Medium",
    status: "Live sandbox",
    verifier: "Local grant → VTI-ready",
    policyHash: "sha256:streamlit-policy",
    evidence: "sha256:streamlit-evidence",
  },
  {
    name: "Cloud PC Excel coworker",
    kind: "Desktop computer-use agent",
    tenant: "Secure Cowork track",
    identity: "did:example:onecomputer:agent:excel-coworker",
    owner: "Platform admin",
    mandate: "Operate preapproved Excel/Claude session with human checkpoints.",
    computers: ["AWS WorkSpaces/AppStream Cloud PC"],
    risk: "High",
    status: "Design track",
    verifier: "VTI step-up planned",
    policyHash: "pending",
    evidence: "pending",
  },
] satisfies readonly AgentControlRecord[];

export const AgentsPageContent = () => {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Agent Control Pane"
        description="Inventory and control state for AI agents: identity, owner, mandate, linked computers, active grants, policy, response actions, and evidence."
      />

      <Card className="border-brand/30 bg-brand/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-brand">
                <ShieldCheck className="size-3" /> Agent inventory
              </Badge>
              <Badge variant="outline">Pilot source: InvGini</Badge>
              <Badge variant="outline">Identity / mandate / controls</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              AI agent exposure, ownership, and enforcement status.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use this pane to answer the operational questions: which agents
              exist, what they are allowed to touch, who owns them, which policy
              is in force, and what response action can stop or revoke access.
            </p>
          </div>
          <div className="grid gap-2 rounded-xl border bg-background p-4 text-xs sm:grid-cols-2 lg:w-[420px]">
            <Metric label="Total agents" value="3" />
            <Metric label="High exposure" value="2" />
            <Metric label="Verifier state" value="1 active" />
            <Metric label="UX gate" value="P6.3" />
          </div>
        </div>
      </Card>

      <AgentControlWorkbench agents={agents} />
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border bg-muted/20 p-3">
    <p className="text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);
