import { Hono } from "hono";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { invalidateGatewayCache } from "../lib/gateway-invalidate";
import {
  listPolicyRules,
  getPolicyRule,
  createPolicyRule,
  updatePolicyRule,
  deletePolicyRule,
} from "../services/policy-rule-service";
import {
  createPolicyRuleSchema,
  updatePolicyRuleSchema,
} from "../validations/policy-rule";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";

export const ruleRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  // RBAC: attach CASL ability to context. Must run after `authMiddleware`.
  app.use("*", withAbility);

  // GET /rules
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "PolicyRule");
    const rules = await listPolicyRules({
      projectId: requireProjectId(auth),
      organizationId: auth.organizationId,
    });
    return c.json(rules);
  });

  // GET /rules/:ruleId
  app.get("/:ruleId", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "PolicyRule");
    const ruleId = c.req.param("ruleId");
    const rule = await getPolicyRule(
      {
        projectId: requireProjectId(auth),
        organizationId: auth.organizationId,
      },
      ruleId,
    );
    return c.json(rule);
  });

  // POST /rules — admin/owner only (creates a policy rule).
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "create", "PolicyRule");
    const body = await c.req.json().catch(() => null);
    const parsed = createPolicyRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const { scope, ...ruleInput } = parsed.data;
    const resourceScope =
      (scope ?? "project") === "organization"
        ? { organizationId: auth.organizationId }
        : { projectId: requireProjectId(auth) };
    const rule = await withAudit(
      () => createPolicyRule(resourceScope, ruleInput),
      (result) => ({
        projectId: auth.projectId,
        organizationId: auth.organizationId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CREATE,
        service: AUDIT_SERVICES.RULE,
        source: AUDIT_SOURCE.API,
        metadata: { ruleId: result.id, name: parsed.data.name },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.json(rule, 201);
  });

  // PATCH /rules/:ruleId — admin/owner only (modifies a policy rule).
  app.patch("/:ruleId", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "update", "PolicyRule");
    const ruleId = c.req.param("ruleId");
    const body = await c.req.json().catch(() => null);
    const parsed = updatePolicyRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    await withAudit(
      () =>
        updatePolicyRule(
          { projectId, organizationId: auth.organizationId },
          ruleId,
          parsed.data,
        ),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.RULE,
        source: AUDIT_SOURCE.API,
        metadata: { ruleId },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.json({ success: true });
  });

  // DELETE /rules/:ruleId — admin/owner only (removes a policy rule).
  app.delete("/:ruleId", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "delete", "PolicyRule");
    const ruleId = c.req.param("ruleId");
    const projectId = requireProjectId(auth);
    await withAudit(
      () =>
        deletePolicyRule(
          { projectId, organizationId: auth.organizationId },
          ruleId,
        ),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.DELETE,
        service: AUDIT_SERVICES.RULE,
        source: AUDIT_SOURCE.API,
        metadata: { ruleId },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.body(null, 204);
  });

  return app;
};
