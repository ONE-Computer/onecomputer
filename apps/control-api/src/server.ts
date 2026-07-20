import { timingSafeEqual } from "node:crypto";
import Fastify, { LogController } from "fastify";
import { OneComputerError, createDeleteFileOperationSchema, createWorkspaceSchema, fixtureApprovalSchema, identityContextSchema, type RuntimePolicy } from "@onecomputer/contracts";
import { LiteLLMGatewayAdapter, type GatewayClient, type GovernedToolExecutor, type OAuthConnectionGateway } from "@onecomputer/litellm-adapter";
import { PostgresIdentityPolicyStore, PostgresWorkspaceStore, runtimePolicyFor, type GovernanceStore, type IdentityPolicyStore, type SessionPrincipal, type WorkspaceStore } from "@onecomputer/workspace-store";
import { z } from "zod";
import { FixtureApprovalAuthority, GovernedOperationService } from "./operations.js";
import { Microsoft365ConnectionService } from "./connections.js";
import { HttpControllerClient, WorkspaceService, type ControllerClient } from "./service.js";
import { EntraAuthenticationService, isAdministrator, testPrincipalFromHeaders } from "./auth.js";

type AuthenticationBoundary = Pick<EntraAuthenticationService, "begin" | "complete" | "authenticate" | "logout">;

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
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:4174"),
  M365_AUTHORIZATION_ORIGIN: z.string().url().default("http://localhost:3001"),
  FIXTURE_APPROVAL_SECRET: z.string().min(32).default("local-disabled-fixture-approval-secret-32-chars"),
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  BOOTSTRAP_TENANT_ID: z.string().min(1).default("acme"),
  BOOTSTRAP_USER_ID: z.string().min(1).default("alex-morgan"),
  TENANT_DISPLAY_NAME: z.string().min(1).default("ME TECH"),
  ADMINISTRATOR_EMAILS: z.string().min(1).default("mike@metech.dev"),
});

const sameSecret = (received: string | undefined, expected: string) => {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createControlServer(
  store: WorkspaceStore & GovernanceStore,
  controller: ControllerClient,
  proxyToken: string,
  gateway?: GatewayClient & Partial<GovernedToolExecutor>,
  fixtureApprovalSecret = "local-test-fixture-approval-secret-32-characters",
  connectionOptions: { publicWebUrl?: string; authorizationOrigin?: string } = {},
  security: {
    authentication?: AuthenticationBoundary;
    identityPolicyStore?: IdentityPolicyStore;
    testIdentityMode?: boolean;
  } = {},
) {
  const testRuntimePolicy: RuntimePolicy = {
    schemaVersion: 1,
    policyVersionId: "test-policy-v1",
    policyVersion: 1,
    policyHash: "0".repeat(64),
    workspaceProfile: "kasm-persistent-standard",
    agentId: "test-default-agent",
    agentProfile: "onecomputer-default-agent",
    networkProfile: "controlled-egress-v1",
    modelAlias: "onecomputer-assistant",
    mcpServer: "onecomputer_fixture",
    allowedTools: ["search_files"],
  };
  const app = Fastify({
    logger: { redact: ["req.headers.x-onecomputer-proxy-token", "req.headers.authorization", "req.body", "*.arguments", "*.launchUrl"] },
    logController: new LogController({
      disableRequestLogging: (request) => request.url.startsWith("/v1/connections/microsoft-365/callback") || request.url.startsWith("/v1/auth/callback"),
    }),
    bodyLimit: 32 * 1024,
  });
  const service = new WorkspaceService(store, controller, gateway);
  const executor: GovernedToolExecutor = gateway?.executeGovernedTool
    ? { executeGovernedTool: (input) => gateway.executeGovernedTool!(input) }
    : { executeGovernedTool: async () => { throw new OneComputerError("GATEWAY_NOT_CONFIGURED", "The governed tool gateway is not configured", 503, true); } };
  const operations = new GovernedOperationService(store, executor, new FixtureApprovalAuthority(fixtureApprovalSecret));
  const oauthGateway = gateway
    && typeof (gateway as Partial<OAuthConnectionGateway>).beginUserOAuthConnection === "function"
    && typeof (gateway as Partial<OAuthConnectionGateway>).completeUserOAuthConnection === "function"
    && typeof (gateway as Partial<OAuthConnectionGateway>).userOAuthConnectionStatus === "function"
    && typeof (gateway as Partial<OAuthConnectionGateway>).disconnectUserOAuthConnection === "function"
    ? gateway as GatewayClient & OAuthConnectionGateway
    : undefined;
  const connections = oauthGateway ? new Microsoft365ConnectionService(oauthGateway, {
    publicWebUrl: connectionOptions.publicWebUrl ?? "http://localhost:4174",
    authorizationOrigin: connectionOptions.authorizationOrigin ?? "http://localhost:3001",
  }) : undefined;
  const requireConnections = () => {
    if (!connections) throw new OneComputerError("M365_CONNECTION_NOT_CONFIGURED", "Microsoft 365 connections are not configured", 503, true);
    return connections;
  };
  if (!security.authentication && !security.testIdentityMode) {
    throw new Error("Control requires Entra authentication; test identity mode must be enabled explicitly in tests");
  }
  const principals = new WeakMap<object, SessionPrincipal>();

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") return;
    if (!sameSecret(request.headers["x-onecomputer-proxy-token"] as string | undefined, proxyToken)) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Authentication is required", correlationId: request.id, retryable: false } });
    }
    if (request.url.startsWith("/v1/auth/login") || request.url.startsWith("/v1/auth/callback")) return;
    const principal = security.testIdentityMode
      ? testPrincipalFromHeaders(request.headers)
      : await security.authentication!.authenticate(request.headers.cookie);
    if (!principal) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in with your work account", correlationId: request.id, retryable: false } });
    }
    principals.set(request, principal);
  });

  const principal = (request: object) => {
    const value = principals.get(request);
    if (!value) throw new OneComputerError("UNAUTHENTICATED", "Sign in with your work account", 401);
    return value;
  };
  const identity = (request: object) => identityContextSchema.parse(principal(request).identity);
  const requireAdministrator = (request: object) => {
    const value = principal(request);
    if (!isAdministrator(value)) throw new OneComputerError("FORBIDDEN", "Administrator access is required", 403);
    return value;
  };
  const requirePolicy = async (request: object) => {
    const value = principal(request);
    const effective = security.identityPolicyStore ? await security.identityPolicyStore.getEffectivePolicy(value.userId) : null;
    if (security.identityPolicyStore && !effective) throw new OneComputerError("POLICY_NOT_ASSIGNED", "No active workspace policy is assigned", 403);
    return { principal: value, policy: effective ? runtimePolicyFor(effective) : testRuntimePolicy };
  };
  const idempotency = (headers: Record<string, unknown>) => {
    const key = headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128) throw new OneComputerError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required", 400);
    return key;
  };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get<{ Querystring: { return?: string } }>("/v1/auth/login", async (request, reply) => {
    if (!security.authentication) throw new OneComputerError("AUTH_NOT_CONFIGURED", "Microsoft sign-in is not configured", 503);
    const started = await security.authentication.begin(request.query.return);
    return reply.code(302).header("set-cookie", started.cookie).header("location", started.location).send();
  });
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>("/v1/auth/callback", async (request, reply) => {
    if (!security.authentication) throw new OneComputerError("AUTH_NOT_CONFIGURED", "Microsoft sign-in is not configured", 503);
    try {
      const completed = await security.authentication.complete({ ...request.query, cookie: request.headers.cookie });
      reply.header("set-cookie", [completed.cookie, completed.clearStateCookie]);
      return reply.code(303).header("location", completed.returnPath).send();
    } catch (error) {
      const reason = error instanceof OneComputerError ? error.code : "OIDC_FAILED";
      return reply.code(303).header("location", `/?signin=error&reason=${encodeURIComponent(reason)}`).send();
    }
  });
  app.get("/v1/auth/session", async (request) => {
    const current = principal(request);
    const effectivePolicy = security.identityPolicyStore ? await security.identityPolicyStore.getEffectivePolicy(current.userId) : null;
    return { user: { id: current.userId, email: current.email, displayName: current.displayName }, tenant: { id: current.tenantId, displayName: current.tenantDisplayName }, roles: current.roles, effectivePolicy };
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    if (!security.authentication) return reply.code(204).send();
    return reply.code(204).header("set-cookie", await security.authentication.logout(request.headers.cookie)).send();
  });
  app.get("/v1/admin/users", async (request) => {
    const actor = requireAdministrator(request);
    if (!security.identityPolicyStore) throw new OneComputerError("POLICY_STORE_NOT_CONFIGURED", "Policy storage is unavailable", 503);
    return { users: await security.identityPolicyStore.listUsers(actor.tenantId) };
  });
  app.post<{ Params: { userId: string } }>("/v1/admin/users/:userId/policy", async (request) => {
    const actor = requireAdministrator(request);
    if (!security.identityPolicyStore) throw new OneComputerError("POLICY_STORE_NOT_CONFIGURED", "Policy storage is unavailable", 503);
    const target = (await security.identityPolicyStore.listUsers(actor.tenantId)).find((item) => item.userId === request.params.userId);
    if (!target) throw new OneComputerError("USER_NOT_FOUND", "User not found", 404);
    return security.identityPolicyStore.assignMvpPolicy({ tenantId: actor.tenantId, targetUserId: request.params.userId, assignedBy: actor.userId });
  });
  app.delete<{ Params: { userId: string } }>("/v1/admin/users/:userId/policy", async (request, reply) => {
    const actor = requireAdministrator(request);
    if (!security.identityPolicyStore) throw new OneComputerError("POLICY_STORE_NOT_CONFIGURED", "Policy storage is unavailable", 503);
    const target = (await security.identityPolicyStore.listUsers(actor.tenantId)).find((item) => item.userId === request.params.userId);
    if (!target) throw new OneComputerError("USER_NOT_FOUND", "User not found", 404);
    const current = await security.identityPolicyStore.getEffectivePolicy(request.params.userId);
    const revoked = await security.identityPolicyStore.revokeMvpPolicy({ tenantId: actor.tenantId, targetUserId: request.params.userId, revokedBy: actor.userId });
    if (revoked && current?.workspaceId && gateway) {
      await Promise.all([
        gateway.revoke(current.workspaceId).catch(() => undefined),
        gateway.revoke(current.workspaceId, current.agentId).catch(() => undefined),
      ]);
    }
    return revoked ? reply.code(204).send() : reply.code(404).send({ error: { code: "POLICY_ASSIGNMENT_NOT_FOUND", message: "Active policy assignment not found", correlationId: request.id, retryable: false } });
  });
  app.post<{ Body: { revisionNote?: string } }>("/v1/admin/policy/versions", async (request) => {
    const actor = requireAdministrator(request);
    if (!security.identityPolicyStore) throw new OneComputerError("POLICY_STORE_NOT_CONFIGURED", "Policy storage is unavailable", 503);
    const note = z.object({ revisionNote: z.string().min(3).max(160) }).parse(request.body ?? {});
    return security.identityPolicyStore.createMvpPolicyVersion({ tenantId: actor.tenantId, createdBy: actor.userId, revisionNote: note.revisionNote });
  });
  app.get("/v1/connections/microsoft-365", async (request) => requireConnections().status(identity(request)));
  app.get("/v1/connections/microsoft-365/authorize", async (request, reply) => {
    const started = await requireConnections().start(identity(request));
    if (started.cookies.length) reply.header("set-cookie", started.cookies);
    return reply.code(302).header("location", started.location).send();
  });
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>("/v1/connections/microsoft-365/callback", async (request, reply) => {
    const service = requireConnections();
    try {
      await service.complete(identity(request), {
        state: request.query.state,
        code: request.query.code,
        error: request.query.error,
      });
      return reply.code(303).header("location", service.resultUrl("connected")).send();
    } catch (error) {
      const reason = error instanceof OneComputerError ? error.code : "M365_CONNECTION_FAILED";
      return reply.code(303).header("location", service.resultUrl("error", reason)).send();
    }
  });
  app.delete("/v1/connections/microsoft-365", async (request) => requireConnections().disconnect(identity(request)));
  app.get("/v1/workspaces/current", async (request, reply) => {
    const { policy } = await requirePolicy(request);
    const current = await service.current(identity(request), policy, "personal");
    return current ? reply.send(current) : reply.code(404).send({ error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found", correlationId: request.id, retryable: false } });
  });
  app.post("/v1/workspaces", async (request, reply) => {
    const input = createWorkspaceSchema.parse(request.body ?? {});
    const { principal: actor, policy } = await requirePolicy(request);
    const workspace = await service.create(identity(request), policy, input.grantId, idempotency(request.headers), request.id);
    await security.identityPolicyStore?.bindWorkspaceIdentity(actor.userId, workspace.id);
    return reply.code(201).send(workspace);
  });
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/open", async (request) => { const { policy } = await requirePolicy(request); return service.open(identity(request), policy, request.params.workspaceId); });
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/restart", async (request) => { const { policy } = await requirePolicy(request); return service.restart(identity(request), policy, request.params.workspaceId, request.id); });
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/stop", async (request) => { const { policy } = await requirePolicy(request); return service.stop(identity(request), policy, request.params.workspaceId); });
  app.post<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId/gateway/test", async (request) => { const { policy } = await requirePolicy(request); return service.testGateway(identity(request), policy, request.params.workspaceId); });
  app.delete<{ Params: { workspaceId: string } }>("/v1/workspaces/:workspaceId", async (request, reply) => {
    const { policy } = await requirePolicy(request);
    await service.delete(identity(request), policy, request.params.workspaceId);
    return reply.code(204).send();
  });
  app.get("/v1/operations/recent", async (request, reply) => {
    await requirePolicy(request);
    const operation = await operations.recent(identity(request));
    return operation ? reply.send(operation) : reply.code(204).send();
  });
  app.post("/v1/operations/delete-file", async (request, reply) => {
    const input = createDeleteFileOperationSchema.parse(request.body ?? {});
    await requirePolicy(request);
    const operation = await operations.createDeleteFile(identity(request), input.workspaceId, input.path, idempotency(request.headers), request.id);
    return reply.code(201).send(operation);
  });
  app.get<{ Params: { operationId: string } }>("/v1/operations/:operationId", async (request) => { await requirePolicy(request); return operations.get(identity(request), request.params.operationId); });
  app.post<{ Params: { operationId: string } }>("/v1/operations/:operationId/fixture-decision", async (request) => {
    idempotency(request.headers);
    const input = fixtureApprovalSchema.parse(request.body ?? {});
    await requirePolicy(request);
    return operations.decideWithFixture(identity(request), request.params.operationId, input.decision, request.id);
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
  const identityPolicyStore = PostgresIdentityPolicyStore.fromConnectionString(env.DATABASE_URL);
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
  const app = createControlServer(
    store,
    new HttpControllerClient(env.CONTROLLER_URL, env.CONTROLLER_INTERNAL_TOKEN),
    env.WEB_PROXY_TOKEN,
    gateway,
    env.FIXTURE_APPROVAL_SECRET,
    { publicWebUrl: env.PUBLIC_WEB_URL, authorizationOrigin: env.M365_AUTHORIZATION_ORIGIN },
    {
      identityPolicyStore,
      authentication: new EntraAuthenticationService(identityPolicyStore, {
        tenantId: env.ENTRA_TENANT_ID,
        clientId: env.ENTRA_CLIENT_ID,
        clientSecret: env.ENTRA_CLIENT_SECRET,
        publicWebUrl: env.PUBLIC_WEB_URL,
        sessionSecret: env.SESSION_SECRET,
        bootstrapOwnedTenantId: env.BOOTSTRAP_TENANT_ID,
        bootstrapOwnedUserId: env.BOOTSTRAP_USER_ID,
        tenantDisplayName: env.TENANT_DISPLAY_NAME,
        administratorEmails: env.ADMINISTRATOR_EMAILS.split(",").map((item) => item.trim()).filter(Boolean),
      }),
    },
  );
  app.addHook("onClose", async () => { await store.close(); await identityPolicyStore.close(); });
  await app.listen({ host: env.CONTROL_HOST, port: env.CONTROL_PORT });
}
