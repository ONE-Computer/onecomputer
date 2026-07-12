import { NextResponse, type NextRequest } from "next/server";
import { db } from "@onecli/db";
import { getServerSession } from "@/lib/auth/server";
import { findUserDefaultProject } from "@onecli/api/services/organization-service";
import {
  applyInvginiEventsToRegistry,
  createInvginiAgentControlAction,
  getInvginiAgentEvidencePack,
  listInvginiAgentEventLogs,
  listInvginiAgentRegistryEntries,
  listInvginiAgentRegistryEntriesForOrganization,
  resolveInvginiAgentControlAction,
} from "@onecli/api/services/invgini-agent-registry";
import {
  invginiAgentControlActionSchema,
  invginiAgentControlResolutionSchema,
  invginiAgentEventsPayloadSchema,
} from "@onecli/api/validations/invgini-agent";

interface InvginiRouteAuth {
  userId: string;
  userEmail: string;
  projectId?: string;
  organizationId: string;
  organizationRole: "owner" | "admin" | "member";
}

const jsonError = (message: string, status: 400 | 401 | 403 | 404 | 500) =>
  NextResponse.json(
    {
      error: {
        message,
        type: status === 401 ? "authentication_error" : "invalid_request_error",
      },
    },
    { status },
  );

const resolveProjectForUser = async (
  request: NextRequest,
  userId: string,
): Promise<{ projectId?: string; organizationId?: string }> => {
  const headerProjectId = request.headers.get("x-project-id");
  if (headerProjectId) {
    const project = await db.project.findFirst({
      where: {
        id: headerProjectId,
        organization: { members: { some: { userId } } },
      },
      select: { id: true, organizationId: true },
    });
    if (project) {
      return { projectId: project.id, organizationId: project.organizationId };
    }
    return {};
  }

  const fallback = await findUserDefaultProject(userId);
  if (!fallback) return {};
  return { projectId: fallback.id, organizationId: fallback.organizationId };
};

const resolveOrganizationForUser = async (
  request: NextRequest,
  userId: string,
  projectOrganizationId?: string,
): Promise<
  { organizationId: string; role: "owner" | "admin" | "member" } | undefined
> => {
  const headerOrganizationId = request.headers.get("x-organization-id");
  if (headerOrganizationId) {
    const membership = await db.organizationMember.findFirst({
      where: { userId, organizationId: headerOrganizationId },
      select: { organizationId: true, role: true },
    });
    if (membership) {
      return {
        organizationId: membership.organizationId,
        role: membership.role as "owner" | "admin" | "member",
      };
    }
  }

  if (projectOrganizationId) {
    const membership = await db.organizationMember.findFirst({
      where: { userId, organizationId: projectOrganizationId },
      select: { organizationId: true, role: true },
    });
    if (membership) {
      return {
        organizationId: membership.organizationId,
        role: membership.role as "owner" | "admin" | "member",
      };
    }
  }

  const firstMembership = await db.organizationMember.findFirst({
    where: { userId },
    select: { organizationId: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  return firstMembership
    ? {
        organizationId: firstMembership.organizationId,
        role: firstMembership.role as "owner" | "admin" | "member",
      }
    : undefined;
};

const resolveInvginiRouteAuth = async (
  request: NextRequest,
  { requireProject = false }: { requireProject?: boolean } = {},
): Promise<InvginiRouteAuth | NextResponse> => {
  const session = await getServerSession();
  if (!session?.id || !session.email) {
    return jsonError("Not authenticated", 401);
  }

  const user = await db.user.findUnique({
    where: { externalAuthId: session.id },
    select: { id: true, email: true },
  });
  if (!user) return jsonError("Invalid session", 401);

  const projectScope = await resolveProjectForUser(request, user.id);
  if (requireProject && !projectScope.projectId) {
    return jsonError("X-Project-Id header or default project is required", 400);
  }

  const organization = await resolveOrganizationForUser(
    request,
    user.id,
    projectScope.organizationId,
  );
  if (!organization) {
    return jsonError("Organization context is required", 400);
  }

  return {
    userId: user.id,
    userEmail: user.email,
    projectId: projectScope.projectId,
    organizationId: organization.organizationId,
    organizationRole: organization.role,
  };
};

const isResponse = (
  value: InvginiRouteAuth | NextResponse,
): value is NextResponse => value instanceof NextResponse;

const canAdminInvginiAgents = (auth: InvginiRouteAuth) =>
  auth.organizationRole === "owner" || auth.organizationRole === "admin";

const requireInvginiAdmin = (auth: InvginiRouteAuth) =>
  canAdminInvginiAgents(auth)
    ? undefined
    : jsonError("InvGini SecOps dashboard requires owner or admin role", 403);

export const listInvginiFleetRoute = async (request: NextRequest) => {
  const auth = await resolveInvginiRouteAuth(request);
  if (isResponse(auth)) return auth;
  const adminError = requireInvginiAdmin(auth);
  if (adminError) return adminError;
  return NextResponse.json(
    await listInvginiAgentRegistryEntriesForOrganization(auth.organizationId),
  );
};

export const listInvginiProjectRegistryRoute = async (request: NextRequest) => {
  const auth = await resolveInvginiRouteAuth(request, { requireProject: true });
  if (isResponse(auth)) return auth;
  return NextResponse.json(
    await listInvginiAgentRegistryEntries(auth.projectId!),
  );
};

export const ingestInvginiEventsRoute = async (request: NextRequest) => {
  const auth = await resolveInvginiRouteAuth(request, { requireProject: true });
  if (isResponse(auth)) return auth;

  const body = await request.json().catch(() => null);
  const parsed = invginiAgentEventsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid request body",
      400,
    );
  }

  const principals = await applyInvginiEventsToRegistry({
    organizationId: auth.organizationId,
    projectId: auth.projectId!,
    payload: parsed.data,
  });

  return NextResponse.json({
    accepted: true,
    projectId: auth.projectId,
    eventCount: parsed.data.events.length,
    principals: principals.map((principal) => principal.did),
  });
};

export const createInvginiControlRoute = async (
  request: NextRequest,
  principalId: string,
) => {
  const auth = await resolveInvginiRouteAuth(request);
  if (isResponse(auth)) return auth;
  const adminError = requireInvginiAdmin(auth);
  if (adminError) return adminError;

  const body = await request.json().catch(() => null);
  const parsed = invginiAgentControlActionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid request body",
      400,
    );
  }

  const control = await createInvginiAgentControlAction({
    organizationId: auth.organizationId,
    principalId,
    requestedByUserId: auth.userId,
    requestedByEmail: auth.userEmail,
    input: parsed.data,
  });

  return NextResponse.json(control, { status: 201 });
};

export const resolveInvginiControlRoute = async (
  request: NextRequest,
  principalId: string,
  controlId: string,
) => {
  const auth = await resolveInvginiRouteAuth(request);
  if (isResponse(auth)) return auth;
  const adminError = requireInvginiAdmin(auth);
  if (adminError) return adminError;

  const body = await request.json().catch(() => null);
  const parsed = invginiAgentControlResolutionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid request body",
      400,
    );
  }

  return NextResponse.json(
    await resolveInvginiAgentControlAction({
      organizationId: auth.organizationId,
      principalId,
      controlId,
      resolvedByUserId: auth.userId,
      resolvedByEmail: auth.userEmail,
      input: parsed.data,
    }),
  );
};

export const getInvginiEventLogsRoute = async (
  request: NextRequest,
  principalId: string,
) => {
  const auth = await resolveInvginiRouteAuth(request);
  if (isResponse(auth)) return auth;
  const adminError = requireInvginiAdmin(auth);
  if (adminError) return adminError;

  return NextResponse.json(
    await listInvginiAgentEventLogs({
      organizationId: auth.organizationId,
      principalId,
    }),
  );
};

export const getInvginiEvidencePackRoute = async (
  request: NextRequest,
  principalId: string,
) => {
  const auth = await resolveInvginiRouteAuth(request);
  if (isResponse(auth)) return auth;
  const adminError = requireInvginiAdmin(auth);
  if (adminError) return adminError;

  return NextResponse.json(
    await getInvginiAgentEvidencePack({
      organizationId: auth.organizationId,
      principalId,
    }),
  );
};
