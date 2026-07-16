import { apiFetch } from "@/lib/api-fetch";

// Thin fetch wrappers — no state, just typed calls
export interface SandboxInfo {
  id: string;
  name: string;
  state: "creating" | "started" | "stopped" | "error" | "archived" | string;
  toolboxUrl: string;
  claudeVersion?: string;
  bootstrapped: boolean;
  desktopUrl?: string;
  desktopReady?: boolean;
  desktopHealth?: DesktopHealth;
  bootLogTail?: string;
  createdAt?: string;
}

export interface DesktopHealth {
  vnc: boolean;
  noVnc: boolean;
  claudeCode: boolean;
  claudeDesktopInstalled?: boolean;
  claudeDesktopRunning?: boolean;
  llmProxyReachable?: boolean;
  claudeDesktop3pConfigured?: boolean;
  dockerAvailable?: boolean;
  browser: boolean;
}

export interface LlmProxyStatus {
  mode: "disabled" | "host-pxpipe" | "custom";
  baseUrl?: string;
  reachable: boolean;
  modelCount?: number;
  configuredModels?: string[];
  logHint?: string;
  error?: string;
}

export interface SandboxDesktopInfo {
  sandboxId: string;
  status: string;
  desktopReady: boolean;
  desktopUrl?: string;
  vncPort: number;
  noVncPort: number;
  authMode: "none" | "vnc-password";
  health: DesktopHealth;
  llmProxy?: LlmProxyStatus;
  claudeVersion?: string;
  bootLogTail?: string;
}

export interface ExecResult {
  exitCode: number;
  output: string;
}

export interface SandboxCounts {
  total: number;
  running: number;
}

export interface TriggeredGovernedAction {
  approvalId: string;
  status: "pending";
  host: string;
  path: string;
  method: string;
}

const BASE = "/v1/sandboxes";

export const sandboxesApi = {
  list: (): Promise<SandboxInfo[]> => apiFetch(BASE).then((r) => r.json()),
  get: (id: string): Promise<SandboxInfo> =>
    apiFetch(`${BASE}/${id}`).then((r) => r.json()),
  create: (name: string): Promise<SandboxInfo> =>
    apiFetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json()),
  desktop: (id: string): Promise<SandboxDesktopInfo> =>
    apiFetch(`${BASE}/${id}/desktop`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
      return body as SandboxDesktopInfo;
    }),
  restartDesktop: (id: string): Promise<SandboxDesktopInfo> =>
    apiFetch(`${BASE}/${id}/desktop/restart`, { method: "POST" }).then(
      async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
        return body as SandboxDesktopInfo;
      },
    ),
  exec: (id: string, command: string): Promise<ExecResult> =>
    apiFetch(`${BASE}/${id}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) {
        const msg =
          typeof body?.error?.message === "string"
            ? body.error.message
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return body as ExecResult;
    }),
  delete: (id: string): Promise<void> =>
    apiFetch(`${BASE}/${id}`, { method: "DELETE" }).then(() => undefined),
  // POST /v1/sandboxes/:id/trigger-governed-action — drives a REAL gateway
  // hold. The server fires a curl through the OneComputer gateway (MITM,
  // :10255) to graph.microsoft.com/v1.0/me/sendMail with the agent token,
  // which matches the seeded manual_approval rule and produces a durable
  // ApprovalRequest (status=pending). Returns the approval id so the card
  // can poll /v1/approvals/bridge/:id and render held → released.
  triggerGovernedAction: (id: string): Promise<TriggeredGovernedAction> =>
    apiFetch(`${BASE}/${id}/trigger-governed-action`, {
      method: "POST",
    }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) {
        const msg =
          typeof body?.error?.message === "string"
            ? body.error.message
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return body as TriggeredGovernedAction;
    }),
  // Returns { total, running }; resolves to {0,0} when Daytona is unreachable
  // so the overview stat card degrades gracefully instead of throwing.
  counts: async (): Promise<SandboxCounts> => {
    try {
      const res = await apiFetch(BASE);
      if (!res.ok) return { total: 0, running: 0 };
      const items: SandboxInfo[] = await res.json();
      if (!Array.isArray(items)) return { total: 0, running: 0 };
      return {
        total: items.length,
        running: items.filter((s) => s.state === "started").length,
      };
    } catch {
      // Daytona down / network error — show 0/0 gracefully
      return { total: 0, running: 0 };
    }
  },
};
