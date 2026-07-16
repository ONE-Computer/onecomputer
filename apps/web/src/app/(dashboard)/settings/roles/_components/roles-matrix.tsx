"use client";

import { Check, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";
import { cn } from "@onecli/ui/lib/utils";
import type { OrgRole } from "@/lib/api";

const ROLE_COLUMNS: { role: OrgRole; label: string; description: string }[] = [
  {
    role: "owner",
    label: "Owner/Platform",
    description: "Manages org, billing, users, and all resources.",
  },
  {
    role: "admin",
    label: "Cyber Admin",
    description: "Security operations, policies, kill switch, evidence.",
  },
  {
    role: "manager",
    label: "Manager",
    description: "Approve team requests, view team activity.",
  },
  {
    role: "member",
    label: "Employee",
    description: "Manage own sandboxes, agents, and apps.",
  },
];

type Access = "full" | "none" | "own" | "team";

interface PermissionRow {
  resource: string;
  action: string;
  access: Record<OrgRole, Access>;
}

// Mirrors the effective grants in packages/api/src/lib/ability.ts. Kept as a
// static reference table for the UX — not derived from CASL directly, so
// update both places if ability.ts changes.
const ROWS: PermissionRow[] = [
  {
    resource: "Sandboxes",
    action: "Create",
    access: { owner: "full", admin: "full", manager: "none", member: "full" },
  },
  {
    resource: "Sandboxes",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Sandboxes",
    action: "Execute",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Sandboxes",
    action: "Delete",
    access: { owner: "full", admin: "full", manager: "none", member: "own" },
  },
  {
    resource: "Agents",
    action: "Create",
    access: { owner: "full", admin: "full", manager: "none", member: "full" },
  },
  {
    resource: "Agents",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Agents",
    action: "Execute",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Agents",
    action: "Delete",
    access: { owner: "full", admin: "full", manager: "none", member: "own" },
  },
  {
    resource: "Approvals",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Approvals",
    action: "Approve",
    access: { owner: "full", admin: "full", manager: "team", member: "none" },
  },
  {
    resource: "Approvals",
    action: "Deny",
    access: { owner: "full", admin: "full", manager: "team", member: "none" },
  },
  {
    resource: "Policy rules",
    action: "Create",
    access: { owner: "full", admin: "full", manager: "none", member: "none" },
  },
  {
    resource: "Policy rules",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "none" },
  },
  {
    resource: "Policy rules",
    action: "Update",
    access: { owner: "full", admin: "full", manager: "none", member: "none" },
  },
  {
    resource: "Policy rules",
    action: "Delete",
    access: { owner: "full", admin: "full", manager: "none", member: "none" },
  },
  {
    resource: "Secrets/connectors",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "none" },
  },
  {
    resource: "Secrets/connectors",
    action: "Create",
    access: { owner: "full", admin: "full", manager: "none", member: "full" },
  },
  {
    resource: "Secrets/connectors",
    action: "Revoke",
    access: { owner: "full", admin: "full", manager: "none", member: "none" },
  },
  {
    resource: "Evidence/activity",
    action: "Read",
    access: { owner: "full", admin: "full", manager: "full", member: "own" },
  },
  {
    resource: "Evidence/activity",
    action: "Export",
    access: { owner: "full", admin: "full", manager: "none", member: "none" },
  },
];

const ACCESS_LABEL: Record<Access, string> = {
  full: "Full",
  own: "Own only",
  team: "Team",
  none: "No access",
};

const AccessCell = ({ access }: { access: Access }) => {
  if (access === "none") {
    return (
      <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
        <X className="size-3.5" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5",
        access === "full" ? "text-brand" : "text-foreground",
      )}
    >
      <Check className="size-3.5" />
      <span className="text-xs">
        {access === "full" ? "" : ACCESS_LABEL[access]}
      </span>
    </div>
  );
};

export const RolesMatrix = () => {
  // Group rows by resource so the table can render a section header row
  // once per resource instead of repeating the resource name on every line.
  const resources = Array.from(new Set(ROWS.map((r) => r.resource)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles and permissions</CardTitle>
        <CardDescription>
          What each role can see and do across sandboxes, agents, approvals,
          policy, secrets, and evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLE_COLUMNS.map((col) => (
            <div key={col.role} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{col.label}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {col.description}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Resource / action</TableHead>
                {ROLE_COLUMNS.map((col) => (
                  <TableHead key={col.role} className="text-center">
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <ResourceRows
                  key={resource}
                  resource={resource}
                  rows={ROWS.filter((r) => r.resource === resource)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

const ResourceRows = ({
  resource,
  rows,
}: {
  resource: string;
  rows: PermissionRow[];
}) => (
  <>
    {rows.map((row, i) => (
      <TableRow key={`${resource}-${row.action}`}>
        <TableCell className="text-sm">
          {i === 0 && (
            <span className="text-foreground font-medium">{resource}</span>
          )}
          <span
            className={cn(
              "text-muted-foreground block text-xs",
              i === 0 && "mt-0.5",
            )}
          >
            {row.action}
          </span>
        </TableCell>
        {ROLE_COLUMNS.map((col) => (
          <TableCell key={col.role}>
            <AccessCell access={row.access[col.role]} />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
);
