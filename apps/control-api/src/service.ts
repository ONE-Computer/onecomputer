import { OneComputerError, readinessFor, type IdentityContext, type Launch, type RuntimePolicy, type Sandbox, type WorkspaceView } from "@onecomputer/contracts";
import type { GatewayClient, GatewayGrant, GatewayReadiness } from "@onecomputer/litellm-adapter";
import type { WorkspaceRecord, WorkspaceStore } from "@onecomputer/workspace-store";

export interface ControllerClient {
  create(input: { workspaceId: string; correlationId: string; policy: RuntimePolicy; gateway?: GatewayGrant; agentBridge?: { baseUrl: string; token: string } }): Promise<Sandbox>;
  status(providerId: string): Promise<Sandbox>;
  open(providerId: string): Promise<Launch>;
  destroy(providerId: string): Promise<void>;
  purgeWorkspace(workspaceId: string): Promise<void>;
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
  async create(input: { workspaceId: string; correlationId: string; policy: RuntimePolicy; gateway?: GatewayGrant; agentBridge?: { baseUrl: string; token: string } }) {
    return await this.call("/internal/v1/sandboxes", { method: "POST", body: JSON.stringify(input) }) as Sandbox;
  }
  async status(providerId: string) { return await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}`) as Sandbox; }
  async open(providerId: string) { return await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}/open`, { method: "POST" }) as Launch; }
  async destroy(providerId: string) { await this.call(`/internal/v1/sandboxes/${encodeURIComponent(providerId)}`, { method: "DELETE" }); }
  async purgeWorkspace(workspaceId: string) { await this.call(`/internal/v1/workspaces/${encodeURIComponent(workspaceId)}/storage`, { method: "DELETE" }); }
}

const profileClient = (profileId: RuntimePolicy["workspaceProfile"]) => profileId === "claude-desktop-standard-v1"
  ? { client: "Claude Desktop", clientVersion: "1.22209.3" }
  : { client: "ONEComputer qualification CLI", clientVersion: "issue-006" };

export const toView = (record: WorkspaceRecord, gateway?: GatewayReadiness, policy?: RuntimePolicy): WorkspaceView => ({
  id: record.id,
  grantId: record.grantId,
  state: record.state,
  readiness: readinessFor(record.state, gateway),
  ...(gateway ? { modelRoute: gateway.modelRoute } : {}),
  ...(policy ? { profile: {
    id: policy.workspaceProfile,
    ...profileClient(policy.workspaceProfile),
    modelAlias: policy.modelAlias,
    persistence: "persistent-home" as const,
    network: "gateway-only" as const,
  } } : {}),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  failureCode: record.failureCode,
});

export class WorkspaceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly controller: ControllerClient,
    private readonly gateway?: GatewayClient,
    private readonly agentBridge?: { baseUrl: string; issue: (identity: IdentityContext, workspaceId: string, policy: RuntimePolicy) => string },
  ) {}

  private bridgeGrant(identity: IdentityContext, workspaceId: string, policy: RuntimePolicy) {
    return this.agentBridge ? { baseUrl: this.agentBridge.baseUrl, token: this.agentBridge.issue(identity, workspaceId, policy) } : undefined;
  }

  private async view(record: WorkspaceRecord, policy: RuntimePolicy) {
    if (!this.gateway || !["ready", "open"].includes(record.state)) return toView(record, undefined, policy);
    const gateway = await this.gateway.readiness(record.id, policy.agentId, policy).catch(() => undefined);
    return toView(record, gateway, policy);
  }

  async current(identity: IdentityContext, policy: RuntimePolicy, grantId = "personal") {
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
      await this.gateway.ensureGrant({ workspaceId: record.id, identity, agentId: policy.agentId, policy }).catch(() => undefined);
    }
    return this.view(record, policy);
  }

  async create(identity: IdentityContext, policy: RuntimePolicy, grantId: string, idempotencyKey: string, correlationId: string) {
    let record = await this.store.createOrGet(identity, grantId, idempotencyKey);
    if (["ready", "open", "provisioning", "restarting"].includes(record.state)) return this.view(record, policy);
    const claimed = await this.store.claim(record.id, ["not_created", "stopped", "failed"], "provisioning");
    if (!claimed) return this.view((await this.store.getOwned(identity, record.id))!, policy);
    try {
      const gateway = await this.gateway?.ensureGrant({ workspaceId: claimed.id, identity, agentId: policy.agentId, policy });
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, policy, gateway, agentBridge: this.bridgeGrant(identity, claimed.id, policy) });
      record = await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "provisioning", providerId: sandbox.providerId, failureCode: sandbox.failureCode });
      return this.view(record, policy);
    } catch (error) {
      await this.gateway?.revoke(claimed.id, policy.agentId).catch(() => undefined);
      await this.store.finish(claimed.id, claimed.operationToken!, { state: "failed", failureCode: error instanceof OneComputerError ? error.code : "PROVISION_FAILED" });
      throw error;
    }
  }

  async open(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!record.providerId || !["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready to open", 409, true);
    await this.gateway?.ensureGrant({ workspaceId: record.id, identity, agentId: policy.agentId, policy });
    const launch = await this.controller.open(record.providerId);
    const updated = await this.store.update(record.id, { state: "open", failureCode: null });
    return { workspace: await this.view(updated, policy), launch };
  }

  async restart(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string, correlationId: string) {
    const record = await this.owned(identity, workspaceId);
    const claimed = await this.store.claim(record.id, ["ready", "open", "stopped", "failed"], "restarting");
    if (!claimed) throw new OneComputerError("WORKSPACE_BUSY", "A workspace operation is already running", 409, true);
    try {
      if (claimed.providerId) await this.controller.destroy(claimed.providerId);
      const gateway = await this.gateway?.ensureGrant({ workspaceId: claimed.id, identity, agentId: policy.agentId, policy });
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, policy, gateway, agentBridge: this.bridgeGrant(identity, claimed.id, policy) });
      return this.view(await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "restarting", providerId: sandbox.providerId, failureCode: sandbox.failureCode }), policy);
    } catch (error) {
      await this.store.finish(claimed.id, claimed.operationToken!, { state: "failed", providerId: null, failureCode: error instanceof OneComputerError ? error.code : "RESTART_FAILED" });
      throw error;
    }
  }

  async stop(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (record.state === "stopped") return toView(record, undefined, policy);
    const claimed = await this.store.claim(record.id, ["ready", "open", "provisioning", "restarting", "failed"], "stopping");
    if (!claimed) throw new OneComputerError("WORKSPACE_BUSY", "A workspace operation is already running", 409, true);
    if (claimed.providerId) await this.controller.destroy(claimed.providerId);
    await this.gateway?.revoke(claimed.id, policy.agentId);
    return toView(await this.store.finish(claimed.id, claimed.operationToken!, { state: "stopped", providerId: null, failureCode: null }), undefined, policy);
  }

  async delete(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (record.providerId) await this.controller.destroy(record.providerId);
    await this.controller.purgeWorkspace(record.id);
    await this.gateway?.revoke(record.id, policy.agentId);
    await this.store.remove(identity, record.id);
  }

  async testGateway(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready", 409, true);
    if (!this.gateway) throw new OneComputerError("GATEWAY_NOT_CONFIGURED", "The model gateway is not configured", 503, true);
    await this.gateway.ensureGrant({ workspaceId: record.id, identity, agentId: policy.agentId, policy });
    return this.gateway.test(record.id, policy.agentId, policy);
  }

  private async owned(identity: IdentityContext, workspaceId: string) {
    const record = await this.store.getOwned(identity, workspaceId);
    if (!record) throw new OneComputerError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    return record;
  }
}
