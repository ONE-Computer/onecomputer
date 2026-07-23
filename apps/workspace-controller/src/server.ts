import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { OneComputerError, controllerCreateSchema } from "@onecomputer/contracts";
import { KasmLocalAdapter, KasmDeveloperApiAdapter, type SandboxAdapter } from "@onecomputer/kasm-adapter";
import { z } from "zod";

const envSchema = z.object({
  CONTROLLER_HOST: z.string().default("127.0.0.1"),
  CONTROLLER_PORT: z.coerce.number().int().positive().default(4101),
  CONTROLLER_INTERNAL_TOKEN: z.string().min(24),
  SANDBOX_DRIVER: z.enum(["kasm", "kasm-local"]).default("kasm-local"),
  KASM_BASE_URL: z.string().url().optional(),
  KASM_API_KEY: z.string().optional(),
  KASM_API_SECRET: z.string().optional(),
  KASM_USER_ID: z.string().optional(),
  KASM_IMAGE_ID: z.string().optional(),
  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
  KASM_LOCAL_IMAGE: z.string().default("kasmweb/ubuntu-jammy-desktop@sha256:58b0710b320b99ab7e352342d7ec3a25b09740c523b75d794c5f7476910da580"),
  KASM_LOCAL_NETWORK_PREFIX: z.string().default("onecomputer-workspace"),
  KASM_LOCAL_CONTROL_NETWORK: z.string().default("onecomputer-control"),
  KASM_LOCAL_GATEWAY_CONTAINER: z.string().default("onecomputer-litellm"),
  KASM_LOCAL_CONTROL_CONTAINER: z.string().default("onecomputer-control-api"),
  KASM_LOCAL_RELAY_IMAGE: z.string().default("node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2"),
  KASM_PUBLIC_HOST: z.string().default("127.0.0.1"),
});

function sameSecret(received: string | undefined, expected: string) {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createControllerServer(adapter: SandboxAdapter, internalToken: string) {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.headers.x-controller-token", "req.body.gateway.credential", "req.body.agentBridge.token", "*.launchUrl", "*.session_token"] },
    bodyLimit: 32 * 1024,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") return;
    if (!sameSecret(request.headers["x-controller-token"] as string | undefined, internalToken)) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found", correlationId: request.id, retryable: false } });
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.post("/internal/v1/sandboxes", async (request, reply) => {
    const input = controllerCreateSchema.parse(request.body);
    return reply.code(201).send(await adapter.create({
      workspaceId: input.workspaceId,
      policy: input.policy,
      gateway: input.gateway,
      agentBridge: input.agentBridge,
    }));
  });
  app.get<{ Params: { providerId: string } }>("/internal/v1/sandboxes/:providerId", async (request) => adapter.status(request.params.providerId));
  app.post<{ Params: { providerId: string } }>("/internal/v1/sandboxes/:providerId/open", async (request) => adapter.open(request.params.providerId));
  app.delete<{ Params: { providerId: string } }>("/internal/v1/sandboxes/:providerId", async (request, reply) => {
    await adapter.destroy(request.params.providerId);
    return reply.code(204).send();
  });
  app.delete<{ Params: { workspaceId: string } }>("/internal/v1/workspaces/:workspaceId/storage", async (request, reply) => {
    await adapter.purgeWorkspace(request.params.workspaceId);
    return reply.code(204).send();
  });

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof OneComputerError ? error : new OneComputerError("INTERNAL_ERROR", "The workspace controller could not complete the request", 500, true);
    request.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "Unknown controller error", code: known.code } }, "controller request failed");
    reply.code(known.statusCode).send({ error: { code: known.code, message: known.message, correlationId: request.id, retryable: known.retryable } });
  });
  return app;
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required when SANDBOX_DRIVER=kasm`);
  return value;
}

export function adapterFromEnv(env: z.infer<typeof envSchema>): SandboxAdapter {
  if (env.SANDBOX_DRIVER === "kasm-local") {
    return new KasmLocalAdapter({
      socketPath: env.DOCKER_SOCKET_PATH,
      image: env.KASM_LOCAL_IMAGE,
      networkPrefix: env.KASM_LOCAL_NETWORK_PREFIX,
      controlNetwork: env.KASM_LOCAL_CONTROL_NETWORK,
      gatewayContainer: env.KASM_LOCAL_GATEWAY_CONTAINER,
      controlContainer: env.KASM_LOCAL_CONTROL_CONTAINER,
      relayImage: env.KASM_LOCAL_RELAY_IMAGE,
      publicHost: env.KASM_PUBLIC_HOST,
    });
  }
  return new KasmDeveloperApiAdapter({
    baseUrl: required(env.KASM_BASE_URL, "KASM_BASE_URL"),
    apiKey: required(env.KASM_API_KEY, "KASM_API_KEY"),
    apiSecret: required(env.KASM_API_SECRET, "KASM_API_SECRET"),
    userId: required(env.KASM_USER_ID, "KASM_USER_ID"),
    imageId: required(env.KASM_IMAGE_ID, "KASM_IMAGE_ID"),
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const env = envSchema.parse(process.env);
  const app = createControllerServer(adapterFromEnv(env), env.CONTROLLER_INTERNAL_TOKEN);
  await app.listen({ host: env.CONTROLLER_HOST, port: env.CONTROLLER_PORT });
}
