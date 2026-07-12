import type { Metadata } from "next";
import {
  BrainCircuit,
  CloudCog,
  FileSearch,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { PageHeader } from "@dashboard/page-header";

export const metadata: Metadata = {
  title: "Compliance Copilot",
};

const futureFlow = [
  {
    title: "Boot governed runtime",
    detail:
      "Start a Claude/AWS AgentCore-style worker with scoped access to approved compliance, policy, registry, and evidence indexes.",
    icon: CloudCog,
  },
  {
    title: "Ask across evidence",
    detail:
      "Cyber/compliance asks questions about trends, gaps, approvals, exceptions, and policy coverage across OneComputer data.",
    icon: MessageSquareText,
  },
  {
    title: "Return cited answers",
    detail:
      "Responses must cite source policy sections, evidence hashes, agent passports, and registry records before recommending action.",
    icon: FileSearch,
  },
  {
    title: "Approve before action",
    detail:
      "Copilot can draft policy diffs or review tasks, but enforcement still requires human approval and audit capture.",
    icon: ShieldCheck,
  },
] as const;

export default function CopilotPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Compliance Copilot"
        description="Future governed chat surface for cyber and compliance teams to ask questions across policy, registry, and evidence data."
      />

      <Card className="border-brand/30 bg-brand/5 p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-brand">
                <BrainCircuit className="size-3.5" /> Future P9
              </Badge>
              <Badge variant="outline">AWS AgentCore / Claude runtime</Badge>
              <Badge variant="outline">Read-only first</Badge>
              <Badge variant="outline">Human approval required</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Chat against compliance data without bypassing governance.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This tab is intentionally a placeholder until P7 Policy Engine and
              P8 production pilot controls exist. The goal is to copy the best
              InvestmentGini agent-runtime pattern, then boot a governed Claude
              or AWS AgentCore worker that can query approved compliance data,
              policy artifacts, agent passports, runtime registry, and evidence
              chains.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4 text-xs xl:w-[420px]">
            <div className="flex items-center gap-2 font-medium">
              <LockKeyhole className="size-4 text-brand" /> Guardrails before
              launch
            </div>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <p>
                • Read-only retrieval before any write or enforcement action.
              </p>
              <p>• Answers require citations to policy/evidence sources.</p>
              <p>• No raw secrets or connector credentials in model context.</p>
              <p>
                • Prompt-injection checks for uploaded compliance documents.
              </p>
              <p>
                • Human approval before generated policy diffs are enforced.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        {futureFlow.map((step, index) => (
          <Card key={step.title} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <step.icon className="size-4 text-brand" />
              <Badge variant="outline">Step {index + 1}</Badge>
            </div>
            <h3 className="mt-4 text-sm font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {step.detail}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Chat is disabled until the trust plane is ready
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              P9 should only ship after policy artifacts, evidence chains,
              access boundaries, and production pilot controls are stable. This
              prevents a powerful copilot from becoming a shadow-IT bypass.
            </p>
          </div>
          <Button disabled>Start governed copilot — P9</Button>
        </div>
      </Card>
    </div>
  );
}
