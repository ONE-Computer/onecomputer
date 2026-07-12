import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests assert the real call paths of the Daytona sandbox adapter (no mocks of
// the adapter logic — only fetch is stubbed). Per AUDIT.md a feature is done
// only when it has a test that asserts AND is wired to a real call path.

// Capture the module-level env defaults so we can restore them.
const ENV_KEYS = [
  "DAYTONA_API_URL",
  "DAYTONA_API_KEY",
  "DAYTONA_PROXY_URL",
  "DAYTONA_SNAPSHOT",
  "VERDACCIO_URL",
  "GATEWAY_PROXY_URL",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

// The daytona-service module reads env at import time, so for tests that need
// deterministic URLs we set env BEFORE importing and reset the module registry
// between tests. We import dynamically per-test to pick up env changes.

type DaytonaModule = typeof import("./daytona-service");
type BootstrapModule = typeof import("./sandbox-bootstrap");

async function importDaytona(): Promise<DaytonaModule> {
  return (await import("./daytona-service")) as DaytonaModule;
}
async function importBootstrap(): Promise<BootstrapModule> {
  return (await import("./sandbox-bootstrap")) as BootstrapModule;
}

beforeEach(() => {
  // Force deterministic URLs for every test.
  process.env.DAYTONA_API_URL = "http://127.0.0.1:3000";
  process.env.DAYTONA_API_KEY = "oclocal_devkey_test";
  process.env.DAYTONA_PROXY_URL = "http://127.0.0.1:4000";
  process.env.DAYTONA_SNAPSHOT = "snap-test";
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("daytona-service", () => {
  it("createSandbox_calls_correct_endpoint", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        let body: string | undefined;
        if (init?.body && typeof init.body === "string") body = init.body;
        calls.push({ url, method, body });
        // POST /api/sandbox → return a started sandbox so no polling is needed.
        if (url.endsWith("/api/sandbox") && method === "POST") {
          return {
            ok: true,
            status: 201,
            statusText: "",
            text: async () =>
              JSON.stringify({ id: "sb-1", name: "test", state: "started" }),
          } as unknown as Response;
        }
        // bootstrap exec call (toolbox) — return a failed BOOTSTRAP_OK so we
        // don't depend on the bootstrap internals for this endpoint assertion.
        if (url.includes("/toolbox/") && url.endsWith("/process/execute")) {
          return {
            ok: true,
            status: 200,
            statusText: "",
            text: async () =>
              JSON.stringify({
                exitCode: 0,
                result:
                  "PACKAGE_GATE_CONFIGURED\nBOOTSTRAP_OK\n2.1.195 (Claude Code)",
              }),
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
      },
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchStub);

    const { createSandbox } = await importDaytona();
    const sb = await createSandbox("test");

    const createCall = calls.find(
      (c) => c.url.endsWith("/api/sandbox") && c.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(createCall!.body).toContain("test");
    expect(createCall!.body).toContain('"snapshot":"snap-test"');
    expect(createCall!.body).toContain('"autoStop":60');
    expect(sb.id).toBe("sb-1");
    expect(sb.state).toBe("started");
  });

  it("exec_uses_proxy_port_4000", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify({ exitCode: 0, result: "ok" }),
        } as unknown as Response;
      },
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchStub);

    const { execInSandbox } = await importDaytona();
    const res = await execInSandbox("sb-xyz", "echo hi");

    const execCall = calls.find((c) => c.method === "POST");
    expect(execCall).toBeDefined();
    // Must hit port 4000 (toolbox proxy), NOT the API port 3000.
    expect(execCall!.url).toContain(":4000");
    expect(execCall!.url).not.toContain(":3000");
    expect(execCall!.url).toContain("/toolbox/sb-xyz/process/execute");
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe("ok");
  });

  it("bootstrap_parses_claude_version", async () => {
    const { bootstrapSandbox } = await importBootstrap();
    const exec = vi.fn(async (id: string, cmd: string) => {
      void id;
      void cmd;
      return {
        exitCode: 0,
        output: "PACKAGE_GATE_CONFIGURED\n2.1.195 (Claude Code)\nBOOTSTRAP_OK",
      };
    });
    const result = await bootstrapSandbox("sb-1", exec);

    expect(result.success).toBe(true);
    expect(result.claudeVersion).toBe("2.1.195");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("package_gate_script_contains_registry", async () => {
    const { PACKAGE_GATE_SCRIPT } = await importBootstrap();
    const script = PACKAGE_GATE_SCRIPT(
      "http://127.0.0.1:4873",
      "http://127.0.0.1:10255",
    );
    expect(script).toContain("registry");
    expect(script).toContain("http://127.0.0.1:4873");
    // Gateway proxy must be wired when gatewayUrl is provided.
    expect(script).toContain("HTTPS_PROXY=http://127.0.0.1:10255");
    expect(script).toContain("PACKAGE_GATE_CONFIGURED");

    // And the placeholder path when nothing is configured.
    const empty = PACKAGE_GATE_SCRIPT(undefined, undefined);
    expect(empty).toContain("Verdaccio not configured");
    expect(empty).toContain("Gateway not configured");
  });
});
