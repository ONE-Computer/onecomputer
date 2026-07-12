import { describe, it, expect, vi, beforeEach } from "vitest";

// member-service hits the DB via @onecli/db and reads getSelfUrl() from the
// providers module. Mock both so we can assert the pure role-validation and
// last-owner-guard logic without a real database.
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationCreate: vi.fn(),
}));

vi.mock("@onecli/db", () => ({
  db: {
    organizationMember: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      count: mocks.count,
      update: mocks.update,
      delete: mocks.delete,
    },
    invitation: {
      findFirst: mocks.invitationFindFirst,
      create: mocks.invitationCreate,
    },
  },
}));

vi.mock("../providers", () => ({
  getSelfUrl: () => "http://localhost:10254",
}));

import { inviteMember, updateMemberRole, removeMember } from "./member-service";
import { ServiceError } from "./errors";

const ORG_ID = "org-1";

describe("member-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("inviteMember", () => {
    it("rejects inviting an owner when requester is not an owner", async () => {
      await expect(
        inviteMember(ORG_ID, "u1", "admin@example.com", "admin", {
          email: "new@example.com",
          role: "owner",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      } satisfies Partial<ServiceError>);
      expect(mocks.findFirst).not.toHaveBeenCalled();
    });

    it("allows an owner to invite another owner", async () => {
      mocks.findFirst.mockResolvedValueOnce(null); // existingMember
      mocks.invitationFindFirst.mockResolvedValueOnce(null); // existingInvitation
      mocks.invitationCreate.mockResolvedValueOnce({
        id: "inv-1",
        token: "tok",
        email: "new@example.com",
        role: "owner",
        expiresAt: new Date(),
      });

      const result = await inviteMember(
        ORG_ID,
        "u1",
        "owner@example.com",
        "owner",
        { email: "new@example.com", role: "owner" },
      );
      expect(result.invitationUrl).toContain("/invite/tok");
      expect(mocks.invitationCreate).toHaveBeenCalledTimes(1);
    });

    it("rejects when the email is already a member", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "existing" });
      await expect(
        inviteMember(ORG_ID, "u1", "admin@example.com", "admin", {
          email: "existing@example.com",
          role: "member",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects when an invitation is already pending", async () => {
      mocks.findFirst.mockResolvedValueOnce(null);
      mocks.invitationFindFirst.mockResolvedValueOnce({ id: "inv-existing" });
      await expect(
        inviteMember(ORG_ID, "u1", "admin@example.com", "admin", {
          email: "pending@example.com",
          role: "member",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("updateMemberRole", () => {
    it("rejects an admin promoting a member to owner", async () => {
      await expect(
        updateMemberRole(ORG_ID, "u2", "admin", { role: "owner" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.findFirst).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when the target member does not exist", async () => {
      mocks.findFirst.mockResolvedValueOnce(null);
      await expect(
        updateMemberRole(ORG_ID, "missing", "owner", { role: "admin" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("blocks demoting the last remaining owner", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u2", role: "owner" });
      mocks.count.mockResolvedValueOnce(1);
      await expect(
        updateMemberRole(ORG_ID, "u2", "owner", { role: "admin" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("allows demoting an owner when another owner remains", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u2", role: "owner" });
      mocks.count.mockResolvedValueOnce(2);
      mocks.update.mockResolvedValueOnce({});
      const result = await updateMemberRole(ORG_ID, "u2", "owner", {
        role: "admin",
      });
      expect(result).toEqual({ userId: "u2", role: "admin" });
      expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it("allows an owner to promote another member to owner", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u3", role: "member" });
      mocks.update.mockResolvedValueOnce({});
      const result = await updateMemberRole(ORG_ID, "u3", "owner", {
        role: "owner",
      });
      expect(result).toEqual({ userId: "u3", role: "owner" });
    });
  });

  describe("removeMember", () => {
    it("throws NOT_FOUND when the target member does not exist", async () => {
      mocks.findFirst.mockResolvedValueOnce(null);
      await expect(removeMember(ORG_ID, "missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("blocks removing the last remaining owner", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u1", role: "owner" });
      mocks.count.mockResolvedValueOnce(1);
      await expect(removeMember(ORG_ID, "u1")).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(mocks.delete).not.toHaveBeenCalled();
    });

    it("allows removing an owner when another owner remains", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u1", role: "owner" });
      mocks.count.mockResolvedValueOnce(2);
      mocks.delete.mockResolvedValueOnce({});
      await removeMember(ORG_ID, "u1");
      expect(mocks.delete).toHaveBeenCalledTimes(1);
    });

    it("allows removing a non-owner member without the owner-count check", async () => {
      mocks.findFirst.mockResolvedValueOnce({ userId: "u4", role: "member" });
      mocks.delete.mockResolvedValueOnce({});
      await removeMember(ORG_ID, "u4");
      expect(mocks.count).not.toHaveBeenCalled();
      expect(mocks.delete).toHaveBeenCalledTimes(1);
    });
  });
});
