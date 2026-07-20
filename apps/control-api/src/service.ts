import { OneComputerError, readinessFor, type IdentityContext, type Launch, type Sandbox, type WorkspaceView } from "@onecomputer/contracts";
import type { GatewayClient, GatewayGrant, GatewayReadiness } from "@onecomputer/litellm-adapter";
import type { WorkspaceRecord, WorkspaceStore } from "@onecomputer/workspace-store";

export interface ControllerClient {
  create(input: { workspaceId: string; correlationId: string; gateway?: GatewayGrant }): Promise<Sandbox>;
  status(providerId: string): Promise<Sandbox>;
  open(providerId: string): Promise<Launch>;
  destroy(providerId: string): Promise<void>;
}

export class HttpControllerClient implements ControllerClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}
  private async call(path: string, init?: RequestInit) {
    const hasBody = init?.body !== undefined;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), "x-controller-token": this.token, ...init?.headers },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; retryable?: boolean } };
      throw new OneComputerError(payload.error?.code ?? "CONTROLLER_ERROR", payload.error?.message ?? "Workspace controller request failed", response.status, payload.error?.retryable ?? response.status >= 500);
    }
    return response.status === 204 ? {} : response.json();
  }
  async create(input: { workspaceId: string; correlationId: string; gateway?: GatewayGrant }) {
    return await this.call("/internal/v1/sandboxes", { method: "POST", body: JSON.stringify(input) }) as Sandbox;
  }
  async status(providerId: string) { return await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}`) as Sandbox; }
  async open(providerId: string) { return await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}/open`, { method: "POST" }) as Launch; }
  async destroy(providerId: string) { await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}`, { method: "DELETE" }); }
}

export const toView = (record: WorkspaceRecord, gateway?: GatewayReadiness): WorkspaceView => ({
  id: record.id,
  grantId: record.grantId,
  state: record.state,
  readiness: readinessFor(record.state, gateway),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  failureCode: record.failureCode,
});

export class WorkspaceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly controller: ControllerClient,
    private readonly gateway?: GatewayClient,
  ) {}

  private async view(record: WorkspaceRecord) {
    if (!this.gateway || !["ready", "open"].includes(record.state)) return toView(record);
    const gateway = await this.gateway.readiness(record.id).catch(() => ({ models: "failed" as const, tools: "failed" as const }));
    return toView(record, gateway);
  }

  async current(identity: IdentityContext, grantId = "personal") {
    let record = await this.store.getCurrent(identity, grantId);
    if (!record) return null;
    if (record.providerId && ["provisioning", "ready", "open", "restarting", "stopping"].includes(record.state)) {
      const sandbox = await this.controller.status(record.providerId);
      record = await this.store.update(record.id, {
        state: sandbox.state === "ready" && record.state === "open" ? "open" : sandbox.state === "ready" ? "ready" : sandbox.state,
        ...(sandbox.state === "stopped" ? { providerId: null } : {}),
        failureCode: sandbox.failureCode,
      });
    }
    if (this.gateway && ["ready", "open"].includes(record.state)) {
      await this.gateway.ensureGrant({ workspaceId: record.id, identity }).catch(() => undefined);
    }
    return this.view(record);
  }

  async create(identity: IdentityContext, grantId: string, idempotencyKey: string, correlationId: string) {
    let record = await this.store.createOrGet(identity, grantId, idempotencyKey);
    if (["ready", "open", "provisioning", "restarting"].includes(record.state)) return this.view(record);
    const claimed = await this.store.claim(record.id, ["not_created", "stopped", "failed"], "provisioning");
    if (!claimed) return this.view((await this.store.getOwned(identity, record.id))!);
    try {
      const gateway = await this.gateway?.ensureGrant({ workspaceId: claimed.id, identity });
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, gateway });
      record = await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "provisioning", providerId: sandbox.providerId, failureCode: sandbox.failureCode });
      return this.view(record);
    } catch (error) {
      await this.gateway?.revoke(claimed.id).catch(() => undefined);
      await this.store.finish(claimed.id, claimed.operationToken!, { state: "failed", failureCode: error instanceof OneComputerError ? error.code : "PROVISION_FAILED" });
      throw error;
    }
  }

  async open(identity: IdentityContext, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!record.providerId || !["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready to open", 409, true);
    await this.gateway?.ensureGrant({ workspaceId: record.id, identity });
    const launch = await this.controller.open(record.providerId);
    const updated = await this.store.update(record.id, { state: "open", failureCode: null });
    return { workspace: await this.view(updated), launch };
  }

  async restart(identity: IdentityContext, workspaceId: string, correlationId: string) {
    const record = await this.owned(identity, workspaceId);
    const claimed = await this.store.claim(record.id, ["ready", "open", "stopped", "failed"], "restarting");
    if (!claimed) throw new OneComputerError("WORKSPACE_BUSY", "A workspace operation is already running", 409, true);
    try {
      if (claimed.providerId) await this.controller.destroy(claimed.providerId);
      const gateway = await this.gateway?.ensureGrant({ workspaceId: claimed.id, identity });
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, gateway });
      return this.view(await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "restarting", providerId: sandbox.providerId, failureCode: sandbox.failureCode }));
    } catch (error) {
      await this.store.finish(claimed.id, claimed.operationToken!, { state: "failed", providerId: null, failureCode: error instanceof OneComputerError ? error.code : "RESTART_FAILED" });
      throw error;
    }
  }

  async stop(identity: IdentityContext, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (record.state === "stopped") return toView(record);
    const claimed = await this.store.claim(record.id, ["ready", "open", "provisioning", "restarting", "failed"], "stopping");
    if (!claimed) throw new OneComputerError("WORKSPACE_BUSY", "A workspace operation is already running", 409, true);
    if (claimed.providerId) await this.controller.destroy(claimed.providerId);
    await this.gateway?.revoke(claimed.id);
    return toView(await this.store.finish(claimed.id, claimed.operationToken!, { state: "stopped", providerId: null, failureCode: null }));
  }

  async delete(identity: IdentityContext, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (record.providerId) await this.controller.destroy(record.providerId);
    await this.gateway?.revoke(record.id);
    await this.store.remove(identity, record.id);
  }

  async testGateway(identity: IdentityContext, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready", 409, true);
    if (!this.gateway) throw new OneComputerError("GATEWAY_NOT_CONFIGURED", "The model gateway is not configured", 503, true);
    await this.gateway.ensureGrant({ workspaceId: record.id, identity });
    return this.gateway.test(record.id);
  }

  private async owned(identity: IdentityContext, workspaceId: string) {
    const record = await this.store.getOwned(identity, workspaceId);
    if (!record) throw new OneComputerError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    return record;
  }
}
