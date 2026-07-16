import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { subject } from "../lib/ability";
import {
  listApprovals,
  createApproval,
  decideApproval,
  decideApprovalByBridgeId,
  getApproval,
  getApprovalByBridgeId,
  getApprovalSummary,
  getApprovalVtiNotification,
  triggerApprovalVtiNotification,
  recordActorAck,
  registerManagerApprovalKey,
  isApprovalStatus,
  type ApprovalStatus,
} from "../services/approval-service";
import {
  createApprovalSchema,
  decideApprovalSchema,
  registerApprovalKeySchema,
} from "../validations/approval";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";

// ApprovalRequest is a Prisma model (packages/db/prisma/schema.prisma) and a
// CASL subject (lib/ability.ts). Managers+ can read all and approve; members
// can read only their own (requestedBy) and cannot approve. This route enforces
// the RBAC gate via `requireAbility` and persists to `approval_requests`.
//
// Routes (mounted at /v1/approvals in app.ts):
//   GET  /approvals              → list pending approvals for this org (paginated)
//   POST /approvals              → create a new approval request (agent/gateway)
//   POST /approvals/:id/decide   → approve or deny { decision, comment? }
//   GET  /approvals/summary      → { pending, approved24h, denied24h }

export const approvalRoutes = () => {
  const app = new Hono<AbilityEnv>();
  app.use("*", authMiddleware);
  app.use("*", withAbility);
  const rejectPortalDecisionInOpenVtc = (c: Context<AbilityEnv>) =>
    process.env.AUTH_MODE === "openvtc"
      ? c.json(
          {
            error:
              "Approval decisions are external-wallet only; use /v1/openvtc-approvals/:id/decide",
          },
          403,
        )
      : null;

  // GET /approvals/summary — manager dashboard counts.
  // Registered before "/:id/decide" so the literal "/summary" path isn't
  // shadowed by a param route (Hono matches in registration order).
  app.get("/summary", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "ApprovalRequest");
    const summary = await getApprovalSummary(auth.organizationId);
    return c.json(summary);
  });

  // Register the authenticated manager's wallet verification key. The key is
  // write-once here; rotation/reset requires a separate admin-controlled flow.
  app.post("/approval-key", async (c) => {
    const blocked = rejectPortalDecisionInOpenVtc(c);
    if (blocked) return blocked;
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "approve", "ApprovalRequest");
    const parsed = registerApprovalKeySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid approval key" },
        400,
      );
    }
    return c.json(
      await registerManagerApprovalKey({
        userId: auth.userId,
        ...parsed.data,
      }),
    );
  });

  // ── Bridge routes: cross-org read + decide by DB id ──────────────────────
  // The governed-action card (sandboxes/[id]/_components/governed-action-card.tsx)
  // triggers a REAL gateway hold via POST /v1/sandboxes/:id/trigger-governed-action.
  // The gateway creates the ApprovalRequest in the agent token's org
  // (`demo-corp-org`), but the local-mode manager session is `local-admin` in a
  // *different* bootstrapped org — so the org-scoped GET /v1/approvals/:id and
  // POST /v1/approvals/:id/decide 404 on these holds (see internal.ts ONE-135
  // note for the same problem on the gateway-poll path).
  //
  // These two routes mirror the internal /v1/internal/approvals/:id{,/decide}
  // endpoints but are gated by normal user auth (any manager) instead of the
  // gateway shared secret, so the browser card can poll + approve the hold it
  // just triggered without holding the shared secret. Registered before the
  // generic "/:id" param route so the literal "/bridge/:id" segment wins.
  app.get("/bridge/:id", async (c) => {
    const ability = c.get("ability");
    requireAbility(ability, "read", "ApprovalRequest");
    const id = c.req.param("id");
    const approval = await getApprovalByBridgeId(id);
    return c.json(approval);
  });

  app.post("/bridge/:id/decide", async (c) => {
    const blocked = rejectPortalDecisionInOpenVtc(c);
    if (blocked) return blocked;
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "approve", subject("ApprovalRequest", { id }));

    const body = await c.req.json().catch(() => null);
    const parsed = decideApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const updated = await decideApprovalByBridgeId({
      bridgeId: id,
      decidedBy: auth.userId,
      decidedByEmail: auth.userEmail,
      input: parsed.data,
    });

    return c.json({ ok: true, status: updated.status, id: updated.id });
  });

  // GET /approvals/:id — fetch one approval request, with the persisted
  // decision VC re-verified on read (ONE-56). The response carries
  // `vtiVerified` (true/false) + `vtiVerifyError` so the manager UI or any
  // consumer can confirm the approval is cryptographically valid. A tampered
  // row (payload flipped in the DB after signing) reads vtiVerified=false.
  // Registered before "/:id/vti-notification" etc.; Hono matches the literal
  // one-segment "/:id" only when there's no further path segment.
  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "read", subject("ApprovalRequest", { id }));

    const approval = await getApproval({
      organizationId: auth.organizationId,
      approvalId: id,
    });
    return c.json(approval);
  });

  // GET /approvals — list approval requests visible to the caller.
  // Query: ?status=pending|approved|denied  &limit=  &cursor=  &projectId=
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "ApprovalRequest");

    const statusParam = c.req.query("status");
    let status: ApprovalStatus | undefined;
    if (statusParam) {
      if (!isApprovalStatus(statusParam)) {
        return c.json(
          {
            error: "status must be one of: pending, approved, denied",
          },
          400,
        );
      }
      status = statusParam;
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || limit! <= 0)) {
      return c.json({ error: "limit must be a positive integer" }, 400);
    }

    const result = await listApprovals({
      organizationId: auth.organizationId,
      projectId: c.req.query("projectId") ?? undefined,
      status,
      limit,
      cursor: c.req.query("cursor") ?? undefined,
    });

    return c.json(result);
  });

  // POST /approvals — create a new approval request.
  // Called by an agent or the gateway when an action needs manager approval.
  // Sets expiresAt to 24h from now. Requires: action, requestedBy, context.
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "create", "ApprovalRequest");

    const body = await c.req.json().catch(() => null);
    const parsed = createApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const approval = await withAudit(
      () =>
        createApproval({
          organizationId: auth.organizationId,
          projectId: parsed.data.projectId ?? auth.projectId,
          agentId: parsed.data.agentId,
          input: parsed.data,
        }),
      (result) => ({
        organizationId: auth.organizationId,
        projectId: result.projectId ?? undefined,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CREATE,
        service: AUDIT_SERVICES.APPROVAL,
        source: AUDIT_SOURCE.API,
        metadata: {
          approvalId: result.id,
          action: parsed.data.action,
          requestedBy: parsed.data.requestedBy,
        },
      }),
    );

    return c.json(approval, 201);
  });

  // GET /approvals/:id/vti-notification — returns the VTI step-up Trust Task
  // envelope embedded at creation time. This is what a VTA/mobile notification
  // sender consumes to deliver the manager 2FA prompt.
  app.get("/:id/vti-notification", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "read", subject("ApprovalRequest", { id }));

    const notification = await getApprovalVtiNotification({
      organizationId: auth.organizationId,
      approvalId: id,
    });
    return c.json(notification);
  });

  // POST /approvals/:id/vti-notification/trigger — simulates handoff to a
  // durable local VTI outbox adapter and records explicit delivery state.
  app.post("/:id/vti-notification/trigger", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "read", subject("ApprovalRequest", { id }));

    const notification = await triggerApprovalVtiNotification({
      organizationId: auth.organizationId,
      approvalId: id,
    });
    return c.json(notification);
  });

  // POST /approvals/:id/actor-ack — the actor who triggered the held action
  // confirms their own identity ("Confirm it's me"). This is the actor-side
  // 2FA analogue for the demo: it stamps context._vti.actorStepUp with an
  // acknowledgedAt timestamp. It does NOT decide the approval — the manager
  // still separately approves/denies via POST /:id/decide. Gated the same as
  // GET /:id/vti-notification (read on own ApprovalRequest); the service
  // additionally enforces that only the original requester can ack.
  app.post("/:id/actor-ack", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "read", subject("ApprovalRequest", { id }));

    const result = await recordActorAck({
      organizationId: auth.organizationId,
      approvalId: id,
      actorUserId: auth.userId,
    });

    return c.json(result);
  });

  // POST /approvals/:id/decide — manager+ only.
  // Records an approve/deny decision and writes to AuditLog. Members have
  // `cannot("approve", "ApprovalRequest")` and are rejected by requireAbility.
  app.post("/:id/decide", async (c) => {
    const blocked = rejectPortalDecisionInOpenVtc(c);
    if (blocked) return blocked;
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    requireAbility(ability, "approve", subject("ApprovalRequest", { id }));

    const body = await c.req.json().catch(() => null);
    const parsed = decideApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        400,
      );
    }

    const updated = await decideApproval({
      organizationId: auth.organizationId,
      approvalId: id,
      decidedBy: auth.userId,
      decidedByEmail: auth.userEmail,
      input: parsed.data,
    });

    return c.json({ ok: true, status: updated.status });
  });

  return app;
};
