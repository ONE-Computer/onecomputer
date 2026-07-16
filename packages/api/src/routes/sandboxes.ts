import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { db } from "@onecli/db";
import { getSandboxProvider } from "../services/sandbox-providers";
import { authMiddleware, requireProjectId } from "../middleware/auth";
import {
  withAbility,
  requireAbility,
  type AbilityEnv,
} from "../middleware/ability";
import { subject } from "../lib/ability";
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
  AUDIT_SOURCE,
} from "../services/audit-service";
import { ServiceError } from "../services/errors";
import { triggerGovernedAction } from "../services/governed-action-service";
import type { SandboxInfo } from "../services/sandbox-providers";
import type { AuthContext } from "../providers";

/**
 * Sandbox management routes — kasm-local / daytona adapter.
 *
 * Mounted under /v1/sandboxes. These hit the real sandbox control plane
 * (POST/GET/DELETE) and the toolbox exec proxy. No mocks.
 *
 * Persistence + RBAC: every created sandbox is persisted to the `Sandbox`
 * Prisma model with `ownerId = auth.userId`. GET is scoped by owner for
 * members (managers/admins see all). DELETE is allowed for the owner or any
 * manager/admin. The provider's own list/get endpoints are not auth-aware, so
 * the DB row — not the provider — is the source of truth for ownership.
 */

// Member roles that see all sandboxes in their org (not just their own).
const ORG_WIDE_ROLES = new Set(["owner", "admin", "manager"]);
const ALLOCATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

const allocationId = (value: string | undefined, label: string): string => {
  const candidate = value?.trim() || `legacy_${randomUUID()}`;
  if (!ALLOCATION_ID_PATTERN.test(candidate)) {
    throw new ServiceError("BAD_REQUEST", `${label} is invalid`);
  }
  return candidate;
};

const allocationRequestHash = (input: {
  organizationId: string;
  projectId: string;
  requesterId: string;
  name: string;
}): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;

// Merge a persisted Sandbox row with live provider state where available.
// Provider state (desktopUrl, health, claudeVersion) is best-effort: if the
// provider can't reach the sandbox (e.g. container stopped), we fall back to
// the persisted row so the UI still lists it with its DB status.
const mergeSandboxInfo = async (row: {
  id: string;
  name: string;
  provider: string;
  status: string;
  allocationOperationId?: string | null;
  allocationIdempotencyKey?: string | null;
}): Promise<SandboxInfo> => {
  const provider = getSandboxProvider();
  try {
    const live = await provider.getSandbox(row.id);
    const pending = row.status === "provisioning" || row.status === "failed";
    return {
      ...live,
      name: row.name,
      allocationOperationId: row.allocationOperationId ?? undefined,
      allocationIdempotencyKey: row.allocationIdempotencyKey ?? undefined,
      state: pending ? row.status : live.state,
      bootstrapped: pending ? false : live.bootstrapped,
      desktopReady: pending ? false : live.desktopReady,
    };
  } catch {
    // Provider can't find it (stopped/removed) — return the persisted view.
    return {
      id: row.id,
      name: row.name,
      state: row.status,
      provider: row.provider as SandboxInfo["provider"],
      bootstrapped: false,
      allocationOperationId: row.allocationOperationId ?? undefined,
      allocationIdempotencyKey: row.allocationIdempotencyKey ?? undefined,
    };
  }
};

export const sandboxRoutes = () => {
  const app = new Hono<AbilityEnv>();
  // Auth + RBAC: sandboxes previously had no auth middleware. Attach both so
  // `c.get("auth")` and `c.get("ability")` are populated. `withAbility` must
  // run after `authMiddleware`.
  app.use("*", authMiddleware);
  app.use("*", withAbility);

  // GET /sandboxes — list sandboxes scoped by ownership.
  // Members see only their own; managers/admins/owners see all in the org.
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "read", "Sandbox");
    const where = ORG_WIDE_ROLES.has(auth.role ?? "member")
      ? { organizationId: auth.organizationId }
      : { organizationId: auth.organizationId, ownerId: auth.userId };
    const rows = await db.sandbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    const sandboxes = await Promise.all(
      rows.map((row) => mergeSandboxInfo(row)),
    );
    return c.json(sandboxes);
  });

  // POST /sandboxes — allocate and persist a sandbox from the default snapshot.
  // Long desktop/Claude bootstrap runs only after the ownership record exists,
  // so DELETE can address an in-flight provider resource after a disconnect.
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    requireAbility(ability, "create", "Sandbox");
    const body = await c.req.json().catch(() => null);
    const name = body && typeof body.name === "string" ? body.name : undefined;
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }
    const projectId = requireProjectId(auth);
    const idempotencyKey = allocationId(
      c.req.header("Idempotency-Key"),
      "Idempotency-Key",
    );
    const operationId = allocationId(
      c.req.header("X-Allocation-Operation-Id"),
      "X-Allocation-Operation-Id",
    );
    const requestHash = allocationRequestHash({
      organizationId: auth.organizationId,
      projectId,
      requesterId: auth.userId,
      name,
    });

    const existing = await db.sandboxAllocationOperation.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: auth.organizationId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.requestHash !== requestHash ||
        existing.projectId !== projectId ||
        existing.requesterId !== auth.userId ||
        existing.id !== operationId
      ) {
        throw new ServiceError(
          "CONFLICT",
          "Allocation idempotency key is already bound to a different request",
        );
      }
      if (existing.sandboxId) {
        const row = await db.sandbox.findFirst({
          where: {
            id: existing.sandboxId,
            organizationId: auth.organizationId,
          },
        });
        if (row) {
          return c.json(await mergeSandboxInfo(row), 200);
        }
      }
      return c.json(
        {
          operationId: existing.id,
          idempotencyKey: existing.idempotencyKey,
          status: existing.status,
          sandboxId: existing.sandboxId ?? undefined,
        },
        202,
      );
    }

    try {
      await db.sandboxAllocationOperation.create({
        data: {
          id: operationId,
          organizationId: auth.organizationId,
          projectId,
          requesterId: auth.userId,
          idempotencyKey,
          requestHash,
          name,
          status: "pending",
        },
      });
    } catch {
      // A concurrent request may have won the compound unique constraint.
      // Re-read it and apply the exact same request-fingerprint checks rather
      // than dispatching a second provider allocation.
      const raced = await db.sandboxAllocationOperation.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: auth.organizationId,
            idempotencyKey,
          },
        },
      });
      if (!raced)
        throw new ServiceError(
          "INTERNAL",
          "Allocation operation could not be persisted",
        );
      if (raced.requestHash !== requestHash || raced.id !== operationId) {
        throw new ServiceError(
          "CONFLICT",
          "Allocation idempotency key is already bound to a different request",
        );
      }
      return c.json(
        {
          operationId: raced.id,
          idempotencyKey: raced.idempotencyKey,
          status: raced.status,
          sandboxId: raced.sandboxId ?? undefined,
        },
        202,
      );
    }
    const agent = await db.agent.findFirst({
      where: { projectId, isDefault: true },
      select: { accessToken: true },
    });
    const provider = getSandboxProvider();
    let sandbox: SandboxInfo;
    try {
      sandbox = await withAudit(
        () =>
          provider.createSandbox(name, {
            gatewayAgentToken: agent?.accessToken ?? undefined,
            allocationOperationId: operationId,
            allocationIdempotencyKey: idempotencyKey,
          }),
        (result) => ({
          organizationId: auth.organizationId,
          userId: auth.userId,
          userEmail: auth.userEmail,
          action: AUDIT_ACTIONS.CREATE,
          service: AUDIT_SERVICES.SANDBOX,
          source: AUDIT_SOURCE.API,
          metadata: {
            sandboxId: result.id,
            name,
            allocationOperationId: operationId,
          },
        }),
      );
    } catch (error) {
      await db.sandboxAllocationOperation
        .update({
          where: { id: operationId },
          data: { status: "unknown", errorCode: "ALLOCATION_OUTCOME_UNKNOWN" },
        })
        .catch(() => undefined);
      throw error;
    }
    // Persist the ownership record. `id` is the provider sandbox id used in
    // all subsequent /v1/sandboxes/:id calls; providerSandboxId mirrors it
    // (the provider's own identifier for the container/instance). If this
    // persistence step fails after provider success, retain an `unknown`
    // receipt rather than claiming the allocation completed.
    try {
      await db.sandbox.upsert({
        where: { id: sandbox.id },
        create: {
          id: sandbox.id,
          organizationId: auth.organizationId,
          ownerId: auth.userId,
          provider: sandbox.provider,
          providerSandboxId: sandbox.id,
          name,
          status: sandbox.state,
          allocationOperationId: operationId,
          allocationIdempotencyKey: idempotencyKey,
        },
        update: {
          organizationId: auth.organizationId,
          ownerId: auth.userId,
          provider: sandbox.provider,
          providerSandboxId: sandbox.id,
          name,
          status: sandbox.state,
          allocationOperationId: operationId,
          allocationIdempotencyKey: idempotencyKey,
        },
      });
      await db.sandboxAllocationOperation.update({
        where: { id: operationId },
        data: {
          status: "completed",
          sandboxId: sandbox.id,
          provider: sandbox.provider,
        },
      });
    } catch (error) {
      await db.sandboxAllocationOperation
        .update({
          where: { id: operationId },
          data: {
            status: "unknown",
            sandboxId: sandbox.id,
            provider: sandbox.provider,
            errorCode: "PERSISTENCE_OUTCOME_UNKNOWN",
          },
        })
        .catch(() => undefined);
      throw error;
    }
    if (provider.bootstrapSandbox) {
      void withAudit(
        () =>
          provider.bootstrapSandbox!(sandbox.id, {
            gatewayAgentToken: agent?.accessToken ?? undefined,
          }),
        (result) => ({
          organizationId: auth.organizationId,
          userId: auth.userId,
          userEmail: auth.userEmail,
          action: AUDIT_ACTIONS.UPDATE,
          service: AUDIT_SERVICES.SANDBOX,
          source: AUDIT_SOURCE.API,
          metadata: {
            sandboxId: result.id,
            state: result.state,
            operation: "bootstrap",
          },
        }),
      )
        .then(async (ready) => {
          await db.sandbox
            .update({
              where: { id: sandbox.id },
              data: { status: ready.state },
            })
            .catch(() => undefined);
        })
        .catch(async () => {
          await withAudit(
            () => provider.deleteSandbox(sandbox.id),
            () => ({
              organizationId: auth.organizationId,
              userId: auth.userId,
              userEmail: auth.userEmail,
              action: AUDIT_ACTIONS.DELETE,
              service: AUDIT_SERVICES.SANDBOX,
              source: AUDIT_SOURCE.API,
              metadata: {
                sandboxId: sandbox.id,
                operation: "bootstrap-cleanup",
              },
            }),
          ).catch(() => undefined);
          await db.sandbox
            .update({ where: { id: sandbox.id }, data: { status: "failed" } })
            .catch(() => undefined);
        });
    }
    return c.json(
      {
        ...sandbox,
        allocationOperationId: operationId,
        allocationIdempotencyKey: idempotencyKey,
      },
      201,
    );
  });

  // GET /sandboxes/:id/desktop — fetch desktop/noVNC health and URL.
  app.get("/:id/desktop", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "read", subject("Sandbox", { id, ownerId }));
    const desktop = await withAudit(
      () => getSandboxProvider().getSandboxDesktop(id),
      () => ({
        organizationId: auth.organizationId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CONNECT,
        service: AUDIT_SERVICES.SANDBOX,
        source: AUDIT_SOURCE.API,
        metadata: { sandboxId: id, target: "desktop" },
      }),
    );
    return c.json(desktop);
  });

  // POST /sandboxes/:id/desktop/restart — rerun idempotent desktop bootstrap.
  app.post("/:id/desktop/restart", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "execute", subject("Sandbox", { id, ownerId }));
    const projectId = requireProjectId(auth);
    const agent = await db.agent.findFirst({
      where: { projectId, isDefault: true },
      select: { accessToken: true },
    });
    const desktop = await withAudit(
      () =>
        getSandboxProvider().restartSandboxDesktop(id, {
          gatewayAgentToken: agent?.accessToken ?? undefined,
        }),
      () => ({
        organizationId: auth.organizationId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.UPDATE,
        service: AUDIT_SERVICES.SANDBOX,
        source: AUDIT_SOURCE.API,
        metadata: { sandboxId: id, target: "desktop-restart" },
      }),
    );
    return c.json(desktop);
  });

  // GET /sandboxes/:id — fetch a single sandbox.
  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "read", subject("Sandbox", { id, ownerId }));
    const sandbox = await getSandboxProvider().getSandbox(id);
    const row = await db.sandbox.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        allocationOperationId: true,
        allocationIdempotencyKey: true,
      },
    });
    return c.json({
      ...sandbox,
      allocationOperationId: row?.allocationOperationId ?? undefined,
      allocationIdempotencyKey: row?.allocationIdempotencyKey ?? undefined,
    });
  });

  // POST /sandboxes/:id/exec — run a command in the sandbox via the toolbox
  // proxy. Body: { "command": string }.
  app.post("/:id/exec", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "execute", subject("Sandbox", { id, ownerId }));
    const body = await c.req.json().catch(() => null);
    const command =
      body && typeof body.command === "string" ? body.command : undefined;
    if (!command) {
      return c.json({ error: "command is required" }, 400);
    }
    const result = await getSandboxProvider().execInSandbox(id, command);
    return c.json(result);
  });

  // POST /sandboxes/:id/trigger-governed-action — drive a REAL gateway hold.
  //
  // Fires a POST to graph.microsoft.com/v1.0/me/sendMail THROUGH the OneComputer
  // gateway (MITM, port 10255) using the agent's access token as proxy auth.
  // The seeded manual_approval rule matches → the gateway holds the request
  // (apps/gateway/src/gateway/forward.rs:449-541) and persists a durable
  // ApprovalRequest. This route does the curl server-side (the browser cannot
  // speak HTTP-CONNECT proxy auth + MITM TLS cleanly) and returns the created
  // approval id; the card then polls the approval status and renders
  // held → released. See services/governed-action-service.ts for the path.
  app.post("/:id/trigger-governed-action", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "execute", subject("Sandbox", { id, ownerId }));
    const result = await withAudit(
      () => triggerGovernedAction(),
      () => ({
        organizationId: auth.organizationId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.CREATE,
        service: AUDIT_SERVICES.SANDBOX,
        source: AUDIT_SOURCE.API,
        metadata: { sandboxId: id, target: "governed-action-trigger" },
      }),
    );
    return c.json(result, 201);
  });

  // DELETE /sandboxes/:id — tear down a sandbox. Idempotent on 404.
  // RBAC: owner/admin may delete any sandbox; managers have read+execute but
  // no delete grant; members may delete only sandboxes they own. The subject
  // carries `ownerId` so the member ability (which scopes read/execute to own
  // resources) fails closed for non-owners. Members have no `delete` grant at
  // all — only owner/admin can delete (see ability.ts).
  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const ability = c.get("ability");
    const id = c.req.param("id");
    const ownerId = await assertSandboxOwner(auth, id);
    requireAbility(ability, "delete", subject("Sandbox", { id, ownerId }));
    await withAudit(
      () => getSandboxProvider().deleteSandbox(id),
      () => ({
        organizationId: auth.organizationId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.DELETE,
        service: AUDIT_SERVICES.SANDBOX,
        source: AUDIT_SOURCE.API,
        metadata: { sandboxId: id },
      }),
    );
    // Best-effort: drop the persisted row once the provider tears it down.
    await db.sandbox.deleteMany({ where: { id } }).catch(() => undefined);
    return c.body(null, 204);
  });

  return app;
};

// Load the persisted Sandbox row for `:id` and return its ownerId so the
// caller can build a CASL subject with ownership conditions. Throws 404 if the
// row doesn't exist (no sandbox by that id is known to this org).
const assertSandboxOwner = async (
  auth: AuthContext,
  id: string,
): Promise<string> => {
  const row = await db.sandbox.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: { ownerId: true },
  });
  if (!row) {
    throw new ServiceError("NOT_FOUND", `Sandbox ${id} not found`);
  }
  return row.ownerId;
};
