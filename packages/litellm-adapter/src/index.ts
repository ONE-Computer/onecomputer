import { createHash, createHmac } from "node:crypto";
import { OneComputerError, type IdentityContext, type OwnedJson } from "@onecomputer/contracts";

export type GatewayGrant = {
  baseUrl: string;
  credential: string;
  modelAlias: string;
  expiresAt: string;
};

export type GatewayReadiness = {
  models: "ready" | "failed";
  tools: "ready" | "failed";
};

export type GatewayTestResult = {
  model: string;
  response: string;
  tools: Array<{ name: string; description: string }>;
  apiBaseUrl: string;
  mcpUrl: string;
};

export interface GatewayClient {
  ensureGrant(input: { workspaceId: string; identity: IdentityContext; agentId?: string }): Promise<GatewayGrant>;
  readiness(workspaceId: string, agentId?: string): Promise<GatewayReadiness>;
  test(workspaceId: string, agentId?: string): Promise<GatewayTestResult>;
  revoke(workspaceId: string, agentId?: string): Promise<void>;
}

export type OAuthConnectionStatus = {
  state: "disconnected" | "connected" | "expired";
  connectedAt: string | null;
  expiresAt: string | null;
};

export interface OAuthConnectionGateway {
  beginUserOAuthConnection(input: {
    identity: IdentityContext;
    serverName: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    authorizationOrigin: string;
  }): Promise<{ location: string; cookies: string[] }>;
  completeUserOAuthConnection(input: {
    identity: IdentityContext;
    serverName: string;
    code: string;
    codeVerifier: string;
  }): Promise<OAuthConnectionStatus>;
  userOAuthConnectionStatus(identity: IdentityContext, serverName: string): Promise<OAuthConnectionStatus>;
  disconnectUserOAuthConnection(identity: IdentityContext, serverName: string): Promise<OAuthConnectionStatus>;
}

export type GovernedToolExecutionInput = {
  tenantId: string;
  subjectId: string;
  workspaceId: string;
  operationId: string;
  operationDigest: string;
  leaseId: string;
  agentId?: string;
  serverName: string;
  toolName: string;
  arguments: OwnedJson;
};

export type GovernedToolExecutionResult = {
  upstreamReference: string;
  resultSummary: string;
  result: OwnedJson;
};

export interface GovernedToolExecutor {
  executeGovernedTool(input: GovernedToolExecutionInput): Promise<GovernedToolExecutionResult>;
}

type LiteLLMConfig = {
  adminUrl: string;
  workspaceUrl: string;
  masterKey: string;
  credentialSecret: string;
  modelAlias?: string;
  mcpServer?: string;
  allowedTools?: string[];
  requestTimeoutMs?: number;
  workspaceGrantTtlMs?: number;
  workspaceGrantRenewalMs?: number;
  connectionGrantTtlMs?: number;
};

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => value && typeof value === "object" ? value as JsonObject : {};

export class LiteLLMGatewayAdapter implements GatewayClient, GovernedToolExecutor, OAuthConnectionGateway {
  private readonly adminUrl: string;
  private readonly workspaceUrl: string;
  private readonly modelAlias: string;
  private readonly mcpServer: string;
  private readonly allowedTools: string[];
  private readonly timeoutMs: number;
  private readonly workspaceGrantTtlMs: number;
  private readonly workspaceGrantRenewalMs: number;
  private readonly connectionGrantTtlMs: number;
  private readonly workspaceGrantExpiries = new Map<string, number>();

  constructor(private readonly config: LiteLLMConfig) {
    this.adminUrl = config.adminUrl.replace(/\/$/, "");
    this.workspaceUrl = config.workspaceUrl.replace(/\/$/, "");
    this.modelAlias = config.modelAlias ?? "onecomputer-assistant";
    this.mcpServer = config.mcpServer ?? "onecomputer_fixture";
    this.allowedTools = config.allowedTools ?? ["search_files"];
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
    this.workspaceGrantTtlMs = config.workspaceGrantTtlMs ?? 8 * 60 * 60 * 1000;
    this.workspaceGrantRenewalMs = config.workspaceGrantRenewalMs ?? 60 * 60 * 1000;
    this.connectionGrantTtlMs = config.connectionGrantTtlMs ?? 15 * 60 * 1000;
  }

  userIdFor(identity: IdentityContext) {
    const digest = createHash("sha256")
      .update(`onecomputer:litellm:user:${identity.tenantId}:${identity.subjectId}`)
      .digest("base64url");
    return `oc-user-${digest}`;
  }

  agentIdFor(workspaceId: string, agentId?: string) {
    const digest = createHash("sha256")
      .update(`onecomputer:litellm:agent:${workspaceId}:${agentId ?? "default"}`)
      .digest("base64url");
    return `oc-agent-${digest}`;
  }

  credentialFor(workspaceId: string, agentId?: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(agentId
        ? `onecomputer:litellm:workspace:${workspaceId}:agent:${agentId}`
        : `onecomputer:litellm:workspace:${workspaceId}`)
      .digest("base64url");
    return `sk-ocw-${digest}`;
  }

  connectionCredentialFor(identity: IdentityContext, serverName: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(`onecomputer:litellm:connection:${identity.tenantId}:${identity.subjectId}:${serverName}`)
      .digest("base64url");
    return `sk-occ-${digest}`;
  }

  async beginUserOAuthConnection(input: {
    identity: IdentityContext;
    serverName: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    authorizationOrigin: string;
  }) {
    const grant = await this.ensureConnectionGrant(input.identity, input.serverName);
    const query = new URLSearchParams({
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      response_type: "code",
    });
    let response: Response;
    try {
      response = await fetch(`${this.adminUrl}/v1/mcp/server/oauth/${encodeURIComponent(grant.serverId)}/authorize?${query}`, {
        method: "GET",
        headers: { authorization: `Bearer ${grant.credential}` },
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new OneComputerError("GATEWAY_UNAVAILABLE", "The Microsoft 365 connection service is unavailable", 503, true);
    }
    if (response.status < 300 || response.status >= 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new OneComputerError("M365_AUTHORIZATION_REJECTED", "Microsoft 365 authorization could not be started", 502, true);
    }
    const location = response.headers.get("location");
    if (!location) throw new OneComputerError("M365_AUTHORIZATION_INVALID", "The Microsoft 365 authorization response was invalid", 502, true);
    let authorizationUrl: URL;
    let expectedOrigin: string;
    try {
      authorizationUrl = new URL(location);
      expectedOrigin = new URL(input.authorizationOrigin).origin;
    } catch {
      throw new OneComputerError("M365_AUTHORIZATION_INVALID", "The Microsoft 365 authorization response was invalid", 502, true);
    }
    if (authorizationUrl.origin !== expectedOrigin) {
      throw new OneComputerError("M365_AUTHORIZATION_ORIGIN_MISMATCH", "The Microsoft 365 authorization origin was not approved", 502);
    }
    const cookieHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = cookieHeaders.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
    return { location: authorizationUrl.toString(), cookies };
  }

  async completeUserOAuthConnection(input: {
    identity: IdentityContext;
    serverName: string;
    code: string;
    codeVerifier: string;
  }): Promise<OAuthConnectionStatus> {
    const grant = await this.ensureConnectionGrant(input.identity, input.serverName);
    try {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
      });
      let response: Response;
      try {
        response = await fetch(`${this.adminUrl}/v1/mcp/server/oauth/${encodeURIComponent(grant.serverId)}/token`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${grant.credential}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        throw new OneComputerError("GATEWAY_UNAVAILABLE", "The Microsoft 365 connection service is unavailable", 503, true);
      }
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) {
        throw new OneComputerError("M365_TOKEN_EXCHANGE_FAILED", "Microsoft 365 did not complete the connection", 502, true);
      }
      return await this.readConnectionStatus(grant.credential, grant.serverId);
    } finally {
      await this.deleteConnectionGrant(grant.credential).catch(() => undefined);
    }
  }

  async userOAuthConnectionStatus(identity: IdentityContext, serverName: string): Promise<OAuthConnectionStatus> {
    const grant = await this.ensureConnectionGrant(identity, serverName);
    try {
      return await this.readConnectionStatus(grant.credential, grant.serverId);
    } finally {
      await this.deleteConnectionGrant(grant.credential).catch(() => undefined);
    }
  }

  async disconnectUserOAuthConnection(identity: IdentityContext, serverName: string): Promise<OAuthConnectionStatus> {
    const grant = await this.ensureConnectionGrant(identity, serverName);
    try {
      const result = await this.dataCall(`/v1/mcp/server/${encodeURIComponent(grant.serverId)}/oauth-user-credential`, grant.credential, { method: "DELETE" });
      if (!result.ok && result.status !== 404) throw this.upstreamError("M365_DISCONNECT_FAILED", result.status, result.payload);
      return { state: "disconnected", connectedAt: null, expiresAt: null };
    } finally {
      await this.deleteConnectionGrant(grant.credential).catch(() => undefined);
    }
  }

  private async resolveMcpServer(serverName: string) {
    const result = await this.adminCall("/v1/mcp/server", { method: "GET" });
    const servers = Array.isArray(result.payload) ? result.payload : [];
    const server = servers.map(asObject).find((item) => item.server_name === serverName);
    const serverId = server?.server_id;
    if (typeof serverId !== "string" || !serverId) {
      throw new OneComputerError("M365_MCP_NOT_REGISTERED", "The Microsoft 365 connector is not registered", 503, true);
    }
    return serverId;
  }

  private async ensureConnectionGrant(identity: IdentityContext, serverName: string) {
    const serverId = await this.resolveMcpServer(serverName);
    const credential = this.connectionCredentialFor(identity, serverName);
    const userId = this.userIdFor(identity);
    const keyAlias = `onecomputer-connection-${userId}`;
    const credentialRoute = `/v1/mcp/server/${serverId}/oauth-user-credential`;
    const allowedRoutes = [
      `/v1/mcp/server/oauth/${serverId}/authorize`,
      `/v1/mcp/server/oauth/${serverId}/token`,
      credentialRoute,
      `${credentialRoute}/status`,
    ];
    const durationSeconds = Math.max(60, Math.ceil(this.connectionGrantTtlMs / 1_000));
    const grant = {
      key: credential,
      key_alias: keyAlias,
      key_type: "default",
      user_id: userId,
      duration: `${durationSeconds}s`,
      models: [],
      max_budget: 0,
      rpm_limit: 12,
      allowed_routes: allowedRoutes,
      metadata: {
        onecomputer_tenant_id: identity.tenantId,
        onecomputer_subject_id: identity.subjectId,
        onecomputer_gateway_user_id: userId,
        onecomputer_connection_credential: true,
        onecomputer_connection_server: serverName,
      },
      object_permission: { mcp_servers: [serverName] },
    };
    const generated = await this.adminCall("/key/generate", { method: "POST", body: grant }, true);
    if (!generated.ok) {
      const existing = await this.adminCall(`/key/list?return_full_object=true&key_alias=${encodeURIComponent(keyAlias)}`, { method: "GET" }, true);
      const keys = Array.isArray(asObject(existing.payload).keys) ? asObject(existing.payload).keys as unknown[] : [];
      const tokenHash = createHash("sha256").update(credential).digest("hex");
      const current = keys.map(asObject).find((key) => key.token === tokenHash);
      const metadata = asObject(current?.metadata);
      const identityMatches = current?.user_id === userId
        && metadata.onecomputer_tenant_id === identity.tenantId
        && metadata.onecomputer_subject_id === identity.subjectId
        && metadata.onecomputer_connection_credential === true
        && metadata.onecomputer_connection_server === serverName;
      if (!identityMatches) {
        await this.deleteConnectionGrant(credential);
        const replaced = await this.adminCall("/key/generate", { method: "POST", body: grant }, true);
        if (!replaced.ok) throw this.upstreamError("M365_CONNECTION_IDENTITY_MISMATCH", replaced.status, replaced.payload);
      } else {
        const updated = await this.adminCall("/key/update", { method: "POST", body: grant }, true);
        if (!updated.ok) throw this.upstreamError("M365_CONNECTION_GRANT_FAILED", updated.status, updated.payload);
      }
    }
    return { credential, serverId };
  }

  private async readConnectionStatus(credential: string, serverId: string): Promise<OAuthConnectionStatus> {
    const result = await this.dataCall(`/v1/mcp/server/${encodeURIComponent(serverId)}/oauth-user-credential/status`, credential);
    if (!result.ok) throw this.upstreamError("M365_CONNECTION_STATUS_FAILED", result.status, result.payload);
    const payload = asObject(result.payload);
    const hasCredential = payload.has_credential === true;
    const isExpired = payload.is_expired === true;
    return {
      state: !hasCredential ? "disconnected" : isExpired ? "expired" : "connected",
      connectedAt: typeof payload.connected_at === "string" ? payload.connected_at : null,
      expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : null,
    };
  }

  private async deleteConnectionGrant(credential: string) {
    const result = await this.adminCall("/key/delete", { method: "POST", body: { keys: [credential] } }, true);
    if (!result.ok && result.status !== 404) throw this.upstreamError("M365_CONNECTION_GRANT_REVOKE_FAILED", result.status, result.payload);
  }

  private executionCredential(operationId: string, leaseId: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(`onecomputer:litellm:execution:${operationId}:${leaseId}`)
      .digest("base64url");
    return `sk-oce-${digest}`;
  }

  async ensureGrant(input: { workspaceId: string; identity: IdentityContext; agentId?: string }): Promise<GatewayGrant> {
    const credential = this.credentialFor(input.workspaceId, input.agentId);
    const gatewayUserId = this.userIdFor(input.identity);
    const gatewayAgentId = this.agentIdFor(input.workspaceId, input.agentId);
    const cachedExpiry = this.workspaceGrantExpiries.get(credential) ?? 0;
    if (cachedExpiry > Date.now() + this.workspaceGrantRenewalMs) {
      return { baseUrl: this.workspaceUrl, credential, modelAlias: this.modelAlias, expiresAt: new Date(cachedExpiry).toISOString() };
    }
    const expiresAt = new Date(Date.now() + this.workspaceGrantTtlMs);
    const durationSeconds = Math.max(60, Math.ceil(this.workspaceGrantTtlMs / 1_000));
    const grant = {
      key: credential,
      key_alias: `onecomputer-agent-${gatewayAgentId}`,
      key_type: "llm_api",
      user_id: gatewayUserId,
      agent_id: gatewayAgentId,
      duration: `${durationSeconds}s`,
      models: [this.modelAlias],
      max_budget: 1,
      rpm_limit: 60,
      tpm_limit: 100_000,
      metadata: {
        onecomputer_workspace_id: input.workspaceId,
        onecomputer_tenant_id: input.identity.tenantId,
        onecomputer_subject_id: input.identity.subjectId,
        onecomputer_agent_id: input.agentId ?? `workspace-default:${input.workspaceId}`,
        onecomputer_gateway_user_id: gatewayUserId,
        onecomputer_gateway_agent_id: gatewayAgentId,
      },
      object_permission: {
        mcp_servers: [this.mcpServer],
        mcp_tool_permissions: { [this.mcpServer]: this.allowedTools },
      },
    };

    const generated = await this.adminCall("/key/generate", { method: "POST", body: grant }, true);
    if (!generated.ok) {
      const existing = await this.adminCall(`/key/list?return_full_object=true&key_alias=${encodeURIComponent(grant.key_alias)}`, { method: "GET" }, true);
      const keys = Array.isArray(asObject(existing.payload).keys) ? asObject(existing.payload).keys as unknown[] : [];
      const tokenHash = createHash("sha256").update(credential).digest("hex");
      const current = keys.map(asObject).find((key) => key.token === tokenHash);
      const metadata = asObject(current?.metadata);
      const identityMatches = current?.user_id === gatewayUserId
        && current?.agent_id === gatewayAgentId
        && metadata.onecomputer_tenant_id === input.identity.tenantId
        && metadata.onecomputer_subject_id === input.identity.subjectId
        && metadata.onecomputer_workspace_id === input.workspaceId
        && metadata.onecomputer_agent_id === (input.agentId ?? `workspace-default:${input.workspaceId}`);
      if (!identityMatches) {
        await this.adminCall("/key/delete", { method: "POST", body: { keys: [credential] } }, true);
        const replaced = await this.adminCall("/key/generate", { method: "POST", body: grant }, true);
        if (!replaced.ok) throw this.upstreamError("GATEWAY_GRANT_IDENTITY_MISMATCH", replaced.status, replaced.payload);
      } else {
        const updated = await this.adminCall("/key/update", { method: "POST", body: grant });
        if (!updated.ok) throw this.upstreamError("GATEWAY_GRANT_FAILED", updated.status, updated.payload);
      }
    }
    this.workspaceGrantExpiries.set(credential, expiresAt.getTime());
    return { baseUrl: this.workspaceUrl, credential, modelAlias: this.modelAlias, expiresAt: expiresAt.toISOString() };
  }

  async readiness(workspaceId: string, agentId?: string): Promise<GatewayReadiness> {
    const credential = this.credentialFor(workspaceId, agentId);
    const [models, tools] = await Promise.all([
      this.dataCall("/v1/models", credential),
      this.dataCall("/mcp-rest/tools/list", credential),
    ]);
    if (!models.ok || !tools.ok) this.workspaceGrantExpiries.delete(credential);
    const modelIds = Array.isArray(asObject(models.payload).data)
      ? (asObject(models.payload).data as unknown[]).map((item) => String(asObject(item).id ?? ""))
      : [];
    const toolNames = Array.isArray(asObject(tools.payload).tools)
      ? (asObject(tools.payload).tools as unknown[]).map((item) => String(asObject(item).name ?? ""))
      : [];
    return {
      models: models.ok && modelIds.includes(this.modelAlias) ? "ready" : "failed",
      tools: tools.ok && this.allowedTools.every((tool) => toolNames.includes(tool)) ? "ready" : "failed",
    };
  }

  async test(workspaceId: string, agentId?: string): Promise<GatewayTestResult> {
    const credential = this.credentialFor(workspaceId, agentId);
    const [completion, toolList] = await Promise.all([
      this.dataCall("/v1/chat/completions", credential, {
        method: "POST",
        body: {
          model: this.modelAlias,
          messages: [{ role: "user", content: "Confirm that the ONEComputer model route is ready." }],
          max_tokens: 80,
        },
      }),
      this.dataCall("/mcp-rest/tools/list", credential),
    ]);
    if (!completion.ok) throw this.upstreamError("MODEL_ROUTE_FAILED", completion.status, completion.payload);
    if (!toolList.ok) throw this.upstreamError("MCP_DISCOVERY_FAILED", toolList.status, toolList.payload);
    const choices = asObject(completion.payload).choices;
    const firstChoice = Array.isArray(choices) ? asObject(choices[0]) : {};
    const content = asObject(firstChoice.message).content;
    if (typeof content !== "string") throw new OneComputerError("GATEWAY_INVALID_RESPONSE", "The model gateway returned an invalid response", 502, true);
    const tools = Array.isArray(asObject(toolList.payload).tools)
      ? (asObject(toolList.payload).tools as unknown[]).map((item) => {
          const tool = asObject(item);
          return { name: String(tool.name ?? ""), description: String(tool.description ?? "") };
        }).filter((tool) => tool.name.length > 0)
      : [];
    return {
      model: this.modelAlias,
      response: content,
      tools,
      apiBaseUrl: `${this.workspaceUrl}/v1`,
      mcpUrl: `${this.workspaceUrl}/mcp`,
    };
  }

  async executeGovernedTool(input: GovernedToolExecutionInput): Promise<GovernedToolExecutionResult> {
    const credential = this.executionCredential(input.operationId, input.leaseId);
    const gatewayUserId = this.userIdFor({ tenantId: input.tenantId, subjectId: input.subjectId, audience: "onecomputer-control" });
    const gatewayAgentId = this.agentIdFor(input.workspaceId, input.agentId);
    const grant = await this.adminCall("/key/generate", {
      method: "POST",
      body: {
        key: credential,
        key_alias: `onecomputer-execution-${input.operationId}`,
        key_type: "llm_api",
        user_id: gatewayUserId,
        agent_id: gatewayAgentId,
        duration: "60s",
        models: [],
        max_budget: 0.01,
        rpm_limit: 4,
        metadata: {
          onecomputer_tenant_id: input.tenantId,
          onecomputer_subject_id: input.subjectId,
          onecomputer_workspace_id: input.workspaceId,
          onecomputer_agent_id: input.agentId ?? `workspace-default:${input.workspaceId}`,
          onecomputer_gateway_user_id: gatewayUserId,
          onecomputer_gateway_agent_id: gatewayAgentId,
          onecomputer_operation_id: input.operationId,
          onecomputer_operation_digest: input.operationDigest,
          onecomputer_lease_id: input.leaseId,
        },
        object_permission: {
          mcp_servers: [input.serverName],
          mcp_tool_permissions: { [input.serverName]: [input.toolName] },
        },
      },
    });
    if (!grant.ok) throw this.upstreamError("GATEWAY_EXECUTION_GRANT_FAILED", grant.status, grant.payload);
    try {
      const availableTools = await this.dataCall("/mcp-rest/tools/list", credential);
      if (!availableTools.ok) throw this.upstreamError("GATEWAY_EXECUTION_DISCOVERY_FAILED", availableTools.status, availableTools.payload);
      const tools = Array.isArray(asObject(availableTools.payload).tools) ? asObject(availableTools.payload).tools as unknown[] : [];
      const selectedTool = tools.map(asObject).find((tool) => tool.name === input.toolName);
      const serverId = asObject(selectedTool?.mcp_info).server_id;
      if (typeof serverId !== "string" || !serverId) {
        throw new OneComputerError("GATEWAY_EXECUTION_TOOL_NOT_ASSIGNED", "The exact governed tool is not assigned to this execution", 403);
      }
      const called = await this.dataCall("/mcp-rest/tools/call", credential, {
        method: "POST",
        body: { server_id: serverId, name: input.toolName, arguments: input.arguments as JsonObject },
      });
      if (!called.ok) throw this.upstreamError("GATEWAY_TOOL_EXECUTION_FAILED", called.status, called.payload);
      const payload = asObject(called.payload);
      if (payload.isError === true) throw new OneComputerError("UPSTREAM_TOOL_FAILED", "The governed tool reported a failure", 502, true);
      const content = Array.isArray(payload.content) ? payload.content : [];
      const firstText = content.map(asObject).find((item) => item.type === "text" && typeof item.text === "string")?.text;
      const resultSummary = typeof firstText === "string" ? firstText.slice(0, 240) : "The governed tool completed successfully.";
      return {
        upstreamReference: `mcp:${input.operationId}`,
        resultSummary,
        result: JSON.parse(JSON.stringify(called.payload)) as OwnedJson,
      };
    } finally {
      await this.adminCall("/key/delete", { method: "POST", body: { keys: [credential] } }, true).catch(() => undefined);
    }
  }

  async revoke(workspaceId: string, agentId?: string) {
    const credential = this.credentialFor(workspaceId, agentId);
    const result = await this.adminCall("/key/delete", {
      method: "POST",
      body: { keys: [credential] },
    }, true);
    this.workspaceGrantExpiries.delete(credential);
    if (!result.ok && result.status !== 404) throw this.upstreamError("GATEWAY_REVOKE_FAILED", result.status, result.payload);
  }

  private async adminCall(path: string, init: { method: string; body?: JsonObject }, tolerateFailure = false) {
    const result = await this.call(`${this.adminUrl}${path}`, this.config.masterKey, init);
    if (!result.ok && !tolerateFailure) throw this.upstreamError("GATEWAY_ADMIN_FAILED", result.status, result.payload);
    return result;
  }

  private async dataCall(path: string, credential: string, init: { method?: string; body?: JsonObject } = {}) {
    return this.call(`${this.adminUrl}${path}`, credential, { method: init.method ?? "GET", body: init.body });
  }

  private async call(url: string, token: string, init: { method: string; body?: JsonObject }) {
    try {
      const response = await fetch(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
    } catch {
      throw new OneComputerError("GATEWAY_UNAVAILABLE", "The model gateway is unavailable", 503, true);
    }
  }

  private upstreamError(code: string, status: number, payload: unknown) {
    const detail = asObject(asObject(payload).detail);
    const error = asObject(payload).error;
    const message = typeof error === "string"
      ? error
      : typeof detail.error === "string"
        ? detail.error
        : "The model gateway rejected the request";
    return new OneComputerError(code, message, status >= 500 ? 502 : status, status >= 500);
  }
}
