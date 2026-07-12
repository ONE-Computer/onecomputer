import { Hono } from "hono";
import type {
  SessionProvider,
  OAuthOrgHandlers,
  ConnectionHooks,
  ResourceHooks,
  RoleResolver,
  PolicyValidator,
  RuleActionGate,
} from "./providers";
import type { CryptoService } from "./lib/crypto-types";
import type { AppDefinition } from "./apps/types";
import type { AppPermissionDefinition } from "./apps/app-permissions/types";
import type { ApiEnv } from "./types";
import {
  initSession,
  initCrypto,
  initCloudApps,
  initOAuthOrg,
  initConnectionHooks,
  initResourceHooks,
  initSelfUrl,
  initRoleResolver,
  initPolicyValidator,
  initRuleActionGate,
} from "./providers";
import { registerAppPermission } from "./apps/app-permissions";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { healthRoutes } from "./routes/health";
import { agentRoutes } from "./routes/agents";
import { secretRoutes } from "./routes/secrets";
import { ruleRoutes } from "./routes/rules";
import { memberRoutes } from "./routes/members";
import { userRoutes } from "./routes/user";
import { appRoutes } from "./routes/apps";
import { deployedAppsRoutes } from "./routes/deployed-apps";
import { deployRoutes } from "./routes/deploy";
import { gatewayUrlRoutes, gatewayCaRoutes } from "./routes/gateway";
import { containerConfigRoutes } from "./routes/container-config";
import { countsRoutes } from "./routes/counts";
import { skillRoutes } from "./routes/skill";
import { credentialStubRoutes } from "./routes/credential-stubs";
import { migrateRoutes } from "./routes/migrate";
import { internalRoutes } from "./routes/internal";
import { invginiRoutes } from "./routes/invgini";
import { policyArtifactRoutes } from "./routes/policy-artifacts";
import { guardrailRoutes } from "./routes/guardrails";
import { personalConnectorRoutes } from "./routes/personal-connectors";
import { m365AgentDirectoryRoutes } from "./routes/m365-agent-directory";
import { goldenWorkflowRoutes } from "./routes/golden-workflows";
import { consoleRoutes } from "./routes/console";
import { consoleLiveRoutes } from "./routes/console-live";
import { sandboxRoutes } from "./routes/sandboxes";
import { approvalRoutes } from "./routes/approvals";
import { openVtcApprovalRoutes } from "./routes/openvtc-approvals";
import { auditRoutes } from "./routes/audit";
import { llmTracesRoutes } from "./routes/llm-traces";
import { dlpAlertRoutes } from "./routes/dlp-alerts";
import {
  authSessionRoutes,
  initSessionHooks,
  type SessionHooks,
} from "./routes/auth-session";

export interface CreateApiAppOptions {
  cloudRoutes?: (app: Hono<ApiEnv>) => void;
  crypto?: CryptoService;
  cloudApps?: AppDefinition[];
  cloudAppPermissions?: AppPermissionDefinition[];
  oauthOrg?: OAuthOrgHandlers;
  connectionHooks?: ConnectionHooks;
  resourceHooks?: ResourceHooks;
  selfUrl?: string;
  roleResolver?: RoleResolver;
  policyValidator?: PolicyValidator;
  ruleActionGate?: RuleActionGate;
  sessionHooks?: Partial<SessionHooks>;
  version?: string;
}

export const createApiApp = (
  session: SessionProvider,
  options?: CreateApiAppOptions,
) => {
  initSession(session);
  if (options?.crypto) initCrypto(options.crypto);
  if (options?.cloudApps) initCloudApps(options.cloudApps);
  if (options?.cloudAppPermissions) {
    for (const perm of options.cloudAppPermissions) {
      registerAppPermission(perm);
    }
  }
  if (options?.oauthOrg) initOAuthOrg(options.oauthOrg);
  if (options?.connectionHooks) initConnectionHooks(options.connectionHooks);
  if (options?.resourceHooks) initResourceHooks(options.resourceHooks);
  if (options?.selfUrl) initSelfUrl(options.selfUrl);
  if (options?.roleResolver) initRoleResolver(options.roleResolver);
  if (options?.policyValidator) initPolicyValidator(options.policyValidator);
  if (options?.ruleActionGate) initRuleActionGate(options.ruleActionGate);
  if (options?.sessionHooks) initSessionHooks(options.sessionHooks);

  const app = new Hono<ApiEnv>().basePath("/v1");
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route("/health", healthRoutes(options?.version));
  app.route("/auth/session", authSessionRoutes());
  app.route("/agents", agentRoutes());
  app.route("/secrets", secretRoutes());
  app.route("/rules", ruleRoutes());
  app.route("/members", memberRoutes());
  app.route("/user", userRoutes());
  app.route("/apps", appRoutes());
  app.route("/apps/deployed", deployedAppsRoutes());
  app.route("/apps/deploy", deployRoutes());
  app.route("/gateway-url", gatewayUrlRoutes());
  app.route("/gateway", gatewayCaRoutes());
  app.route("/container-config", containerConfigRoutes());
  app.route("/counts", countsRoutes());
  app.route("/skill", skillRoutes());
  app.route("/credential-stubs", credentialStubRoutes());
  app.route("/migrate", migrateRoutes());
  app.route("/internal", internalRoutes());
  app.route("/invgini", invginiRoutes());
  app.route("/policy-artifacts", policyArtifactRoutes());
  app.route("/guardrails", guardrailRoutes());
  app.route("/personal-connectors", personalConnectorRoutes());
  app.route("/m365-agent-directory", m365AgentDirectoryRoutes());
  app.route("/golden-workflows", goldenWorkflowRoutes());
  app.route("/console", consoleRoutes());
  app.route("/console-live", consoleLiveRoutes());
  app.route("/sandboxes", sandboxRoutes());
  app.route("/approvals", approvalRoutes());
  app.route("/openvtc-approvals", openVtcApprovalRoutes());
  app.route("/audit", auditRoutes());
  app.route("/llm-traces", llmTracesRoutes());
  app.route("/dlp-alerts", dlpAlertRoutes());

  if (options?.cloudRoutes) {
    options.cloudRoutes(app);
  }

  return app;
};
