import { createHash } from "node:crypto";
import { z } from "zod";

export const workspaceStates = [
  "not_created",
  "provisioning",
  "ready",
  "open",
  "restarting",
  "stopping",
  "stopped",
  "failed",
] as const;

export const workspaceStateSchema = z.enum(workspaceStates);
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export const readinessStateSchema = z.enum(["ready", "checking", "unavailable", "failed"]);
export type ReadinessState = z.infer<typeof readinessStateSchema>;

export const readinessSchema = z.object({
  identity: readinessStateSchema,
  network: readinessStateSchema,
  models: readinessStateSchema,
  tools: readinessStateSchema,
});

export const modelRouteSchema = z.object({
  alias: z.string().min(1).max(128),
  status: z.enum(["ready", "failed"]),
  fallback: z.literal("none"),
  budget: z.object({
    limitUsd: z.number().nonnegative(),
    spentUsd: z.number().nonnegative(),
    remainingUsd: z.number().nonnegative(),
    duration: z.literal("30d"),
    resetsAt: z.iso.datetime().nullable(),
  }),
  limits: z.object({
    requestsPerMinute: z.number().int().positive(),
    tokensPerMinute: z.number().int().positive(),
    maxParallelRequests: z.number().int().positive(),
  }),
});

export const sandboxProfileIds = ["claude-desktop-standard-v1", "kasm-persistent-standard"] as const;
export const sandboxProfileIdSchema = z.enum(sandboxProfileIds);
export type SandboxProfileId = z.infer<typeof sandboxProfileIdSchema>;

export const sandboxModelAliases = ["onecomputer-claude", "onecomputer-openai", "onecomputer-glm", "onecomputer-assistant"] as const;
export const sandboxModelAliasSchema = z.enum(sandboxModelAliases);
export type SandboxModelAlias = z.infer<typeof sandboxModelAliasSchema>;

export const sandboxProfileSchema = z.object({
  id: sandboxProfileIdSchema,
  version: z.literal(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  client: z.enum(["Claude Desktop", "ONEComputer qualification CLI"]),
  clientVersion: z.string().min(1),
  persistence: z.literal("persistent-home"),
  network: z.literal("gateway-only"),
  resources: z.object({ cpus: z.number().positive(), memoryGiB: z.number().positive() }),
});
export type SandboxProfile = z.infer<typeof sandboxProfileSchema>;

export const clipboardPolicySchema = z.object({
  enabled: z.boolean(),
  localToWorkspace: z.boolean(),
  workspaceToLocal: z.boolean(),
  maxBytes: z.number().int().positive().max(1_048_576),
}).strict();
export type ClipboardPolicy = z.infer<typeof clipboardPolicySchema>;

export const defaultClipboardPolicy: ClipboardPolicy = Object.freeze({
  enabled: true,
  localToWorkspace: true,
  workspaceToLocal: true,
  maxBytes: 65_536,
});

export const egressProtocolSchema = z.enum(["http", "https"]);
export type EgressProtocol = z.infer<typeof egressProtocolSchema>;

export const egressSecurityGroupRuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  action: z.literal("allow"),
  protocol: egressProtocolSchema,
  host: z.string().min(1).max(253),
  includeSubdomains: z.boolean(),
  port: z.number().int().min(1).max(65_535),
  purpose: z.string().min(3).max(240),
}).strict();
export type EgressSecurityGroupRule = z.infer<typeof egressSecurityGroupRuleSchema>;

export const saveEgressSecurityGroupSchema = z.object({
  securityGroupId: z.string().regex(/^esg_[a-z0-9_]{3,96}$/).optional(),
  name: z.string().min(3).max(96),
  description: z.string().min(3).max(500),
  rules: z.array(egressSecurityGroupRuleSchema).max(64),
}).strict();
export type SaveEgressSecurityGroup = z.infer<typeof saveEgressSecurityGroupSchema>;

export const assignEgressSecurityGroupSchema = z.object({
  securityGroupVersionId: z.string().regex(/^egv_[a-z0-9_]{3,96}$/),
}).strict();

export const egressSecurityGroupVersionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^egv_[a-z0-9_]{3,96}$/),
  securityGroupId: z.string().regex(/^esg_[a-z0-9_]{3,96}$/),
  tenantId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  name: z.string().min(3).max(96),
  description: z.string().min(3).max(500),
  defaultAction: z.literal("deny"),
  rules: z.array(egressSecurityGroupRuleSchema).max(64),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdBy: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
}).strict();
export type EgressSecurityGroupVersion = z.infer<typeof egressSecurityGroupVersionSchema>;

export const runtimeEgressPolicySchema = egressSecurityGroupVersionSchema.pick({
  id: true,
  securityGroupId: true,
  version: true,
  name: true,
  description: true,
  defaultAction: true,
  rules: true,
  documentHash: true,
});
export type RuntimeEgressPolicy = z.infer<typeof runtimeEgressPolicySchema>;

export const egressDecisionReasonSchema = z.enum([
  "EGRESS_ALLOWED",
  "EGRESS_DEFAULT_DENY",
  "EGRESS_INVALID_HOST",
  "EGRESS_IP_LITERAL_DENIED",
  "EGRESS_DESTINATION_RESERVED",
  "EGRESS_DNS_UNAVAILABLE",
  "EGRESS_TLS_SNI_REQUIRED",
  "EGRESS_TLS_SNI_MISMATCH",
]);
export type EgressDecisionReason = z.infer<typeof egressDecisionReasonSchema>;

export const egressDecisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  reasonCode: egressDecisionReasonSchema,
  ruleId: z.string().optional(),
}).strict();
export type EgressDecision = z.infer<typeof egressDecisionSchema>;

export const sandboxSettingsSchema = z.object({
  grantId: z.string().min(1).max(128),
  profileId: sandboxProfileIdSchema,
  modelAlias: sandboxModelAliasSchema,
  profile: sandboxProfileSchema,
  availableProfiles: z.array(sandboxProfileSchema).min(1),
  availableModels: z.array(z.object({ alias: sandboxModelAliasSchema, displayName: z.string().min(1), provider: z.string().min(1) })).min(1),
  egress: runtimeEgressPolicySchema.optional(),
  updatedAt: z.iso.datetime().nullable(),
});
export type SandboxSettings = z.infer<typeof sandboxSettingsSchema>;

export const saveSandboxSettingsSchema = z.object({
  grantId: z.string().min(1).max(128).default("personal"),
  profileId: sandboxProfileIdSchema,
  modelAlias: sandboxModelAliasSchema,
}).strict();

export const workspaceViewSchema = z.object({
  id: z.uuid(),
  grantId: z.string().min(1),
  state: workspaceStateSchema,
  readiness: readinessSchema,
  modelRoute: modelRouteSchema.optional(),
  profile: z.object({
    id: z.string().min(1),
    client: z.string().min(1),
    clientVersion: z.string().min(1),
    modelAlias: z.string().min(1),
    persistence: z.literal("persistent-home"),
    network: z.literal("gateway-only"),
  }).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  failureCode: z.string().nullable(),
});
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

export const createWorkspaceSchema = z.object({
  grantId: z.string().min(1).max(128).default("personal"),
});

export const identityContextSchema = z.object({
  tenantId: z.string().min(1).max(128),
  subjectId: z.string().min(1).max(128),
  audience: z.literal("onecomputer-control"),
});
export type IdentityContext = z.infer<typeof identityContextSchema>;

export const runtimePolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyVersionId: z.string().min(1),
  policyVersion: z.number().int().positive(),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceProfile: z.enum(["kasm-persistent-standard", "claude-desktop-standard-v1"]),
  agentId: z.string().min(1),
  agentProfile: z.enum(["onecomputer-default-agent", "claude-desktop-managed-v1"]),
  networkProfile: z.literal("controlled-egress-v1"),
  egress: runtimeEgressPolicySchema.optional(),
  clipboard: clipboardPolicySchema.optional(),
  modelAlias: z.string().min(1).max(128),
  mcpServer: z.string().min(1).max(128),
  allowedTools: z.array(z.string().min(1).max(128)).min(1),
  toolPolicies: z.record(
    z.string().min(1).max(128),
    z.enum(["allow", "approval_required", "deny"]),
  ),
});
export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;

export const controllerCreateSchema = z.object({
  workspaceId: z.uuid(),
  correlationId: z.string().min(1).max(128),
  policy: runtimePolicySchema,
  gateway: z.object({
    baseUrl: z.url(),
    credential: z.string().min(24),
    modelAlias: z.string().min(1).max(128),
    expiresAt: z.iso.datetime(),
  }).optional(),
  agentBridge: z.object({
    baseUrl: z.url(),
    token: z.string().min(24),
  }).optional(),
  egressProxy: z.object({
    token: z.string().min(24),
    verificationSecret: z.string().min(32),
    expiresAt: z.iso.datetime(),
    expectedGrant: z.object({
      tenantId: z.string().min(1).max(128),
      subjectId: z.string().min(1).max(128),
      workspaceId: z.uuid(),
      agentId: z.string().min(1),
      securityGroupVersionId: z.string().regex(/^egv_[a-z0-9_]{3,96}$/),
      policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).optional(),
});

export const sandboxSchema = z.object({
  providerId: z.string().min(1),
  state: z.enum(["provisioning", "ready", "stopped", "failed"]),
  failureCode: z.string().nullable().default(null),
});
export type Sandbox = z.infer<typeof sandboxSchema>;

export const clipboardCapabilitySchema = z.object({
  status: z.enum(["available", "policy_disabled"]),
  reasonCode: z.enum(["CLIPBOARD_READY", "CLIPBOARD_POLICY_DISABLED"]),
  mode: z.literal("native"),
  localToWorkspace: z.boolean(),
  workspaceToLocal: z.boolean(),
  mimeTypes: z.tuple([z.literal("text/plain")]),
  maxBytes: z.number().int().positive().max(1_048_576),
  requiresUserGesture: z.literal(true),
  supportedBrowsers: z.tuple([z.literal("chromium")]),
  fallback: z.literal("kasm-control-panel"),
}).strict();
export type ClipboardCapability = z.infer<typeof clipboardCapabilitySchema>;

export const launchSchema = z.object({
  launchUrl: z.url(),
  expiresAt: z.iso.datetime(),
  clipboard: clipboardCapabilitySchema,
});
export type Launch = z.infer<typeof launchSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    retryable: z.boolean(),
  }),
});

export class OneComputerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "OneComputerError";
  }
}

export type OwnedJson = null | boolean | number | string | OwnedJson[] | { [key: string]: OwnedJson };

export type GovernedOperationEnvelope = {
  version: "1";
  tenantId: string;
  subjectId: string;
  workspaceId: string;
  agentId?: string;
  audience: string;
  capabilityId: string;
  serverName: string;
  toolName: string;
  schemaId: string;
  arguments: OwnedJson;
  policyVersionId?: string;
  policyHash?: string;
  nonce: string;
  expiresAt: string;
};

const normalizeOwnedJson = (value: unknown): OwnedJson => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new OneComputerError("INVALID_CANONICAL_JSON", "Canonical JSON numbers must be finite", 400);
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeOwnedJson);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new OneComputerError("INVALID_CANONICAL_JSON", "Canonical JSON accepts only plain JSON values", 400);
  }
  const normalized: Record<string, OwnedJson> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) throw new OneComputerError("INVALID_CANONICAL_JSON", "Canonical JSON does not accept undefined values", 400);
    normalized[key] = normalizeOwnedJson(item);
  }
  return normalized;
};

export const canonicalJson = (value: unknown) => JSON.stringify(normalizeOwnedJson(value));

export const governedOperationDigest = (envelope: GovernedOperationEnvelope) =>
  createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex");

export const governedOperationStates = [
  "approval_required",
  "approved",
  "executing",
  "succeeded",
  "denied",
  "failed",
  "expired",
] as const;
export const governedOperationStateSchema = z.enum(governedOperationStates);
export type GovernedOperationState = z.infer<typeof governedOperationStateSchema>;

export const createDeleteFileOperationSchema = z.strictObject({
  workspaceId: z.uuid(),
  path: z.string().trim().min(1).max(512).refine((value) => !value.includes("\0"), "Path contains an invalid character"),
});
export type CreateDeleteFileOperation = z.infer<typeof createDeleteFileOperationSchema>;

export const fixtureApprovalSchema = z.strictObject({
  decision: z.enum(["approve", "deny"]),
});

const ownedJsonSchema: z.ZodType<OwnedJson> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(ownedJsonSchema),
  z.record(z.string(), ownedJsonSchema),
]));

export const mcpPolicyRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tenantId: z.string().min(1).max(128),
  subjectId: z.string().min(1).max(128),
  workspaceId: z.uuid(),
  agentId: z.string().min(1).max(128),
  policyVersionId: z.string().min(1).max(128).nullable(),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  operationId: z.uuid().nullable(),
  operationDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  leaseId: z.uuid().nullable(),
  serverId: z.string().regex(/^[a-f0-9]{32}$/),
  serverName: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  arguments: ownedJsonSchema,
});
export type McpPolicyRequest = z.infer<typeof mcpPolicyRequestSchema>;

export const mcpPolicyDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decision: z.enum(["allow", "deny", "approval_required"]),
  code: z.string().min(1).max(128),
  capabilityId: z.string().min(1).max(128).nullable(),
  schemaId: z.string().min(1).max(160).nullable(),
  schemaHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  operationId: z.uuid().nullable(),
});
export type McpPolicyDecision = z.infer<typeof mcpPolicyDecisionSchema>;

export const operationViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  agentId: z.string().min(1).nullable(),
  policyVersionId: z.string().min(1).nullable(),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  state: governedOperationStateSchema,
  action: z.string().min(1),
  resourceName: z.string(),
  resourceLocation: z.string(),
  safeSummary: z.string(),
  operationDigest: z.string().length(64),
  requestedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  requiredApprovalChannel: z.enum(["local-fixture", "openvtc-task-consent"]),
  approval: z.object({
    decision: z.enum(["approve", "deny"]),
    channel: z.enum(["local-fixture", "openvtc-task-consent"]),
    decidedAt: z.iso.datetime(),
  }).nullable(),
  receipt: z.object({
    status: z.literal("succeeded"),
    resultSummary: z.string(),
    executedAt: z.iso.datetime(),
  }).nullable(),
  failureCode: z.string().nullable(),
});
export type OperationView = z.infer<typeof operationViewSchema>;

export const mcpToolPolicyDecisionSchema = z.enum(["allow", "approval_required", "deny"]);
export type McpToolPolicyDecision = z.infer<typeof mcpToolPolicyDecisionSchema>;

export const m365ToolCatalog = {
  "list-mail-folders": { service: "mail", risk: "read", decision: "allow" },
  "list-mail-messages": { service: "mail", risk: "read", decision: "allow" },
  "get-mail-message": { service: "mail", risk: "read", decision: "allow" },
  "create-draft-email": { service: "mail", risk: "write", decision: "approval_required" },
  "update-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "delete-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "move-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "send-mail": { service: "mail", risk: "write", decision: "approval_required" },
  "send-draft-message": { service: "mail", risk: "write", decision: "approval_required" },
  "reply-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "reply-all-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "forward-mail-message": { service: "mail", risk: "write", decision: "approval_required" },
  "list-calendars": { service: "calendar", risk: "read", decision: "allow" },
  "list-calendar-events": { service: "calendar", risk: "read", decision: "allow" },
  "get-calendar-view": { service: "calendar", risk: "read", decision: "allow" },
  "get-calendar-event": { service: "calendar", risk: "read", decision: "allow" },
  "create-calendar-event": { service: "calendar", risk: "write", decision: "approval_required" },
  "update-calendar-event": { service: "calendar", risk: "write", decision: "approval_required" },
  "delete-calendar-event": { service: "calendar", risk: "write", decision: "approval_required" },
  "list-drives": { service: "onedrive", risk: "read", decision: "allow" },
  "get-drive-root-item": { service: "onedrive", risk: "read", decision: "allow" },
  "list-folder-files": { service: "onedrive", risk: "read", decision: "allow" },
  "search-onedrive-files": { service: "onedrive", risk: "read", decision: "allow" },
  "get-drive-item": { service: "onedrive", risk: "read", decision: "allow" },
  "create-onedrive-folder": { service: "onedrive", risk: "write", decision: "approval_required" },
  "upload-file-content": { service: "onedrive", risk: "write", decision: "approval_required" },
  "move-rename-onedrive-item": { service: "onedrive", risk: "write", decision: "approval_required" },
  "copy-drive-item": { service: "onedrive", risk: "write", decision: "approval_required" },
  "delete-onedrive-file": { service: "onedrive", risk: "write", decision: "approval_required" },
  "list-chats": { service: "teams", risk: "read", decision: "allow" },
  "list-chat-messages": { service: "teams", risk: "read", decision: "allow" },
  "list-joined-teams": { service: "teams", risk: "read", decision: "allow" },
  "list-team-channels": { service: "teams", risk: "read", decision: "allow" },
  "list-channel-messages": { service: "teams", risk: "read", decision: "allow" },
  "send-chat-message": { service: "teams", risk: "write", decision: "approval_required" },
  "reply-to-chat-message": { service: "teams", risk: "write", decision: "approval_required" },
  "send-channel-message": { service: "teams", risk: "write", decision: "approval_required" },
  "reply-to-channel-message": { service: "teams", risk: "write", decision: "approval_required" },
} as const satisfies Record<string, {
  service: "mail" | "calendar" | "onedrive" | "teams";
  risk: "read" | "write";
  decision: McpToolPolicyDecision;
}>;

export type M365ToolName = keyof typeof m365ToolCatalog;

export const mcpToolPolicySchema = z.object({
  serverName: z.literal("onecomputer_ms365"),
  version: z.number().int().positive(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  tools: z.array(z.object({
    name: z.string().min(1).max(128),
    displayName: z.string().min(1).max(128),
    description: z.string().min(1).max(320),
    decision: mcpToolPolicyDecisionSchema,
    risk: z.enum(["read", "write"]),
  })),
});
export type McpToolPolicy = z.infer<typeof mcpToolPolicySchema>;

export const saveMcpToolPolicySchema = z.strictObject({
  tools: z.record(z.string().min(1).max(128), mcpToolPolicyDecisionSchema),
});

export const readinessFor = (state: WorkspaceState, gateway?: { models: ReadinessState; tools: ReadinessState }) => ({
  identity: "ready" as const,
  network: (["ready", "open"].includes(state)
    ? "ready"
    : state === "failed"
      ? "failed"
      : ["not_created", "stopped"].includes(state)
        ? "unavailable"
        : "checking") as ReadinessState,
  models: gateway?.models ?? "unavailable" as ReadinessState,
  tools: gateway?.tools ?? "unavailable" as ReadinessState,
});
