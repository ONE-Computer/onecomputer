import { apiGet, apiPost, apiPut, apiPatch } from "./client";
import type {
  Agent,
  CreatedAgent,
  CreateAgentInput,
  AgentGranularAccess,
  AgentConnection,
} from "./types";

export const list = () => apiGet<Agent[]>("/v1/agents");

// ── Lightweight live-fetch wrapper (agents page live wiring) ────────────────

export interface AgentInfo {
  id: string;
  name: string;
  identifier?: string;
  accessToken?: string;
  isDefault?: boolean;
  did?: string;
  createdAt?: string;
}

export const agentsApi = {
  list: (): Promise<AgentInfo[]> =>
    fetch("/v1/agents")
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? d : (d.agents ?? []))),
  get: (id: string): Promise<AgentInfo> =>
    fetch(`/v1/agents/${id}`).then((r) => r.json()),
  // Kill switch — revoke an agent's access token so it can no longer call the
  // gateway. Returns { ok, message }. Optional reason is recorded in the audit log.
  revoke: (id: string, reason?: string) =>
    apiPost<{ ok: boolean; message: string }>(`/v1/agents/${id}/revoke`, {
      ...(reason ? { reason } : {}),
    }),
};

export const create = (input: CreateAgentInput) =>
  apiPost<CreatedAgent>("/v1/agents", input);

export const granularAccess = () =>
  apiGet<AgentGranularAccess[]>("/v1/agents/granular-access");

// ── Credential access (secret mode, secrets, app connections) ──────────────

export const secrets = (agentId: string) =>
  apiGet<string[]>(`/v1/agents/${agentId}/secrets`);

export const updateSecrets = (agentId: string, secretIds: string[]) =>
  apiPut<{ success: boolean }>(`/v1/agents/${agentId}/secrets`, { secretIds });

export const updateSecretMode = (agentId: string, mode: "all" | "selective") =>
  apiPatch<{ success: boolean }>(`/v1/agents/${agentId}/secret-mode`, { mode });

export const connections = (agentId: string) =>
  apiGet<AgentConnection[]>(`/v1/agents/${agentId}/connections`);

export const updateConnections = (
  agentId: string,
  connections: {
    appConnectionId: string;
    sessionPolicy?: Record<string, unknown> | null;
  }[],
) =>
  apiPut<{ success: boolean }>(`/v1/agents/${agentId}/connections`, {
    connections,
  });
