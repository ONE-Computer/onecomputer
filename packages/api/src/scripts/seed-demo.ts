/**
 * Idempotent demo-data seed for local/manual QA and CEO-style demos.
 *
 * Creates a namespaced "Demo Corp" organization with a stable well-known id,
 * four members spanning every OrgRole, a "Field Sales Team" project (the
 * "Team" concept per phase-17 project-as-team), enterprise/team/user-scoped
 * policy rules, and one agent for the demo member.
 *
 * Safe to run repeatedly — every step upserts/looks-up-before-create against
 * the stable Demo Corp id, so re-running never duplicates rows and never
 * touches real orgs.
 *
 * Deliberately goes through the same services the HTTP routes use
 * (member/agent/policy-rule/organization) rather than raw `db.*.create`, so
 * seeded rows pick up the same defaults, validation, and audit-relevant
 * shape as data created through the product.
 *
 * Run: pnpm --filter @onecli/api seed:demo
 *
 * Reset mode: set SEED_DEMO_RESET=1 to delete every row that belongs to the
 * Demo Corp namespace (by the stable ids below) BEFORE reseeding, giving a
 * clean-slate "Reset demo data" without ever touching a non-demo org. The
 * flag is a deliberate guard — running `seed:demo` on its own is always a
 * safe idempotent upsert; only the explicit reset flag deletes anything, and
 * the delete is hard-scoped to DEMO_ORG_ID/DEMO_PROJECT_ID/DEMO_USERS'
 * externalAuthIds, never a broad `deleteMany({})`.
 */
import { db } from "@onecli/db";
import { createAgent } from "../services/agent-service";
import { createPolicyRule } from "../services/policy-rule-service";
import { createApproval } from "../services/approval-service";
import type { ResourceScope } from "../services/resource-scope";

// Stable, well-known ids so re-seeding (or a future `seed:reset`) only ever
// touches this org's data. Not real UUIDs on purpose — instantly recognizable
// in logs/DB browsers as demo data, and Prisma's `id String @id` accepts any
// string.
const DEMO_ORG_ID = "demo-corp-org";
const DEMO_PROJECT_ID = "demo-corp-team-field-sales";
const DEMO_ORG_SLUG = "demo-corp";
const DEMO_PROJECT_SLUG = "field-sales-team";

interface DemoUserSpec {
  externalAuthId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "manager" | "member";
}

const DEMO_USERS: DemoUserSpec[] = [
  {
    externalAuthId: "demo-owner",
    email: "owner@demo.onecomputer.local",
    name: "Olivia Owner",
    role: "owner",
  },
  {
    externalAuthId: "demo-cyber",
    email: "cyber@demo.onecomputer.local",
    name: "Casey Cyber",
    role: "admin",
  },
  {
    externalAuthId: "demo-manager",
    email: "manager@demo.onecomputer.local",
    name: "Morgan Manager",
    role: "manager",
  },
  {
    externalAuthId: "demo-alex",
    email: "alex@demo.onecomputer.local",
    name: "Alex Employee",
    role: "member",
  },
];

// These are the real Entra test accounts documented for the hosted demo.
// Pre-provisioning them by email is intentional: on first SSO login the session
// synchronizer replaces the placeholder externalAuthId with Entra's immutable
// subject, while preserving their Demo Corp membership and role.
const ENTRA_DEMO_USERS: DemoUserSpec[] = [
  {
    externalAuthId: "entra-preprovisioned-owner",
    email: "terencetan@giniresearch.onmicrosoft.com",
    name: "Terence Tan",
    role: "owner",
  },
  {
    externalAuthId: "entra-preprovisioned-admin",
    email: "demo.admin@giniresearch.onmicrosoft.com",
    name: "Demo Admin",
    role: "admin",
  },
  {
    externalAuthId: "entra-preprovisioned-manager",
    email: "demo.manager@giniresearch.onmicrosoft.com",
    name: "Demo Manager",
    role: "manager",
  },
  {
    externalAuthId: "entra-preprovisioned-member",
    email: "demo.member@giniresearch.onmicrosoft.com",
    name: "Demo Member",
    role: "member",
  },
];

const log = (msg: string, extra?: Record<string, unknown>) => {
  console.log(`[seed-demo] ${msg}`, extra ? JSON.stringify(extra) : "");
};

/** Upsert a demo User row keyed by externalAuthId (same pattern as ensureLocalUser). */
const upsertDemoUser = async (spec: DemoUserSpec) => {
  const user = await db.user.upsert({
    where: { externalAuthId: spec.externalAuthId },
    create: {
      externalAuthId: spec.externalAuthId,
      email: spec.email,
      name: spec.name,
    },
    update: { email: spec.email, name: spec.name },
    select: { id: true, email: true, name: true },
  });
  return user;
};

const ensureEntraDemoUser = async (spec: DemoUserSpec) => {
  const existing = await db.user.findUnique({
    where: { email: spec.email },
    select: { id: true, email: true, name: true },
  });
  if (existing) return existing;

  return db.user.create({
    data: {
      externalAuthId: spec.externalAuthId,
      email: spec.email,
      name: spec.name,
    },
    select: { id: true, email: true, name: true },
  });
};

/** Upsert the Demo Corp organization at a stable id. */
const upsertDemoOrg = async () => {
  const org = await db.organization.upsert({
    where: { id: DEMO_ORG_ID },
    create: {
      id: DEMO_ORG_ID,
      name: "Demo Corp",
      slug: DEMO_ORG_SLUG,
    },
    update: { name: "Demo Corp" },
    select: { id: true, slug: true },
  });
  return org;
};

/**
 * Ensure a user is a member of the org with the given role. There is no
 * dedicated "addMember" in member-service (it's invite-token based, which
 * doesn't fit a synchronous local seed), so this mirrors the minimal-safe
 * direct upsert bootstrapOrganization itself uses for the first member —
 * same shape, same required fields, no audit bypass since org membership
 * rows aren't audited on creation elsewhere either.
 */
const ensureMember = async (
  organizationId: string,
  userId: string,
  userEmail: string,
  role: DemoUserSpec["role"],
) => {
  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, userEmail, role },
    update: { role, userEmail },
  });
};

/** Ensure the "Field Sales Team" project exists at a stable id (Team = Project, phase-17). */
const upsertDemoProject = async (
  organizationId: string,
  createdByUserId: string,
  createdByUserEmail: string,
) => {
  const project = await db.project.upsert({
    where: { id: DEMO_PROJECT_ID },
    create: {
      id: DEMO_PROJECT_ID,
      name: "Field Sales Team",
      slug: DEMO_PROJECT_SLUG,
      organizationId,
      createdByUserId,
      createdByUserEmail,
    },
    update: { name: "Field Sales Team" },
    select: { id: true, organizationId: true },
  });
  return project;
};

/**
 * createPolicyRule has no upsert — it's a plain create. Make the seed
 * idempotent by checking for an existing rule with the same
 * scope/hostPattern/pathPattern/method/action before creating.
 */
const ensurePolicyRule = async (
  scope: ResourceScope,
  input: Parameters<typeof createPolicyRule>[1],
) => {
  const where = scope.organizationId
    ? { organizationId: scope.organizationId, scope: "organization" as const }
    : { projectId: scope.projectId!, scope: "project" as const };

  const existing = await db.policyRule.findFirst({
    where: {
      ...where,
      hostPattern: input.hostPattern,
      pathPattern: input.pathPattern ?? null,
      method: input.method ?? null,
      action: input.action,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    },
    select: { id: true, name: true },
  });
  if (existing) {
    log(`policy rule already exists, skipping: ${existing.name}`, {
      ruleId: existing.id,
    });
    return existing;
  }

  const created = await createPolicyRule(scope, input);
  log(`created policy rule: ${created.name}`, { ruleId: created.id });
  return created;
};

// ─── Story events (Agent 19-B) ─────────────────────────────────────────────
//
// The demo narrates three concrete "moments" beyond the static org/policy
// setup above. Each is seeded idempotently against a stable marker so
// re-running never duplicates rows:
//   1. A blocked RequestLog row (npm install attempt) -> Cyber console
//      violations feed + /audit timeline "gateway" event.
//   2. A PENDING ApprovalRequest for alex@demo's agent trying to send an
//      Outlook email, created through approval-service so it carries a real
//      context._vti.stepUpRequest (manager) and context._vti.actorStepUp
//      (actor, phase-15a). Populates /approvals, /device/approvals/:id, and
//      the audit timeline "approval" event.
//   3. Sandbox: there is NO Sandbox Prisma model — Daytona sandboxes are
//      entirely live, unpersisted (see packages/api/src/services/
//      daytona-service.ts: SandboxInfo is fetched from the Daytona API, never
//      written to Postgres). Faking a "running" sandbox row would contradict
//      AUDIT.md's own rule against pretend state, so this seed deliberately
//      SKIPS sandbox seeding and logs why instead of writing a placeholder
//      that nothing reads.

const STORY_BLOCKED_LOG_MARKER = "seed-demo:blocked-npm-install";

/**
 * Seed the blocked-install RequestLog the Cyber console violations feed and
 * /audit timeline narrate. RequestLog has no dedicated service (the gateway
 * writes it directly in production), so this mirrors the exact extraData
 * shape the gateway writes for a rule-blocked request (see
 * routes/console-live.ts and services/request-log-service.ts:
 * decision: "blocked" + blocked_by_rule). Idempotent via a marker field
 * inside extraData rather than a fixed row id, since RequestLog's id is a
 * bare `@default(uuid())` with no natural business key.
 */
const ensureBlockedInstallRequestLog = async (
  projectId: string,
  agentId: string,
  blockedByRuleName: string,
) => {
  const existing = await db.requestLog.findFirst({
    where: {
      projectId,
      agentId,
      extraData: { path: ["seedMarker"], equals: STORY_BLOCKED_LOG_MARKER },
    },
    select: { id: true },
  });
  if (existing) {
    log("blocked install RequestLog already exists, skipping", {
      id: existing.id,
    });
    return existing;
  }

  const created = await db.requestLog.create({
    data: {
      projectId,
      agentId,
      method: "GET",
      host: "registry.npmjs.org",
      path: "/left-pad",
      provider: "npm",
      status: 403,
      latencyMs: 4,
      injectionCount: 0,
      // Timestamped "now" (not backdated) so it always falls inside the
      // console's rolling 24h violations window.
      createdAt: new Date(),
      extraData: {
        decision: "blocked",
        blocked_by_rule: blockedByRuleName,
        seedMarker: STORY_BLOCKED_LOG_MARKER,
      },
    },
    select: { id: true, host: true, path: true },
  });
  log("created blocked install RequestLog", created);
  return created;
};

const STORY_APPROVAL_MARKER = "seed-demo:alex-outlook-send";

/**
 * Seed the pending Outlook-send ApprovalRequest for alex@demo's agent, via
 * approval-service.createApproval (not a raw insert) so it goes through the
 * exact same VTI step-up bridging every real approval gets: a manager-facing
 * `context._vti.stepUpRequest` envelope and an actor-facing
 * `context._vti.actorStepUp` envelope (phase-15a), both built by
 * vti-consent-service. Idempotent by looking for an existing pending/any
 * approval with the seed marker in its context before creating.
 */
const ensureAlexOutlookApproval = async (
  organizationId: string,
  projectId: string,
  agentId: string,
  alexUserId: string,
) => {
  const existing = await db.approvalRequest.findFirst({
    where: {
      organizationId,
      projectId,
      context: { path: ["seedMarker"], equals: STORY_APPROVAL_MARKER },
    },
    select: { id: true, status: true },
  });
  if (existing) {
    log("alex@demo Outlook approval already exists, skipping", existing);
    return existing;
  }

  const created = await createApproval({
    organizationId,
    projectId,
    agentId,
    input: {
      action: "outlook.send_email",
      requestedBy: alexUserId,
      agentId,
      projectId,
      context: {
        seedMarker: STORY_APPROVAL_MARKER,
        recipient: "board@demo-corp.example",
        subject: "Q3 pipeline forecast — draft for review",
        preview:
          "Attaching the draft Q3 pipeline forecast ahead of Thursday's board sync...",
      },
    },
  });
  log("created pending Outlook-send approval for alex@demo", {
    id: created.id,
    status: created.status,
    hasStepUpRequest: Boolean(
      (created.context as { _vti?: { stepUpRequest?: unknown } } | null)?._vti
        ?.stepUpRequest,
    ),
    hasActorStepUp: Boolean(
      (created.context as { _vti?: { actorStepUp?: unknown } } | null)?._vti
        ?.actorStepUp,
    ),
  });
  return created;
};

/**
 * Delete every row that belongs to the Demo Corp namespace, scoped strictly
 * to DEMO_ORG_ID / DEMO_PROJECT_ID / the four demo externalAuthIds. Never
 * touches any other org, project, or user.
 *
 * Deletion order respects FK dependencies (children before parents):
 * AuditLog/RequestLog/ApprovalRequest/PolicyRule/Agent -> OrganizationMember
 * -> Project -> demo Users -> Organization. Uses deleteMany with explicit
 * org/project id filters throughout — there is no unscoped `deleteMany({})`
 * anywhere in this function.
 */
export async function resetDemoNamespace() {
  log("Resetting Demo Corp namespace...");

  const demoExternalAuthIds = DEMO_USERS.map((u) => u.externalAuthId);
  const demoUsers = await db.user.findMany({
    where: { externalAuthId: { in: demoExternalAuthIds } },
    select: { id: true },
  });
  const demoUserIds = demoUsers.map((u) => u.id);

  // Audit logs written against the demo org/project (e.g. approval decisions
  // made during a prior demo run).
  const auditResult = await db.auditLog.deleteMany({
    where: {
      OR: [{ organizationId: DEMO_ORG_ID }, { projectId: DEMO_PROJECT_ID }],
    },
  });

  // Gateway decision logs (blocked-install story event) scoped to the demo project.
  const requestLogResult = await db.requestLog.deleteMany({
    where: { projectId: DEMO_PROJECT_ID },
  });

  // Approval requests (pending Outlook-send story event) scoped to the demo org.
  const approvalResult = await db.approvalRequest.deleteMany({
    where: { organizationId: DEMO_ORG_ID },
  });

  // Policy rules at every scope this seed creates: organization-scoped,
  // project-scoped, and agent-scoped (agent-scoped rules are also
  // project-scoped, so this filter covers all three).
  const policyResult = await db.policyRule.deleteMany({
    where: {
      OR: [{ organizationId: DEMO_ORG_ID }, { projectId: DEMO_PROJECT_ID }],
    },
  });

  // Agents belong to the demo project only.
  const agentResult = await db.agent.deleteMany({
    where: { projectId: DEMO_PROJECT_ID },
  });

  // Org membership rows for the demo org.
  const memberResult = await db.organizationMember.deleteMany({
    where: { organizationId: DEMO_ORG_ID },
  });

  // The "Field Sales Team" project.
  const projectResult = await db.project.deleteMany({
    where: { id: DEMO_PROJECT_ID },
  });

  // The four demo users, matched only by their well-known externalAuthId —
  // never a broader match on email/name that could catch a real user.
  const userResult = await db.user.deleteMany({
    where: { externalAuthId: { in: demoExternalAuthIds } },
  });

  // The Demo Corp organization itself.
  const orgResult = await db.organization.deleteMany({
    where: { id: DEMO_ORG_ID },
  });

  const summary = {
    auditLogsDeleted: auditResult.count,
    requestLogsDeleted: requestLogResult.count,
    approvalsDeleted: approvalResult.count,
    policyRulesDeleted: policyResult.count,
    agentsDeleted: agentResult.count,
    membersDeleted: memberResult.count,
    projectsDeleted: projectResult.count,
    usersDeleted: userResult.count,
    orgsDeleted: orgResult.count,
    demoUserIds,
  };
  log("Demo Corp namespace reset complete.", summary);
  return summary;
}

/**
 * Idempotently seed the Demo Corp namespace (org, users, project, policies,
 * agent, story events). Safe to call repeatedly. Callable both from the CLI
 * entrypoint below and from the guarded internal HTTP reset route.
 */
export async function runDemoSeed() {
  log("Seeding Demo Corp...");

  // 1. Organization
  const org = await upsertDemoOrg();
  log("organization ready", { id: org.id, slug: org.slug });

  // 2. Users + OrganizationMembers
  const usersByRole = new Map<
    DemoUserSpec["role"],
    { id: string; email: string; name: string | null }
  >();
  for (const spec of DEMO_USERS) {
    const user = await upsertDemoUser(spec);
    await ensureMember(org.id, user.id, spec.email, spec.role);
    usersByRole.set(spec.role, user);
    log(`member ready: ${spec.role}`, { userId: user.id, email: user.email });
  }

  for (const spec of ENTRA_DEMO_USERS) {
    const user = await ensureEntraDemoUser(spec);
    await ensureMember(org.id, user.id, spec.email, spec.role);
    log(`Entra member ready: ${spec.role}`, {
      userId: user.id,
      email: user.email,
    });
  }

  const owner = usersByRole.get("owner")!;
  const alex = usersByRole.get("member")!;

  // 3. Project ("Field Sales Team" = the Team, per phase-17 project-as-team)
  const project = await upsertDemoProject(org.id, owner.id, owner.email);
  log("project ready", { id: project.id });

  // 4a. Enterprise (org scope): block direct public npm/pypi registries.
  const orgScope: ResourceScope = { organizationId: org.id };
  await ensurePolicyRule(orgScope, {
    name: "Block public npm registry",
    hostPattern: "registry.npmjs.org",
    action: "block",
    enabled: true,
  });
  await ensurePolicyRule(orgScope, {
    name: "Block public PyPI",
    hostPattern: "pypi.org",
    action: "block",
    enabled: true,
  });

  // 4a-org-approval: Enterprise (org scope) manual approval for Outlook
  // sendMail. The gateway's PolicyDecision::ManualApproval hold path
  // (apps/gateway/src/gateway/forward.rs) is dormant without a matching
  // manual_approval rule, so the demo "Attempt Outlook send" card never
  // triggers a hold -> ApprovalRequest -> poll -> decide -> release chain.
  // Org scope guarantees the hold fires for every project/agent in Demo
  // Corp; the project-scoped rule below is a redundant belt-and-suspenders
  // match. Strictest-wins merge keeps both consistent (ManualApproval is
  // ManualApproval). See ONE-78.
  await ensurePolicyRule(orgScope, {
    name: "Approve Outlook send mail (org)",
    hostPattern: "graph.microsoft.com",
    pathPattern: "/v1.0/me/sendMail",
    method: "POST",
    action: "manual_approval",
    enabled: true,
  });

  // App-only Graph Mail.Send addresses the sender explicitly because `/me`
  // is unavailable to client-credentials tokens.
  await ensurePolicyRule(orgScope, {
    name: "Approve Outlook application send mail (org)",
    hostPattern: "graph.microsoft.com",
    pathPattern: "/v1.0/users/*/sendMail",
    method: "POST",
    action: "manual_approval",
    enabled: true,
  });

  // 4b. Team (project scope): manual approval required for Outlook send.
  const projectScope: ResourceScope = { projectId: project.id };
  await ensurePolicyRule(projectScope, {
    name: "Approve Outlook send mail",
    hostPattern: "graph.microsoft.com",
    pathPattern: "/v1.0/me/sendMail",
    method: "POST",
    action: "manual_approval",
    enabled: true,
  });

  // 5. Agent for alex@demo (agent-service mints token + DID).
  const existingAgent = await db.agent.findFirst({
    where: { projectId: project.id, identifier: "alex-agent" },
    select: { id: true, name: true, accessToken: true, did: true },
  });

  const alexAgent =
    existingAgent ??
    (await createAgent(project.id, "Alex's Agent", "alex-agent"));

  if (existingAgent) {
    log("agent already exists, skipping creation", {
      agentId: existingAgent.id,
    });
  } else {
    log("created agent for alex@demo", {
      agentId: alexAgent.id,
      did: "did" in alexAgent ? alexAgent.did : undefined,
    });
  }

  // 4c. User (agent scope): rate-limit example scoped to alex's agent.
  await ensurePolicyRule(projectScope, {
    name: "Rate limit alex's agent — Slack posts",
    hostPattern: "slack.com",
    pathPattern: "/api/chat.postMessage",
    method: "POST",
    action: "rate_limit",
    enabled: true,
    agentId: alexAgent.id,
    rateLimit: 20,
    rateLimitWindow: "hour",
  });

  // 6a. Story event: blocked public-registry install (Cyber console
  // violations feed + /audit timeline "gateway" event).
  const blockedLog = await ensureBlockedInstallRequestLog(
    project.id,
    alexAgent.id,
    "Block public npm registry",
  );

  // 6b. Story event: PENDING Outlook-send approval for alex@demo's agent,
  // created through approval-service (real _vti.stepUpRequest +
  // _vti.actorStepUp). Populates /approvals, /device/approvals/:id, and the
  // audit timeline "approval" event.
  const alexApproval = await ensureAlexOutlookApproval(
    org.id,
    project.id,
    alexAgent.id,
    alex.id,
  );

  // 6c. Story event: sandbox. Deliberately skipped — see the comment above
  // ensureBlockedInstallRequestLog. There is no Sandbox Prisma model;
  // Daytona sandboxes are live-only (services/daytona-service.ts fetches
  // from the Daytona API, nothing persists to Postgres), so there is no row
  // to seed without inventing fake "running" state that nothing in the
  // product actually reads back.
  log(
    "sandbox seeding SKIPPED — no Sandbox Prisma model exists; Daytona sandboxes are live-only (services/daytona-service.ts), not persisted. Seeding a fake row would misrepresent state nothing reads.",
  );

  const summary = {
    organizationId: org.id,
    projectId: project.id,
    users: DEMO_USERS.map((u) => ({ role: u.role, email: u.email })),
    agentId: alexAgent.id,
    blockedRequestLogId: blockedLog.id,
    alexApprovalId: alexApproval.id,
  };
  log("Demo Corp seed complete.", summary);
  return summary;
}

/**
 * CLI entrypoint. Only runs main()+process.exit when this file is executed
 * directly (`tsx src/scripts/seed-demo.ts`), not when `runDemoSeed` /
 * `resetDemoNamespace` are imported by the internal HTTP route — importing
 * this module must never have the side effect of seeding/exiting the process.
 */
async function main() {
  if (process.env.SEED_DEMO_RESET === "1") {
    await resetDemoNamespace();
  }
  await runDemoSeed();
}

const isMainModule =
  process.argv[1]?.endsWith("seed-demo.ts") ||
  process.argv[1]?.endsWith("seed-demo.js");

if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed-demo] FAILED", err);
      process.exit(1);
    });
}
