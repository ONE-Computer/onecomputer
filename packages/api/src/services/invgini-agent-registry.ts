import { createHash } from "node:crypto";
import { db, Prisma } from "@onecli/db";
import type {
  InvginiAgentControlActionInput,
  InvginiAgentControlResolutionInput,
  InvginiAgentEvent,
  InvginiAgentEventsPayload,
} from "../validations/invgini-agent";
import { ServiceError } from "./errors";

type InvginiDbClient = typeof db | Prisma.TransactionClient;

type InvginiVtiBridgeMetadata = NonNullable<
  NonNullable<InvginiAgentEvent["actionRequest"]>["vtiBridge"]
>;

const mapVtiBridge = (
  value: Prisma.JsonValue | null | undefined,
): InvginiVtiBridgeMetadata | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as InvginiVtiBridgeMetadata)
    : undefined;

export type InvginiAgentControlAction = {
  id: string;
  action: string;
  status: string;
  reason: string;
  connector: string | null;
  resource: Record<string, unknown>;
  requestedByUserId: string;
  requestedByEmail: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByEmail: string | null;
  resolutionReason: string | null;
  createdAt: string;
};

export type InvginiAgentEventLogEntry = {
  id: string;
  projectId: string;
  principalId: string | null;
  principalDid: string;
  eventType: InvginiAgentEvent["eventType"];
  eventHash: string;
  occurredAt: string;
  ingestedAt: string;
  payload: InvginiAgentEvent;
  vtiBridge?: InvginiVtiBridgeMetadata;
};

export type InvginiAgentEvidencePack = {
  generatedAt: string;
  project: InvginiAgentRegistryEntry["project"];
  principal: InvginiAgentEvent["principal"];
  mandates: InvginiAgentEvent["mandates"];
  resourceGrants: InvginiAgentEvent["resourceGrants"];
  actionRequests: NonNullable<InvginiAgentEvent["actionRequest"]>[];
  actionReceipts: NonNullable<InvginiAgentEvent["receipt"]>[];
  controlActions: InvginiAgentControlAction[];
  eventLogs: InvginiAgentEventLogEntry[];
  vtiBridgeArtifacts: Record<string, unknown>[];
};

export type InvginiAgentRegistryEntry = {
  projectId: string;
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  principal: InvginiAgentEvent["principal"];
  mandates: InvginiAgentEvent["mandates"];
  resourceGrants: InvginiAgentEvent["resourceGrants"];
  actionRequests: NonNullable<InvginiAgentEvent["actionRequest"]>[];
  pendingActionRequests: NonNullable<InvginiAgentEvent["actionRequest"]>[];
  actionReceipts: NonNullable<InvginiAgentEvent["receipt"]>[];
  controlActions: InvginiAgentControlAction[];
  eventLogCount: number;
  lastEventHash: string | null;
  lastEventType: InvginiAgentEvent["eventType"];
  lastSeenAt: string;
};

export const mergePendingActionRequestSnapshot = (
  existing: NonNullable<InvginiAgentEvent["actionRequest"]>[],
  actionRequest: NonNullable<InvginiAgentEvent["actionRequest"]>,
) => {
  const pendingActionRequests = [...existing];
  const existingIndex = pendingActionRequests.findIndex(
    (request) => request.id === actionRequest.id,
  );
  if (actionRequest.status === "PENDING") {
    if (existingIndex >= 0)
      pendingActionRequests[existingIndex] = actionRequest;
    else pendingActionRequests.push(actionRequest);
  } else if (existingIndex >= 0) {
    pendingActionRequests.splice(existingIndex, 1);
  }
  return pendingActionRequests;
};

const toDate = (value: string) => new Date(value);

const toJson = (value: Record<string, unknown>) =>
  value as Prisma.InputJsonValue;

const toNullableJson = (value: Record<string, unknown> | undefined | null) =>
  value ? toJson(value) : Prisma.JsonNull;

const normalizeForHash = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeForHash(item)]),
  );
};

const stableStringify = (value: unknown) =>
  JSON.stringify(normalizeForHash(value));

export const createInvginiEventHash = (
  projectId: string,
  event: InvginiAgentEvent,
) =>
  createHash("sha256")
    .update(stableStringify({ projectId, event }))
    .digest("hex");

const extractEventVtiBridge = (event: InvginiAgentEvent) =>
  event.actionRequest?.vtiBridge ?? event.receipt?.vtiBridge;

type PrincipalWithRelations = Prisma.InvginiAgentPrincipalGetPayload<{
  include: {
    project: {
      select: {
        id: true;
        name: true;
        slug: true;
      };
    };
    mandates: true;
    resourceGrants: true;
    actionRequests: true;
    actionReceipts: true;
    controlActions: true;
  };
}>;

const mapControlAction = (
  control: Prisma.InvginiAgentControlActionGetPayload<object>,
): InvginiAgentControlAction => ({
  id: control.id,
  action: control.action,
  status: control.status,
  reason: control.reason,
  connector: control.connector,
  resource: control.resource as Record<string, unknown>,
  requestedByUserId: control.requestedByUserId,
  requestedByEmail: control.requestedByEmail,
  expiresAt: control.expiresAt?.toISOString() ?? null,
  resolvedAt: control.resolvedAt?.toISOString() ?? null,
  resolvedByUserId: control.resolvedByUserId,
  resolvedByEmail: control.resolvedByEmail,
  resolutionReason: control.resolutionReason,
  createdAt: control.createdAt.toISOString(),
});

const mapEventLog = (
  eventLog: Prisma.InvginiAgentEventLogGetPayload<object>,
): InvginiAgentEventLogEntry => ({
  id: eventLog.id,
  projectId: eventLog.projectId,
  principalId: eventLog.principalId,
  principalDid: eventLog.principalDid,
  eventType: eventLog.eventType as InvginiAgentEvent["eventType"],
  eventHash: eventLog.eventHash,
  occurredAt: eventLog.occurredAt.toISOString(),
  ingestedAt: eventLog.ingestedAt.toISOString(),
  payload: eventLog.payload as InvginiAgentEvent,
  vtiBridge: mapVtiBridge(eventLog.vtiBridge),
});

const mapActionRequest = (
  request: PrincipalWithRelations["actionRequests"][number],
): NonNullable<InvginiAgentEvent["actionRequest"]> => ({
  id: request.id,
  connector: request.connector,
  action: request.action,
  resource: request.resource as Record<string, unknown>,
  riskTier: request.riskTier,
  riskScore: request.riskScore,
  policySignals: request.policySignals as Record<string, unknown> | null,
  vtiBridge: mapVtiBridge(request.vtiBridge),
  status: request.status,
  reason: request.reason,
  decidedByUserId: request.decidedByUserId,
  decidedAt: request.decidedAt?.toISOString() ?? null,
  createdAt: request.requestedAt.toISOString(),
});

const mapActionReceipt = (
  receipt: PrincipalWithRelations["actionReceipts"][number],
): NonNullable<InvginiAgentEvent["receipt"]> => ({
  id: receipt.id,
  connector: receipt.connector,
  action: receipt.action,
  resource: receipt.resource as Record<string, unknown>,
  outcome: receipt.outcome,
  requestId: receipt.requestId,
  runId: receipt.runId,
  receiptHash: receipt.receiptHash,
  details: receipt.details as Record<string, unknown> | null,
  vtiBridge: mapVtiBridge(receipt.vtiBridge),
  createdAt: receipt.executedAt.toISOString(),
});

const countEventLogs = async (
  client: InvginiDbClient,
  row: PrincipalWithRelations,
) =>
  client.invginiAgentEventLog.count({
    where: { projectId: row.projectId, principalDid: row.did },
  });

const findLastEventHash = async (
  client: InvginiDbClient,
  row: PrincipalWithRelations,
) => {
  const latest = await client.invginiAgentEventLog.findFirst({
    where: { projectId: row.projectId, principalDid: row.did },
    orderBy: [{ occurredAt: "desc" }, { ingestedAt: "desc" }],
    select: { eventHash: true },
  });
  return latest?.eventHash ?? null;
};

const mapRegistryEntry = async (
  row: PrincipalWithRelations,
  client: InvginiDbClient = db,
): Promise<InvginiAgentRegistryEntry> => ({
  projectId: row.projectId,
  project: {
    id: row.project.id,
    name: row.project.name ?? "Untitled project",
    slug: row.project.slug,
  },
  principal: {
    id: row.id,
    did: row.did,
    trustProvider: row.trustProvider,
    subjectType: row.subjectType,
    status: row.status,
    displayName: row.displayName,
    ownerEmail: row.ownerEmail,
    sourceSystem: "invgini",
    sourceRefType: row.sourceRefType,
    sourceRefId: row.sourceRefId,
    metadata: row.metadata as Record<string, unknown>,
  },
  mandates: row.mandates.map((mandate) => ({
    id: mandate.id,
    title: mandate.title,
    description: mandate.description,
    constraints: mandate.constraints as Record<string, unknown>,
    status: mandate.status,
  })),
  resourceGrants: row.resourceGrants.map((grant) => ({
    id: grant.id,
    resourceType: grant.resourceType,
    resourceId: grant.resourceId,
    permission: grant.permission,
    constraints: grant.constraints as Record<string, unknown>,
    status: grant.status,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
  })),
  actionRequests: row.actionRequests.map(mapActionRequest),
  pendingActionRequests: row.actionRequests
    .filter((request) => request.status === "PENDING")
    .map(mapActionRequest),
  actionReceipts: row.actionReceipts.map(mapActionReceipt),
  controlActions: row.controlActions.map(mapControlAction),
  eventLogCount: await countEventLogs(client, row),
  lastEventHash: await findLastEventHash(client, row),
  lastEventType: row.lastEventType as InvginiAgentEvent["eventType"],
  lastSeenAt: row.lastSeenAt.toISOString(),
});

export const listInvginiAgentRegistryEntries = async (projectId: string) => {
  const rows = await db.invginiAgentPrincipal.findMany({
    where: { projectId },
    include: {
      project: { select: { id: true, name: true, slug: true } },
      mandates: { orderBy: { createdAt: "asc" } },
      resourceGrants: { orderBy: { createdAt: "asc" } },
      actionRequests: {
        orderBy: { requestedAt: "desc" },
        take: 50,
      },
      actionReceipts: {
        orderBy: { executedAt: "desc" },
        take: 50,
      },
      controlActions: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  return Promise.all(rows.map((row) => mapRegistryEntry(row)));
};

export const listInvginiAgentRegistryEntriesForOrganization = async (
  organizationId: string,
) => {
  const rows = await db.invginiAgentPrincipal.findMany({
    where: { project: { organizationId } },
    include: {
      project: { select: { id: true, name: true, slug: true } },
      mandates: { orderBy: { createdAt: "asc" } },
      resourceGrants: { orderBy: { createdAt: "asc" } },
      actionRequests: {
        orderBy: { requestedAt: "desc" },
        take: 50,
      },
      actionReceipts: {
        orderBy: { executedAt: "desc" },
        take: 50,
      },
      controlActions: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
    orderBy: [{ projectId: "asc" }, { lastSeenAt: "desc" }],
  });
  return Promise.all(rows.map((row) => mapRegistryEntry(row)));
};

export const createInvginiAgentControlAction = async ({
  organizationId,
  principalId,
  requestedByUserId,
  requestedByEmail,
  input,
}: {
  organizationId: string;
  principalId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  input: InvginiAgentControlActionInput;
}) => {
  const principal = await db.invginiAgentPrincipal.findFirst({
    where: { id: principalId, project: { organizationId } },
    select: { id: true },
  });
  if (!principal) {
    throw new ServiceError("NOT_FOUND", "InvGini agent principal not found");
  }

  const control = await db.invginiAgentControlAction.create({
    data: {
      principalId,
      action: input.action,
      status: input.action === "EXPORT_RECEIPTS" ? "COMPLETED" : "OPEN",
      reason: input.reason,
      connector: input.connector ?? null,
      resource: toJson(input.resource),
      expiresAt: input.expiresAt ? toDate(input.expiresAt) : null,
      requestedByUserId,
      requestedByEmail,
    },
  });

  return mapControlAction(control);
};

export const resolveInvginiAgentControlAction = async ({
  organizationId,
  principalId,
  controlId,
  resolvedByUserId,
  resolvedByEmail,
  input,
}: {
  organizationId: string;
  principalId: string;
  controlId: string;
  resolvedByUserId: string;
  resolvedByEmail: string;
  input: InvginiAgentControlResolutionInput;
}) => {
  const control = await db.invginiAgentControlAction.findFirst({
    where: {
      id: controlId,
      principalId,
      principal: { project: { organizationId } },
    },
    select: { id: true, status: true },
  });
  if (!control) {
    throw new ServiceError("NOT_FOUND", "InvGini control action not found");
  }

  if (!["OPEN", "APPLIED"].includes(control.status)) {
    throw new ServiceError(
      "CONFLICT",
      `InvGini control action is already ${control.status}`,
    );
  }

  return mapControlAction(
    await db.invginiAgentControlAction.update({
      where: { id: controlId },
      data: {
        status: input.status,
        resolvedAt: new Date(),
        resolvedByUserId,
        resolvedByEmail,
        resolutionReason: input.reason,
      },
    }),
  );
};

const upsertPrincipal = async (
  client: InvginiDbClient,
  projectId: string,
  event: InvginiAgentEvent,
) => {
  const principal = event.principal;
  const occurredAt = toDate(event.occurredAt);
  const existing = await client.invginiAgentPrincipal.findUnique({
    where: { projectId_did: { projectId, did: principal.did } },
  });

  if (existing && existing.lastSeenAt > occurredAt) {
    return { principal: existing, materialized: false };
  }

  const data = {
    trustProvider: principal.trustProvider,
    subjectType: principal.subjectType,
    status: principal.status,
    displayName: principal.displayName ?? null,
    ownerEmail: principal.ownerEmail ?? null,
    sourceSystem: principal.sourceSystem,
    sourceRefType: principal.sourceRefType,
    sourceRefId: principal.sourceRefId,
    metadata: toJson(principal.metadata),
    lastEventType: event.eventType,
    lastSeenAt: occurredAt,
  };

  if (existing) {
    return {
      principal: await client.invginiAgentPrincipal.update({
        where: { id: existing.id },
        data,
      }),
      materialized: true,
    };
  }

  return {
    principal: await client.invginiAgentPrincipal.create({
      data: {
        id: principal.id,
        projectId,
        did: principal.did,
        ...data,
      },
    }),
    materialized: true,
  };
};

const replaceMandates = async (
  client: InvginiDbClient,
  principalId: string,
  mandates: InvginiAgentEvent["mandates"],
) => {
  if (!mandates.length) return;
  await client.invginiAgentMandate.deleteMany({ where: { principalId } });
  await client.invginiAgentMandate.createMany({
    data: mandates.map((mandate) => ({
      id: mandate.id,
      principalId,
      title: mandate.title,
      description: mandate.description,
      constraints: toJson(mandate.constraints),
      status: mandate.status,
    })),
  });
};

const replaceResourceGrants = async (
  client: InvginiDbClient,
  principalId: string,
  grants: InvginiAgentEvent["resourceGrants"],
) => {
  if (!grants.length) return;
  await client.invginiAgentResourceGrant.deleteMany({ where: { principalId } });
  await client.invginiAgentResourceGrant.createMany({
    data: grants.map((grant) => ({
      id: grant.id,
      principalId,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      permission: grant.permission,
      constraints: toJson(grant.constraints),
      status: grant.status,
      expiresAt: grant.expiresAt ? toDate(grant.expiresAt) : null,
    })),
  });
};

const upsertActionRequest = async (
  client: InvginiDbClient,
  principalId: string,
  actionRequest: NonNullable<InvginiAgentEvent["actionRequest"]>,
) => {
  await client.invginiAgentActionRequest.upsert({
    where: { id: actionRequest.id },
    create: {
      id: actionRequest.id,
      principalId,
      connector: actionRequest.connector,
      action: actionRequest.action,
      resource: toJson(actionRequest.resource),
      riskTier: actionRequest.riskTier,
      riskScore: actionRequest.riskScore,
      policySignals: toNullableJson(actionRequest.policySignals),
      vtiBridge: toNullableJson(actionRequest.vtiBridge),
      status: actionRequest.status,
      reason: actionRequest.reason ?? null,
      decidedByUserId: actionRequest.decidedByUserId ?? null,
      decidedAt: actionRequest.decidedAt
        ? toDate(actionRequest.decidedAt)
        : null,
      requestedAt: toDate(actionRequest.createdAt),
    },
    update: {
      connector: actionRequest.connector,
      action: actionRequest.action,
      resource: toJson(actionRequest.resource),
      riskTier: actionRequest.riskTier,
      riskScore: actionRequest.riskScore,
      policySignals: toNullableJson(actionRequest.policySignals),
      vtiBridge: toNullableJson(actionRequest.vtiBridge),
      status: actionRequest.status,
      reason: actionRequest.reason ?? null,
      decidedByUserId: actionRequest.decidedByUserId ?? null,
      decidedAt: actionRequest.decidedAt
        ? toDate(actionRequest.decidedAt)
        : null,
      requestedAt: toDate(actionRequest.createdAt),
    },
  });
};

const upsertActionReceipt = async (
  client: InvginiDbClient,
  principalId: string,
  receipt: NonNullable<InvginiAgentEvent["receipt"]>,
) => {
  await client.invginiAgentActionReceipt.upsert({
    where: { id: receipt.id },
    create: {
      id: receipt.id,
      principalId,
      requestId: receipt.requestId ?? null,
      runId: receipt.runId ?? null,
      connector: receipt.connector,
      action: receipt.action,
      resource: toJson(receipt.resource),
      outcome: receipt.outcome,
      receiptHash: receipt.receiptHash ?? null,
      details: toNullableJson(receipt.details),
      vtiBridge: toNullableJson(receipt.vtiBridge),
      executedAt: toDate(receipt.createdAt),
    },
    update: {
      requestId: receipt.requestId ?? null,
      runId: receipt.runId ?? null,
      connector: receipt.connector,
      action: receipt.action,
      resource: toJson(receipt.resource),
      outcome: receipt.outcome,
      receiptHash: receipt.receiptHash ?? null,
      details: toNullableJson(receipt.details),
      vtiBridge: toNullableJson(receipt.vtiBridge),
      executedAt: toDate(receipt.createdAt),
    },
  });
};

const upsertEventLog = async (
  client: InvginiDbClient,
  {
    organizationId,
    projectId,
    principalId,
    event,
  }: {
    organizationId: string;
    projectId: string;
    principalId: string;
    event: InvginiAgentEvent;
  },
) => {
  const eventHash = createInvginiEventHash(projectId, event);
  const vtiBridge = extractEventVtiBridge(event);
  return client.invginiAgentEventLog.upsert({
    where: { projectId_eventHash: { projectId, eventHash } },
    create: {
      organizationId,
      projectId,
      principalId,
      principalDid: event.principal.did,
      eventType: event.eventType,
      eventHash,
      occurredAt: toDate(event.occurredAt),
      payload: event as unknown as Prisma.InputJsonValue,
      vtiBridge: vtiBridge ? toJson(vtiBridge) : Prisma.JsonNull,
    },
    update: {
      principalId,
    },
  });
};

const applyInvginiEventToRegistry = async (
  client: InvginiDbClient,
  organizationId: string,
  projectId: string,
  event: InvginiAgentEvent,
) => {
  const { principal, materialized } = await upsertPrincipal(
    client,
    projectId,
    event,
  );

  await upsertEventLog(client, {
    organizationId,
    projectId,
    principalId: principal.id,
    event,
  });

  if (materialized) {
    await replaceMandates(client, principal.id, event.mandates);
    await replaceResourceGrants(client, principal.id, event.resourceGrants);
  }
  if (event.actionRequest) {
    await upsertActionRequest(client, principal.id, event.actionRequest);
  }
  if (event.receipt) {
    await upsertActionReceipt(client, principal.id, event.receipt);
  }
  return principal;
};

export const applyInvginiEventsToRegistry = async ({
  organizationId,
  projectId,
  payload,
}: {
  organizationId: string;
  projectId: string;
  payload: InvginiAgentEventsPayload;
}) =>
  db.$transaction(async (tx) => {
    const principals = [];
    for (const event of payload.events) {
      principals.push(
        await applyInvginiEventToRegistry(tx, organizationId, projectId, event),
      );
    }
    return principals;
  });

export const listInvginiAgentEventLogs = async ({
  organizationId,
  principalId,
  limit = 200,
}: {
  organizationId: string;
  principalId: string;
  limit?: number;
}) => {
  const principal = await db.invginiAgentPrincipal.findFirst({
    where: { id: principalId, project: { organizationId } },
    select: { id: true, projectId: true, did: true },
  });
  if (!principal) {
    throw new ServiceError("NOT_FOUND", "InvGini agent principal not found");
  }

  const rows = await db.invginiAgentEventLog.findMany({
    where: {
      organizationId,
      projectId: principal.projectId,
      principalDid: principal.did,
    },
    orderBy: [{ occurredAt: "desc" }, { ingestedAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 500),
  });
  return rows.map(mapEventLog);
};

export const getInvginiAgentEvidencePack = async ({
  organizationId,
  principalId,
}: {
  organizationId: string;
  principalId: string;
}): Promise<InvginiAgentEvidencePack> => {
  const row = await db.invginiAgentPrincipal.findFirst({
    where: { id: principalId, project: { organizationId } },
    include: {
      project: { select: { id: true, name: true, slug: true } },
      mandates: { orderBy: { createdAt: "asc" } },
      resourceGrants: { orderBy: { createdAt: "asc" } },
      actionRequests: { orderBy: { requestedAt: "desc" }, take: 200 },
      actionReceipts: { orderBy: { executedAt: "desc" }, take: 200 },
      controlActions: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!row) {
    throw new ServiceError("NOT_FOUND", "InvGini agent principal not found");
  }

  const [entry, eventLogs] = await Promise.all([
    mapRegistryEntry(row),
    listInvginiAgentEventLogs({ organizationId, principalId, limit: 500 }),
  ]);
  const vtiBridgeArtifacts = [
    ...entry.actionRequests
      .map((request) => request.vtiBridge)
      .filter((artifact): artifact is InvginiVtiBridgeMetadata =>
        Boolean(artifact),
      ),
    ...entry.actionReceipts
      .map((receipt) => receipt.vtiBridge)
      .filter((artifact): artifact is InvginiVtiBridgeMetadata =>
        Boolean(artifact),
      ),
    ...eventLogs
      .map((eventLog) => eventLog.vtiBridge)
      .filter((artifact): artifact is InvginiVtiBridgeMetadata =>
        Boolean(artifact),
      ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    project: entry.project,
    principal: entry.principal,
    mandates: entry.mandates,
    resourceGrants: entry.resourceGrants,
    actionRequests: entry.actionRequests,
    actionReceipts: entry.actionReceipts,
    controlActions: entry.controlActions,
    eventLogs,
    vtiBridgeArtifacts,
  };
};
