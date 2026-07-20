import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxAdapter } from "@onecomputer/kasm-adapter";
import { createControllerServer } from "../apps/workspace-controller/src/server.js";

const token = "controller-test-token-0000001";
let lastGatewayCredential: string | undefined;
const adapter: SandboxAdapter = {
  async create({ workspaceId, gateway }) {
    lastGatewayCredential = gateway?.credential;
    return { providerId: `provider-${workspaceId}`, state: "ready", failureCode: null };
  },
  async status(providerId) { return { providerId, state: "ready", failureCode: null }; },
  async open() { return { launchUrl: "https://127.0.0.1:16920/", expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
  async destroy() {},
};

test("private controller hides routes without its internal token", async () => {
  const app = createControllerServer(adapter, token);
  const response = await app.inject({ method: "GET", url: "/internal/v1/sandboxes/guessed" });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("bodyless open and destroy commands work with internal authentication", async () => {
  const app = createControllerServer(adapter, token);
  const open = await app.inject({ method: "POST", url: "/internal/v1/sandboxes/provider-1/open", headers: { "x-controller-token": token } });
  assert.equal(open.statusCode, 200);
  assert.equal(open.json().launchUrl, "https://127.0.0.1:16920/");
  const destroy = await app.inject({ method: "DELETE", url: "/internal/v1/sandboxes/provider-1", headers: { "x-controller-token": token } });
  assert.equal(destroy.statusCode, 204);
  await app.close();
});

test("controller passes a validated scoped gateway grant to the sandbox adapter", async () => {
  const app = createControllerServer(adapter, token);
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/sandboxes",
    headers: { "x-controller-token": token },
    payload: {
      workspaceId: "b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508",
      correlationId: "correlation-002",
      gateway: {
        baseUrl: "http://litellm:4000",
        credential: "sk-scoped-controller-test-000001",
        modelAlias: "onecomputer-assistant",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(lastGatewayCredential, "sk-scoped-controller-test-000001");
  await app.close();
});
