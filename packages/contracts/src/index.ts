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

export const workspaceViewSchema = z.object({
  id: z.uuid(),
  grantId: z.string().min(1),
  state: workspaceStateSchema,
  readiness: readinessSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
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

export const controllerCreateSchema = z.object({
  workspaceId: z.uuid(),
  correlationId: z.string().min(1).max(128),
  expiresAt: z.iso.datetime(),
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
