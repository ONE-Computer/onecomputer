import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { IdentityContext, RuntimePolicy } from "@onecomputer/contracts";
import { AgentBridgeAuthority } from "../apps/control-api/src/agent-bridge.js";

const identity: IdentityContext = {
  tenantId: "acme",
  subjectId: "mike",
  audience: "onecomputer-control",
};

const runtimePolicy: RuntimePolicy = {
  schemaVersion: 1,
  policyVersionId: randomUUID(),
  policyHash: "a".repeat(64),
  workspaceProfile: "claude-desktop-v1",
  agentProfile: "onecomputer-default-agent",
  agentId: randomUUID(),
  modelAliases: ["onecomputer-assistant"],
  networkProfile: "controlled-egress-v1",
  mcpServer: "onecomputer_ms365",
  allowedTools: ["list-drives"],
  toolPolicies: { "list-drives": "allow" },
  capabilities: ["m365-read"],
  protectedOperations: {},
};

test("agent bridge grants are scoped and reject mutation", () => {
  const authority = new AgentBridgeAuthority("agent-bridge-test-secret-at-least-32-characters");
  const workspaceId = randomUUID();
  const token = authority.issue(identity, workspaceId, runtimePolicy);

  assert.deepEqual(authority.verify(token), {
    version: 1,
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    workspaceId,
    agentId: runtimePolicy.agentId,
    policyHash: runtimePolicy.policyHash,
  });

  const mutated = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.throws(() => authority.verify(mutated), /authentication is invalid/);
  assert.throws(() => authority.verify("not-a-grant"), /authentication is required/);
});
