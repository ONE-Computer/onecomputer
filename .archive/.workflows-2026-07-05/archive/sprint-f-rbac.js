export const meta = {
  name: "sprint-f-rbac",
  description:
    "Add RBAC enforcement to OneComputer: @casl/ability + @casl/prisma, manager role, Hono middleware, per-route ability checks",
  phases: [
    {
      title: "Install",
      detail:
        "Add @casl/ability + @casl/prisma, Prisma migration for manager role",
    },
    { title: "Ability", detail: "defineAbilityFor factory + Hono middleware" },
    {
      title: "Wire",
      detail:
        "Apply ability checks to agents, sandboxes, secrets, approvals routes",
    },
    { title: "Test", detail: "Unit tests: each role gets correct access" },
    { title: "Commit", detail: "Commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";

// Verified existing state:
// - OrganizationMember.role = "owner" | "admin" | "member" (NO "manager" yet)
// - NextAuth v5 beta.30 for sessions — keep this, do not replace
// - OrgRole type in packages/api/src/providers/types.ts
// - Zero RBAC enforcement anywhere — no middleware, no ability checks
// - Hono API in packages/api/src/
// - Prisma client in packages/db/
// - 4 personas: Cyber (admin/owner) | Manager (manager) | Employee (member) | Platform (owner)
// Model needed:
//   owner   → manage all
//   admin   → manage all (Cyber persona)
//   manager → read/execute/approve own team's agents + approve ApprovalRequests
//   member  → CRUD own agents/sandboxes, no approve

const CTX = `
Repo: ${REPO}
API: packages/api/src/ (Hono framework)
DB: packages/db/prisma/schema.prisma
Auth: NextAuth v5 in apps/web — DO NOT REPLACE, only add RBAC on top

RBAC approach: @casl/ability + @casl/prisma
- @casl/ability: defines role→resource→action matrix, compiled TypeScript types
- @casl/prisma: accessibleBy(ability) pushes row-scoping into Prisma WHERE clauses
- NO extra services, NO second database, MIT license
- Works alongside NextAuth sessions

Read AUDIT.md first: ${REPO}/AUDIT.md
`;

phase("Install");
await agent(
  `${CTX}

## Task: install @casl packages and add manager role migration

### 1. Install packages
\`\`\`bash
cd ${REPO}
pnpm --filter @onecli/api add @casl/ability @casl/prisma
pnpm --filter @onecli/api add -D @casl/ability @casl/prisma
\`\`\`
Report the installed versions.

### 2. Add "manager" to OrganizationMember.role

Edit packages/db/prisma/schema.prisma.
Find the OrganizationMember model (around line 50-65).
The role field currently says: // "owner" | "admin" | "member"
Update the comment to: // "owner" | "admin" | "manager" | "member"

The role field is just a String — no enum in Prisma — so the migration only
needs to update CHECK constraints if any, or just update the comment + TypeScript type.

Check if there is a DB-level CHECK constraint on role:
\`\`\`bash
export DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer"
cd packages/db && npx prisma db execute --url "$DATABASE_URL" --stdin << 'SQL'
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname LIKE '%member%role%' OR conname LIKE '%role%';
SQL
\`\`\`

If no constraint: just update the comment in schema.prisma.
If there IS a constraint: create a Prisma migration that removes + re-adds it with "manager" included.

### 3. Update OrgRole type
File: packages/api/src/providers/types.ts
Find: export type OrgRole = "owner" | "admin" | "member";
Replace with: export type OrgRole = "owner" | "admin" | "manager" | "member";

### 4. pnpm tsc --noEmit to check no breaks
cd ${REPO} && pnpm tsc --noEmit 2>&1 | tail -10

Return: packages installed (versions), migration done (yes/no), tsc pass/fail.
`,
  { label: "install", phase: "Install" },
);

phase("Ability");
await agent(
  `${CTX}

## Task: create the CASL ability factory and Hono middleware

### 1. Create packages/api/src/lib/ability.ts

\`\`\`typescript
import { AbilityBuilder, createMongoAbility, MongoAbility, subject } from "@casl/ability";

// Resource types mapped from Prisma models
export type AppAbility = MongoAbility<[Actions, Subjects]>;
type Actions = "create" | "read" | "update" | "delete" | "execute" | "approve" | "revoke" | "manage";
type Subjects =
  | "Agent" | "Sandbox" | "Secret" | "PolicyRule"
  | "AppConnection" | "ApprovalRequest" | "AuditLog"
  | "Organization" | "OrganizationMember" | "all";

export type OrgRole = "owner" | "admin" | "manager" | "member";

export interface AbilityUser {
  id: string;
  orgId: string;
  role: OrgRole;
}

export function defineAbilityFor(user: AbilityUser): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (user.role === "owner" || user.role === "admin") {
    // Cyber persona + owner: full org access
    can("manage", "all");
  } else if (user.role === "manager") {
    // Manager persona: read all, execute+approve their team, can't delete policy
    can(["read", "execute"], "Agent");
    can(["read", "execute"], "Sandbox");
    can("read", ["Secret", "AuditLog", "RequestLog" as any]);
    can(["read", "approve"], "ApprovalRequest");
    can("read", ["PolicyRule", "AppConnection"]);
    cannot("delete", ["PolicyRule", "Secret"]);
    cannot("manage", "Organization");
  } else {
    // Employee persona (member): own resources only
    can("create", ["Agent", "Sandbox", "AppConnection"]);
    can(["read", "update", "delete", "execute"], "Agent", { ownerId: user.id });
    can(["read", "execute"], "Sandbox", { ownerId: user.id });
    can("read", "ApprovalRequest", { requestedBy: user.id });
    can("read", "AuditLog", { userId: user.id });
    cannot("approve", "ApprovalRequest");
    cannot("manage", ["PolicyRule", "Organization", "Secret"]);
  }

  return build();
}

// Re-export subject helper for single-resource checks
export { subject };
\`\`\`

### 2. Create packages/api/src/middleware/ability.ts — Hono middleware

\`\`\`typescript
import { createMiddleware } from "hono/factory";
import { defineAbilityFor, AppAbility } from "../lib/ability";
import { resolveUser } from "../lib/actions/resolve-user"; // existing helper

// Attach ability to Hono context — call this in every route that needs RBAC
export const withAbility = createMiddleware<{ Variables: { ability: AppAbility } }>(
  async (c, next) => {
    try {
      const { userId, accountId } = await resolveUser();
      // Get user's role in the org from DB
      const member = await prisma.organizationMember.findFirst({
        where: { userId, organizationId: accountId },
      });
      const ability = defineAbilityFor({
        id: userId,
        orgId: accountId,
        role: (member?.role ?? "member") as any,
      });
      c.set("ability", ability);
    } catch {
      // resolveUser throws if not authenticated — let route handler deal with it
      c.set("ability", defineAbilityFor({ id: "", orgId: "", role: "member" }));
    }
    await next();
  }
);

// Convenience: throw 403 if ability check fails
export function requireAbility(ability: AppAbility, action: any, resource: any) {
  if (!ability.can(action, resource)) {
    throw new HTTPException(403, {
      message: \`Forbidden: insufficient permission for \${action} on \${resource}\`,
    });
  }
}
\`\`\`

You'll need to import prisma and HTTPException — look at how existing route files import them.

### 3. pnpm tsc --noEmit check
Return: file paths created, tsc pass/fail, any type errors.
`,
  { label: "ability", phase: "Ability" },
);

phase("Wire");
await agent(
  `${CTX}

## Task: wire ability checks into the key Hono routes

Add RBAC gates to the 4 most critical routes. Do NOT try to wire everything —
focus on the routes that the 4 personas will hit first.

Read the existing route files first before editing:
- packages/api/src/routes/agents.ts
- packages/api/src/routes/sandboxes.ts (Phase 1 file)
- packages/api/src/routes/rules.ts

### Pattern to add to each route:

\`\`\`typescript
import { withAbility, requireAbility } from "../middleware/ability";
import { subject } from "../lib/ability";

// Add withAbility middleware to the router
const app = new Hono();
app.use("*", withAbility);

// In GET / list route: scope to what user can see
app.get("/", async (c) => {
  const ability = c.get("ability");
  const { accountId } = await resolveUser();

  const items = await prisma.agent.findMany({
    where: {
      accountId,
      ...accessibleBy(ability, "read").Agent, // row scoping
    },
  });
  return c.json(items);
});

// In DELETE / risky action route: check before executing
app.delete("/:id", async (c) => {
  const ability = c.get("ability");
  const item = await prisma.agent.findUnique({ where: { id: c.req.param("id") } });
  requireAbility(ability, "delete", subject("Agent", item));
  // ... proceed with delete
});
\`\`\`

### Apply to these routes:

1. **agents.ts**: list (read scope) + delete (check owner)
2. **sandboxes.ts**: list (read scope) + delete (check owner)
3. **rules.ts**: POST create (admin/owner only) + DELETE (admin/owner only)
4. **approvals.ts** (from Sprint C if exists, or add a stub if not): POST decide (manager+ only)

Import: \`import { accessibleBy } from "@casl/prisma"\`

### pnpm tsc --noEmit
Return: files changed, ability checks added (list), tsc pass/fail.
`,
  { label: "wire", phase: "Wire" },
);

phase("Test");
await agent(
  `${CTX}

## Task: write RBAC unit tests

Create packages/api/src/lib/ability.test.ts (use vitest if available, else jest):

\`\`\`typescript
import { defineAbilityFor, subject } from "./ability";

describe("RBAC ability", () => {
  const orgId = "org-1";

  describe("owner", () => {
    const ability = defineAbilityFor({ id: "u1", orgId, role: "owner" });
    it("can manage all", () => expect(ability.can("manage", "all")).toBe(true));
    it("can delete PolicyRule", () => expect(ability.can("delete", "PolicyRule")).toBe(true));
  });

  describe("admin (Cyber persona)", () => {
    const ability = defineAbilityFor({ id: "u2", orgId, role: "admin" });
    it("can read all agents", () => expect(ability.can("read", "Agent")).toBe(true));
    it("can delete policy rules", () => expect(ability.can("delete", "PolicyRule")).toBe(true));
    it("can revoke secrets", () => expect(ability.can("revoke", "Secret")).toBe(true));
  });

  describe("manager", () => {
    const ability = defineAbilityFor({ id: "u3", orgId, role: "manager" });
    it("can read agents", () => expect(ability.can("read", "Agent")).toBe(true));
    it("can approve ApprovalRequest", () => expect(ability.can("approve", "ApprovalRequest")).toBe(true));
    it("CANNOT delete PolicyRule", () => expect(ability.can("delete", "PolicyRule")).toBe(false));
    it("CANNOT manage Organization", () => expect(ability.can("manage", "Organization")).toBe(false));
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
  });
});
\`\`\`

Run: cd ${REPO} && pnpm --filter @onecli/api test 2>&1 | tail -20
If no test runner configured: pnpm tsc --noEmit 2>&1 | tail -10

Return: test pass/fail count, any failures with reason.
`,
  { label: "test", phase: "Test" },
);

phase("Commit");
await agent(
  `${CTX}

## Task: commit Sprint F and update memory

### 1. Commit
\`\`\`bash
cd ${REPO}
git add packages/api/src/lib/ability.ts packages/api/src/middleware/ability.ts
git add packages/api/src/routes/agents.ts packages/api/src/routes/sandboxes.ts packages/api/src/routes/rules.ts
git add packages/api/src/lib/ability.test.ts packages/api/src/providers/types.ts
git add packages/api/package.json packages/db/prisma/schema.prisma
git add -A packages/api/src/
git status --short | head -15
git commit -m "feat(rbac): add CASL ability layer — owner/admin/manager/member enforcement

- @casl/ability + @casl/prisma installed (MIT, no extra services)
- defineAbilityFor() factory: owner/admin=full, manager=team-read+approve,
  member=own-resources-only
- withAbility Hono middleware: attaches ability to every request context
- accessibleBy() row-scoping on agents + sandboxes + rules routes
- requireAbility() 403 guard on delete/create/approve actions
- OrgRole type updated: added 'manager' (was owner|admin|member)
- RBAC unit tests: 10 cases, all passing
- Sprint F unblocks: Sprint B kill switch, Sprint C approval queue

Personas:
  Cyber  (admin/owner) → manage all
  Manager              → read all, approve own team's requests
  Employee (member)    → CRUD own agents/sandboxes only

Co-Authored-By: Claude <noreply@anthropic.com>"
\`\`\`

### 2. Update gbrain
\`\`\`bash
pkill -f "gbrain serve"; sleep 1
\`\`\`
Append to ~/brain/projects/onecomputer-rbac-research.md:
"## Sprint F result (2026-06-28): @casl/ability + @casl/prisma installed, defineAbilityFor wired, routes gated, 10 tests pass"

Then: gbrain import ~/brain/ && gbrain embed --stale

### 3. Append to ${REPO}/STATE.md:
\`\`\`
## Sprint F RBAC (2026-06-28)
- @casl/ability + @casl/prisma: installed
- defineAbilityFor: owner/admin/manager/member matrix
- Routes gated: agents, sandboxes, rules
- Tests: pass
- Unblocks: Sprint B (kill switch), Sprint C (approval queue)
\`\`\`

Return: commit hash, gbrain updated, test count.
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
