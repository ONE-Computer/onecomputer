import { z } from "zod";

export const validateTokenSchema = z.object({
  token: z.string().min(1, "token is required"),
});

export const resolveSchema = z.object({
  token: z.string().min(1, "token is required"),
  op_ref: z.string().min(1, "op_ref is required"),
});

export const listVaultsSchema = z.object({
  token: z.string().min(1, "token is required"),
});

export const listItemsSchema = z.object({
  token: z.string().min(1, "token is required"),
  vaultId: z.string().min(1, "vaultId is required"),
});

export const listFieldsSchema = z.object({
  token: z.string().min(1, "token is required"),
  vaultId: z.string().min(1, "vaultId is required"),
  itemId: z.string().min(1, "itemId is required"),
});

// POST /v1/internal/approvals — the gateway reports a ManualApproval
// PolicyDecision (apps/gateway/src/gateway/forward.rs builds a PendingApproval
// and holds the request). This creates the durable ApprovalRequest record the
// manager persona sees in the approvals queue. The CREATE path only — the
// unblock path (gateway submit_decision ↔ API status) is Phase 3 identity work.
//
// `gatewayApprovalId` is the gateway's in-memory pending-approval id; we do NOT
// use it as the DB id (the DB mints its own uuid) but stash it in
// `context.gatewayApprovalId` so a future unblock path can correlate the two.
export const internalApprovalSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
  projectId: z.string().min(1, "projectId is required"),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  action: z.string().min(1, "action is required"),
  requestedBy: z.string().min(1, "requestedBy is required"),
  context: z.record(z.string(), z.unknown()).optional(),
  gatewayApprovalId: z.string().optional(),
  // Unix seconds (gateway uses u64). Optional — defaults to the API's 24h TTL.
  expiresAtUnix: z.number().int().positive().optional(),
});

// POST /v1/internal/gateway/manual-approval — smoke-testable bridge shape for
// gateway ManualApproval events. organizationId/projectId/requestedBy are needed
// by the durable ApprovalRequest API until the Rust gateway callback is wired.
export const gatewayManualApprovalSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
  projectId: z.string().min(1, "projectId is required"),
  agentId: z.string().optional(),
  requestedBy: z.string().min(1, "requestedBy is required"),
  ruleId: z.string().min(1, "ruleId is required"),
  action: z.string().min(1, "action is required"),
  host: z.string().min(1, "host is required"),
  path: z.string().min(1, "path is required"),
  method: z.string().min(1, "method is required"),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type InternalApprovalInput = z.infer<typeof internalApprovalSchema>;
export type GatewayManualApprovalInput = z.infer<
  typeof gatewayManualApprovalSchema
>;

export const gatewayDlpAlertSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
  projectId: z.string().optional(),
  sandboxId: z.string().optional(),
  agentId: z.string().optional(),
  approvalId: z.string().optional(),
  requestLogId: z.string().optional(),
  source: z.string().min(1, "source is required"),
  direction: z.string().min(1, "direction is required"),
  host: z.string().optional(),
  path: z.string().optional(),
  method: z.string().optional(),
  action: z
    .enum(["observe", "redact", "block", "manual_approval"])
    .default("observe"),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  entityTypes: z.array(z.unknown()).default([]),
  findingCount: z.number().int().nonnegative(),
  redacted: z.boolean(),
  blocked: z.boolean().default(false),
  sampleHash: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GatewayDlpAlertInput = z.infer<typeof gatewayDlpAlertSchema>;
