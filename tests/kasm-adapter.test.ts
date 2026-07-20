import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KasmLocalAdapter, mapKasmState } from "@onecomputer/kasm-adapter";

test("Kasm operational states map to the canonical sandbox contract", () => {
  assert.equal(mapKasmState("running"), "ready");
  assert.equal(mapKasmState("starting"), "provisioning");
  assert.equal(mapKasmState("stopped"), "stopped");
  assert.equal(mapKasmState("error"), "failed");
});

test("local Kasm creates a hardened internal network per workspace and attaches only the gateway", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onecomputer-docker-api-"));
  const socketPath = join(directory, "docker.sock");
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let createCount = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const path = request.url?.replace(/^\/v1\.47/, "") ?? "";
    requests.push({ method: request.method ?? "", path, body });
    response.setHeader("content-type", "application/json");
    if (path === "/containers/json?all=1") {
      response.end("[]");
      return;
    }
    if (path === "/containers/sandbox-id/json") {
      response.end(JSON.stringify({
        State: { Running: true, ExitCode: 0 },
        Config: { Labels: { "com.onecomputer.workspace-network": "onecomputer-v4-ws-b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508" } },
      }));
      return;
    }
    if (request.method === "GET" && (path.startsWith("/networks/") || path.startsWith("/volumes/") || path.includes("/json"))) {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "not found" }));
      return;
    }
    if (request.method === "POST" && path.startsWith("/containers/create")) {
      createCount += 1;
      response.statusCode = 201;
      response.end(JSON.stringify({ Id: createCount === 1 ? "sandbox-id" : "relay-id" }));
      return;
    }
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const policy = {
    schemaVersion: 1 as const,
    policyVersionId: "policy-version-1",
    policyVersion: 1,
    policyHash: "d".repeat(64),
    workspaceProfile: "kasm-persistent-standard" as const,
    agentId: "agent-alex",
    agentProfile: "onecomputer-default-agent" as const,
    networkProfile: "controlled-egress-v1" as const,
    modelAlias: "onecomputer-assistant",
    mcpServer: "onecomputer_ms365",
    allowedTools: ["list-mail-folders", "list-calendars", "list-drives"],
  };
  try {
    const adapter = new KasmLocalAdapter({
      socketPath,
      image: "sha256:pinned-workspace",
      networkPrefix: "onecomputer-v4-ws",
      controlNetwork: "onecomputer-v4-control",
      gatewayContainer: "onecomputer-v4-litellm",
      relayImage: "sha256:pinned-relay",
      portStart: 16920,
      portEnd: 16920,
    });
    await adapter.create({
      workspaceId: "b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508",
      policy,
      gateway: {
        baseUrl: "http://litellm:4000",
        credential: "sk-scoped-workspace-agent-key",
        modelAlias: "onecomputer-assistant",
        expiresAt: "2026-07-21T00:00:00.000Z",
      },
    });
    const workspaceNetwork = "onecomputer-v4-ws-b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508";
    const networkCreate = requests.find((item) => item.path === "/networks/create" && item.body.Name === workspaceNetwork)!;
    assert.equal(networkCreate.body.Internal, true);
    assert.equal((networkCreate.body.Labels as Record<string, unknown>)["com.onecomputer.workspace-id"], "b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508");
    const gatewayAttach = requests.find((item) => item.path === `/networks/${workspaceNetwork}/connect` && item.body.Container === "onecomputer-v4-litellm")!;
    assert.deepEqual((gatewayAttach.body.EndpointConfig as Record<string, unknown>).Aliases, ["litellm"]);
    const sandboxCreate = requests.find((item) => item.path.startsWith("/containers/create?name=onecomputer-v4-sandbox"))!;
    const host = sandboxCreate.body.HostConfig as Record<string, unknown>;
    assert.equal(host.NetworkMode, workspaceNetwork);
    assert.deepEqual(host.CapDrop, ["NET_ADMIN", "NET_RAW", "SYS_ADMIN"]);
    assert.deepEqual(host.SecurityOpt, ["no-new-privileges"]);
    const workspaceVolume = "onecomputer-v4-ws-home-b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508";
    assert.deepEqual(host.Mounts, [{ Type: "volume", Source: workspaceVolume, Target: "/home/kasm-user" }]);
    const volumeCreate = requests.find((item) => item.path === "/volumes/create")!;
    assert.equal(volumeCreate.body.Name, workspaceVolume);
    const serialized = JSON.stringify(sandboxCreate.body);
    assert.ok(serialized.includes("ONECOMPUTER_ALLOWED_TOOLS=list-mail-folders,list-calendars,list-drives"));
    assert.ok(!serialized.includes("LITELLM_MASTER_KEY"));
    assert.ok(!serialized.includes("CLIENT_SECRET"));
    assert.ok(!serialized.includes("DATABASE_URL"));
    assert.ok(!serialized.includes("DOCKER_HOST"));
    await adapter.status("sandbox-id");
    assert.ok(requests.filter((item) => item.path === `/networks/${workspaceNetwork}/connect` && item.body.Container === "onecomputer-v4-litellm").length >= 2);
    await adapter.purgeWorkspace("b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508");
    assert.ok(requests.some((item) => item.method === "DELETE" && item.path === `/volumes/${workspaceVolume}?force=true`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
