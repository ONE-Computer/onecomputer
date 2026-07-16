import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware, requireProjectId } from "../middleware/auth";
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

export const invginiRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/agents/fleet", async (c) => {
    const auth = c.get("auth");
    return c.json(
      await listInvginiAgentRegistryEntriesForOrganization(auth.organizationId),
    );
  });

  app.get("/agents", async (c) => {
    const auth = c.get("auth");
    const projectId = requireProjectId(auth);
    return c.json(await listInvginiAgentRegistryEntries(projectId));
  });

  app.get("/agents/:principalId/events", async (c) => {
    const auth = c.get("auth");
    const principalId = c.req.param("principalId");
    return c.json(
      await listInvginiAgentEventLogs({
        organizationId: auth.organizationId,
        principalId,
      }),
    );
  });

  app.get("/agents/:principalId/evidence-pack", async (c) => {
    const auth = c.get("auth");
    const principalId = c.req.param("principalId");
    return c.json(
      await getInvginiAgentEvidencePack({
        organizationId: auth.organizationId,
        principalId,
      }),
    );
  });

  app.post("/agents/:principalId/controls", async (c) => {
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

  app.post("/agents/:principalId/controls/:controlId/resolve", async (c) => {
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
  });

  app.post("/agent-events", async (c) => {
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
    const principalDids = principals.map((principal) => principal.did);

    // Validation and durable external-agent registry ingestion for InvGini
    // principals. OneCLI can now render the SecOps/admin fleet view from DB.
    return c.json({
      accepted: true,
      projectId,
      eventCount: parsed.data.events.length,
      principals: principalDids,
    });
  });

  return app;
};
