export const meta = {
  name: "phase-11-rbac-explainability",
  description:
    "Make RBAC and guardrails understandable: disabled action reasons, permission banners, policy builder, RBAC audit panel",
  phases: [
    {
      title: "Permission component",
      detail: "Reusable PermissionGate / DisabledReason component",
    },
    {
      title: "Action reasons",
      detail: "Apply reasons to sandboxes, approvals, rules, console actions",
    },
    {
      title: "Policy builder",
      detail: "Manager/Cyber approval policy builder for sensitive actions",
    },
    {
      title: "RBAC audit panel",
      detail: "Why can/cannot I do this panel in settings",
    },
    { title: "Verify+Commit", detail: "tsc/browser checks, commit, gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

const CTX = `
Repo: ${REPO}
Web: ${WEB}
RBAC exists: packages/api/src/lib/ability.ts and middleware/ability.ts.
Goal: users understand why actions are allowed/blocked.
Persona language: Cyber=security ops, Manager=approvals, Employee=developer, Platform=deploy/admin.
`;

phase("Permission component");
const comp = await agent(
  `${CTX}
Create reusable permission UI components.

Files:
- apps/web/src/components/permission-gate.tsx

Exports:
1. PermissionHint({ reason, requiredRole })
   - small muted text with lock icon
   - e.g. "Requires Cyber Admin" or "Manager approval required"
2. DisabledActionButton({ children, reason, ...buttonProps })
   - wraps Button disabled
   - Tooltip shows reason
3. RoleRequirementBadge({ role })
   - badge labels: Owner, Cyber Admin, Manager, Employee

Use @onecli/ui button/badge/tooltip. Run tsc.
Return files and tsc result.
`,
  { label: "11-A:permission-components", phase: "Permission component" },
);

phase("Action reasons");
const reasons = await agent(
  `${CTX}
Apply permission explanations to important actions.

Files to inspect/edit:
- sandboxes-content.tsx: Delete action and exec action
- approvals-content.tsx: Approve/Deny buttons
- rules page: create/delete policy buttons
- ciso-console-live.tsx: Kill sandbox / Export evidence buttons

Requirements:
- If an action is disabled, show explicit reason:
  - "Requires Cyber Admin"
  - "Managers can approve team requests"
  - "Employees can only delete their own sandboxes"
  - "Gateway policy blocks this action"
- Replace generic disabled buttons with DisabledActionButton where appropriate.
- Do not block working actions unless RBAC says so; this is explanatory UX.

Run tsc. Return pages updated and tsc result.
`,
  { label: "11-B:action-reasons", phase: "Action reasons" },
);

phase("Policy builder");
const builder = await agent(
  `${CTX}
Build a simple approval policy builder.

Target page: /rules (rules-content.tsx or new component)

Add a card: "Approval policy builder"
Fields:
- Action select: Outlook send, SharePoint write, External package install, Connector write
- Requires approval from: Manager, Cyber Admin, Both
- Host/path preview:
  Outlook send -> graph.microsoft.com /v1.0/me/sendMail POST manual_approval
  SharePoint write -> graph.microsoft.com /v1.0/sites/* PATCH manual_approval
- Button: Create policy
Calls POST /v1/rules with proper hostPattern/pathPattern/method/action.

Show confirmation toast: "Policy created — future matching actions require approval."

Run tsc. Return files changed and tsc result.
`,
  { label: "11-C:policy-builder", phase: "Policy builder" },
);

phase("RBAC audit panel");
const audit = await agent(
  `${CTX}
Create RBAC audit panel in Settings.

File: apps/web/src/app/(dashboard)/settings/roles/page.tsx or new _components/rbac-audit-panel.tsx

Panel title: "Why can I do this?"
Shows:
- Current role (from role-preference/local mode): Cyber Admin / Manager / Employee / Owner
- What the role can do (summary bullets)
- What the role cannot do (summary bullets)
- Example decisions:
  - Delete sandbox: allowed/denied
  - Approve request: allowed/denied
  - Create policy rule: allowed/denied
  - Export evidence: allowed/denied

Add a note: "Production decisions are enforced by the API; this panel explains the current role model."

Run tsc. Return files changed and tsc result.
`,
  { label: "11-D:rbac-audit-panel", phase: "RBAC audit panel" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
Verify and commit Phase 11.

Run:
cd ${REPO}/apps/web && npx tsc --noEmit
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10254/settings/roles
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10254/rules

Then commit:
cd ${REPO}
git add -A apps/web/src/
git commit -m "feat(ux): Phase 11 RBAC explainability and guardrails UX

- PermissionGate / DisabledActionButton / RoleRequirementBadge components
- Disabled actions now explain required role or approval reason
- Rules page approval policy builder creates manual_approval rules
- Settings roles page includes RBAC audit panel: why can/can't I do this
- Persona-specific guardrail copy for Cyber, Manager, Employee, Platform

tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Update gbrain enterprise UX gap with Phase 11 result, append STATE.md, import/embed.
Return commit hash and verification results.
`,
  { label: "11-E:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { comp, reasons, builder, audit, commit };
