import { createHmac } from "node:crypto";
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
  ensureGrant(input: { workspaceId: string; identity: IdentityContext }): Promise<GatewayGrant>;
  readiness(workspaceId: string): Promise<GatewayReadiness>;
  test(workspaceId: string): Promise<GatewayTestResult>;
  revoke(workspaceId: string): Promise<void>;
}

export type GovernedToolExecutionInput = {
  tenantId: string;
  subjectId: string;
  workspaceId: string;
  operationId: string;
  operationDigest: string;
  leaseId: string;
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
};

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => value && typeof value === "object" ? value as JsonObject : {};

export class LiteLLMGatewayAdapter implements GatewayClient, GovernedToolExecutor {
  private readonly adminUrl: string;
  private readonly workspaceUrl: string;
  private readonly modelAlias: string;
  private readonly mcpServer: string;
  private readonly allowedTools: string[];
  private readonly timeoutMs: number;
  private readonly workspaceGrantTtlMs: number;
  private readonly workspaceGrantRenewalMs: number;
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
  }

  credentialFor(workspaceId: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(`onecomputer:litellm:workspace:${workspaceId}`)
      .digest("base64url");
    return `sk-ocw-${digest}`;
  }

  private executionCredential(operationId: string, leaseId: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(`onecomputer:litellm:execution:${operationId}:${leaseId}`)
      .digest("base64url");
    return `sk-oce-${digest}`;
  }

  async ensureGrant(input: { workspaceId: string; identity: IdentityContext }): Promise<GatewayGrant> {
    const credential = this.credentialFor(input.workspaceId);
    const cachedExpiry = this.workspaceGrantExpiries.get(input.workspaceId) ?? 0;
    if (cachedExpiry > Date.now() + this.workspaceGrantRenewalMs) {
      return { baseUrl: this.workspaceUrl, credential, modelAlias: this.modelAlias, expiresAt: new Date(cachedExpiry).toISOString() };
    }
    const expiresAt = new Date(Date.now() + this.workspaceGrantTtlMs);
    const durationSeconds = Math.max(60, Math.ceil(this.workspaceGrantTtlMs / 1_000));
    const grant = {
      key: credential,
      key_alias: `onecomputer-workspace-${input.workspaceId}`,
      key_type: "llm_api",
      duration: `${durationSeconds}s`,
      models: [this.modelAlias],
      max_budget: 1,
      rpm_limit: 60,
      tpm_limit: 100_000,
      metadata: {
        onecomputer_workspace_id: input.workspaceId,
        onecomputer_tenant_id: input.identity.tenantId,
        onecomputer_subject_id: input.identity.subjectId,
      },
      object_permission: {
        mcp_servers: [this.mcpServer],
        mcp_tool_permissions: { [this.mcpServer]: this.allowedTools },
      },
    };

    const generated = await this.adminCall("/key/generate", { method: "POST", body: grant }, true);
    if (!generated.ok) {
      const updated = await this.adminCall("/key/update", { method: "POST", body: grant });
      if (!updated.ok) throw this.upstreamError("GATEWAY_GRANT_FAILED", updated.status, updated.payload);
    }
    this.workspaceGrantExpiries.set(input.workspaceId, expiresAt.getTime());
    return { baseUrl: this.workspaceUrl, credential, modelAlias: this.modelAlias, expiresAt: expiresAt.toISOString() };
  }

  async readiness(workspaceId: string): Promise<GatewayReadiness> {
    const credential = this.credentialFor(workspaceId);
    const [models, tools] = await Promise.all([
      this.dataCall("/v1/models", credential),
      this.dataCall("/mcp-rest/tools/list", credential),
    ]);
    if (!models.ok || !tools.ok) this.workspaceGrantExpiries.delete(workspaceId);
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

  async test(workspaceId: string): Promise<GatewayTestResult> {
    const credential = this.credentialFor(workspaceId);
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
    const grant = await this.adminCall("/key/generate", {
      method: "POST",
      body: {
        key: credential,
        key_alias: `onecomputer-execution-${input.operationId}`,
        key_type: "llm_api",
        duration: "60s",
        models: [],
        max_budget: 0.01,
        rpm_limit: 4,
        metadata: {
          onecomputer_tenant_id: input.tenantId,
          onecomputer_subject_id: input.subjectId,
          onecomputer_workspace_id: input.workspaceId,
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

  async revoke(workspaceId: string) {
    const result = await this.adminCall("/key/delete", {
      method: "POST",
      body: { keys: [this.credentialFor(workspaceId)] },
    }, true);
    this.workspaceGrantExpiries.delete(workspaceId);
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
