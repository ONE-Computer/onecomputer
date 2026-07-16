import { z } from "zod";

// POST /approvals — create an approval request (called by agent/gateway).
// `action` is the canonical capability string (e.g. "outlook.send_email"),
// `requestedBy` is the userId or agentId that wants to perform the action,
// and `context` carries the human-readable preview ({ recipient, subject, ... }).
export const createApprovalSchema = z.object({
  action: z.string().min(1, "action is required"),
  requestedBy: z.string().min(1, "requestedBy is required"),
  context: z.record(z.string(), z.unknown()),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
});

export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;

// POST /approvals/:id/decide — manager+ records an approve/deny decision.
// `decision` is "approved" | "denied" (the task spec uses these statuses;
// the prior stub used "rejected", which is superseded here).
export const decideApprovalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  comment: z.string().max(2000).optional(),
  confirmation: z
    .union([
      // Compatibility-only local/demo approval. OpenVTC sessions use the
      // signed Trust-Task document form.
      z.object({
        protocol: z.literal("confirm/response"),
        version: z.literal("0.1"),
        approverDid: z.string().startsWith("did:"),
        signedAt: z.string().datetime(),
        signature: z.string().min(40),
      }),
      z.object({
        // Canonical OpenVTC Trust Task. The wallet/VTA signs the document;
        // the gateway is the authoritative verifier before release.
        protocol: z.literal("auth/step-up/approve-response/0.2"),
        version: z.literal("0.2"),
        document: z.record(z.string(), z.unknown()),
      }),
    ])
    .optional(),
});

export const registerApprovalKeySchema = z.object({
  did: z.string().startsWith("did:"),
  publicKeyJwk: z.object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().min(40),
  }),
});

export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;
