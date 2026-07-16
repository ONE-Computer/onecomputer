import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
  subject,
  type ForcedSubject,
} from "@casl/ability";

// Resource types mapped from Prisma models. Subjects that carry row-scoping
// conditions are declared as interfaces tagged with ForcedSubject<T> so CASL
// can type-check the `conditions` argument to `can`/`cannot`.
export type AppAbility = MongoAbility<[Actions, Subjects]>;

export type Actions =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "execute"
  | "approve"
  | "revoke"
  | "manage";

export interface AgentSubject extends ForcedSubject<"Agent"> {
  ownerId?: string;
}
export interface SandboxSubject extends ForcedSubject<"Sandbox"> {
  ownerId?: string;
}
export interface ApprovalRequestSubject extends ForcedSubject<"ApprovalRequest"> {
  requestedBy?: string;
}
export interface AuditLogSubject extends ForcedSubject<"AuditLog"> {
  userId?: string;
}

export type Subjects =
  | AgentSubject
  | SandboxSubject
  | ApprovalRequestSubject
  | AuditLogSubject
  | "Agent"
  | "Sandbox"
  | "Secret"
  | "PolicyRule"
  | "AppConnection"
  | "ApprovalRequest"
  | "AuditLog"
  | "RequestLog"
  | "DlpAlert"
  | "Organization"
  | "OrganizationMember"
  | "all";

export type OrgRole = "owner" | "admin" | "manager" | "member";

export interface AbilityUser {
  id: string;
  orgId: string;
  role: OrgRole;
}

export function defineAbilityFor(user: AbilityUser): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility,
  );

  if (user.role === "owner" || user.role === "admin") {
    // Cyber persona + owner: full org access
    can("manage", "all");
  } else if (user.role === "manager") {
    // Manager persona: read all, execute+approve their team, can't delete policy
    can(["read", "execute"], "Agent");
    can(["read", "execute"], "Sandbox");
    can("read", ["Secret", "AuditLog", "RequestLog", "DlpAlert"]);
    can(["read", "approve"], "ApprovalRequest");
    can("read", ["PolicyRule", "AppConnection"]);
    cannot("delete", ["PolicyRule", "Secret"]);
    cannot("manage", "Organization");
  } else {
    // Employee persona (member): own resources only
    can("create", ["Agent", "Sandbox", "AppConnection"]);
    can(["read", "update", "delete", "execute"], "Agent", {
      ownerId: user.id,
    });
    can(["read", "execute", "delete"], "Sandbox", { ownerId: user.id });
    can("read", "ApprovalRequest", { requestedBy: user.id });
    can("read", "AuditLog", { userId: user.id });
    cannot("approve", "ApprovalRequest");
    cannot("manage", ["PolicyRule", "Organization", "Secret"]);
  }

  return build();
}

// Re-export subject helper for single-resource checks
export { subject };
