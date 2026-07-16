import { Hono } from "hono";
import { auth } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import {
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  getRoleMatrix,
} from "../services/member-service";
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "../validations/member";

// Members are org-scoped, not project-scoped — do not require a projectId.
const orgAuth = auth({ requireProject: false });

export const memberRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", orgAuth);
  // RBAC: attach CASL ability to context. Must run after `orgAuth`.
  app.use("*", withAbility);

  // GET /members — list current org members.
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "OrganizationMember");
    const members = await listMembers(auth.organizationId);
    return c.json(members);
  });

  // GET /members/roles — role/permission matrix for UI display. Any
  // authenticated org member may view this (it describes capabilities, not
  // data), so no ability check beyond being authenticated.
  app.get("/roles", async (c) => {
    return c.json(getRoleMatrix());
  });

  // POST /members/invite — owner/admin only (enforced via "manage" on
  // OrganizationMember, which only owner/admin hold per ability.ts).
  app.post("/invite", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "manage", "OrganizationMember");
    const body = await c.req.json().catch(() => null);
    const parsed = inviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const requesterRole = auth.role ?? "member";
    const result = await inviteMember(
      auth.organizationId,
      auth.userId,
      auth.userEmail,
      requesterRole,
      parsed.data,
    );
    return c.json(result, 201);
  });

  // PATCH /members/:userId/role — owner/admin only.
  app.patch("/:userId/role", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "manage", "OrganizationMember");
    const targetUserId = c.req.param("userId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateMemberRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const requesterRole = auth.role ?? "member";
    const result = await updateMemberRole(
      auth.organizationId,
      targetUserId,
      requesterRole,
      parsed.data,
    );
    return c.json(result);
  });

  // DELETE /members/:userId — owner/admin only.
  app.delete("/:userId", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "manage", "OrganizationMember");
    const targetUserId = c.req.param("userId");
    await removeMember(auth.organizationId, targetUserId);
    return c.body(null, 204);
  });

  return app;
};
