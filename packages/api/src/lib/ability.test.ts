import { describe, it, expect } from "vitest";
import { defineAbilityFor, subject } from "./ability";

describe("RBAC ability", () => {
  const orgId = "org-1";

  describe("owner", () => {
    const ability = defineAbilityFor({ id: "u1", orgId, role: "owner" });
    it("can manage all", () => expect(ability.can("manage", "all")).toBe(true));
    it("can delete PolicyRule", () =>
      expect(ability.can("delete", "PolicyRule")).toBe(true));
  });

  describe("admin (Cyber persona)", () => {
    const ability = defineAbilityFor({ id: "u2", orgId, role: "admin" });
    it("can read all agents", () =>
      expect(ability.can("read", "Agent")).toBe(true));
    it("can delete policy rules", () =>
      expect(ability.can("delete", "PolicyRule")).toBe(true));
    it("can revoke secrets", () =>
      expect(ability.can("revoke", "Secret")).toBe(true));
  });

  describe("manager", () => {
    const ability = defineAbilityFor({ id: "u3", orgId, role: "manager" });
    it("can read agents", () =>
      expect(ability.can("read", "Agent")).toBe(true));
    it("can approve ApprovalRequest", () =>
      expect(ability.can("approve", "ApprovalRequest")).toBe(true));
    it("CANNOT delete PolicyRule", () =>
      expect(ability.can("delete", "PolicyRule")).toBe(false));
    it("CANNOT manage Organization", () =>
      expect(ability.can("manage", "Organization")).toBe(false));
  });

  describe("member (Employee persona)", () => {
    const userId = "u4";
    const ability = defineAbilityFor({ id: userId, orgId, role: "member" });
    it("can execute own agent", () => {
      const myAgent = { ownerId: userId, id: "a1" };
      expect(ability.can("execute", subject("Agent", myAgent))).toBe(true);
    });
    it("CANNOT execute other's agent", () => {
      const otherAgent = { ownerId: "other", id: "a2" };
      expect(ability.can("execute", subject("Agent", otherAgent))).toBe(false);
    });
    it("CANNOT approve ApprovalRequest", () => {
      expect(ability.can("approve", "ApprovalRequest")).toBe(false);
    });
    it("CANNOT delete PolicyRule", () => {
      expect(ability.can("delete", "PolicyRule")).toBe(false);
    });
    it("can read own sandbox", () => {
      expect(
        ability.can("read", subject("Sandbox", { ownerId: userId, id: "s1" })),
      ).toBe(true);
    });
    it("CANNOT read another member's sandbox", () => {
      expect(
        ability.can("read", subject("Sandbox", { ownerId: "other", id: "s2" })),
      ).toBe(false);
    });
    it("can delete own sandbox", () => {
      expect(
        ability.can(
          "delete",
          subject("Sandbox", { ownerId: userId, id: "s1" }),
        ),
      ).toBe(true);
    });
    it("CANNOT delete another member's sandbox", () => {
      expect(
        ability.can(
          "delete",
          subject("Sandbox", { ownerId: "other", id: "s2" }),
        ),
      ).toBe(false);
    });
    it("can create sandboxes", () => {
      expect(ability.can("create", "Sandbox")).toBe(true);
    });
  });

  describe("manager sandbox scope", () => {
    const ability = defineAbilityFor({ id: "u5", orgId, role: "manager" });
    it("can read any sandbox in the org", () => {
      expect(
        ability.can("read", subject("Sandbox", { ownerId: "other", id: "s3" })),
      ).toBe(true);
    });
    it("CANNOT delete sandboxes (no delete grant)", () => {
      expect(
        ability.can(
          "delete",
          subject("Sandbox", { ownerId: "other", id: "s3" }),
        ),
      ).toBe(false);
    });
  });
});
