import { Hono } from "hono";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { subject } from "../lib/ability";
import { invalidateGatewayCache } from "../lib/gateway-invalidate";
import {
  listAgents,
  createAgent,
  agentExistsByIdentifier,
  getDefaultAgent,
  setDefaultAgent,
  renameAgent,
  deleteAgent,
  regenerateAgentToken,
  revokeAgentToken,
  updateAgentSecretMode,
  getAgentSecrets,
  updateAgentSecrets,
  getAgentAppConnections,
  updateAgentAppConnections,
  listAgentGranularAccess,
} from "../services/agent-service";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";
import {
  createAgentSchema,
  renameAgentSchema,
  secretModeSchema,
  updateAgentSecretsSchema,
  updateAgentConnectionsSchema,
} from "../validations/agent";
import { getResourceHooks } from "../providers";
import {
  invginiAgentControlActionSchema,
  invginiAgentControlResolutionSchema,
  invginiAgentEventsPayloadSchema,
} from "../validations/invgini-agent";
import {
  applyInvginiEventsToRegistry,
  createInvginiAgentControlAction,
  getInvginiAgentEvidencePack,
  listInvginiAgentEventLogs,
  listInvginiAgentRegistryEntries,
  listInvginiAgentRegistryEntriesForOrganization,
  resolveInvginiAgentControlAction,
} from "../services/invgini-agent-registry";

export const agentRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  // RBAC: attach CASL ability to context. Must run after `authMiddleware` so
  // `c.get("auth")` (userId, organizationId, role) is populated.
  app.use("*", withAbility);

  // GET /agents
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    // Authorization gate: caller must be allowed to read Agent resources.
    // Row-level scoping via `accessibleBy` is deferred until the Agent model
    // gains an owner/createdBy column (see AUDIT.md — don't overstate what
    // works). Project-scoping (requireProjectId) still bounds the result set.
    requireAbility(ability, "read", "Agent");
    const agents = await listAgents(requireProjectId(auth));
    return c.json(agents);
  });

  // GET /agents/granular-access — read-only overview of per-agent granular
  // policies (GitHub repos, Dropbox folders) across the project.
  app.get("/granular-access", async (c) => {
    const auth = c.get("auth");
    const entries = await listAgentGranularAccess(requireProjectId(auth));
    return c.json(entries);
  });

  // GET /agents/invgini-governance/fleet — organization-wide SecOps fleet view
  // for cybersecurity/admin dashboards that need to monitor agents across
  // multiple InvGini projects, not just the currently selected project.
  app.get("/invgini-governance/fleet", async (c) => {
    const auth = c.get("auth");
    return c.json(
      await listInvginiAgentRegistryEntriesForOrganization(auth.organizationId),
    );
  });

  // GET /agents/invgini-governance — InvGini SecOps registry alias mounted
  // under the existing agents surface so the dashboard can render even in
  // runtimes that proxy/load only the established /agents API subtree.
  app.get("/invgini-governance", async (c) => {
    const auth = c.get("auth");
    return c.json(
      await listInvginiAgentRegistryEntries(requireProjectId(auth)),
    );
  });

  // POST /agents/invgini-governance/events — compatibility ingest endpoint
  // for InvGini AgentRegistered/ActionRequested/ReceiptCreated events.
  app.post("/invgini-governance/events", async (c) => {
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => null);
    const parsed = invginiAgentEventsPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    const principals = await applyInvginiEventsToRegistry({
      organizationId: auth.organizationId,
      projectId,
      payload: parsed.data,
    });

    return c.json({
      accepted: true,
      projectId,
      eventCount: parsed.data.events.length,
      principals: principals.map((principal) => principal.did),
    });
  });

  // GET /agents/invgini-governance/:principalId/evidence-pack — export an
  // audit bundle for incident review / regulated handoff. Kept under the
  // compatibility /agents subtree because dashboards may only proxy this API.
  // GET /agents/invgini-governance/:principalId/events — expose the persisted
  // Trust Flight Recorder so SecOps can diff the materialized registry against
  // immutable, idempotent event ingest.
  app.get("/invgini-governance/:principalId/events", async (c) => {
    const auth = c.get("auth");
    const principalId = c.req.param("principalId");
    return c.json(
      await listInvginiAgentEventLogs({
        organizationId: auth.organizationId,
        principalId,
      }),
    );
  });

  app.get("/invgini-governance/:principalId/evidence-pack", async (c) => {
    const auth = c.get("auth");
    const principalId = c.req.param("principalId");
    return c.json(
      await getInvginiAgentEvidencePack({
        organizationId: auth.organizationId,
        principalId,
      }),
    );
  });

  // POST /agents/invgini-governance/:principalId/controls — durable SecOps
  // control intent for an InvGini external agent. InvGini remains the action
  // execution source of truth, but OneCLI now records owner/admin decisions
  // such as freeze, approval-required, grant revoke, connector quarantine, or
  // receipt export requests.
  app.post("/invgini-governance/:principalId/controls", async (c) => {
    const auth = c.get("auth");
    const principalId = c.req.param("principalId");
    const body = await c.req.json().catch(() => null);
    const parsed = invginiAgentControlActionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const control = await createInvginiAgentControlAction({
      organizationId: auth.organizationId,
      principalId,
      requestedByUserId: auth.userId,
      requestedByEmail: auth.userEmail,
      input: parsed.data,
    });

    return c.json(control, 201);
  });

  app.post(
    "/invgini-governance/:principalId/controls/:controlId/resolve",
    async (c) => {
      const auth = c.get("auth");
      const principalId = c.req.param("principalId");
      const controlId = c.req.param("controlId");
      const body = await c.req.json().catch(() => null);
      const parsed = invginiAgentControlResolutionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
          400,
        );
      }

      return c.json(
        await resolveInvginiAgentControlAction({
          organizationId: auth.organizationId,
          principalId,
          controlId,
          resolvedByUserId: auth.userId,
          resolvedByEmail: auth.userEmail,
          input: parsed.data,
        }),
      );
    },
  );

  // POST /agents
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => null);
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);

    // The agent quota gates *new* agents only -- re-creating an existing
    // identifier consumes no slot. Skip the quota check when it already exists
    // so createAgent returns the canonical 409 instead of a 403 that shadows it
    // at the cap and breaks idempotent ensureAgent. See onecli/node-sdk#40.
    if (!(await agentExistsByIdentifier(projectId, parsed.data.identifier))) {
      await getResourceHooks().beforeCreateAgent(auth.organizationId);
    }

    const agent = await createAgent(
      projectId,
      parsed.data.name,
      parsed.data.identifier,
      parsed.data.parentIdentifier,
    );
    invalidateGatewayCache(c.req.raw);
    return c.json(agent, 201);
  });

  // GET /agents/default
  app.get("/default", async (c) => {
    const auth = c.get("auth");
    const agent = await getDefaultAgent(requireProjectId(auth));
    if (!agent) {
      return c.json({ error: "No default agent found" }, 404);
    }
    return c.json(agent);
  });

  // PATCH /agents/:agentId
  app.patch("/:agentId", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => null);
    const parsed = renameAgentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    await renameAgent(requireProjectId(auth), agentId, parsed.data.name);
    return c.json({ success: true });
  });

  // DELETE /agents/:agentId
  app.delete("/:agentId", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const agentId = c.req.param("agentId");
    // RBAC: owner/admin may delete any agent; managers have no delete grant;
    // members may only delete agents they own. The Agent model has no owner
    // column yet, so for members the subject carries no `ownerId` and the
    // ability check fails closed (forbidden). See AUDIT.md.
    requireAbility(ability, "delete", subject("Agent", { id: agentId }));
    await deleteAgent(requireProjectId(auth), agentId);
    invalidateGatewayCache(c.req.raw);
    return c.body(null, 204);
  });

  // POST /agents/:agentId/set-default
  app.post("/:agentId/set-default", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    await setDefaultAgent(requireProjectId(auth), agentId);
    invalidateGatewayCache(c.req.raw);
    return c.json({ success: true });
  });

  // POST /agents/:agentId/regenerate-token
  app.post("/:agentId/regenerate-token", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const result = await regenerateAgentToken(requireProjectId(auth), agentId);
    invalidateGatewayCache(c.req.raw);
    return c.json(result);
  });

  // POST /agents/:agentId/revoke — kill switch. Revokes the agent's access
  // token so it can no longer authenticate to the gateway, and writes an
  // audit record (action=REVOKE, service=AGENT). Body: { reason?: string }.
  app.post("/:agentId/revoke", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const agentId = c.req.param("agentId");
    // RBAC: revoking access is a destructive control action; require the
    // same `delete` grant the DELETE /agents/:id endpoint uses.
    requireAbility(ability, "delete", subject("Agent", { id: agentId }));

    const body = await c.req.json().catch(() => null);
    const reason =
      body && typeof body.reason === "string" ? body.reason : undefined;

    const projectId = requireProjectId(auth);
    await withAudit(
      () => revokeAgentToken(projectId, agentId, reason),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.REVOKE,
        service: AUDIT_SERVICES.AGENT,
        source: AUDIT_SOURCE.API,
        metadata: { agentId, reason },
      }),
    );
    invalidateGatewayCache(c.req.raw);
    return c.json({ ok: true, message: "Agent access revoked" });
  });

  // PATCH /agents/:agentId/secret-mode
  app.patch("/:agentId/secret-mode", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => null);
    const parsed = secretModeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    await withAudit(
      () => updateAgentSecretMode(projectId, agentId, parsed.data.mode),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.AGENT,
        source: AUDIT_SOURCE.API,
        metadata: { agentId, secretMode: parsed.data.mode },
      }),
    );
    return c.json({ success: true });
  });

  // GET /agents/:agentId/secrets
  app.get("/:agentId/secrets", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const secretIds = await getAgentSecrets(requireProjectId(auth), agentId);
    return c.json(secretIds);
  });

  // PUT /agents/:agentId/secrets
  app.put("/:agentId/secrets", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateAgentSecretsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    await withAudit(
      () => updateAgentSecrets(projectId, agentId, parsed.data.secretIds),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.AGENT,
        source: AUDIT_SOURCE.API,
        metadata: { agentId, secretCount: parsed.data.secretIds.length },
      }),
    );
    return c.json({ success: true });
  });

  // GET /agents/:agentId/connections
  app.get("/:agentId/connections", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const connections = await getAgentAppConnections(
      requireProjectId(auth),
      agentId,
    );
    return c.json(connections);
  });

  // PUT /agents/:agentId/connections — replace the agent's app-connection
  // assignments and their per-connection granular-access policies.
  app.put("/:agentId/connections", async (c) => {
    const auth = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateAgentConnectionsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const projectId = requireProjectId(auth);
    await withAudit(
      () =>
        updateAgentAppConnections(projectId, agentId, parsed.data.connections),
      () => ({
        projectId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.AGENT,
        source: AUDIT_SOURCE.API,
        metadata: {
          agentId,
          appConnectionCount: parsed.data.connections.length,
        },
      }),
    );
    return c.json({ success: true });
  });

  return app;
};
