import { z } from "zod";

const forbiddenRawConnectorKeys = new Set([
  "rawConnectorId",
  "raw_connector_id",
  "rawPhoneNumber",
  "raw_phone_number",
  "phoneNumber",
  "phone_number",
  "rawEmail",
  "raw_email",
  "emailAddress",
  "email_address",
  "rawChatId",
  "raw_chat_id",
  "chatId",
  "chat_id",
  "rawPlatformId",
  "raw_platform_id",
  "platformUserId",
  "platform_user_id",
  "messageId",
  "message_id",
  "userId",
  "user_id",
]);

export const assertNoRawConnectorKeys = (
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoRawConnectorKeys(item, ctx, [...path, index]),
    );
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (forbiddenRawConnectorKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message: `Raw connector identifier field ${key} must stay in the VTI connector layer`,
      });
    }
    assertNoRawConnectorKeys(item, ctx, [...path, key]);
  });
};

export const invginiVtiBridgeOpaqueHandleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1).optional(),
    gateway: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
  })
  .passthrough();

export const invginiVtiBridgeMetadataSchema = z
  .object({
    trustTaskId: z.string().min(1).optional(),
    trustTaskType: z.string().min(1).optional(),
    trustTaskThreadId: z.string().min(1).optional(),
    issuerDid: z.string().min(1).optional(),
    recipientDid: z.string().min(1).optional(),
    policyArtifactId: z.string().min(1).optional(),
    consentArtifactId: z.string().min(1).optional(),
    bridgeReceiptHash: z.string().min(1).optional(),
    previousReceiptHash: z.string().min(1).optional(),
    connectorCustodyMode: z.literal("opaque_handle").default("opaque_handle"),
    rawConnectorIdPresent: z.literal(false).default(false),
    opaqueHandle: invginiVtiBridgeOpaqueHandleSchema.optional(),
    consentState: z.string().min(1).optional(),
    deliveryState: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => assertNoRawConnectorKeys(value, ctx));

export const invginiAgentPrincipalSchema = z.object({
  id: z.string().min(1),
  did: z.string().min(1),
  trustProvider: z.string().min(1),
  subjectType: z.string().default("agent"),
  status: z.string().min(1),
  displayName: z.string().nullable().optional(),
  ownerEmail: z.string().email().nullable().optional(),
  sourceSystem: z.literal("invgini").default("invgini"),
  sourceRefType: z.string().min(1),
  sourceRefId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const invginiAgentMandateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).default({}),
  status: z.string().min(1),
});

export const invginiAgentResourceGrantSchema = z.object({
  id: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  permission: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).default({}),
  status: z.string().min(1),
  expiresAt: z.string().nullable().optional(),
});

export const invginiAgentActionRequestSchema = z
  .object({
    id: z.string().min(1),
    connector: z.string().min(1),
    action: z.string().min(1),
    resource: z.record(z.string(), z.unknown()).default({}),
    riskTier: z.string().min(1),
    riskScore: z.number().int().min(0).max(100).default(0),
    policySignals: z.record(z.string(), z.unknown()).nullable().optional(),
    vtiBridge: invginiVtiBridgeMetadataSchema.optional(),
    status: z.string().min(1),
    reason: z.string().nullable().optional(),
    decidedByUserId: z.string().nullable().optional(),
    decidedAt: z.string().nullable().optional(),
    createdAt: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    assertNoRawConnectorKeys(value.resource, ctx, ["resource"]);
    assertNoRawConnectorKeys(value.policySignals, ctx, ["policySignals"]);
  });

export const invginiAgentReceiptSchema = z
  .object({
    id: z.string().min(1),
    connector: z.string().min(1),
    action: z.string().min(1),
    resource: z.record(z.string(), z.unknown()).default({}),
    outcome: z.string().min(1),
    requestId: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    receiptHash: z.string().nullable().optional(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
    vtiBridge: invginiVtiBridgeMetadataSchema.optional(),
    createdAt: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    assertNoRawConnectorKeys(value.resource, ctx, ["resource"]);
    assertNoRawConnectorKeys(value.details, ctx, ["details"]);
  });

export const invginiAgentEventSchema = z.object({
  eventType: z.enum([
    "AgentRegistered",
    "AgentUpdated",
    "GrantChanged",
    "ActionRequested",
    "ActionDecided",
    "ReceiptCreated",
  ]),
  occurredAt: z.string().min(1),
  principal: invginiAgentPrincipalSchema,
  mandates: z.array(invginiAgentMandateSchema).default([]),
  resourceGrants: z.array(invginiAgentResourceGrantSchema).default([]),
  actionRequest: invginiAgentActionRequestSchema.optional(),
  receipt: invginiAgentReceiptSchema.optional(),
});

export const invginiAgentControlActionSchema = z
  .object({
    action: z.enum([
      "FREEZE_AGENT",
      "REQUIRE_APPROVAL",
      "REVOKE_GRANTS",
      "QUARANTINE_CONNECTOR",
      "EXPORT_RECEIPTS",
    ]),
    reason: z.string().min(3).max(500),
    connector: z.string().min(1).nullable().optional(),
    resource: z.record(z.string(), z.unknown()).default({}),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    assertNoRawConnectorKeys(value.resource, ctx, ["resource"]);
  });

export type InvginiAgentControlActionInput = z.infer<
  typeof invginiAgentControlActionSchema
>;

export const invginiAgentControlResolutionSchema = z
  .object({
    status: z.enum(["APPLIED", "RESOLVED", "EXPIRED", "CANCELLED"]),
    reason: z.string().min(3).max(500),
  })
  .superRefine((value, ctx) => {
    assertNoRawConnectorKeys(value, ctx);
  });

export type InvginiAgentControlResolutionInput = z.infer<
  typeof invginiAgentControlResolutionSchema
>;

export const invginiAgentEventsPayloadSchema = z.object({
  events: z.array(invginiAgentEventSchema).min(1).max(100),
});

export type InvginiAgentEvent = z.infer<typeof invginiAgentEventSchema>;
export type InvginiAgentEventsPayload = z.infer<
  typeof invginiAgentEventsPayloadSchema
>;
