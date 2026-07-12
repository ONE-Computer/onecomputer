"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onecli/ui/components/select";
import { Label } from "@onecli/ui/components/label";
import { rules as rulesApi } from "@/lib/api";
import type { RuleActions } from "./types";

type ActionKey =
  | "outlook_send"
  | "sharepoint_write"
  | "external_package_install"
  | "connector_write";

type ApprovalFrom = "manager" | "cyber_admin" | "both";

interface ActionConfig {
  label: string;
  /** Persona role context shown in the description */
  personaHint: string;
  hostPattern: string;
  pathPattern: string;
  method: "POST" | "PATCH" | "PUT" | "GET" | "DELETE";
}

const ACTION_CONFIGS: Record<ActionKey, ActionConfig> = {
  outlook_send: {
    label: "Outlook send",
    personaHint: "Employee (developer) sending email via Microsoft Graph",
    hostPattern: "graph.microsoft.com",
    pathPattern: "/v1.0/me/sendMail",
    method: "POST",
  },
  sharepoint_write: {
    label: "SharePoint write",
    personaHint: "Employee (developer) writing to SharePoint sites",
    hostPattern: "graph.microsoft.com",
    pathPattern: "/v1.0/sites/*",
    method: "PATCH",
  },
  external_package_install: {
    label: "External package install",
    personaHint:
      "Platform (deploy/admin) installing packages from external registries",
    hostPattern: "registry.npmjs.org",
    pathPattern: "/*",
    method: "GET",
  },
  connector_write: {
    label: "Connector write",
    personaHint: "Platform (deploy/admin) writing to external connectors",
    hostPattern: "*",
    pathPattern: "/v1/connectors/*",
    method: "POST",
  },
};

const APPROVAL_LABELS: Record<ApprovalFrom, string> = {
  manager: "Manager",
  cyber_admin: "Cyber Admin",
  both: "Both (Manager + Cyber Admin)",
};

const buildRuleName = (action: ActionKey, approval: ApprovalFrom): string => {
  const actionLabel = ACTION_CONFIGS[action].label;
  const approvalLabel = APPROVAL_LABELS[approval];
  return `Require ${approvalLabel} approval for ${actionLabel}`;
};

interface ApprovalPolicyBuilderProps {
  ruleActions?: RuleActions;
  pageScope?: "project" | "organization";
}

export const ApprovalPolicyBuilder = ({
  ruleActions,
  pageScope = "project",
}: ApprovalPolicyBuilderProps) => {
  const [selectedAction, setSelectedAction] = useState<ActionKey | "">("");
  const [approvalFrom, setApprovalFrom] = useState<ApprovalFrom | "">("");
  const [isPending, startTransition] = useTransition();

  const config = selectedAction ? ACTION_CONFIGS[selectedAction] : null;

  const handleCreate = () => {
    if (!selectedAction || !approvalFrom) return;

    const cfg = ACTION_CONFIGS[selectedAction];
    const input = {
      name: buildRuleName(selectedAction, approvalFrom),
      hostPattern: cfg.hostPattern,
      pathPattern: cfg.pathPattern,
      method: cfg.method,
      action: "manual_approval" as const,
      enabled: true,
      scope: pageScope,
    };

    startTransition(async () => {
      try {
        if (ruleActions?.createRule) {
          await ruleActions.createRule(input);
        } else {
          await rulesApi.create(input);
        }
        toast.success(
          "Policy created — future matching actions require approval.",
          { icon: <CheckCircle2 className="size-4 text-green-500" /> },
        );
        setSelectedAction("");
        setApprovalFrom("");
      } catch {
        toast.error("Failed to create policy. Please try again.");
      }
    });
  };

  return (
    <Card className="border-brand/20 bg-brand/5 p-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Approval policy builder</h2>
        <Badge variant="outline" className="text-[10px]">
          manual_approval
        </Badge>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
        Create a policy that routes a specific action through a human approval
        gate before the agent can proceed. Managers approve business requests;
        Cyber Admins approve security-sensitive operations.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Action select */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Action</Label>
          <Select
            value={selectedAction}
            onValueChange={(v) => setSelectedAction(v as ActionKey)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select an action…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="outlook_send" className="text-xs">
                Outlook send
              </SelectItem>
              <SelectItem value="sharepoint_write" className="text-xs">
                SharePoint write
              </SelectItem>
              <SelectItem value="external_package_install" className="text-xs">
                External package install
              </SelectItem>
              <SelectItem value="connector_write" className="text-xs">
                Connector write
              </SelectItem>
            </SelectContent>
          </Select>
          {config && (
            <p className="text-[11px] text-muted-foreground">
              {config.personaHint}
            </p>
          )}
        </div>

        {/* Requires approval from */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Requires approval from</Label>
          <Select
            value={approvalFrom}
            onValueChange={(v) => setApprovalFrom(v as ApprovalFrom)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select approver…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manager" className="text-xs">
                Manager
              </SelectItem>
              <SelectItem value="cyber_admin" className="text-xs">
                Cyber Admin
              </SelectItem>
              <SelectItem value="both" className="text-xs">
                Both (Manager + Cyber Admin)
              </SelectItem>
            </SelectContent>
          </Select>
          {approvalFrom === "both" && (
            <p className="text-[11px] text-muted-foreground">
              Both approvers must confirm before the action proceeds.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Policy scope</Label>
          <div className="rounded-md border bg-background/60 px-2.5 py-1.5 text-xs">
            {pageScope === "organization" ? "Company-wide" : "Project / team"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {pageScope === "organization"
              ? "Applies to every project in this company."
              : "Applies to this project and its agents."}
          </p>
        </div>
      </div>

      {/* Host/path preview */}
      {config && (
        <div className="mt-4 rounded-md border bg-background/70 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Gateway rule preview
          </p>
          <div className="grid gap-1 font-mono text-[11px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">host</span>
              <span className="rounded bg-muted px-1 py-0.5">
                {config.hostPattern}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">path</span>
              <span className="rounded bg-muted px-1 py-0.5">
                {config.pathPattern}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {config.method}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">action</span>
              <Badge variant="secondary" className="text-[10px]">
                manual_approval
              </Badge>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button
          size="sm"
          disabled={!selectedAction || !approvalFrom || isPending}
          onClick={handleCreate}
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Creating…
            </>
          ) : (
            "Create policy"
          )}
        </Button>
      </div>
    </Card>
  );
};
