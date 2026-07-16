import { randomBytes } from "crypto";
import { db } from "@onecli/db";
import { ServiceError } from "./errors";
import { getSelfUrl } from "../providers";
import type { OrgRole } from "../lib/ability";
import type {
  InviteMemberInput,
  UpdateMemberRoleInput,
} from "../validations/member";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const generateInvitationToken = () => randomBytes(32).toString("hex");

/**
 * List all members of an organization.
 */
export const listMembers = async (organizationId: string) => {
  const members = await db.organizationMember.findMany({
    where: { organizationId },
    select: {
      userId: true,
      userEmail: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return members;
};

/**
 * Invite a new member to an organization by email. Creates an Invitation row
 * with a random token, valid for 7 days. In local dev there is no email send
 * — the caller returns the invitation URL/token directly to the requester.
 *
 * Only owner/admin may call this (enforced via RBAC at the route level).
 * Inviting as "owner" is only allowed when the requester is themselves an
 * owner — enforced here since it depends on the requester's specific role,
 * not just resource-level ability.
 */
export const inviteMember = async (
  organizationId: string,
  requestedByUserId: string,
  requestedByEmail: string,
  requesterRole: OrgRole,
  input: InviteMemberInput,
) => {
  if (input.role === "owner" && requesterRole !== "owner") {
    throw new ServiceError(
      "FORBIDDEN",
      "Only an owner can invite another owner",
    );
  }

  const email = input.email.trim().toLowerCase();

  const existingMember = await db.organizationMember.findFirst({
    where: { organizationId, userEmail: email },
    select: { userId: true },
  });
  if (existingMember) {
    throw new ServiceError(
      "CONFLICT",
      "This user is already a member of the organization",
    );
  }

  const existingInvitation = await db.invitation.findFirst({
    where: { organizationId, email, status: "pending" },
    select: { id: true },
  });
  if (existingInvitation) {
    throw new ServiceError(
      "CONFLICT",
      "An invitation is already pending for this email",
    );
  }

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await db.invitation.create({
    data: {
      organizationId,
      email,
      role: input.role,
      token,
      status: "pending",
      invitedById: requestedByUserId,
      invitedByEmail: requestedByEmail,
      expiresAt,
    },
    select: { id: true, token: true, email: true, role: true, expiresAt: true },
  });

  const invitationUrl = `${getSelfUrl()}/invite/${invitation.token}`;

  return {
    invitationId: invitation.id,
    invitationUrl,
    token: invitation.token,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
};

/**
 * Accept a pending invitation for an email when the invited user first logs in.
 *
 * Called from the session-sync route (auth-session.ts) BEFORE the
 * bootstrap-a-new-org fallback. This is what makes a multi-user story work in
 * OAuth/Entra mode: an owner invites `alex@...` as a `member`; when Alex
 * signs in with Microsoft for the first time they land as a member of the
 * existing org (with the role the inviter chose) instead of bootstrapping
 * their own org as owner.
 *
 * Picks the most recent non-expired pending invitation for the email, creates
 * the OrganizationMember row, marks the invitation accepted, and returns the
 * org + a resolvable default project so the session route can short-circuit
 * org bootstrap. Returns null when there is no matching invitation (caller
 * falls back to bootstrapOrganization, preserving first-user-becomes-owner).
 *
 * Idempotent: if the user is already a member of the invited org, the
 * invitation is marked accepted and the existing membership is kept (no role
 * downgrade — explicit `updateMemberRole` is the only path that changes an
 * existing member's role).
 */
export const acceptPendingInvitationForEmail = async (
  email: string,
  userId: string,
): Promise<{ organizationId: string; projectId: string } | null> => {
  const normalized = email.trim().toLowerCase();

  const invitation = await db.invitation.findFirst({
    where: {
      email: normalized,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      role: true,
      expiresAt: true,
    },
  });

  if (!invitation) return null;

  // Reuse an existing membership if one exists (e.g. user was removed and
  // re-invited). Never silently downgrade an existing owner/admin.
  const existing = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: invitation.organizationId,
        userId,
      },
    },
    select: { role: true },
  });

  if (!existing) {
    await db.organizationMember.create({
      data: {
        organizationId: invitation.organizationId,
        userId,
        userEmail: normalized,
        role: invitation.role,
      },
    });
  }

  await db.invitation.update({
    where: { id: invitation.id },
    data: { status: "accepted" },
  });

  // Resolve to the first project in the invited org so the new member lands
  // somewhere usable rather than triggering org bootstrap.
  const project = await db.project.findFirst({
    where: { organizationId: invitation.organizationId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (!project) {
    // Edge case: org exists but has no project yet. Return the org so the
    // caller's bootstrap-aware path can still find a home; the session route
    // will fall back to creating a default project for the org if needed.
    return { organizationId: invitation.organizationId, projectId: "" };
  }

  return {
    organizationId: invitation.organizationId,
    projectId: project.id,
  };
};

export const updateMemberRole = async (
  organizationId: string,
  targetUserId: string,
  requesterRole: OrgRole,
  input: UpdateMemberRoleInput,
) => {
  if (input.role === "owner" && requesterRole !== "owner") {
    throw new ServiceError(
      "FORBIDDEN",
      "Only an owner can promote a member to owner",
    );
  }

  const member = await db.organizationMember.findFirst({
    where: { organizationId, userId: targetUserId },
    select: { userId: true, role: true },
  });
  if (!member) throw new ServiceError("NOT_FOUND", "Member not found");

  // Guard: cannot demote the last remaining owner.
  if (member.role === "owner" && input.role !== "owner") {
    const ownerCount = await db.organizationMember.count({
      where: { organizationId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new ServiceError(
        "CONFLICT",
        "Cannot change role: organization must have at least one owner",
      );
    }
  }

  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
    data: { role: input.role },
  });

  return { userId: targetUserId, role: input.role };
};

/**
 * Remove a member from an organization. Rejects removing the last owner
 * (either removing yourself as the sole owner, or removing any owner when
 * they are the only one left).
 */
export const removeMember = async (
  organizationId: string,
  targetUserId: string,
) => {
  const member = await db.organizationMember.findFirst({
    where: { organizationId, userId: targetUserId },
    select: { userId: true, role: true },
  });
  if (!member) throw new ServiceError("NOT_FOUND", "Member not found");

  if (member.role === "owner") {
    const ownerCount = await db.organizationMember.count({
      where: { organizationId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new ServiceError(
        "CONFLICT",
        "Cannot remove the last owner of the organization",
      );
    }
  }

  await db.organizationMember.delete({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
};

// Role → permitted actions/resources matrix, for the UI to render a
// human-readable capabilities table. Mirrors packages/api/src/lib/ability.ts.
export const getRoleMatrix = () => {
  return {
    roles: [
      { role: "owner", label: "Owner/Platform" },
      { role: "admin", label: "Cyber Admin" },
      { role: "manager", label: "Manager" },
      { role: "member", label: "Employee" },
    ],
    resources: [
      {
        resource: "Organization",
        actions: {
          owner: ["manage"],
          admin: ["manage"],
          manager: [],
          member: [],
        },
      },
      {
        resource: "OrganizationMember",
        actions: {
          owner: ["manage"],
          admin: ["manage"],
          manager: ["read"],
          member: [],
        },
      },
      {
        resource: "Agent",
        actions: {
          owner: ["create", "read", "update", "delete", "execute"],
          admin: ["create", "read", "update", "delete", "execute"],
          manager: ["read", "execute"],
          member: [
            "create",
            "read (own)",
            "update (own)",
            "delete (own)",
            "execute (own)",
          ],
        },
      },
      {
        resource: "Sandbox",
        actions: {
          owner: ["create", "read", "update", "delete", "execute"],
          admin: ["create", "read", "update", "delete", "execute"],
          manager: ["read", "execute"],
          member: ["create", "read (own)", "execute (own)"],
        },
      },
      {
        resource: "Secret",
        actions: {
          owner: ["manage"],
          admin: ["manage"],
          manager: ["read"],
          member: [],
        },
      },
      {
        resource: "PolicyRule",
        actions: {
          owner: ["create", "read", "update", "delete"],
          admin: ["create", "read", "update", "delete"],
          manager: ["read"],
          member: [],
        },
      },
      {
        resource: "AppConnection",
        actions: {
          owner: ["manage"],
          admin: ["manage"],
          manager: ["read"],
          member: ["create (own)"],
        },
      },
      {
        resource: "ApprovalRequest",
        actions: {
          owner: ["manage"],
          admin: ["manage"],
          manager: ["read", "approve"],
          member: ["read (own)"],
        },
      },
      {
        resource: "AuditLog",
        actions: {
          owner: ["read"],
          admin: ["read"],
          manager: ["read"],
          member: ["read (own)"],
        },
      },
    ],
  };
};
