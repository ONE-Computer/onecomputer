/**
 * Internal endpoints the gateway calls to delegate 1Password SDK work.
 * Guarded by the shared-secret middleware (not user auth). Served at
 * `/v1/internal/*`. Errors propagate to the root app's error handler.
 *
 * NOTE on withAudit: these routes are machine-to-machine (Rust gateway ->
 * Node), gated by `internalAuth` (shared secret), which never populates
 * `c.get("auth")`. There is no userId/userEmail to attribute an AuditLog row
 * to. The 1Password routes below are also read-only passthroughs to the
 * 1Password API (see services/onepassword-service.ts — no `db.*` writes), so
 * there is no local mutation to audit. The two POST /approvals* routes do
 * persist an `ApprovalRequest` row via createApproval(), but that row IS the
 * durable record (requestedBy/agentId/context), and — like the equivalent
 * user-facing POST /approvals route — is intentionally not double-logged to
 * AuditLog with a synthetic actor identity.
 */
import { Hono } from "hono";
import { z } from "zod";

import { DEMO_MODE_ENABLED } from "../lib/env";
import { internalAuth } from "../middleware/internal-auth";
import { ServiceError } from "../services/errors";
import { createDlpAlert } from "../services/dlp-alert-service";
import { resetDemoNamespace, runDemoSeed } from "../scripts/seed-demo";
import {
  getItemFields,
  listItems,
  listVaults,
  resolveSecret,
  validateToken,
} from "../services/onepassword-service";
import {
  createApproval,
  decideApprovalByBridgeId,
  getApprovalByBridgeId,
  getApprovalStatus,
  isApprovalStatus,
  listApprovalsByBridge,
} from "../services/approval-service";
import type { ApiEnv } from "../types";
import {
  gatewayDlpAlertSchema,
  gatewayManualApprovalSchema,
  internalApprovalSchema,
  listFieldsSchema,
  listItemsSchema,
  listVaultsSchema,
  resolveSchema,
  validateTokenSchema,
} from "../validations/internal";
import { decideApprovalSchema } from "../validations/approval";

/** Validate a JSON body against a schema, surfacing the first issue as a 400. */
const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceError(
      "BAD_REQUEST",
      parsed.error.issues[0]?.message ?? "invalid request",
    );
  }
  return parsed.data;
};

export const internalRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", internalAuth);

  // POST /v1/internal/dlp-alerts — gateway persists DLP findings.
  app.post("/dlp-alerts", async (c) => {
    const input = parseBody(
      gatewayDlpAlertSchema,
      await c.req.json().catch(() => ({})),
    );
    const alert = await createDlpAlert(input);
    return c.json(alert, 201);
  });

  // POST /v1/internal/onepassword/validate — { token }
  app.post("/onepassword/validate", async (c) => {
    const { token } = parseBody(
      validateTokenSchema,
      await c.req.json().catch(() => ({})),
    );
    await validateToken(token);
    return c.json({ valid: true });
  });

  // POST /v1/internal/onepassword/resolve — { token, op_ref }
  app.post("/onepassword/resolve", async (c) => {
    const { token, op_ref } = parseBody(
      resolveSchema,
      await c.req.json().catch(() => ({})),
    );
    return c.json({ value: await resolveSecret(token, op_ref) });
  });

  // ── Picker: browse vaults → items → fields (values never leave Node) ──

  app.post("/onepassword/list-vaults", async (c) => {
    const { token } = parseBody(
      listVaultsSchema,
      await c.req.json().catch(() => ({})),
    );
    return c.json({ vaults: await listVaults(token) });
  });

  app.post("/onepassword/list-items", async (c) => {
    const { token, vaultId } = parseBody(
      listItemsSchema,
      await c.req.json().catch(() => ({})),
    );
    return c.json({ items: await listItems(token, vaultId) });
  });

  app.post("/onepassword/list-fields", async (c) => {
    const { token, vaultId, itemId } = parseBody(
      listFieldsSchema,
      await c.req.json().catch(() => ({})),
    );
    return c.json(await getItemFields(token, vaultId, itemId));
  });

  // ── Manual approval ingest ─────────────────────────────────────────────
  // POST /v1/internal/approvals — the gateway calls this when a request matches
  // a `manual_approval` policy rule (PolicyDecision::ManualApproval in
  // apps/gateway/src/gateway/forward.rs). The gateway holds the request
  // in-memory and long-polls for a decision; this endpoint persists a durable
  // ApprovalRequest so the manager persona can see it in the approvals queue.
  //
  // CREATE path only — the unblock path (decision submitted to the gateway ↔
  // ApprovalRequest status flip) is deferred to Phase 3 identity work. The
  // gateway's own approval id is echoed back in `context.gatewayApprovalId` so
  // the future unblock path can correlate the two records.
  app.post("/approvals", async (c) => {
    const input = parseBody(
      internalApprovalSchema,
      await c.req.json().catch(() => ({})),
    );

    // Fold the gateway's contextual fields (agent name, HTTP method/host/path,
    // body preview) into the JSON `context` the manager sees, plus the gateway
    // approval id for future correlation.
    const context = {
      ...(input.context ?? {}),
      gatewayApprovalId: input.gatewayApprovalId,
      agentName: input.agentName,
    };

    const expiresAt = input.expiresAtUnix
      ? new Date(input.expiresAtUnix * 1000)
      : undefined;

    const approval = await createApproval({
      organizationId: input.organizationId,
      projectId: input.projectId,
      agentId: input.agentId,
      input: {
        action: input.action,
        requestedBy: input.requestedBy,
        context,
      },
      expiresAt,
    });

    return c.json(approval, 201);
  });

  // GET /v1/internal/approvals/:id/status — the gateway polls this endpoint
  // every ~2s while holding a request awaiting manual approval. `:id` can be
  // either the DB ApprovalRequest id OR the `gatewayApprovalId` stored in
  // context.gatewayApprovalId (the UUID the gateway generated in forward.rs).
  // Returns { status: "pending" | "approved" | "denied" }.
  app.get("/approvals/:id/status", async (c) => {
    const id = c.req.param("id");
    if (!id) {
      throw new ServiceError("BAD_REQUEST", "id is required");
    }

    // The gateway doesn't have an organizationId when it calls this endpoint —
    // it only knows the gatewayApprovalId it generated. To keep things simple
    // we search across the org using only the id and let the DB query resolve
    // whether it's a DB id or a gatewayApprovalId. The shared secret already
    // gates this endpoint so org scoping is an additional safeguard, not the
    // primary auth boundary.
    //
    // We require an explicit orgId query param for scope so the query stays
    // indexed. The gateway passes it when it calls POST /approvals.
    const orgId = c.req.query("orgId") ?? "";

    const result = await getApprovalStatus({ organizationId: orgId, id });
    if (!result) {
      throw new ServiceError("NOT_FOUND", "Approval request not found");
    }
    // Return the persisted signed decision VC (context._vti.decision) alongside
    // the status so the gateway can verify_vc it before releasing a held
    // request (ONE-142). Absent on pending rows / rows decided under a prior
    // build — the gateway then falls back to string-only behavior with a warn.
    return c.json({
      status: result.status,
      ...(result.decisionVc ? { decisionVc: result.decisionVc } : {}),
      ...(result.managerConfirmation
        ? { managerConfirmation: result.managerConfirmation }
        : {}),
    });
  });

  // GET /v1/internal/approvals/:id — fetch one approval request (cross-org,
  // resolved by DB id OR context.gatewayApprovalId) with its persisted decision
  // VC re-verified on read (ONE-56). Returns the row plus `vtiVerified` +
  // `vtiVerifyError`. This is the PM/verify-script path: a manager-side tool
  // can confirm a gateway-created hold's decision is cryptographically valid
  // without being in the agent's org. Tampering with the row's
  // context._vti.decision payload after signing reads vtiVerified=false.
  app.get("/approvals/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) {
      throw new ServiceError("BAD_REQUEST", "id is required");
    }
    const approval = await getApprovalByBridgeId(id);
    return c.json(approval);
  });

  // GET /v1/internal/approvals — list approval requests created by the gateway
  // (those carrying `context.gatewayApprovalId`), optionally filtered by
  // status. This is the manager-side "show me what the gateway is holding
  // right now" list for the approve→release bridge.
  //
  // Why an internal list and not the public GET /v1/approvals? The public
  // route is org-scoped to the caller's session. In local/demo mode the
  // manager session is the auto-authenticated `local-admin` user, whose org is
  // bootstrapped fresh — *not* `demo-corp-org` where the gateway-created holds
  // live (the agent token resolves to demo-corp-org). So the public list 404s
  // / hides them. The internal shared secret is the auth boundary here; the
  // list is intentionally cross-org so a manager-side tool can surface and
  // approve gateway holds regardless of which org the agent ran in.
  app.get("/approvals", async (c) => {
    const statusParam = c.req.query("status");
    const limitParam = c.req.query("limit");
    const result = await listApprovalsByBridge({
      status:
        statusParam && isApprovalStatus(statusParam) ? statusParam : undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });
    return c.json(result);
  });

  // POST /v1/internal/approvals/:id/decide — the **id-bridge** decide route.
  //
  // THE BUG THIS FIXES (ONE-135): the public POST /v1/approvals/:id/decide
  // returns 404 for gateway-created ApprovalRequests because `decideApproval`
  // filters `findFirst({ where: { id, organizationId } })` by the manager
  // session's org. The gateway writes the hold into the agent token's org
  // (`demo-corp-org`); the local-mode manager session is `local-admin` in a
  // *different* bootstrapped org — so the row is invisible and the manager can
  // never approve it. The gateway's poll then never sees `approved` and the
  // held request times out (180s) to deny.
  //
  // This internal route resolves the row by its DB `id` OR by the
  // `gatewayApprovalId` (same two keys the gateway polls status with), pulling
  // the org from the row itself. Guarded by `X-Gateway-Secret` (shared secret)
  // — the same boundary as the gateway's other internal calls. A manager-side
  // script (or the gateway itself, or a test) approves by posting the id the
  // gateway created + shared secret.
  app.post("/approvals/:id/decide", async (c) => {
    const id = c.req.param("id");
    if (!id) {
      throw new ServiceError("BAD_REQUEST", "id is required");
    }

    const parsed = decideApprovalSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      throw new ServiceError(
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "invalid request",
      );
    }

    const updated = await decideApprovalByBridgeId({
      bridgeId: id,
      decidedBy: "gateway-internal-decide",
      input: parsed.data,
    });

    return c.json({ ok: true, status: updated.status, id: updated.id });
  });

  // POST /v1/internal/demo/reset — wipe + reseed the Demo Corp namespace.
  // Called from the "Reset demo data" button (local/demo mode, Owner-only —
  // both gated client-side; this route re-checks server-side via
  // DEMO_MODE_ENABLED so it can never run in a cloud/production deployment
  // even if a caller has the gateway shared secret). Delegates entirely to
  // scripts/seed-demo.ts's resetDemoNamespace()+runDemoSeed() — same
  // delete-scope guarantees (stable Demo Corp ids only) and the same
  // service-backed seed path as `pnpm seed:demo:reset`.
  app.post("/demo/reset", async (c) => {
    if (!DEMO_MODE_ENABLED) {
      throw new ServiceError(
        "FORBIDDEN",
        "Demo reset is disabled outside local/demo mode",
      );
    }

    const deleted = await resetDemoNamespace();
    const seeded = await runDemoSeed();
    return c.json({ deleted, seeded });
  });

  // POST /v1/internal/gateway/manual-approval — a direct ingest bridge for a
  // gateway PolicyDecision::ManualApproval event. The Rust gateway callback is
  // intentionally not wired here; this endpoint provides the durable API side of
  // the bridge and is smoke-testable with curl.
  app.post("/gateway/manual-approval", async (c) => {
    const input = parseBody(
      gatewayManualApprovalSchema,
      await c.req.json().catch(() => ({})),
    );

    const approval = await createApproval({
      organizationId: input.organizationId,
      projectId: input.projectId,
      agentId: input.agentId,
      input: {
        action: input.action,
        requestedBy: input.requestedBy,
        agentId: input.agentId,
        projectId: input.projectId,
        context: {
          ...(input.context ?? {}),
          host: input.host,
          path: input.path,
          method: input.method,
          ruleId: input.ruleId,
        },
      },
    });

    return c.json(approval, 201);
  });

  return app;
};
