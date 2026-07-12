import { describe, it, expect, vi, beforeEach } from "vitest";

// acceptPendingInvitationForEmail uses db.invitation.findFirst,
// db.organizationMember.findUnique + create, db.invitation.update, and
// db.project.findFirst. Mock the full surface so we can assert the
// multi-user IAM behavior (invited user lands as member, not owner) without a
// real database.
const mocks = vi.hoisted(() => ({
  invitationFindFirst: vi.fn(),
  invitationUpdate: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  projectFindFirst: vi.fn(),
}));

vi.mock("@onecli/db", () => ({
  db: {
    organizationMember: {
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
    },
    invitation: {
      findFirst: mocks.invitationFindFirst,
      update: mocks.invitationUpdate,
    },
    project: {
      findFirst: mocks.projectFindFirst,
    },
  },
}));

vi.mock("../providers", () => ({
  getSelfUrl: () => "http://localhost:10254",
}));

import { acceptPendingInvitationForEmail } from "./member-service";

const EMAIL = "alex@demo.onecomputer.local";
const USER_ID = "user-2";
const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";

describe("acceptPendingInvitationForEmail (ONE-144 multi-user IAM)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invitationUpdate.mockResolvedValue({});
    mocks.memberCreate.mockResolvedValue({});
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
  });

  it("returns null when there is no pending invitation (caller bootstraps own org as owner)", async () => {
    mocks.invitationFindFirst.mockResolvedValue(null);

    const result = await acceptPendingInvitationForEmail(EMAIL, USER_ID);

    expect(result).toBeNull();
    expect(mocks.memberCreate).not.toHaveBeenCalled();
    expect(mocks.invitationUpdate).not.toHaveBeenCalled();
  });

  it("creates a member row with the invited role and marks the invitation accepted", async () => {
    mocks.invitationFindFirst.mockResolvedValue({
      id: "inv-1",
      organizationId: ORG_ID,
      role: "member",
      expiresAt: new Date(Date.now() + 1000),
    });
    mocks.memberFindUnique.mockResolvedValue(null);

    const result = await acceptPendingInvitationForEmail(EMAIL, USER_ID);

    expect(result).toEqual({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    });
    expect(mocks.memberCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        userEmail: EMAIL,
        role: "member",
      },
    });
    expect(mocks.invitationUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "accepted" },
    });
  });

  it("honors the role the inviter chose (e.g. manager), not a hardcoded member", async () => {
    mocks.invitationFindFirst.mockResolvedValue({
      id: "inv-2",
      organizationId: ORG_ID,
      role: "manager",
      expiresAt: new Date(Date.now() + 1000),
    });
    mocks.memberFindUnique.mockResolvedValue(null);

    await acceptPendingInvitationForEmail(EMAIL, USER_ID);

    expect(mocks.memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "manager" }),
      }),
    );
  });

  it("does not create a duplicate membership if the user is already a member", async () => {
    mocks.invitationFindFirst.mockResolvedValue({
      id: "inv-3",
      organizationId: ORG_ID,
      role: "member",
      expiresAt: new Date(Date.now() + 1000),
    });
    // Already a member (e.g. re-invited after removal). Must NOT create a
    // second membership row, and must NOT silently change their role.
    mocks.memberFindUnique.mockResolvedValue({ role: "admin" });

    const result = await acceptPendingInvitationForEmail(EMAIL, USER_ID);

    expect(result).toEqual({ organizationId: ORG_ID, projectId: PROJECT_ID });
    expect(mocks.memberCreate).not.toHaveBeenCalled();
    expect(mocks.invitationUpdate).toHaveBeenCalledWith({
      where: { id: "inv-3" },
      data: { status: "accepted" },
    });
  });

  it("normalizes the email to lowercase before looking up the invitation", async () => {
    mocks.invitationFindFirst.mockResolvedValue(null);

    await acceptPendingInvitationForEmail(
      "Alex@Demo.OneComputer.Local",
      USER_ID,
    );

    expect(mocks.invitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: "alex@demo.onecomputer.local",
        }),
      }),
    );
  });
});
