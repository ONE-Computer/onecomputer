import { createHmac } from "node:crypto";
import { OneComputerError, type IdentityContext } from "@onecomputer/contracts";

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
  ensureGrant(input: { workspaceId: string; identity: IdentityContext; expiresAt: string }): Promise<GatewayGrant>;
  readiness(workspaceId: string): Promise<GatewayReadiness>;
  test(workspaceId: string): Promise<GatewayTestResult>;
  revoke(workspaceId: string): Promise<void>;
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
};

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => value && typeof value === "object" ? value as JsonObject : {};

export class LiteLLMGatewayAdapter implements GatewayClient {
  private readonly adminUrl: string;
  private readonly workspaceUrl: string;
  private readonly modelAlias: string;
  private readonly mcpServer: string;
  private readonly allowedTools: string[];
  private readonly timeoutMs: number;

  constructor(private readonly config: LiteLLMConfig) {
    this.adminUrl = config.adminUrl.replace(/\/$/, "");
    this.workspaceUrl = config.workspaceUrl.replace(/\/$/, "");
    this.modelAlias = config.modelAlias ?? "onecomputer-assistant";
    this.mcpServer = config.mcpServer ?? "onecomputer_fixture";
    this.allowedTools = config.allowedTools ?? ["search_files"];
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
  }

  credentialFor(workspaceId: string) {
    const digest = createHmac("sha256", this.config.credentialSecret)
      .update(`onecomputer:litellm:workspace:${workspaceId}`)
      .digest("base64url");
    return `sk-ocw-${digest}`;
  }

  async ensureGrant(input: { workspaceId: string; identity: IdentityContext; expiresAt: string }): Promise<GatewayGrant> {
    const credential = this.credentialFor(input.workspaceId);
    const remainingSeconds = Math.max(60, Math.ceil((new Date(input.expiresAt).getTime() - Date.now()) / 1_000));
    const grant = {
      key: credential,
      key_alias: `onecomputer-workspace-${input.workspaceId}`,
      key_type: "llm_api",
      duration: `${remainingSeconds}s`,
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
    return { baseUrl: this.workspaceUrl, credential, modelAlias: this.modelAlias, expiresAt: input.expiresAt };
  }

  async readiness(workspaceId: string): Promise<GatewayReadiness> {
    const credential = this.credentialFor(workspaceId);
    const [models, tools] = await Promise.all([
      this.dataCall("/v1/models", credential),
      this.dataCall("/mcp-rest/tools/list", credential),
    ]);
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

  async revoke(workspaceId: string) {
    const result = await this.adminCall("/key/delete", {
      method: "POST",
      body: { keys: [this.credentialFor(workspaceId)] },
    }, true);
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
