export const meta = {
  name: "phase-9-enterprise-admin-rbac",
  description:
    "Enterprise Admin UX: members management, role matrix, role badge, RBAC-visible workflows",
  phases: [
    {
      title: "Members API",
      detail: "Organization members/invitations CRUD routes with RBAC",
    },
    {
      title: "Members UI",
      detail:
        "/settings/members page for invite, role assignment, disable/remove",
    },
    {
      title: "Roles UX",
      detail: "/settings/roles matrix + role badge in sidebar/header",
    },
    { title: "Verify", detail: "tsc + route smoke + UI page HTTP checks" },
    { title: "Commit", detail: "Commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API = `${REPO}/packages/api/src`;

const CTX = `
Repo: ${REPO}
API: ${API}
Web: ${WEB}
Existing schema: Organization, OrganizationMember(role string), Invitation exist.
Existing RBAC: packages/api/src/lib/ability.ts, middleware/ability.ts.
Roles: owner | admin | manager | member. UI labels: Owner/Platform, Cyber Admin, Manager, Employee.
Auth local dev: admin@localhost, AUTH_MODE=local.
North star: enterprise admins need to see/invite users, assign roles, understand permissions.
Do not replace NextAuth. Add RBAC UX on top.
`;

const MEMBERS_API = `${CTX}

## Agent 9-A: Members API

Create organization members + invitations API.

Files:
- packages/api/src/routes/members.ts (new)
- packages/api/src/services/member-service.ts (new)
- packages/api/src/app.ts (wire app.route('/members', memberRoutes()))

Routes mounted at /v1/members:
1. GET /members
   - returns current org members from OrganizationMember
   - fields: userId, userEmail, role, createdAt
   - RBAC: requireAbility(ability, 'read', 'OrganizationMember')
2. POST /members/invite
   - body: { email, role }
   - role enum: owner/admin/manager/member, but do NOT allow inviting owner unless requester is owner
   - creates Invitation row with token, expiresAt=7 days
   - in local dev, no email send; return { invitationUrl, token }
   - RBAC: owner/admin only
3. PATCH /members/:userId/role
   - body: { role }
   - updates OrganizationMember.role
   - RBAC: owner/admin only; admin cannot promote to owner
4. DELETE /members/:userId
   - removes org membership (or rejects deleting self if last owner)
   - RBAC: owner/admin only
5. GET /members/roles
   - returns role matrix for UI (actions/resources table)

Use existing authMiddleware + withAbility. Use db from @onecli/db.
Use ServiceError pattern if needed. Keep implementation simple and explicit.

Tests if feasible: member-service.test.ts for role validation and last-owner guard.
Run pnpm tsc --noEmit.
Return files changed, tsc result, any TODOs.
`;

const MEMBERS_UI = `${CTX}

## Agent 9-B: Members UI

Create enterprise user management UI.

Files:
- apps/web/src/lib/api/members.ts (new typed client)
- apps/web/src/app/(dashboard)/settings/members/page.tsx (new)
- apps/web/src/app/(dashboard)/settings/members/_components/members-content.tsx (new)
- update settings nav to include Members

UI requirements:
- Header: "Members" + subtitle "Invite users and assign enterprise roles."
- Table: Email | Role badge | Joined | Actions
- Invite button opens dialog:
  - email input
  - role select: Cyber Admin(admin), Manager(manager), Employee(member)
  - Invite button calls POST /v1/members/invite
  - show returned invitationUrl with copy button
- Role dropdown on each row calls PATCH /v1/members/:userId/role
- Remove button uses AlertDialog (not confirm()) and DELETE /v1/members/:userId
- Empty state: "No members yet" + Invite user CTA
- Local mode note: "Local dev runs as Admin; invited users are persisted but email delivery is not configured."

Use shadcn components: Card, Button, Badge, Dialog, AlertDialog, Input, Select, Table if available.
Run apps/web npx tsc --noEmit.
Return files, tsc result.
`;

const ROLES_UX = `${CTX}

## Agent 9-C: Roles matrix + role badge

Files:
- apps/web/src/app/(dashboard)/settings/roles/page.tsx (new)
- apps/web/src/app/(dashboard)/settings/roles/_components/roles-matrix.tsx (new)
- update settings nav to include Roles
- update sidebar/user menu to show role badge

Roles matrix:
Columns: Owner/Platform, Cyber Admin, Manager, Employee
Rows/resources:
- Sandboxes: create/read/execute/delete
- Agents: create/read/execute/delete
- Approvals: read/approve/deny
- Policy rules: create/read/update/delete
- Secrets/connectors: read/create/revoke
- Evidence/activity: read/export

Use plain English descriptions:
- Owner/Platform: manages org, billing, users, all resources
- Cyber Admin: security operations, policies, kill switch, evidence
- Manager: approve team requests, view team activity
- Employee: manage own sandboxes/agents/apps

Role badge:
- In sidebar user card or header, show current role.
- In local dev, default label: Cyber Admin (local)
- If persona preview localStorage exists (oc_role_pref), map it to label.

Run tsc. Return files and result.
`;

const VERIFY = `${CTX}

## Agent 9-D: Verify Phase 9

Run:
cd ${REPO}/apps/web && npx tsc --noEmit
Then HTTP checks:
- http://127.0.0.1:10254/settings/members => 200
- http://127.0.0.1:10254/settings/roles => 200
API checks:
- GET http://127.0.0.1:10254/v1/members
- GET http://127.0.0.1:10254/v1/members/roles

Return pass/fail, first errors if any, page HTTP codes, API response shapes.
`;

phase("Members API");
const api = await agent(MEMBERS_API, {
  label: "9-A:members-api",
  phase: "Members API",
});
phase("Members UI");
const ui = await agent(MEMBERS_UI, {
  label: "9-B:members-ui",
  phase: "Members UI",
});
phase("Roles UX");
const roles = await agent(ROLES_UX, {
  label: "9-C:roles-ux",
  phase: "Roles UX",
});
phase("Verify");
const verify = await agent(VERIFY, {
  label: "9-D:verify",
  phase: "Verify",
  model: "haiku",
});
phase("Commit");
const commit = await agent(
  `${CTX}

Commit Phase 9.
Commands:
cd ${REPO}
git add packages/api/src/routes/members.ts packages/api/src/services/member-service.ts packages/api/src/app.ts apps/web/src/lib/api/members.ts apps/web/src/app/\\(dashboard\\)/settings/members/ apps/web/src/app/\\(dashboard\\)/settings/roles/ apps/web/src/app/\\(dashboard\\)/settings/_components/ apps/web/src/app/\\(dashboard\\)/_components/ apps/web/src/lib/nav-config.ts 2>/dev/null
git add -A apps/web/src packages/api/src
git commit -m "feat(enterprise): Phase 9 admin RBAC UX — members, roles, role badge

- /v1/members API: list, invite, role update, remove, role matrix
- /settings/members: invite users, role assignment, remove member
- /settings/roles: enterprise role matrix for Owner/Cyber/Manager/Employee
- Sidebar/header role badge: current role visible; local dev shows Cyber Admin
- RBAC guarded: owner/admin manage users; managers/employees cannot

tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Update gbrain: append Phase 9 result to ~/brain/projects/onecomputer-enterprise-ux-gap.md; import/embed.
Append STATE.md Phase 9 section.
Return commit hash.
`,
  { label: "9-E:commit", phase: "Commit", model: "haiku" },
);

return { api, ui, roles, verify, commit };
