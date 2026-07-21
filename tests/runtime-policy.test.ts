import assert from "node:assert/strict";
import test from "node:test";
import { runtimePolicyFor, type EffectivePolicy } from "@onecomputer/workspace-store";

test("effective policy projects to the one approved workspace runtime", () => {
  const effective: EffectivePolicy = {
    assignmentId: "assignment-1",
    policyBundleId: "bundle-1",
    policyVersionId: "version-1",
    version: 1,
    documentHash: "c".repeat(64),
    assignedBy: "admin-1",
    assignedAt: "2026-07-20T00:00:00.000Z",
    agentId: "agent-1",
    workspaceIdentityId: "workspace-identity-1",
    workspaceId: null,
    vendorUserId: "oc-user-1",
    document: {
      schemaVersion: 1,
      workspaceProfile: "kasm-persistent-standard",
      agentProfile: "onecomputer-default-agent",
      modelAliases: ["onecomputer-assistant"],
      networkProfile: "controlled-egress-v1",
      mcp: { servers: { onecomputer_ms365: { tools: ["list-mail-folders", "list-calendars", "list-drives", "search-onedrive-files", "get-drive-item", "delete-onedrive-file"] } } },
    },
  };
  assert.deepEqual(runtimePolicyFor(effective), {
    schemaVersion: 1,
    policyVersionId: "version-1",
    policyVersion: 1,
    policyHash: "c".repeat(64),
    workspaceProfile: "kasm-persistent-standard",
    agentId: "agent-1",
    agentProfile: "onecomputer-default-agent",
    networkProfile: "controlled-egress-v1",
    modelAlias: "onecomputer-assistant",
    mcpServer: "onecomputer_ms365",
    allowedTools: ["list-mail-folders", "list-calendars", "list-drives", "search-onedrive-files", "get-drive-item", "delete-onedrive-file"],
    toolPolicies: {
      "list-mail-folders": "allow",
      "list-calendars": "allow",
      "list-drives": "allow",
      "search-onedrive-files": "allow",
      "get-drive-item": "allow",
      "delete-onedrive-file": "approval_required",
    },
  });
});

test("an assigned sandbox selection can narrow a multi-model policy but cannot broaden it", () => {
  const effective: EffectivePolicy = {
    assignmentId: "assignment-2", policyBundleId: "bundle-1", policyVersionId: "version-2", version: 2,
    documentHash: "d".repeat(64), assignedBy: "admin-1", assignedAt: "2026-07-21T00:00:00.000Z",
    agentId: "agent-1", workspaceIdentityId: "workspace-identity-1", workspaceId: null, vendorUserId: "oc-user-1",
    document: {
      schemaVersion: 1,
      workspaceProfile: "claude-desktop-standard-v1",
      workspaceProfiles: ["claude-desktop-standard-v1"],
      agentProfile: "claude-desktop-managed-v1",
      modelAliases: ["onecomputer-claude", "onecomputer-openai", "onecomputer-glm"],
      networkProfile: "controlled-egress-v1",
      mcp: { servers: { onecomputer_ms365: { tools: ["list-mail-folders"] } } },
    },
  };
  const selected = runtimePolicyFor(effective, "onecomputer-glm", "claude-desktop-standard-v1");
  assert.equal(selected.modelAlias, "onecomputer-glm");
  assert.equal(selected.workspaceProfile, "claude-desktop-standard-v1");
  assert.throws(() => runtimePolicyFor(effective, "unassigned-model", "claude-desktop-standard-v1"), /not assigned/);
});
