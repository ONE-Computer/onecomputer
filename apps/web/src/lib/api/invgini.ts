import { apiGet, apiPost } from "./client";

export type InvginiVtiBridgeMetadata = {
  trustTaskId?: string;
  trustTaskType?: string;
  trustTaskThreadId?: string;
  issuerDid?: string;
  recipientDid?: string;
  policyArtifactId?: string;
  consentArtifactId?: string;
  bridgeReceiptHash?: string;
  previousReceiptHash?: string;
  connectorCustodyMode?: "opaque_handle";
  rawConnectorIdPresent?: false;
  opaqueHandle?: {
    id: string;
    kind?: string;
    gateway?: string;
    displayName?: string;
    [key: string]: unknown;
  };
  consentState?: string;
  deliveryState?: string;
  [key: string]: unknown;
};

export type InvginiAgentPrincipal = {
  id: string;
  did: string;
  trustProvider: string;
  subjectType: string;
  status: string;
  displayName?: string | null;
  ownerEmail?: string | null;
  sourceSystem: "invgini";
  sourceRefType: string;
  sourceRefId: string;
  metadata: Record<string, unknown>;
};

export type InvginiAgentMandate = {
  id: string;
  title: string;
  description: string;
  constraints: Record<string, unknown>;
  status: string;
};

export type InvginiAgentResourceGrant = {
  id: string;
  resourceType: string;
  resourceId: string;
  permission: string;
  constraints: Record<string, unknown>;
  status: string;
  expiresAt?: string | null;
};

export type InvginiAgentActionRequest = {
  id: string;
  connector: string;
  action: string;
  resource: Record<string, unknown>;
  riskTier: string;
  riskScore: number;
  policySignals?: Record<string, unknown> | null;
  vtiBridge?: InvginiVtiBridgeMetadata;
  status: string;
  reason?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  createdAt: string;
};

export type InvginiAgentActionReceipt = {
  id: string;
  connector: string;
  action: string;
  resource: Record<string, unknown>;
  outcome: string;
  requestId?: string | null;
  runId?: string | null;
  receiptHash?: string | null;
  details?: Record<string, unknown> | null;
  vtiBridge?: InvginiVtiBridgeMetadata;
  createdAt: string;
};

export type InvginiAgentControlActionName =
  | "FREEZE_AGENT"
  | "REQUIRE_APPROVAL"
  | "REVOKE_GRANTS"
  | "QUARANTINE_CONNECTOR"
  | "EXPORT_RECEIPTS";

export type InvginiAgentControlAction = {
  id: string;
  action: InvginiAgentControlActionName;
  status: string;
  reason: string;
  connector?: string | null;
  resource: Record<string, unknown>;
  requestedByUserId: string;
  requestedByEmail: string;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
  resolvedByEmail?: string | null;
  resolutionReason?: string | null;
  createdAt: string;
};

export type InvginiAgentEventLog = {
  id: string;
  projectId: string;
  principalId?: string | null;
  principalDid: string;
  eventType: string;
  eventHash: string;
  occurredAt: string;
  ingestedAt: string;
  payload: Record<string, unknown>;
  vtiBridge?: InvginiVtiBridgeMetadata;
};

export type CreateInvginiControlActionInput = {
  principalId: string;
  action: InvginiAgentControlActionName;
  reason: string;
  connector?: string | null;
  resource?: Record<string, unknown>;
  expiresAt?: string | null;
};

export type ResolveInvginiControlActionInput = {
  principalId: string;
  controlId: string;
  status: "APPLIED" | "RESOLVED" | "EXPIRED" | "CANCELLED";
  reason: string;
};

export type InvginiAgentRegistryEntry = {
  projectId: string;
  project: {
    id: string;
    name: string;
    slug?: string | null;
  };
  principal: InvginiAgentPrincipal;
  mandates: InvginiAgentMandate[];
  resourceGrants: InvginiAgentResourceGrant[];
  actionRequests: InvginiAgentActionRequest[];
  pendingActionRequests: InvginiAgentActionRequest[];
  actionReceipts: InvginiAgentActionReceipt[];
  controlActions: InvginiAgentControlAction[];
  eventLogCount?: number;
  lastEventHash?: string | null;
  lastEventType: string;
  lastSeenAt: string;
};

export type InvginiAgentEvidencePack = {
  generatedAt: string;
  project: InvginiAgentRegistryEntry["project"];
  principal: InvginiAgentPrincipal;
  mandates: InvginiAgentMandate[];
  resourceGrants: InvginiAgentResourceGrant[];
  actionRequests: InvginiAgentActionRequest[];
  actionReceipts: InvginiAgentActionReceipt[];
  controlActions: InvginiAgentControlAction[];
  eventLogs: InvginiAgentEventLog[];
  vtiBridgeArtifacts: Record<string, unknown>[];
};

export const listInvginiAgents = () =>
  apiGet<InvginiAgentRegistryEntry[]>("/v1/agents/invgini-governance/fleet");

export const getInvginiAgentEvidencePack = (principalId: string) =>
  apiGet<InvginiAgentEvidencePack>(
    `/v1/agents/invgini-governance/${principalId}/evidence-pack`,
  );

export const getInvginiAgentEventLogs = (principalId: string) =>
  apiGet<InvginiAgentEventLog[]>(
    `/v1/agents/invgini-governance/${principalId}/events`,
  );

export const createInvginiControlAction = ({
  principalId,
  ...body
}: CreateInvginiControlActionInput) =>
  apiPost<InvginiAgentControlAction>(
    `/v1/agents/invgini-governance/${principalId}/controls`,
    body,
  );

export const resolveInvginiControlAction = ({
  principalId,
  controlId,
  ...body
}: ResolveInvginiControlActionInput) =>
  apiPost<InvginiAgentControlAction>(
    `/v1/agents/invgini-governance/${principalId}/controls/${controlId}/resolve`,
    body,
  );
