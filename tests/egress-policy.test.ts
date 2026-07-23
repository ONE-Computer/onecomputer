import assert from "node:assert/strict";
import test from "node:test";
import {
  egressSecurityGroupVersionSchema,
  type EgressSecurityGroupVersion,
} from "@onecomputer/contracts";
import {
  compileEgressSecurityGroup,
  decideEgress,
  deriveEgressProxySecret,
  issueEgressProxyGrant,
  normalizeEgressHost,
  verifyEgressProxyGrant,
} from "@onecomputer/egress-policy";

const group = egressSecurityGroupVersionSchema.parse({
  schemaVersion: 1,
  id: "egv_acme_updates_v1",
  securityGroupId: "esg_acme_updates",
  tenantId: "acme",
  version: 1,
  name: "Approved agent updates",
  description: "Exact reviewed update destinations.",
  defaultAction: "deny",
  rules: [
    {
      id: "anthropic-downloads",
      action: "allow",
      protocol: "https",
      host: "downloads.claude.ai",
      includeSubdomains: false,
      port: 443,
      purpose: "Claude Desktop and Claude Code updates",
    },
    {
      id: "example-subdomains",
      action: "allow",
      protocol: "https",
      host: "updates.example.com",
      includeSubdomains: true,
      port: 443,
      purpose: "Qualification fixture",
    },
  ],
  documentHash: "a".repeat(64),
  createdBy: "admin-1",
  createdAt: "2026-07-23T04:30:00.000Z",
}) satisfies EgressSecurityGroupVersion;

test("egress host normalization is deterministic and rejects literals or wildcards", () => {
  assert.equal(normalizeEgressHost("DOWNLOADS.CLAUDE.AI."), "downloads.claude.ai");
  assert.equal(normalizeEgressHost("BÜCHER.example"), "xn--bcher-kva.example");
  assert.throws(() => normalizeEgressHost("127.0.0.1"), /IP literal/i);
  assert.throws(() => normalizeEgressHost("[::1]"), /IP literal/i);
  assert.throws(() => normalizeEgressHost("*.example.com"), /wildcard/i);
  assert.equal(normalizeEgressHost("example.com.evil.test."), "example.com.evil.test");
});

test("security groups compile to exact, deny-by-default rules", () => {
  const compiled = compileEgressSecurityGroup(group);
  assert.equal(compiled.defaultAction, "deny");
  assert.deepEqual(compiled.rules.map((rule) => rule.host), [
    "downloads.claude.ai",
    "updates.example.com",
  ]);
  assert.equal(compiled.documentHash, group.documentHash);
});

test("egress decisions match exact hosts and explicit subdomains without hostile suffixes", () => {
  const compiled = compileEgressSecurityGroup(group);
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "downloads.claude.ai",
    port: 443,
    resolvedAddresses: ["104.18.0.1"],
  }).reasonCode, "EGRESS_ALLOWED");
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "cdn.updates.example.com",
    port: 443,
    resolvedAddresses: ["104.18.0.2"],
  }).reasonCode, "EGRESS_ALLOWED");
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "downloads.claude.ai.evil.test",
    port: 443,
    resolvedAddresses: ["104.18.0.3"],
  }).reasonCode, "EGRESS_DEFAULT_DENY");
});

test("egress decisions reject raw IPs, reserved resolutions, protocol changes, and alternate ports", () => {
  const compiled = compileEgressSecurityGroup(group);
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "104.18.0.1",
    port: 443,
    resolvedAddresses: ["104.18.0.1"],
  }).reasonCode, "EGRESS_IP_LITERAL_DENIED");
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "downloads.claude.ai",
    port: 443,
    resolvedAddresses: ["169.254.169.254"],
  }).reasonCode, "EGRESS_DESTINATION_RESERVED");
  assert.equal(decideEgress(compiled, {
    protocol: "http",
    host: "downloads.claude.ai",
    port: 443,
    resolvedAddresses: ["104.18.0.1"],
  }).reasonCode, "EGRESS_DEFAULT_DENY");
  assert.equal(decideEgress(compiled, {
    protocol: "https",
    host: "downloads.claude.ai",
    port: 8443,
    resolvedAddresses: ["104.18.0.1"],
  }).reasonCode, "EGRESS_DEFAULT_DENY");
});

test("egress proxy grants are scoped, signed, expiring, and cannot cross workspace boundaries", () => {
  const expected = {
    tenantId: "acme",
    subjectId: "alex",
    workspaceId: "workspace-a",
    agentId: "agent-a",
    securityGroupVersionId: group.id,
    policyHash: "b".repeat(64),
  };
  const now = new Date("2026-07-23T04:00:00.000Z");
  const secret = deriveEgressProxySecret("root-secret-with-at-least-thirty-two-characters", expected.workspaceId);
  const token = issueEgressProxyGrant(secret, expected, now, 60);
  assert.equal(verifyEgressProxyGrant(token, secret, expected, now)?.workspaceId, "workspace-a");
  assert.equal(verifyEgressProxyGrant(`${token}tampered`, secret, expected, now), null);
  assert.equal(verifyEgressProxyGrant(token, secret, { ...expected, workspaceId: "workspace-b" }, now), null);
  assert.equal(verifyEgressProxyGrant(token, secret, { ...expected, tenantId: "other" }, now), null);
  assert.equal(verifyEgressProxyGrant(token, secret, { ...expected, agentId: "agent-b" }, now), null);
  assert.equal(verifyEgressProxyGrant(token, secret, expected, new Date("2026-07-23T04:01:01.000Z")), null);
});
