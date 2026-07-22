import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";

test("Claude Desktop MCP call waits for the governed operation receipt", async (context) => {
  const operationId = "11111111-1111-4111-8111-111111111111";
  let statusReads = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/mcp-rest/tools/list") {
      response.end(JSON.stringify({ tools: [{
        name: "delete-onedrive-file",
        description: "Delete a file",
        inputSchema: { type: "object" },
        mcp_info: { server_id: "server-1" },
      }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/mcp-rest/tools/call") {
      response.statusCode = 409;
      response.end(JSON.stringify({ detail: { error: "MCP_APPROVAL_REQUIRED", operation_id: operationId } }));
      return;
    }
    if (request.method === "GET" && request.url === `/onecomputer/operations/${operationId}`) {
      statusReads += 1;
      response.end(JSON.stringify(statusReads === 1
        ? { id: operationId, state: "approval_required" }
        : { id: operationId, state: "succeeded", receipt: { resultSummary: "Deleted after signed approval" } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(4312, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const child = spawn("python3", ["infra/issue-010/onecomputer-mcp-stdio.py"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const responses: Array<Record<string, unknown>> = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "delete-onedrive-file", arguments: { driveId: "drive", driveItemId: "item", "If-Match": "etag" } },
  })}\n`);

  const deadline = Date.now() + 5_000;
  while (responses.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(responses.length, 2);
  assert.equal((responses[1]?.result as { isError: boolean }).isError, false);
  assert.equal((responses[1]?.result as { content: Array<{ text: string }> }).content[0]?.text, "Deleted after signed approval");
  assert.equal(statusReads, 2);
});

test("Claude Desktop MCP bridge removes nullable LiteLLM result fields", async (context) => {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/mcp-rest/tools/list") {
      response.end(JSON.stringify({ tools: [{
        name: "list-drives",
        description: "List drives",
        inputSchema: { type: "object" },
        mcp_info: { server_id: "server-1" },
      }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/mcp-rest/tools/call") {
      response.end(JSON.stringify({
        _meta: null,
        content: [{ type: "text", text: '{"value":[]}', annotations: null, _meta: null }],
        structuredContent: null,
        isError: false,
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(4312, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const child = spawn("python3", ["infra/issue-010/onecomputer-mcp-stdio.py"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const responses: Array<Record<string, unknown>> = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list-drives", arguments: {} } })}\n`);

  const deadline = Date.now() + 5_000;
  while (responses.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(responses.length, 2);
  assert.deepEqual(responses[1]?.result, {
    content: [{ type: "text", text: '{"value":[]}' }],
    isError: false,
  });
});

test("Claude Desktop cannot supply connector execution flags for a protected delete", async (context) => {
  let forwardedArguments: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/mcp-rest/tools/list") {
      response.end(JSON.stringify({ tools: [{
        name: "delete-onedrive-file",
        description: "Delete a file",
        inputSchema: {
          type: "object",
          properties: {
            driveId: { type: "string" },
            driveItemId: { type: "string" },
            "If-Match": { type: "string" },
            confirm: { type: "boolean" },
            excludeResponse: { type: "boolean" },
          },
          required: ["driveId", "driveItemId", "confirm"],
        },
        mcp_info: { server_id: "server-1" },
      }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/mcp-rest/tools/call") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      forwardedArguments = body.arguments;
      response.end(JSON.stringify({ content: [{ type: "text", text: "held" }], isError: false }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(4312, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const child = spawn("python3", ["infra/issue-010/onecomputer-mcp-stdio.py"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const responses: Array<Record<string, unknown>> = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "delete-onedrive-file",
      arguments: { driveId: "drive", driveItemId: "item", "If-Match": "etag", confirm: true, excludeResponse: false },
    },
  })}\n`);

  const deadline = Date.now() + 5_000;
  while (responses.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const tools = ((responses[0]?.result as { tools: Array<{ inputSchema: { properties: Record<string, unknown> } }> }).tools);
  assert.equal("confirm" in tools[0]!.inputSchema.properties, false);
  assert.equal("excludeResponse" in tools[0]!.inputSchema.properties, false);
  assert.deepEqual(forwardedArguments, { driveId: "drive", driveItemId: "item", "If-Match": "etag" });
});
