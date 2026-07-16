import { z } from "zod";
import { GUARDRAIL_ACTION_TYPES } from "../services/protective-guardrails-service";

export const guardrailBoundarySchema = z.enum([
  "enterprise",
  "personal",
  "external",
  "runtime",
  "policy",
]);

export const guardrailActionSchema = z.object({
  actionType: z.enum(GUARDRAIL_ACTION_TYPES),
  actorId: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(200),
  sourceBoundary: guardrailBoundarySchema,
  targetBoundary: guardrailBoundarySchema,
  resourceClass: z.string().trim().min(1).max(200),
  connectorId: z.string().trim().min(1).max(200).optional(),
  recipientClass: z
    .enum(["self", "internal", "manager", "external"])
    .optional(),
  count: z.number().int().min(0).max(1_000_000).optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

export const simulateGuardrailSchema = z.object({
  action: guardrailActionSchema,
  previousHead: z.string().trim().min(1).max(200).optional(),
});

export type SimulateGuardrailInput = z.infer<typeof simulateGuardrailSchema>;
