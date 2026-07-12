import { z } from "zod";
import { PERSONAL_CONNECTOR_KINDS } from "../services/personal-connector-broker-service";

export const personalConnectorScopeSchema = z.object({
  labels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  folders: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  dateFrom: z.string().trim().max(40).optional(),
  dateTo: z.string().trim().max(40).optional(),
  query: z.string().trim().min(1).max(500).optional(),
});

export const personalConnectorGrantPreviewSchema = z.object({
  connectorId: z.string().trim().min(1).max(200),
  connectorKind: z.enum(PERSONAL_CONNECTOR_KINDS),
  userId: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(8).max(500),
  scope: personalConnectorScopeSchema,
  ttlMinutes: z.number().int().min(1).max(60),
  maxItems: z.number().int().min(1).max(50),
  issuedAt: z.string().trim().min(1).max(80),
});

export type PersonalConnectorGrantPreviewInput = z.infer<
  typeof personalConnectorGrantPreviewSchema
>;
