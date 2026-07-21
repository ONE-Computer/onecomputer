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

export const workspaceViewSchema = z.object({
  id: z.uuid(),
  grantId: z.string().min(1),
  state: workspaceStateSchema,
  readiness: readinessSchema,
  modelRoute: modelRouteSchema.optional(),
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
  workspaceProfile: z.literal("kasm-persistent-standard"),
  agentId: z.string().min(1),
  agentProfile: z.literal("onecomputer-default-agent"),
  networkProfile: z.literal("controlled-egress-v1"),
  modelAlias: z.string().min(1).max(128),
  mcpServer: z.string().min(1).max(128),
  allowedTools: z.array(z.string().min(1).max(128)).min(1),
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
});

export const sandboxSchema = z.object({
  providerId: z.string().min(1),
  state: z.enum(["provisioning", "ready", "stopped", "failed"]),
  failureCode: z.string().nullable().default(null),
});
export type Sandbox = z.infer<typeof sandboxSchema>;

export const launchSchema = z.object({
  launchUrl: z.url(),
  expiresAt: z.iso.datetime(),
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
  state: governedOperationStateSchema,
  action: z.literal("Delete file"),
  resourceName: z.string(),
  resourceLocation: z.string(),
  safeSummary: z.string(),
  operationDigest: z.string().length(64),
  requestedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
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
