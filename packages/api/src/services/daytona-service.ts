// Daytona sandbox adapter — real fetch calls against the local Daytona API.
//
// Config (env with sane defaults for the local dev stack documented in AUDIT.md):
//   DAYTONA_API_URL   — control-plane API (default http://127.0.0.1:3000)
//   DAYTONA_API_KEY   — Bearer dev key
//   DAYTONA_PROXY_URL — toolbox exec proxy (default http://127.0.0.1:4000)
//   DAYTONA_SNAPSHOT  — base image snapshot id
//
// No mocks, no DIY crypto. The exec path goes through the toolbox proxy on port
// 4000 (NOT the API port 3000) — this is the real call path the gateway will
// eventually MITM.

import { bootstrapSandbox } from "./sandbox-bootstrap";
import {
  bootstrapDesktop,
  checkDesktopHealth,
  type DesktopStatus,
} from "./sandbox-desktop-bootstrap";

const DAYTONA_API = process.env.DAYTONA_API_URL ?? "http://127.0.0.1:3000";
const DAYTONA_KEY =
  process.env.DAYTONA_API_KEY ?? "oclocal_devkey_faf128a9c992740356cc0a28";
const DAYTONA_PROXY = process.env.DAYTONA_PROXY_URL ?? "http://127.0.0.1:4000";
const SNAPSHOT_ID =
  process.env.DAYTONA_SNAPSHOT ?? "595be745-2eb0-4d30-a969-e4e04800ac0d";

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 3 * 60 * 1_000;

export interface SandboxInfo {
  id: string;
  name: string;
  state: string;
  /** http://127.0.0.1:4000/toolbox/<id> — the toolbox exec endpoint. */
  toolboxUrl: string;
  claudeVersion?: string;
  bootstrapped: boolean;
  desktopUrl?: string;
  desktopReady?: boolean;
  desktopHealth?: DesktopStatus["health"];
  bootLogTail?: string;
}

class DaytonaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DaytonaError";
  }
}

async function daytonaRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${DAYTONA_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAYTONA_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null
        ? ((body as { message?: string }).message ?? JSON.stringify(body))
        : String(body ?? res.statusText);
    throw new DaytonaError(message, res.status);
  }
  return body as T;
}

interface RawSandbox {
  id: string;
  name?: string;
  state?: string;
  status?: string;
  errorReason?: string;
}

function normalizeSandbox(raw: RawSandbox): SandboxInfo {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    state: raw.state ?? raw.status ?? "unknown",
    toolboxUrl: `${DAYTONA_PROXY}/toolbox/${raw.id}`,
    bootstrapped: false,
  };
}

/**
 * Create a sandbox from the default snapshot and wait until it is started.
 * Polls GET /api/sandbox/<id> every 4s up to 3 min. On `started` runs
 * bootstrapSandbox; on `error` throws with the errorReason.
 */
export async function createSandbox(name: string): Promise<SandboxInfo> {
  const created = await daytonaRequest<RawSandbox>("/api/sandbox", {
    method: "POST",
    body: JSON.stringify({
      name,
      snapshot: SNAPSHOT_ID,
      autoStop: 60,
    }),
  });

  // If the create response already reports a terminal state, honor it and
  // skip the poll loop (Daytona can return `started` synchronously for warm
  // snapshots). Otherwise poll GET /api/sandbox/<id> until terminal.
  let current = created;
  const firstState = current.state ?? current.status ?? "unknown";
  if (firstState === "error") {
    throw new DaytonaError(
      current.errorReason ?? `sandbox ${current.id} entered error state`,
      502,
    );
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (firstState !== "started" && Date.now() < deadline) {
    current = await daytonaRequest<RawSandbox>(`/api/sandbox/${current.id}`, {
      method: "GET",
    });
    const state = current.state ?? current.status ?? "unknown";
    if (state === "started") {
      break;
    }
    if (state === "error") {
      throw new DaytonaError(
        current.errorReason ?? `sandbox ${current.id} entered error state`,
        502,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const finalState = current.state ?? current.status ?? "unknown";
  if (finalState !== "started") {
    throw new DaytonaError(
      `sandbox ${current.id} did not start within ${POLL_TIMEOUT_MS}ms (state=${finalState})`,
      504,
    );
  }

  const info = normalizeSandbox(current);
  const boot = await bootstrapSandbox(info.id, execInSandbox);
  info.claudeVersion = boot.claudeVersion ?? undefined;
  info.bootstrapped = boot.success;

  const desktop = await bootstrapDesktop(info.id, execInSandbox);
  info.desktopReady = desktop.desktopReady;
  info.desktopUrl = desktop.desktopUrl;
  info.desktopHealth = desktop.health;
  info.bootLogTail = desktop.bootLogTail;
  info.claudeVersion = desktop.claudeVersion || info.claudeVersion;
  return info;
}

/**
 * Execute a command inside a sandbox via the toolbox proxy (port 4000, NOT the
 * API port 3000). Request shape `{command}` → response `{exitCode, result}`.
 */
export async function execInSandbox(
  sandboxId: string,
  command: string,
): Promise<{ exitCode: number; output: string }> {
  const res = await fetch(
    `${DAYTONA_PROXY}/toolbox/${sandboxId}/process/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAYTONA_KEY}`,
      },
      body: JSON.stringify({ command }),
    },
  );
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null
        ? ((body as { message?: string }).message ?? JSON.stringify(body))
        : String(body ?? res.statusText);
    throw new DaytonaError(message, res.status);
  }
  const data = body as { exitCode?: number; result?: string };
  return {
    exitCode: data.exitCode ?? 0,
    output: data.result ?? "",
  };
}

/** DELETE /api/sandbox/<id>. No-op on 404. */
export async function deleteSandbox(id: string): Promise<void> {
  try {
    await daytonaRequest<void>(`/api/sandbox/${id}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof DaytonaError && err.status === 404) return;
    throw err;
  }
}

/** GET /api/sandbox → items[]. */
export async function listSandboxes(): Promise<SandboxInfo[]> {
  const data = await daytonaRequest<{ items?: RawSandbox[] } | RawSandbox[]>(
    "/api/sandbox",
    { method: "GET" },
  );
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return items.map(normalizeSandbox);
}

/** GET /api/sandbox/<id>. */
export async function getSandbox(id: string): Promise<SandboxInfo> {
  const raw = await daytonaRequest<RawSandbox>(`/api/sandbox/${id}`, {
    method: "GET",
  });
  return normalizeSandbox(raw);
}

/** Check desktop/noVNC/Claude health for a sandbox. */
export async function getSandboxDesktop(
  id: string,
): Promise<DesktopStatus & { sandboxId: string; status: string }> {
  const sandbox = await getSandbox(id);
  const desktop = await checkDesktopHealth(id, execInSandbox);
  return { sandboxId: id, status: sandbox.state, ...desktop };
}

/** Restart/re-run the desktop bootstrap idempotently. */
export async function restartSandboxDesktop(
  id: string,
): Promise<DesktopStatus & { sandboxId: string; status: string }> {
  const sandbox = await getSandbox(id);
  const desktop = await bootstrapDesktop(id, execInSandbox);
  return { sandboxId: id, status: sandbox.state, ...desktop };
}
