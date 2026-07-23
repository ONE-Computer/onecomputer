import { OneComputerError, readinessFor, type IdentityContext, type Launch, type RuntimeAgentPolicy, type RuntimePolicy, type Sandbox, type WorkspaceView } from "@onecomputer/contracts";
import { deriveEgressProxySecret, issueEgressProxyGrant } from "@onecomputer/egress-policy";
import type { GatewayClient, GatewayGrant, GatewayReadiness } from "@onecomputer/litellm-adapter";
import type { WorkspaceRecord, WorkspaceStore } from "@onecomputer/workspace-store";

export interface ControllerClient {
  create(input: {
    workspaceId: string;
    correlationId: string;
    policy: RuntimePolicy;
    gateway?: GatewayGrant;
    agentBridge?: { baseUrl: string; token: string };
    agentGrants?: Array<{ catalogId: RuntimeAgentPolicy["catalogId"]; agentId: string; gateway: GatewayGrant; agentBridge: { baseUrl: string; token: string } }>;
    egressProxy?: EgressProxyGrant;
  }): Promise<Sandbox>;
  status(providerId: string): Promise<Sandbox>;
  open(providerId: string): Promise<Launch>;
  destroy(providerId: string): Promise<void>;
  purgeWorkspace(workspaceId: string): Promise<void>;
}

export type EgressProxyGrant = {
  token: string;
  verificationSecret: string;
  expiresAt: string;
  expectedGrant: {
    tenantId: string;
    subjectId: string;
    workspaceId: string;
    agentId: string;
    securityGroupVersionId: string;
    policyHash: string;
  };
};

export class EgressProxyGrantAuthority {
  constructor(private readonly rootSecret: string) {}

  issue(identity: IdentityContext, workspaceId: string, policy: RuntimePolicy): EgressProxyGrant | undefined {
    if (!policy.egress) return undefined;
    const verificationSecret = deriveEgressProxySecret(this.rootSecret, workspaceId);
    const expectedGrant = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      workspaceId,
      agentId: policy.agentId,
      securityGroupVersionId: policy.egress.id,
      policyHash: policy.policyHash,
    };
    const ttlSeconds = 24 * 60 * 60;
    return {
      token: issueEgressProxyGrant(verificationSecret, expectedGrant, new Date(), ttlSeconds),
      verificationSecret,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      expectedGrant,
    };
  }
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
  async create(input: Parameters<ControllerClient["create"]>[0]) {
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
  ...(policy?.agents ? {
    agents: policy.agents.map((agent) => ({
      id: agent.catalogId,
      displayName: agent.displayName,
      clientVersion: agent.clientVersion,
      agentId: agent.agentId,
      state: record.state === "failed"
        ? "unavailable" as const
        : ["provisioning", "restarting"].includes(record.state)
          ? "starting" as const
          : ["ready", "open"].includes(record.state)
            ? gateway?.models === "failed" || gateway?.tools === "failed" ? "degraded" as const : "ready" as const
            : "selected" as const,
    })),
  } : {}),
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
    private readonly egressProxyAuthority?: EgressProxyGrantAuthority,
  ) {}

  private bridgeGrant(identity: IdentityContext, workspaceId: string, policy: RuntimePolicy) {
    return this.agentBridge ? { baseUrl: this.agentBridge.baseUrl, token: this.agentBridge.issue(identity, workspaceId, policy) } : undefined;
  }

  private agentPolicies(policy: RuntimePolicy): RuntimePolicy[] {
    if (!policy.agents?.length) return [policy];
    return policy.agents.map((agent) => ({
      ...policy,
      agentId: agent.agentId,
      agentProfile: agent.agentProfile,
      modelAlias: agent.modelAlias,
      mcpServer: agent.mcpServer,
      allowedTools: agent.allowedTools,
      toolPolicies: agent.toolPolicies,
      agents: [agent],
    }));
  }

  private async ensureAgentGrants(identity: IdentityContext, workspaceId: string, policy: RuntimePolicy) {
    const policies = this.agentPolicies(policy);
    const resolved = await Promise.all(policies.map(async (agentPolicy) => ({
      policy: agentPolicy,
      gateway: await this.gateway?.ensureGrant({
        workspaceId,
        identity,
        agentId: agentPolicy.agentId,
        policy: agentPolicy,
      }),
      agentBridge: this.bridgeGrant(identity, workspaceId, agentPolicy),
    })));
    const primary = resolved[0]!;
    const agentGrants = policy.agents?.length && this.gateway && this.agentBridge
      ? resolved.map((item) => ({
        catalogId: item.policy.agents![0]!.catalogId,
        agentId: item.policy.agentId,
        gateway: item.gateway!,
        agentBridge: item.agentBridge!,
      }))
      : undefined;
    return { gateway: primary.gateway, agentBridge: primary.agentBridge, agentGrants };
  }

  private async revokeAgentGrants(workspaceId: string, policy: RuntimePolicy) {
    await Promise.all(this.agentPolicies(policy).map((agentPolicy) => (
      this.gateway?.revoke(workspaceId, agentPolicy.agentId)
    )));
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
      await this.ensureAgentGrants(identity, record.id, policy).catch(() => undefined);
    }
    return this.view(record, policy);
  }

  async refreshPolicyGrant(identity: IdentityContext, policy: RuntimePolicy, grantId = "personal") {
    const record = await this.store.getCurrent(identity, grantId);
    if (!record || !this.gateway || !["ready", "open"].includes(record.state)) return false;
    await this.ensureAgentGrants(identity, record.id, policy);
    return true;
  }

  async create(identity: IdentityContext, policy: RuntimePolicy, grantId: string, idempotencyKey: string, correlationId: string) {
    let record = await this.store.createOrGet(identity, grantId, idempotencyKey);
    if (["ready", "open", "provisioning", "restarting"].includes(record.state)) return this.view(record, policy);
    const claimed = await this.store.claim(record.id, ["not_created", "stopped", "failed"], "provisioning");
    if (!claimed) return this.view((await this.store.getOwned(identity, record.id))!, policy);
    try {
      const grants = await this.ensureAgentGrants(identity, claimed.id, policy);
      const egressProxy = this.egressProxyAuthority?.issue(identity, claimed.id, policy);
      if (policy.egress && !egressProxy) throw new OneComputerError("EGRESS_PROXY_NOT_CONFIGURED", "The assigned egress firewall cannot be provisioned", 503);
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, policy, ...grants, egressProxy });
      record = await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "provisioning", providerId: sandbox.providerId, failureCode: sandbox.failureCode });
      return this.view(record, policy);
    } catch (error) {
      await this.revokeAgentGrants(claimed.id, policy).catch(() => undefined);
      await this.store.finish(claimed.id, claimed.operationToken!, { state: "failed", failureCode: error instanceof OneComputerError ? error.code : "PROVISION_FAILED" });
      throw error;
    }
  }

  async open(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!record.providerId || !["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready to open", 409, true);
    await this.ensureAgentGrants(identity, record.id, policy);
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
      const grants = await this.ensureAgentGrants(identity, claimed.id, policy);
      const egressProxy = this.egressProxyAuthority?.issue(identity, claimed.id, policy);
      if (policy.egress && !egressProxy) throw new OneComputerError("EGRESS_PROXY_NOT_CONFIGURED", "The assigned egress firewall cannot be provisioned", 503);
      const sandbox = await this.controller.create({ workspaceId: claimed.id, correlationId, policy, ...grants, egressProxy });
      return this.view(await this.store.finish(claimed.id, claimed.operationToken!, { state: sandbox.state === "ready" ? "ready" : "restarting", providerId: sandbox.providerId, failureCode: sandbox.failureCode }), policy);
    } catch (error) {
      await this.revokeAgentGrants(claimed.id, policy).catch(() => undefined);
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
    await this.revokeAgentGrants(claimed.id, policy);
    return toView(await this.store.finish(claimed.id, claimed.operationToken!, { state: "stopped", providerId: null, failureCode: null }), undefined, policy);
  }

  async delete(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (record.providerId) await this.controller.destroy(record.providerId);
    await this.controller.purgeWorkspace(record.id);
    await this.revokeAgentGrants(record.id, policy);
    await this.store.remove(identity, record.id);
  }

  async testGateway(identity: IdentityContext, policy: RuntimePolicy, workspaceId: string) {
    const record = await this.owned(identity, workspaceId);
    if (!["ready", "open"].includes(record.state)) throw new OneComputerError("WORKSPACE_NOT_READY", "The workspace is not ready", 409, true);
    if (!this.gateway) throw new OneComputerError("GATEWAY_NOT_CONFIGURED", "The model gateway is not configured", 503, true);
    await this.ensureAgentGrants(identity, record.id, policy);
    return this.gateway.test(record.id, policy.agentId, policy);
  }

  private async owned(identity: IdentityContext, workspaceId: string) {
    const record = await this.store.getOwned(identity, workspaceId);
    if (!record) throw new OneComputerError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    return record;
  }
}
