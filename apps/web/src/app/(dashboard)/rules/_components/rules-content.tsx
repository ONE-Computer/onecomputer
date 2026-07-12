"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  FileUp,
  GitCompare,
  Hash,
  Info,
  KeyRound,
  LockKeyhole,
  PencilLine,
  Plus,
  ScrollText,
  Settings2,
  Shield,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  policyArtifacts as policyArtifactsApi,
  rules as rulesApi,
} from "@/lib/api";
import { queryKeys } from "@/lib/api/keys";
import { useAgents, useAgentGranularAccess } from "@/hooks/use-agents";
import { useConnections } from "@/hooks/use-connections";
import { useCanManagePolicy } from "@/hooks/use-persona-role";
import { DisabledActionButton } from "@/components/permission-gate";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { Skeleton } from "@onecli/ui/components/skeleton";
import { Separator } from "@onecli/ui/components/separator";
import { RuleCard } from "./rule-card";
import { RuleDialog } from "./rule-dialog";
import { AppPermissionSummary } from "./app-permission-summary";
import { GranularAccessSummary } from "./granular-access-summary";
import { ApprovalPolicyBuilder } from "./approval-policy-builder";
import type { PolicyMode } from "@onecli/api/validations/policy-rule";
import type { PolicyArtifactPreviewResponse } from "@/lib/api";
import type { AgentOption, PolicyRuleItem, RuleActions } from "./types";
export type { PolicyRuleItem, AgentOption, RuleActions } from "./types";

interface RulesContentProps {
  getRules?: () => Promise<PolicyRuleItem[]>;
  ruleActions?: RuleActions;
  pageScope?: "project" | "organization";
  showAgentField?: boolean;
  policyMode?: PolicyMode;
  settingsHref?: string;
}

const isAppPermissionRule = (rule: PolicyRuleItem) =>
  rule.metadata != null &&
  typeof rule.metadata === "object" &&
  "source" in rule.metadata &&
  rule.metadata.source === "app_permission";

const RulesCommandSummary = ({
  policyMode,
  customCount,
  appPermissionCount,
  granularCount,
  inheritedCount,
}: {
  policyMode: PolicyMode;
  customCount: number;
  appPermissionCount: number;
  granularCount: number;
  inheritedCount: number;
}) => {
  const isDenyMode = policyMode === "deny";
  return (
    <Card className="border-brand/20 bg-brand/5 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-brand" />
            <h2 className="text-sm font-semibold">Policy command center</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Show a CISO exactly where autonomous access is allowed, denied, or
            inherited before an agent can call external APIs.
          </p>
        </div>
        <Badge variant={isDenyMode ? "secondary" : "outline"}>
          {isDenyMode ? "Lockdown / allowlist" : "YOLO / blocklist"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {[
          ["Custom rules", customCount],
          ["App permissions", appPermissionCount],
          ["Granular grants", granularCount],
          ["Inherited controls", inheritedCount],
        ].map(([label, count]) => (
          <div key={label} className="rounded-md border bg-background/60 p-3">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold">{count}</p>
          </div>
        ))}
      </div>
    </Card>
  );
};

const samplePolicyDocument = {
  title: "MFA Document Review Standard",
  source: "Internal policy sample",
  uploadHash: "sha256:policy-doc-mfa-review",
  status: "Parsed as content, not instructions",
} as const;

const extractedControlCandidates = [
  {
    id: "POL-MFA-001",
    title: "Restrict write access to MFA workspace",
    citation: "§2.1 Workspace boundaries",
    confidence: "94%",
    mapping: "Legal MFA reviewer → SharePoint MFA workspace",
    effect: "Require approval before copy/annotate outside scoped folder.",
  },
  {
    id: "POL-MFA-002",
    title: "Require evidence for high-exposure review agents",
    citation: "§3.4 Audit and evidence",
    confidence: "91%",
    mapping: "High exposure agents → policy hash + evidence head",
    effect: "Block autonomous runs unless evidence head is attached.",
  },
  {
    id: "POL-MFA-003",
    title: "Step-up before external sharing",
    citation: "§4.2 External disclosure",
    confidence: "88%",
    mapping: "Builder apps + Legal MFA outputs → reviewer approval",
    effect: "Require human review before wider access or export.",
  },
] as const;

const reviewWorkflow = [
  ["Draft", "AI-extracted candidate only", "active"],
  ["Reviewer edits", "Cyber/compliance adjusts scope", "next"],
  ["Approved", "Human approves policy artifact", "locked"],
  ["Signed / exported", "VTI/Affinidi or enterprise signer", "locked"],
  ["Enforced", "Gateway applies after diff preview", "locked"],
] as const;

const impactPreview = [
  ["Block", "1 write path until approval", "Legal MFA reviewer"],
  ["Step-up", "2 external-share actions", "Meeting Tracker + MFA exports"],
  ["Evidence", "3 agents require evidence head", "High/medium exposure"],
  ["Owner review", "2 owners must confirm mandate", "InvGini + builder"],
] as const;

const shortHash = (value: string) =>
  value.length > 24 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;

const PolicyArtifactApiSeam = () => {
  const [approvalState, setApprovalState] = useState<
    "draft" | "edited" | "approved" | "rejected"
  >("draft");
  const { data, isPending, isError } = useQuery<PolicyArtifactPreviewResponse>({
    queryKey: queryKeys.policyArtifacts.sample(),
    queryFn: policyArtifactsApi.samplePreview,
    staleTime: 60_000,
  });

  const preview = data?.preview;
  const controls = preview?.controls ?? [];
  const policyDiff = preview?.policyDiff ?? [];
  const approvalWorkflow = data?.approvalWorkflow;
  const diffExport = data?.diffExport;
  const approvalLabel =
    approvalState === "approved"
      ? "approved — signer/export still required"
      : approvalState === "rejected"
        ? "rejected — no enforcement"
        : approvalState === "edited"
          ? "reviewer edits captured"
          : "draft review required";
  const exportPolicyDiff = () => {
    if (!diffExport) return;
    const blob = new Blob([JSON.stringify(diffExport, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${diffExport.exportId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-emerald-600">
              <KeyRound className="size-3.5" />
              Deterministic API seam
            </Badge>
            <Badge variant="outline">
              /api/onecomputer/policy-artifacts/sample
            </Badge>
            <Badge variant="outline">P3-compatible after review</Badge>
          </div>
          <h3 className="mt-3 text-sm font-semibold tracking-tight">
            Draft policy artifact can now be generated with a stable hash
          </h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            P7.2 turns the compliance preview into an inspectable artifact seam:
            the API returns deterministic metadata, cited controls, a policy
            diff, prompt-injection safety notes, and an artifact hash. It still
            stores no raw document text and does not enforce anything until a
            human reviewer approves and an external signer is wired.
          </p>
        </div>
        <div className="rounded-lg border bg-background/70 p-3 text-xs lg:w-[420px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isError ? "destructive" : "secondary"}>
              {isPending
                ? "loading"
                : isError
                  ? "API fallback needed"
                  : "live seam"}
            </Badge>
            <Badge variant="outline">
              {preview?.status.replaceAll("_", " ") ?? "draft review required"}
            </Badge>
          </div>
          <div className="mt-3 space-y-2">
            <p className="flex items-start gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
              <Hash className="mt-0.5 size-3.5 shrink-0" />
              {preview?.artifactHash
                ? shortHash(preview.artifactHash)
                : "sha256:pending-api-response"}
            </p>
            <p className="flex items-start gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
              <Hash className="mt-0.5 size-3.5 shrink-0" />
              {preview?.p3Compatibility.idempotencyKey
                ? shortHash(preview.p3Compatibility.idempotencyKey)
                : "idempotency:pending"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Artifact ID
          </p>
          <p className="mt-1 break-all font-mono text-xs font-medium">
            {preview?.artifactId ?? "opa_pending"}
          </p>
        </div>
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Controls emitted
          </p>
          <p className="mt-1 text-xs font-medium">
            {controls.length || extractedControlCandidates.length} cited draft
            controls
          </p>
        </div>
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Enforcement posture
          </p>
          <p className="mt-1 text-xs font-medium">
            {data?.apiSemantics.enforcement.replaceAll("_", " ") ??
              "not enforced"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            <p className="text-xs font-semibold">Safety guarantees</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
            <li>• Uploaded text is content evidence, not instructions.</li>
            <li>• Generated artifact is draft-only and reviewer-gated.</li>
            <li>• VTI/Affinidi or enterprise signer remains external.</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <GitCompare className="size-3.5 text-emerald-600" />
            <p className="text-xs font-semibold">Diff emitted by API</p>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(policyDiff.length > 0
              ? policyDiff
              : impactPreview.map(([label, count, target]) => ({
                  effect: label.toLowerCase().replace("-", "_") as string,
                  count: Number.parseInt(count, 10) || 1,
                  targets: [target],
                }))
            ).map((item) => (
              <div
                key={item.effect}
                className="rounded-md border bg-muted/20 p-2"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide">
                  {item.effect.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.count} target{item.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border bg-background/70 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <UserCheck className="size-3.5 text-emerald-600" />
                <p className="text-xs font-semibold">Human approval workflow</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Reviewer can edit, approve, or reject the draft. Approval
                appends an evidence event preview but still cannot enforce until
                signed.
              </p>
            </div>
            <Badge
              variant={
                approvalState === "rejected" ? "destructive" : "secondary"
              }
            >
              {approvalLabel}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setApprovalState("edited")}
              disabled={!approvalWorkflow || approvalState === "approved"}
            >
              Edit draft
            </Button>
            <Button
              size="sm"
              onClick={() => setApprovalState("approved")}
              disabled={!approvalWorkflow || approvalState === "rejected"}
            >
              <CheckCircle2 className="size-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setApprovalState("rejected")}
              disabled={!approvalWorkflow || approvalState === "approved"}
            >
              <XCircle className="size-3.5" />
              Reject
            </Button>
          </div>
          <div className="mt-3 rounded-md border bg-muted/20 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
            <p>
              event:{" "}
              {shortHash(
                approvalWorkflow?.evidenceAppendPreview.decisionEventHash ??
                  "sha256:pending",
              )}
            </p>
            <p>
              next head:{" "}
              {shortHash(
                approvalWorkflow?.evidenceAppendPreview.nextHead ??
                  "sha256:pending",
              )}
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Download className="size-3.5 text-emerald-600" />
                <p className="text-xs font-semibold">Policy diff export</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Export is metadata-only and reviewer-gated. It lists impacted
                agents/computers/actions without carrying raw document text.
              </p>
            </div>
            <Badge variant="outline">
              {diffExport?.exportId ?? "pdx_pending"}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">
                Block
              </p>
              <p className="text-xs font-medium">
                {diffExport?.summary.block ?? 0}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">
                Step-up
              </p>
              <p className="text-xs font-medium">
                {diffExport?.summary.stepUp ?? 0}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">
                Evidence
              </p>
              <p className="text-xs font-medium">
                {diffExport?.summary.requireEvidence ?? 0}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">
                Review
              </p>
              <p className="text-xs font-medium">
                {diffExport?.summary.ownerReview ?? 0}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full sm:w-auto"
            onClick={exportPolicyDiff}
            disabled={!diffExport}
          >
            <Download className="size-3.5" />
            Export diff JSON
          </Button>
        </div>
      </div>
    </Card>
  );
};

const PolicyCompilerPreview = () => (
  <Card className="border-brand/20 bg-brand/5 p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 text-brand">
            <FileUp className="size-3.5" />
            Policy engine phase
          </Badge>
          <Badge variant="outline">Compliance document intake</Badge>
          <Badge variant="outline">Human approval required</Badge>
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-tight">
          Compliance document → reviewable policy artifacts
        </h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Planned P7 flow: cyber or compliance uploads MAS/MFA/internal policy
          documents, OneComputer extracts controls, maps them to agent and
          computer scopes, then produces draft policy artifacts with citations
          and evidence requirements. Nothing is enforced until a reviewer
          approves the generated policy set.
        </p>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3 lg:w-[520px]">
        {[
          [
            "1",
            "Extract controls",
            "Find obligations, prohibitions, approvals.",
          ],
          [
            "2",
            "Map scope",
            "Bind controls to agents, computers, data classes.",
          ],
          ["3", "Approve policy", "Reviewer signs before enforcement."],
        ].map(([step, title, detail]) => (
          <div key={step} className="rounded-lg border bg-background/70 p-3">
            <div className="flex items-center gap-2">
              {step === "1" ? (
                <ScrollText className="size-3.5 text-brand" />
              ) : step === "2" ? (
                <Shield className="size-3.5 text-brand" />
              ) : (
                <ShieldCheck className="size-3.5 text-brand" />
              )}
              <p className="font-medium">
                {step}. {title}
              </p>
            </div>
            <p className="mt-2 text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>
    </div>

    <div className="mt-5">
      <PolicyArtifactApiSeam />
    </div>

    <div className="mt-5 grid gap-4 2xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="bg-background/70 p-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Document intake preview</h3>
        </div>
        <div className="mt-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{samplePolicyDocument.title}</Badge>
            <Badge variant="outline">{samplePolicyDocument.source}</Badge>
          </div>
          <p className="mt-3 flex items-start gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
            <Hash className="mt-0.5 size-3.5 shrink-0" />
            {samplePolicyDocument.uploadHash}
          </p>
          <p className="mt-3 flex items-start gap-2 rounded-md border bg-background/70 p-2 text-xs leading-5 text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            Prompt-injection guard: uploaded text is treated as evidence content
            only. It cannot instruct OneComputer to grant access, disable
            logging, or bypass review.
          </p>
        </div>

        <div className="mt-4 grid gap-2">
          {reviewWorkflow.map(([step, detail, state], index) => (
            <div
              key={step}
              className="grid grid-cols-[28px_1fr_auto] gap-2 rounded-lg border bg-muted/20 p-3 text-xs"
            >
              <span className="flex size-7 items-center justify-center rounded-full border bg-background font-medium">
                {index + 1}
              </span>
              <div>
                <p className="font-medium">{step}</p>
                <p className="mt-1 text-muted-foreground">{detail}</p>
              </div>
              <Badge variant={state === "active" ? "secondary" : "outline"}>
                {state}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="bg-background/70 p-4">
        <div className="flex items-center gap-2">
          <FileCheck2 className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">
            Draft controls with citations
          </h3>
        </div>
        <div className="mt-4 space-y-3">
          {extractedControlCandidates.map((control) => (
            <div key={control.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{control.id}</Badge>
                <Badge variant="outline">{control.confidence}</Badge>
                <Badge variant="outline">{control.citation}</Badge>
              </div>
              <p className="mt-3 text-sm font-medium">{control.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {control.mapping}
              </p>
              <p className="mt-2 rounded-md border bg-background/70 p-2 text-xs leading-5 text-muted-foreground">
                {control.effect}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Card className="bg-background/70 p-4">
        <div className="flex items-center gap-2">
          <GitCompare className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Policy impact preview</h3>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {impactPreview.map(([label, count, target]) => (
            <div key={label} className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-semibold">{count}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {target}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="bg-background/70 p-4">
        <div className="flex items-center gap-2">
          <PencilLine className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Reviewer actions</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          P7’s core safety rule: AI may draft policy candidates, but only a
          human reviewer can approve, sign/export, or enforce them.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Button size="sm" variant="outline" disabled>
            Edit draft
          </Button>
          <Button size="sm" variant="outline" disabled>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled>
            Reject
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
          Artifact target: P3-compatible policy hash + evidence-chain append
          after reviewer approval.
        </p>
      </Card>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled>
        <FileUp className="size-3.5" />
        Upload document — P7
      </Button>
      <Button size="sm" variant="outline" disabled>
        Preview generated controls
      </Button>
      <Button size="sm" variant="outline" disabled>
        Export policy diff
      </Button>
    </div>
  </Card>
);

const fallbackPolicies = [
  {
    title: "Default-deny external write actions",
    detail:
      "Agents may not write, delete, send, or export outside approved computers without reviewer approval.",
  },
  {
    title: "Evidence required for high-exposure agents",
    detail:
      "High-exposure agents must attach policy hash, owner, mandate, and evidence head before autonomous runs.",
  },
  {
    title: "Compliance document intake is draft-only",
    detail:
      "Uploaded policy documents create draft controls with citations. They are not enforced until human approval.",
  },
] as const;

const PolicyLibraryFallback = ({ mode }: { mode: PolicyMode }) => (
  <Card className="border-amber-500/30 bg-amber-500/5 p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">
            Rules API unavailable — showing policy-library fallback
          </h2>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
          The live rules registry did not load. To avoid a blank/error screen,
          OneComputer shows non-enforced baseline policies for review. This
          fallback is read-only and does not imply enforcement.
        </p>
      </div>
      <Badge variant="outline">Mode: {mode}</Badge>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      {fallbackPolicies.map((policy) => (
        <div
          key={policy.title}
          className="rounded-lg border bg-background/70 p-3"
        >
          <div className="flex items-center gap-2">
            <Shield className="size-3.5 text-brand" />
            <p className="text-sm font-medium">{policy.title}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {policy.detail}
          </p>
        </div>
      ))}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled>
        Retry sync — upcoming
      </Button>
      <Button size="sm" variant="outline" disabled>
        Export fallback pack — upcoming
      </Button>
    </div>
  </Card>
);

export const RulesContent = ({
  getRules,
  ruleActions,
  pageScope = "project",
  showAgentField = true,
  policyMode = "allow",
  settingsHref,
}: RulesContentProps) => {
  const isDenyMode = policyMode === "deny";
  const canManagePolicy = useCanManagePolicy();
  const {
    data: rules = [],
    isPending: loading,
    isError,
  } = useQuery<PolicyRuleItem[]>({
    queryKey: [...queryKeys.rules.list(), pageScope],
    queryFn: (getRules ?? rulesApi.list) as () => Promise<PolicyRuleItem[]>,
  });
  const { data: agentsList = [] } = useAgents();
  const agents: AgentOption[] = useMemo(
    () => agentsList.map((a) => ({ id: a.id, name: a.name })),
    [agentsList],
  );
  const { data: granularEntries = [] } = useAgentGranularAccess(
    pageScope === "project",
  );
  const { data: connectionsList = [] } = useConnections();
  const connectedProviders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of connectionsList) {
      if (c.status !== "connected") continue;
      const labels = map.get(c.provider) ?? [];
      if (c.label) labels.push(c.label);
      map.set(c.provider, labels);
    }
    return map;
  }, [connectionsList]);
  const [createOpen, setCreateOpen] = useState(false);

  const isInherited = (r: PolicyRuleItem) =>
    r.scope != null && r.scope !== pageScope;

  const ownRules: PolicyRuleItem[] = [];
  const inheritedRules: PolicyRuleItem[] = [];
  const appPermRules: PolicyRuleItem[] = [];

  for (const r of rules) {
    if (isAppPermissionRule(r)) {
      appPermRules.push(r);
    } else if (isInherited(r)) {
      inheritedRules.push(r);
    } else {
      ownRules.push(r);
    }
  }

  const customRules = [...ownRules, ...inheritedRules];

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-5 w-9 rounded-full" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <PolicyCompilerPreview />
        <RulesCommandSummary
          policyMode={policyMode}
          customCount={0}
          appPermissionCount={0}
          granularCount={granularEntries.length}
          inheritedCount={0}
        />
        <ApprovalPolicyBuilder
          ruleActions={ruleActions}
          pageScope={pageScope}
        />
        <PolicyLibraryFallback mode={policyMode} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PolicyCompilerPreview />
      <RulesCommandSummary
        policyMode={policyMode}
        customCount={ownRules.length}
        appPermissionCount={appPermRules.length}
        granularCount={granularEntries.length}
        inheritedCount={inheritedRules.length}
      />
      <ApprovalPolicyBuilder ruleActions={ruleActions} pageScope={pageScope} />
      {/* Strictest-wins doctrine note */}
      <div className="flex items-start gap-2 rounded-md border border-brand/20 bg-brand/5 px-3.5 py-2.5 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
        <p className="text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">
            Team = project scope.
          </span>{" "}
          Enterprise policies set the floor; teams and users can only make rules
          stricter, never weaker.{" "}
          <Link
            href="/settings/members"
            className="text-brand underline-offset-2 hover:underline"
          >
            Manage team members
          </Link>{" "}
          to set a Team policy from the members page.
        </p>
      </div>

      <div className="flex justify-end">
        {canManagePolicy ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New Rule
          </Button>
        ) : (
          <DisabledActionButton size="sm" reason="Requires Cyber Admin">
            <Plus className="size-3.5" />
            New Rule
          </DisabledActionButton>
        )}
      </div>

      {customRules.length === 0 &&
      appPermRules.length === 0 &&
      granularEntries.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          {isDenyMode ? (
            <>
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-blue-500/10">
                <Shield className="size-6 text-blue-500" />
              </div>
              <p className="text-sm font-medium">Lockdown mode</p>
              <p className="text-muted-foreground mt-1 max-w-xs text-xs">
                All traffic is blocked by default. Add an allow rule to permit
                specific endpoints your agents need.
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/10">
                <ShieldOff className="size-6 text-amber-500" />
              </div>
              <p className="text-sm font-medium">YOLO mode</p>
              <p className="text-muted-foreground mt-1 max-w-xs text-xs">
                Your agents have unrestricted access to all assigned secrets.
                Add a rule to block specific endpoints or set boundaries.
              </p>
            </>
          )}
          {settingsHref && (
            <Link
              href={settingsHref}
              className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 text-xs transition-colors"
            >
              <Settings2 className="size-3" />
              Change policy mode
            </Link>
          )}
        </Card>
      ) : (
        <>
          {customRules.length > 0 && (
            <div className="space-y-3">
              {customRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  agents={agents}
                  readOnly={isInherited(rule)}
                  badge={isInherited(rule) ? "Organization" : undefined}
                  ruleActions={ruleActions}
                  policyMode={policyMode}
                />
              ))}
            </div>
          )}

          {appPermRules.length > 0 && (
            <>
              {customRules.length > 0 && (
                <div className="flex items-center gap-3 pt-2">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    App permissions
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}
              <AppPermissionSummary
                rules={appPermRules}
                pageScope={pageScope}
                connectedProviders={connectedProviders}
              />
            </>
          )}

          {granularEntries.length > 0 && (
            <>
              {(customRules.length > 0 || appPermRules.length > 0) && (
                <div className="flex items-center gap-3 pt-2">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground shrink-0 text-xs">
                    Granular access
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}
              <GranularAccessSummary entries={granularEntries} />
            </>
          )}
        </>
      )}

      <RuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={showAgentField ? agents : []}
        showAgentField={showAgentField}
        ruleActions={ruleActions}
        connectedProviders={connectedProviders}
        policyMode={policyMode}
      />
    </div>
  );
};
