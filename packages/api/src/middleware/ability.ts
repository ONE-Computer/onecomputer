import { createMiddleware } from "hono/factory";

import { db } from "@onecli/db";

import {
  defineAbilityFor,
  type AppAbility,
  type OrgRole,
} from "../lib/ability";
import { ServiceError } from "../services/errors";
import type { ApiEnv } from "../types";

// Extends ApiEnv so this composes with the existing `auth` middleware, which
// sets `c.get("auth")` ({ userId, organizationId, role? }). Run `auth` first,
// then `withAbility`.
export type AbilityEnv = {
  Variables: ApiEnv["Variables"] & { ability: AppAbility };
};

const VALID_ROLES = new Set<OrgRole>(["owner", "admin", "manager", "member"]);

function isOrgRole(value: string): value is OrgRole {
  return VALID_ROLES.has(value as OrgRole);
}

// Attach ability to Hono context — call this in every route that needs RBAC.
// Must run AFTER the `auth` middleware so `c.get("auth")` is populated.
export const withAbility = createMiddleware<AbilityEnv>(async (c, next) => {
  const auth = c.get("auth");

  if (!auth) {
    // Not authenticated — defer to the route handler / downstream auth guard.
    c.set("ability", defineAbilityFor({ id: "", orgId: "", role: "member" }));
    return next();
  }

  // Prefer the role already resolved by the `auth({ role })` middleware; fall
  // back to a DB lookup on OrganizationMember.
  let role: OrgRole = "member";
  if (auth.role) {
    role = auth.role;
  } else {
    const member = await db.organizationMember.findFirst({
      where: {
        userId: auth.userId,
        organizationId: auth.organizationId,
      },
      select: { role: true },
    });
    if (member && isOrgRole(member.role)) {
      role = member.role;
    }
  }

  c.set(
    "ability",
    defineAbilityFor({
      id: auth.userId,
      orgId: auth.organizationId,
      role,
    }),
  );

  return next();
});

// Convenience: throw 403 (via ServiceError, mapped by errorHandler) if the
// ability check fails. Use inside route handlers that have `withAbility` set
// `c.get("ability")`.
export function requireAbility(
  ability: AppAbility,
  action: Parameters<AppAbility["can"]>[0],
  resource: Parameters<AppAbility["can"]>[1],
): void {
  if (!ability.can(action, resource)) {
    throw new ServiceError(
      "FORBIDDEN",
      `Forbidden: insufficient permission for ${String(action)} on ${String(
        typeof resource === "string"
          ? resource
          : ((resource as { __caslSubjectType__?: unknown })
              ?.__caslSubjectType__ ?? "resource"),
      )}`,
    );
  }
}
