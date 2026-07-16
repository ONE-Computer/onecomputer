import { db, Prisma } from "@onecli/db";

export type DlpAlertRow = Prisma.DlpAlertGetPayload<object>;

export interface DlpAlertInput {
  organizationId: string;
  projectId?: string;
  sandboxId?: string;
  agentId?: string;
  approvalId?: string;
  requestLogId?: string;
  source: string;
  direction: string;
  host?: string;
  path?: string;
  method?: string;
  action: string;
  riskLevel: string;
  entityTypes: unknown[];
  findingCount: number;
  redacted: boolean;
  blocked?: boolean;
  sampleHash?: string;
  metadata?: Record<string, unknown>;
}

export const createDlpAlert = async (
  input: DlpAlertInput,
): Promise<DlpAlertRow> => {
  return db.dlpAlert.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sandboxId: input.sandboxId,
      agentId: input.agentId,
      approvalId: input.approvalId,
      requestLogId: input.requestLogId,
      source: input.source,
      direction: input.direction,
      host: input.host,
      path: input.path,
      method: input.method,
      action: input.action,
      riskLevel: input.riskLevel,
      entityTypes: input.entityTypes as Prisma.InputJsonValue,
      findingCount: input.findingCount,
      redacted: input.redacted,
      blocked: input.blocked ?? false,
      sampleHash: input.sampleHash,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
};

export const listDlpAlerts = async (params: {
  projectId?: string;
  organizationId?: string;
  limit?: number;
  riskLevel?: string;
}): Promise<DlpAlertRow[]> => {
  const limit = Math.min(params.limit ?? 100, 500);
  return db.dlpAlert.findMany({
    where: {
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.riskLevel ? { riskLevel: params.riskLevel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
};

export const getDlpAlert = async (id: string): Promise<DlpAlertRow | null> => {
  return db.dlpAlert.findUnique({ where: { id } });
};
