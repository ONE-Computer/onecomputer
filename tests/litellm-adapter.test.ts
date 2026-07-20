import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { LiteLLMGatewayAdapter } from "@onecomputer/litellm-adapter";

const identity = { tenantId: "acme", subjectId: "alex-morgan", audience: "onecomputer-control" as const };

const adapter = new LiteLLMGatewayAdapter({
  adminUrl: "http://litellm.internal:4000",
  workspaceUrl: "http://litellm:4000",
  masterKey: "sk-master-test-not-used-00001",
  credentialSecret: "credential-secret-for-tests-00000001",
});

test("workspace credentials are deterministic, scoped by workspace, and not the master key", () => {
  const first = adapter.credentialFor("workspace-a");
  assert.equal(first, adapter.credentialFor("workspace-a"));
  assert.notEqual(first, adapter.credentialFor("workspace-b"));
  assert.notEqual(first, "sk-master-test-not-used-00001");
  assert.match(first, /^sk-ocw-[A-Za-z0-9_-]+$/);
});

test("workspace grant expiry renews independently of workspace lifetime", async () => {
  let grantRequests = 0;
  const server = createServer((_request, response) => {
    grantRequests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const liveAdapter = new LiteLLMGatewayAdapter({
    adminUrl: `http://127.0.0.1:${address.port}`,
    workspaceUrl: `http://127.0.0.1:${address.port}`,
    masterKey: "sk-master-test-not-used-00001",
    credentialSecret: "credential-secret-for-tests-00000001",
    workspaceGrantTtlMs: 120_000,
    workspaceGrantRenewalMs: 30_000,
  });
  try {
    const first = await liveAdapter.ensureGrant({ workspaceId: "workspace-a", identity });
    const reused = await liveAdapter.ensureGrant({ workspaceId: "workspace-a", identity });
    assert.equal(reused.credential, first.credential);
    assert.equal(reused.expiresAt, first.expiresAt);
    assert.equal(grantRequests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("governed execution uses one exact-tool key, resolved server id, and revocation", async () => {
  const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ url: request.url ?? "", authorization: String(request.headers.authorization ?? ""), body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/mcp-rest/tools/list") {
      response.end(JSON.stringify({ tools: [{ name: "delete_file", mcp_info: { server_id: "fixture-server-id" } }] }));
    } else if (request.url === "/mcp-rest/tools/call") {
      response.end(JSON.stringify({ content: [{ type: "text", text: "Deleted fixture Q3-draft.docx" }] }));
    } else {
      response.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const liveAdapter = new LiteLLMGatewayAdapter({
    adminUrl: `http://127.0.0.1:${address.port}`,
    workspaceUrl: `http://127.0.0.1:${address.port}`,
    masterKey: "sk-master-test-not-used-00001",
    credentialSecret: "credential-secret-for-tests-00000001",
  });
  try {
    const result = await liveAdapter.executeGovernedTool({
      tenantId: "acme",
      subjectId: "alex-morgan",
      workspaceId: "b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508",
      operationId: "15eaf54f-5f29-4b2d-9e21-890e8711720d",
      operationDigest: "0".repeat(64),
      leaseId: "73bc3cc4-34da-42ea-a933-0d6bf2bfd968",
      serverName: "onecomputer_fixture",
      toolName: "delete_file",
      arguments: { path: "/Finance/2026/Q3-draft.docx" },
    });
    const grant = requests.find((item) => item.url === "/key/generate")!;
    const call = requests.find((item) => item.url === "/mcp-rest/tools/call")!;
    assert.deepEqual((grant.body.object_permission as Record<string, unknown>).mcp_tool_permissions, { onecomputer_fixture: ["delete_file"] });
    assert.notEqual(call.authorization, "Bearer sk-master-test-not-used-00001");
    assert.match(call.authorization, /^Bearer sk-oce-/);
    assert.deepEqual(call.body, { server_id: "fixture-server-id", name: "delete_file", arguments: { path: "/Finance/2026/Q3-draft.docx" } });
    assert.equal(requests.at(-1)?.url, "/key/delete");
    assert.equal(result.resultSummary, "Deleted fixture Q3-draft.docx");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
