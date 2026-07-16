# OneComputer — North Star: 4-Persona Platform

> Last updated: 2026-06-28. Branch: feature/onecomputer-persona-platform.

## The 4 personas and what they actually need

### Persona 1 — Cyber / Compliance Team

**Who**: CISO, security ops, compliance officer  
**Need**: Real-time visibility and control over EVERY sandbox, agent, and connector
across the org. Evidence for audits. Kill switches. Policy enforcement proof.

**Jobs to be done:**

- See all running sandboxes org-wide with owner, state, uptime, resource usage
- See all agents and what connectors/tools they have access to
- See every outbound API call an agent made (who, what, when, blocked/allowed)
- Block a specific agent or sandbox instantly (kill switch)
- Export evidence pack for any sandbox/agent (audit trail)
- Set org-wide policy rules (e.g. "no Outlook send without approval") and see them enforced
- Get alerted when a policy is violated or an anomalous request is detected

**Key surfaces**: `/console` (currently hardcoded samples → must be live),
`/activity` (already live-polling!), `/rules` (already real!), new `/org/sandboxes`

### Persona 2 — Business Unit Manager

**Who**: Head of a team, VP, department lead  
**Need**: Approve/deny what their people's agents are doing. 2FA step-up for
sensitive operations. Overview of their team's agent activity and spend.

**Jobs to be done:**

- See all sandboxes/agents owned by their team members
- Approve or deny a pending action (e.g. "Agent wants to send email to client")
- Receive push notification when one of their team's agents needs approval
- See a summary: agents active today, actions taken, policy violations
- Set team-level policy (e.g. "all external emails need my approval")
- Revoke a team member's agent if compromised

**Key surfaces**: New `/approvals` page, team-scoped view on `/overview`,
email/push notifications for approval requests

### Persona 3 — Individual Contributor (IC)

**Who**: Developer, analyst, power user managing 20-30 Claude Code agents/apps  
**Need**: Vercel/v0-like experience. Deploy fast, see what's running, debug easily.
Low friction for the 95% case; governance visible but not in the way.

**Jobs to be done:**

- Boot a new Claude Code sandbox in one click with a name
- See all their sandboxes with status, Claude version, running time
- Open a terminal/exec panel to run commands in a sandbox
- See what their agents are doing right now (live activity feed per sandbox)
- Install a connector (e.g. Outlook) with one OAuth click
- See when a request was blocked and why (so they can request policy change)
- Deploy a vibe-coded app (Streamlit/React) and get a governed URL

**Key surfaces**: `/sandboxes` (Phase 6A, partially built), new IC-friendly
`/overview` variant, exec panel in sandbox detail, connector OAuth flow

### Persona 4 — Enterprise V0/Vercel

**Who**: The product itself — the "how it feels" bar  
**Need**: One-command deploy, instant preview, governed URL, clear ownership.
Think: `vercel deploy` but for governed AI apps and agents.

**Jobs to be done:**

- `onecomputer deploy` → detects app type → asks 3 questions → live governed URL
- Live preview with sandbox URL, status badge, uptime
- One-click rollback / stop / restart
- App passport: owner, purpose, data classification, runtime, expiry — visible always
- Governed URL that requires auth + shows the app's policy to visitors

**Key surfaces**: `/apps` (currently hardcoded showcase), deploy command in CLI,
new app passport detail page

---

## Current state mapped to personas

| What exists                                | Persona        | Real?                             |
| ------------------------------------------ | -------------- | --------------------------------- |
| `/activity` (live-polling request logs)    | Cyber          | ✅ Real                           |
| `/rules` (live rules CRUD + policy modes)  | Cyber, Manager | ✅ Real                           |
| `/connections` (OAuth connect flows)       | IC             | ✅ Real                           |
| `/sandboxes` API + route (Phase 1)         | IC             | ✅ Real (API), ❌ No UI yet       |
| `/console` (CISO view)                     | Cyber          | ❌ Hardcoded samples              |
| `/agents` page                             | All            | ❌ Hardcoded 3 records            |
| `/apps` (Computer Control)                 | IC, V0         | ❌ Hardcoded 4 records            |
| `/overview`                                | All            | ❌ Hardcoded graphs               |
| Approvals / step-up                        | Manager        | ❌ Not built                      |
| Kill switch (agent/sandbox wipe)           | Cyber          | ❌ Not wired                      |
| Gateway enforcement (Phase 2 code on disk) | Cyber          | ⚠️ Written, not compiled/verified |
| Org-wide sandbox view                      | Cyber, Manager | ❌ Not built                      |

---

## Build order (persona-priority, credit-efficient)

### Sprint A — IC gets a real cockpit (highest visible value, no Rust compile needed)

**Branch**: `feature/ic-sandbox-cockpit`
Files: `apps/web/src/app/(dashboard)/sandboxes/` (new)

1. `/sandboxes` page with live list (polls `/v1/sandboxes` every 5s)
2. "New Sandbox" button + modal → creates real sandbox → shows bootstrap progress
3. Sandbox detail: state badge, exec terminal panel, Claude version, uptime
4. "Open" button: links to toolbox URL / preview URL
5. Delete + stop actions wired

### Sprint B — Cyber gets a real console (replaces hardcoded samples)

**Branch**: `feature/cyber-live-console`
Files: `apps/web/src/app/(dashboard)/console/`

1. Wire `/console` CISO view to real data from `/v1/sandboxes` + `/v1/agents` + `/v1/rules`
2. Org sandbox fleet table: all sandboxes, owners, states, uptime
3. Live violations feed from `/activity` filtered to blocked/policy-denied
4. Kill switch button → DELETE `/v1/sandboxes/:id` or agent revoke
5. Evidence export button (already has hash-chain in gateway)
6. Policy health summary: N rules active, M violations today

### Sprint C — Manager gets approvals

**Branch**: `feature/manager-approvals`

1. New `/approvals` page: pending approval requests (from vti-consent-service)
2. Step-up gate for Outlook write → creates an approval record → notifies manager
3. Approve/deny UI with comment
4. Summary widget on `/overview` scoped to team

### Sprint D — V0/Vercel feel + app deploy

**Branch**: `feature/enterprise-v0`

1. Wire `/apps` to real deployed apps from the database
2. App passport detail page (owner, data class, expiry, evidence hash)
3. Deploy flow: drag-and-drop or URL → 3-question wizard → governed URL

### Sprint E — Phase 2 gateway verify + compile (low-credit Rust work)

**Branch**: `feature/gateway-enforcement`

Run Phase 2 gaps ONE AT A TIME sequentially (not parallel) to stay within credits:

- G1: cargo test condition_match → verify → commit
- G2: cargo test mcp → verify → commit
- G3: cargo test channel → verify → commit
- G4: cargo test metrics → verify → commit

---

## Workflow credit budget rule

**Phase 2 killed by running 4 parallel agents at max_tokens=16384.**
Rule going forward: all Rust gateway workflows run **one agent at a time** (pipeline,
not parallel). TypeScript UI workflows can run 2 parallel max.
Add `model: 'haiku'` for verify/capture agents (they only need to read and grep).

---

## Git branching strategy

```
main (protected)
└── feature/onecomputer-persona-platform  ← current (Phase 1+2 committed)
    ├── feature/ic-sandbox-cockpit         ← Sprint A
    ├── feature/cyber-live-console         ← Sprint B
    ├── feature/manager-approvals          ← Sprint C
    ├── feature/enterprise-v0              ← Sprint D
    └── feature/gateway-enforcement        ← Sprint E (sequential Rust)
```

PRs: each feature branch → persona-platform → main when stable.

---

## Archive convention

Once a phase/sprint workflow script has actually shipped (its work is merged and
verified in `git log`, not just written to disk), move it from `.workflows/` to
`.workflows/archive/` with `git mv` so history follows the file. This keeps the
`.workflows/` root showing only active/pending work.

This convention was established 2026-07-04 when 22 completed scripts (sprint-1
through sprint-g, phase-1 through phase-8, phase-i-identity-wire,
phase-e2e-system-tests, goal-close-vti-2fa) were archived in one pass. Phase-9
onward stayed at the root as active/pending at that time.

Follow this pattern for future phases instead of inventing a 4th naming style —
we've already had sprint-N, sprint-<letter>, and phase-N; don't add a new one.
When a phase ships, `git mv .workflows/phase-N-*.js .workflows/archive/`.
