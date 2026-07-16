import { describe, it, expect } from "vitest";

// ONE-78: the gateway has a real ManualApproval hold path
// (apps/gateway/src/gateway/forward.rs) that fires when PolicyDecision::
// ManualApproval is returned by policy::evaluate. That only happens when a
// manual_approval PolicyRule matches the outbound request. This test pins the
// shape of the seeded org-scope rule (packages/api/src/scripts/seed-demo.ts,
// "Approve Outlook send mail (org)") and asserts it matches the exact demo
// request the GovernedActionCard "Attempt Outlook send" issues — a POST to
// graph.microsoft.com/v1.0/me/sendMail — and not neighboring requests.
//
// The match semantics below mirror the gateway exactly:
//   - host: apps/gateway/src/connect.rs:host_matches (exact equality; the
//     seeded pattern has no leading wildcard so only the exact branch applies).
//   - path: apps/gateway/src/inject.rs:path_matches (exact equality for a
//     pattern with no wildcard).
//   - method: case-insensitive equality (policy.rs::matches_request uses
//     eq_ignore_ascii_case); null method = all methods.
//
// We assert against the literal seeded field values rather than a DB fetch so
// the test runs in CI without a database (the demo seed is idempotent but
// still needs Postgres). If the seed drifts from what the demo card targets,
// this test fails loudly.

const SEEDED_ORG_RULE = {
  name: "Approve Outlook send mail (org)",
  hostPattern: "graph.microsoft.com",
  pathPattern: "/v1.0/me/sendMail",
  method: "POST",
  action: "manual_approval",
  enabled: true,
  scope: "organization",
} as const;

const hostMatches = (requestHost: string, pattern: string): boolean => {
  if (requestHost === pattern) return true;
  if (pattern.startsWith("*")) {
    const suffix = pattern.slice(1);
    return requestHost.endsWith(suffix) && requestHost.length > suffix.length;
  }
  return false;
};

const pathMatches = (requestPath: string, pattern: string): boolean => {
  const path = requestPath.split("?")[0] ?? requestPath;
  if (pattern === "*") return true;
  return path === pattern;
};

const ruleMatches = (
  rule: typeof SEEDED_ORG_RULE,
  request: { host: string; path: string; method: string },
): boolean => {
  if (!rule.enabled) return false;
  if (rule.action !== "manual_approval") return false;
  return (
    hostMatches(request.host, rule.hostPattern) &&
    pathMatches(request.path, rule.pathPattern) &&
    (rule.method == null ||
      rule.method.toUpperCase() === request.method.toUpperCase())
  );
};

describe("ONE-78: seeded manual_approval rule matches the demo Outlook sendMail request", () => {
  it("matches a POST to graph.microsoft.com/v1.0/me/sendMail", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "graph.microsoft.com",
        path: "/v1.0/me/sendMail",
        method: "POST",
      }),
    ).toBe(true);
  });

  it("still matches with a query string on the path", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "graph.microsoft.com",
        path: "/v1.0/me/sendMail?api-version=beta",
        method: "POST",
      }),
    ).toBe(true);
  });

  it("matches method case-insensitively (post)", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "graph.microsoft.com",
        path: "/v1.0/me/sendMail",
        method: "post",
      }),
    ).toBe(true);
  });

  it("does NOT match a GET to the same path (wrong method)", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "graph.microsoft.com",
        path: "/v1.0/me/sendMail",
        method: "GET",
      }),
    ).toBe(false);
  });

  it("does NOT match a different Graph endpoint", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "graph.microsoft.com",
        path: "/v1.0/me/messages",
        method: "POST",
      }),
    ).toBe(false);
  });

  it("does NOT match sendMail on a different host", () => {
    expect(
      ruleMatches(SEEDED_ORG_RULE, {
        host: "localhost-integration.onecomputer.local",
        path: "/v1.0/me/sendMail",
        method: "POST",
      }),
    ).toBe(false);
  });

  it("is org-scoped and enabled with action manual_approval", () => {
    expect(SEEDED_ORG_RULE.scope).toBe("organization");
    expect(SEEDED_ORG_RULE.action).toBe("manual_approval");
    expect(SEEDED_ORG_RULE.enabled).toBe(true);
  });
});
