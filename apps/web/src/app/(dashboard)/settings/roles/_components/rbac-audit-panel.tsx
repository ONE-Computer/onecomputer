"use client";

import { usePersonaRole } from "@/hooks/use-persona-role";
import type { PersonaRole } from "@/lib/role-preference";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import { Badge } from "@onecli/ui/components/badge";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface RoleProfile {
  label: string;
  description: string;
  canDo: string[];
  cannotDo: string[];
}

const ROLE_PROFILES: Record<PersonaRole, RoleProfile> = {
  admin: {
    label: "Cyber Admin",
    description:
      "Security operations persona. Full org-wide access to enforce policy, review evidence, and perform kill-switch actions.",
    canDo: [
      "Create, read, update, and delete any sandbox or agent",
      "Create, update, and delete policy rules",
      "Approve or deny any approval request",
      "Read and export all evidence and audit logs",
      "Manage secrets and revoke app connections",
      "Manage organization members and settings",
    ],
    cannotDo: [
      // admin === manage all — nothing blocked at the ability layer
      "No restrictions — full manage access across all resources",
    ],
  },
  owner: {
    label: "Owner / Platform",
    description:
      "Platform admin persona. Same full access as Cyber Admin, plus billing and org-level settings.",
    canDo: [
      "Everything Cyber Admin can do",
      "Manage billing and organization-level configuration",
      "Transfer or delete the organization",
    ],
    cannotDo: ["No restrictions — full manage access across all resources"],
  },
  manager: {
    label: "Manager",
    description:
      "Approvals persona. Read-only across the org, with execute rights on agents and sandboxes and approval authority over team requests.",
    canDo: [
      "Read any agent or sandbox (org-wide)",
      "Execute (run) any agent or sandbox",
      "Read secrets and app connections (no write)",
      "Read and approve or deny approval requests",
      "Read policy rules and audit logs",
    ],
    cannotDo: [
      "Create or delete policy rules",
      "Create, update, or delete secrets",
      "Manage organization settings or members",
      "Export evidence or audit logs",
      "Delete sandboxes or agents",
    ],
  },
  member: {
    label: "Employee / Developer",
    description:
      "Developer persona. Can create sandboxes, agents, and app connections, but can only read or modify resources they own.",
    canDo: [
      "Create sandboxes, agents, and app connections",
      "Read, update, delete, and execute own agents",
      "Read and execute own sandboxes",
      "Read own approval requests",
      "Read own audit log entries",
    ],
    cannotDo: [
      "Read or modify other users' sandboxes or agents",
      "Approve or deny approval requests",
      "Create, update, or delete policy rules",
      "Read or manage secrets",
      "Manage organization settings or members",
      "Export evidence or audit logs",
    ],
  },
};

type DecisionResult = "allowed" | "denied" | "conditional";

interface ExampleDecision {
  action: string;
  result: Record<PersonaRole, DecisionResult>;
  conditionNote?: Partial<Record<PersonaRole, string>>;
}

const EXAMPLE_DECISIONS: ExampleDecision[] = [
  {
    action: "Delete sandbox",
    result: {
      owner: "allowed",
      admin: "allowed",
      manager: "denied",
      member: "conditional",
    },
    conditionNote: {
      member: "Only for sandboxes you own",
    },
  },
  {
    action: "Approve request",
    result: {
      owner: "allowed",
      admin: "allowed",
      manager: "allowed",
      member: "denied",
    },
  },
  {
    action: "Create policy rule",
    result: {
      owner: "allowed",
      admin: "allowed",
      manager: "denied",
      member: "denied",
    },
  },
  {
    action: "Export evidence",
    result: {
      owner: "allowed",
      admin: "allowed",
      manager: "denied",
      member: "denied",
    },
  },
];

const DECISION_CONFIG: Record<
  DecisionResult,
  { icon: React.ReactNode; label: string; className: string }
> = {
  allowed: {
    icon: <CheckCircle2 className="size-4 text-emerald-600" />,
    label: "Allowed",
    className: "text-emerald-700 dark:text-emerald-400",
  },
  denied: {
    icon: <XCircle className="size-4 text-destructive" />,
    label: "Denied",
    className: "text-destructive",
  },
  conditional: {
    icon: <AlertCircle className="size-4 text-amber-600" />,
    label: "Conditional",
    className: "text-amber-700 dark:text-amber-400",
  },
};

export const RbacAuditPanel = () => {
  const role = usePersonaRole();
  const profile = ROLE_PROFILES[role];

  return (
    <div className="flex flex-col gap-4">
      {/* Current role + summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Why can I do this?</CardTitle>
            <Badge variant="secondary">{profile.label}</Badge>
          </div>
          <CardDescription>{profile.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              What this role can do
            </p>
            <ul className="space-y-1.5">
              {profile.canDo.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              What this role cannot do
            </p>
            <ul className="space-y-1.5">
              {profile.cannotDo.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Example decisions */}
      <Card>
        <CardHeader>
          <CardTitle>Example decisions for your role</CardTitle>
          <CardDescription>
            How the current role model resolves common actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {EXAMPLE_DECISIONS.map((decision) => {
              const result = decision.result[role];
              const note = decision.conditionNote?.[role];
              const config = DECISION_CONFIG[result];
              return (
                <div
                  key={decision.action}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <span className="text-sm">{decision.action}</span>
                  <div className="flex items-center gap-2">
                    {config.icon}
                    <span className={`text-sm font-medium ${config.className}`}>
                      {config.label}
                    </span>
                    {note && (
                      <span className="text-xs text-muted-foreground">
                        ({note})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">
        Production decisions are enforced by the API; this panel explains the
        current role model. Switch your preview persona in{" "}
        <strong>Settings &rarr; Profile</strong> to see how decisions change for
        other roles.
      </p>
    </div>
  );
};
