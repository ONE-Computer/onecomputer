import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { OneComputerError, createWorkspaceSchema, identityContextSchema } from "@onecomputer/contracts";
import { LiteLLMGatewayAdapter, type GatewayClient } from "@onecomputer/litellm-adapter";
import { PostgresWorkspaceStore, type WorkspaceStore } from "@onecomputer/workspace-store";
import { z } from "zod";
import { HttpControllerClient, WorkspaceService, type ControllerClient } from "./service.js";

const envSchema = z.object({
  CONTROL_HOST: z.string().default("127.0.0.1"),
  CONTROL_PORT: z.coerce.number().int().positive().default(4100),
  WEB_PROXY_TOKEN: z.string().min(24),
  CONTROLLER_URL: z.string().url().default("http://127.0.0.1:4101"),
  CONTROLLER_INTERNAL_TOKEN: z.string().min(24),
  DATABASE_URL: z.string().min(1),
  LITELLM_ADMIN_URL: z.string().url().optional(),
  LITELLM_WORKSPACE_URL: z.string().url().optional(),
  LITELLM_MASTER_KEY: z.string().min(24).optional(),
  LITELLM_CREDENTIAL_SECRET: z.string().min(32).optional(),
});

const sameSecret = (received: string | undefined, expected: string) => {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createControlServer(store: WorkspaceStore, controller: ControllerClient, proxyToken: string, gateway?: GatewayClient) {
  const app = Fastify({ logger: { redact: ["req.headers.x-onecomputer-proxy-token", "req.headers.authorization", "*.launchUrl"] }, bodyLimit: 32 * 1024 });
  const service = new WorkspaceService(store, controller, gateway);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") return;
    if (!sameSecret(request.headers["x-onecomputer-proxy-token"] as string | undefined, proxyToken)) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Authentication is required", correlationId: request.id, retryable: false } });
    }
  });

  const identity = (headers: Record<string, unknown>) => identityContextSchema.parse({
    tenantId: headers["x-onecomputer-tenant-id"],
    subjectId: headers["x-onecomputer-subject-id"],
    audience: headers["x-onecomputer-audience"],
  });
  const idempotency = (headers: Record<string, unknown>) => {
    const key = headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128) throw new OneComputerError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required", 400);
    return key;
  };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/v1/workspaces/current", async (request, reply) => {
    const current = await service.current(identity(request.headers), "personal");
    return current ? reply.send(current) : reply.code(404).send({ error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found", correlationId: request.id, retryable: false } });
  });
  app.post("/v1/workspaces", async (request, reply) => {
    const input = createWorkspaceSchema.parse(request.body ?? {});
    const workspace = await service.create(identity(request.headers), input.grantId, idempotency(request.headers), request.id);
    return reply.code(201).send(workspace);
  });
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/open", async (request) => service.open(identity(request.headers), request.params.workspaceId));
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/restart", async (request) => service.restart(identity(request.headers), request.params.workspaceId, request.id));
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/stop", async (request) => service.stop(identity(request.headers), request.params.workspaceId));
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/gateway/test", async (request) => service.testGateway(identity(request.headers), request.params.workspaceId));
  app.delete<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId", async (request, reply) => {
    await service.delete(identity(request.headers), request.params.workspaceId);
    return reply.code(204).send();
  });

  app.setErrorHandler((error, request, reply) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const validation = errorName === "ZodError";
    const known = error instanceof OneComputerError ? error : validation ? new OneComputerError("INVALID_REQUEST", "The request is invalid", 400) : new OneComputerError("INTERNAL_ERROR", "The request could not be completed", 500, true);
    request.log.error({ err: { name: errorName, code: known.code } }, "control request failed");
    reply.code(known.statusCode).send({ error: { code: known.code, message: known.message, correlationId: request.id, retryable: known.retryable } });
  });
  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const env = envSchema.parse(process.env);
  const store = PostgresWorkspaceStore.fromConnectionString(env.DATABASE_URL);
  await store.migrate();
  const gatewayValues = [env.LITELLM_ADMIN_URL, env.LITELLM_WORKSPACE_URL, env.LITELLM_MASTER_KEY, env.LITELLM_CREDENTIAL_SECRET];
  if (gatewayValues.some(Boolean) && !gatewayValues.every(Boolean)) throw new Error("All LiteLLM gateway settings must be configured together");
  const gateway = env.LITELLM_ADMIN_URL && env.LITELLM_WORKSPACE_URL && env.LITELLM_MASTER_KEY && env.LITELLM_CREDENTIAL_SECRET
    ? new LiteLLMGatewayAdapter({
        adminUrl: env.LITELLM_ADMIN_URL,
        workspaceUrl: env.LITELLM_WORKSPACE_URL,
        masterKey: env.LITELLM_MASTER_KEY,
        credentialSecret: env.LITELLM_CREDENTIAL_SECRET,
      })
    : undefined;
  const app = createControlServer(store, new HttpControllerClient(env.CONTROLLER_URL, env.CONTROLLER_INTERNAL_TOKEN), env.WEB_PROXY_TOKEN, gateway);
  app.addHook("onClose", async () => store.close());
  await app.listen({ host: env.CONTROL_HOST, port: env.CONTROL_PORT });
}
