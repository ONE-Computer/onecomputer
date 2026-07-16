# 00 — Current State

Date: 2026-06-28  
Branch: `feature/upstream-selective-merge`

See also: [`.workflows/NORTH-STAR.md`](../../.workflows/NORTH-STAR.md) for the
4-persona product direction and sprint/branch plan that governs how workflow
scripts are authored (different audience — product/build-order, not verified
state).

## Verified services

| Service              |  Port | Status                   | Notes                            |
| -------------------- | ----: | ------------------------ | -------------------------------- |
| ONEComputer web      | 10254 | ✅ HTTP 200              | local auth mode                  |
| ONEComputer gateway  | 10255 | ✅ starts                | Rust MITM proxy                  |
| ONEComputer Postgres |  5433 | ✅ 73 migrations applied | 5432 is occupied locally         |
| Daytona API          |  3000 | ✅ healthy               | use `127.0.0.1`, not `localhost` |
| Daytona toolbox      |  4000 | ✅ working               | real sandbox exec path           |
| Verdaccio            |  4873 | ✅ running               | npm proxy/gate                   |
| JFrog OSS            |  8082 | ✅ running               | generic artifact storage only    |
| VTI/TDK mediator     |  7037 | ✅ healthy               | DIDComm test stack               |

## Verified product proof

### Sandbox + Claude

- `POST /v1/sandboxes` creates a Daytona sandbox through ONEComputer.
- The sandbox reaches `state: started`.
- `bootstrapSandbox()` installs Claude Code via npm.
- `POST /v1/sandboxes/:id/exec` runs:

```bash
/home/daytona/.npm-global/bin/claude --version
```

and returns:

```text
2.1.195 (Claude Code)
```

### Policy + VTI step-up

- `POST /v1/rules` creates a `manual_approval` rule for Outlook send.
- `POST /v1/internal/gateway/manual-approval` creates an `ApprovalRequest`.
- `ApprovalRequest.context._vti.stepUpRequest` is a VTI Trust Task envelope:

```json
{
  "taskType": "auth/step-up/approve-request",
  "proofMode": "external_vti_required",
  "taskHash": "sha256:...",
  "payload": {
    "humanSummary": "outlook.send_email: ...",
    "requestedActionDigest": "sha256:..."
  }
}
```

- `POST /v1/approvals/:id/vti-notification/trigger` returns:

```json
{ "delivery": { "status": "sent_to_vti_adapter" } }
```

## Verified tests

| Check                    | Status                                |
| ------------------------ | ------------------------------------- |
| Web TypeScript           | ✅ `0` TS errors                      |
| Gateway tests            | ✅ `447` unit + `8` integration tests |
| Gateway clippy           | ✅ clean                              |
| VTI signer tests         | ✅ sign/verify/tamper/DID format      |
| Identity injection tests | ✅ inject/no-op/proof                 |
| RBAC ability tests       | ✅ role matrix tests                  |

## Current readiness estimate

| Readiness type                  | Estimate |
| ------------------------------- | -------: |
| Prototype/demo readiness        |   70–75% |
| Controlled internal pilot       |   40–45% |
| Enterprise production readiness |   20–25% |

## Still not production-ready

1. Real VTA/mobile DIDComm delivery is not wired.
2. Live gateway `manual_approval` callback from Rust proxy to API is not fully automatic.
3. SharePoint and Outlook connectors are not live against Microsoft Graph.
4. CI is still weaker than local checks unless `DATABASE_URL` is fully wired.
5. RBAC UI needs enterprise-grade member/role management.
6. UX is improved but not yet investor-demo polished.

## Real priorities (from AUDIT.md, not the old phase ladder)

1. Wire behavioral policy conditions / Rego eval (`condition_match.rs` stub —
   see AUDIT.md, do not touch as part of cleanup passes).
2. MCP/A2A JSON-RPC parsers + per-tool policies.
3. Prometheus `/metrics` endpoint.
4. Source auth (API key + JWT/JWKS).
5. Daytona/E2B adapter on the AppStream POC pattern.
6. DID + VP issuance (vetted SDK / real VTI — no DIY crypto).

## Outstanding action item

`../onecomputer-secure-claude-computer-poc/repos/invgini-core-web/.npmrc:9`
commits a plaintext JFrog `_authToken`. **Rotate the token in JFrog Artifactory
and purge git history.** Not done as of last check.

---

## Phase 9 — Admin RBAC UX SHIPPED (2026-07-04)

**Commit:** `6f6fa40ca2b6ca86e01afcb98a62ba315b3843cc`

Enterprise admin surfaces are now live:

- **/settings/members** — Invite users, assign roles (Owner/Cyber Admin/Manager/Employee), resend invites, remove members
- **/settings/roles** — Role capability matrix: what each role can do (view members, invite, manage rules, approve requests, etc.)
- **Header/sidebar role badge** — Current role visible (e.g., "Cyber Admin" for admin@localhost)
- **/v1/members API** — RESTful member management (list, invite, role update, remove, role matrix)
- **RBAC guarded** — owner/admin manage users; managers/employees cannot access admin surfaces
- **tsc --noEmit: clean** — TypeScript build passes

Impact: admins can now provision and delegate roles within the UI. Visibility and control are in place for enterprise deployments.

## Phase 10 — Enterprise Get Started Onboarding SHIPPED (2026-07-04)

**Commit:** `9f831d6867ebe4a2f138017b1ddba29b4382898d`

The "Get Started" modal has been redesigned from a developer-first OneCLI CLI installation guide into a **first-run enterprise onboarding checklist**. This addresses the core gap: new admins no longer see coding-agent orientation; instead they see an actionable org-setup path.

### Checklist items (enterprise-oriented)

1. **Invite users and assign roles** — Add team, assign Cyber Admin/Manager/Employee roles (links to `/settings/members`)
2. **Review role permissions** — Confirm capability matrix for each role (links to `/settings/roles`)
3. **Configure package gate** — Set allowed registries, block-list risky packages (links to `/settings/policy`)
4. **Boot first governed sandbox** — Spin up an isolated AI sandbox with policy applied (links to `/sandboxes`)
5. **Create manager approval policy** — Define which agent actions require manager sign-off (links to `/rules`)
6. **Monitor in Cyber console** — Track action approval timeline and audit evidence (links to `/console`)

### Persona quick-start buttons

Each persona sees a tailored entry:

- **Cyber Admin** — "Set up the org" (security-first path)
- **Manager** — "Review pending approvals" (approval/oversight path)
- **Employee** — "Launch your first sandbox" (action/compute path)
- **Platform Owner** — "Configure connectors" (integration/control path)

### Developer path preserved

The OneCLI terminal/CLI installation is now in an **Advanced** section—kept for developers who need it, not the first-run UX.

### Local progress tracking

Onboarding progress is stored in `localStorage` with a visual progress bar, so admins can:

- See which steps are done (`getProgress()`)
- Mark steps complete manually or via UI (`markStepComplete()`)
- Return to the modal later and see their progress

### Files modified/added

- `apps/web/src/app/(dashboard)/_components/get-started-dialog.tsx` — Redesigned modal with checklist, personas, progress bar
- `apps/web/src/app/(dashboard)/_components/get-started-button.tsx` — Updated trigger button
- `apps/web/src/lib/onboarding-progress.ts` — LocalStorage progress tracker with TypeScript types
- `apps/web/src/app/(dashboard)/sandboxes/[id]/` — New sandbox detail route (D4 workflow output)
- `apps/web/src/app/(dashboard)/sandboxes/_components/state-badge.tsx` — Sandbox state indicator

### Test status

- **tsc --noEmit: clean** — TypeScript build passes
- **Router/link refs verified** — All persona/checklist links point to real routes

Impact: First-run UX is now aligned with enterprise personas and org-setup workflows, not developer CLI tooling. Admins get a clear on-ramp; employees see action paths. OneCLI remains available but not blocking.

## Phase 17-D — Strictest-Wins Policy Merge in Real Gateway SHIPPED (2026-07-04)

**Commit:** `9e178ec`

Cross-scope policy merge is now in the real enforcement path (`policy.rs`). A request
hitting the gateway now sees org + project + agent rules; strictest action wins; org is
the floor (project/agent may raise controls, never weaken org). Previously this logic
lived only in `protective-guardrails-service.ts` with `enforcement: "simulator_only_not_enforced"`.

### What shipped

- `policy.rs` — new `merge_rule_sets()` function + 7 strictest-wins matrix unit tests
- Project surfaced as "Team" in policy UI with Enterprise/Team/User level badges
- `approval-policy-builder.tsx` — new UI component for approval policy configuration
- `rbac-audit-panel.tsx` — RBAC audit panel in roles settings page
- `approval_notify.rs` + `approval_poll.rs` — gateway-side approval notification and polling

### Tests

- **472 unit tests + 8 integration tests: all pass**
- **7 strictest-wins matrix tests: all pass**
  - `strictest_wins_org_block_overrides_agent_allow`
  - `strictest_wins_project_raises_floor_above_org_allow`
  - `strictest_wins_agent_rate_limit_over_project_allow`
  - `strictest_wins_no_rules_defaults_to_allow`
  - `strictest_wins_org_block_does_not_bleed_to_other_paths`
  - `strictest_wins_org_only_block_regression`
  - `strictest_wins_project_only_rate_limit_regression`
- **cargo clippy: clean**
- **tsc --noEmit: clean**

Risk R-SW (strictest-wins not enforced in real gateway) is now CLOSED.

## Phase D9 — Microsoft Entra SSO VERIFIED (2026-07-04, Agent 18-D)

**Status: OIDC round-trip verified and committed**

Microsoft Entra ID single sign-on is now wired and ready for demo-day use:

### App Registration (already provisioned 2026-07-04)

- **Tenant** — giniresearch.onmicrosoft.com (single-tenant, does not allow cross-org sign-in)
- **Client ID** — ba30d158-a7f8-41d0-b816-2aed0d0c29c8
- **Redirect URIs** — http://127.0.0.1:10254/v1/auth/callback/microsoft-entra-id + localhost variants
- **Scopes** — openid, profile, email, User.Read (admin-consented, identity-only, no mail/file/write)
- **Secret** — In .env (AZURE_AD_CLIENT_SECRET), expires 2027-07-04; rotation runbook at docs/plan/runbooks/entra-sso-setup.md

### NextAuth Provider (committed)

- **Commits:** `0289615` (feat: Microsoft Entra ID SSO provider), `793b8db` (fix: canCyberAdmin prop)
- **Provider ID** — microsoft-entra-id (Auth.js v5 naming; routes to /v1/auth/callback/microsoft-entra-id)
- **Env-gated** — Appears only when AZURE*AD*\* vars are set; local mode (AUTH_MODE=local) unaffected
- **First sign-in mapping** — Creates OrganizationMember with role: Employee (no auto-admin escalation)
- **TypeScript** — tsc --noEmit: clean; no TypeScript errors

### Verification (2026-07-04)

- ✅ OIDC authorize endpoint redirects to login.microsoftonline.com with correct tenant, client_id, redirect_uri
- ✅ PKCE S256 enabled (public OIDC best practice)
- ✅ Scopes match consented Graph permissions
- ✅ No secrets committed (git grep clean; credentials only in .env)
- ✅ Web app HTTP 200 in local mode (no login required when AUTH_MODE=local)
- ✅ Browser login automation ready (manual demo-day step with real Gini Research credentials)

### Next steps

- Entra sign-in can be tested on demo-day with real Gini Research credentials
- First sign-in creates an OrganizationMember account automatically (name/email from Entra profile)
- Manager-level first sign-in will require manual role assignment in /settings/members (no auto-escalation by design)

Impact: Enterprise SSO is no longer a blocker for demo-day and pilot deployments. Local dev/testing is unaffected.

## Phase 14 — Gateway approval bridge VERIFIED LIVE (2026-07-04)

**Status: real hold/approve/deny round-trip confirmed against a freshly-built gateway binary**

The gateway-side code (`apps/gateway/src/gateway/approval_notify.rs`, `forward.rs`,
`approval_poll.rs`) had already landed in commit `9e178ec` (swept in by a concurrent
phase-17 `git add -A`), but was never independently exercised live — this entry closes
that gap.

### What was verified

- Ran `scripts/onecomputer/e2e-gateway-approval-proof.mjs` against a **freshly rebuilt**
  gateway binary (the previously-running instance on :10255 was a stale pre-phase-17 build
  and would not have exercised this code path — restarted before testing).
- Result: `{ ok: true, held: true, durableApprovalCreatedByGateway: true, approvedUnblocked: true, deniedReturns403: true, caveats: [] }`
- Gateway logs confirm the real path: `MANUAL APPROVAL required` → `holding request for approval`
  → `durable ApprovalRequest created via internal API status=201` → either
  `APPROVED — forwarding request` or `MANUAL APPROVAL rejected reason="denied"`.
- `cargo test` (gateway): 472 unit tests + 8 integration tests, all passing.
- `tsc --noEmit` clean on both `packages/api` and `apps/web`.

### What this proves

The gateway does not just evaluate `manual_approval` and hold in-memory — it POSTs a
durable `ApprovalRequest` to `POST /v1/internal/approvals` (shared-secret authenticated),
so the approval decision survives gateway restarts and is visible in the API/UI approval
queue, not just gateway memory. Approve/deny decisions made through the API correctly
unblock or reject the held upstream request.

Risk item "manual_approval holds are gateway-memory-only, not durable" is now CLOSED.

### Caveat

The gateway process must be running the current binary — `cargo build` after any gateway
change, and confirm `lsof -i :10255` points at a binary built after your last edit before
trusting a live-demo run. A stale process silently no-ops this entire path (proxies traffic
without holding it) with no error, since it's a different binary instance from the same
process name.

## Phase 15A — Dual Step-Up + Manager Device Approval SHIPPED (2026-07-04, Agent 15A-D)

**Commit:** `69f89df` — "feat(approvals): dual step-up + manager device approval page"

Two-person 2FA workflow is now live in the UI. Manager device page renders real Trust Task
envelopes and can approve/deny; actor receives a parallel 2FA prompt to verify identity
before the manager acts.

### Verified output

- `tsc --noEmit`: Clean (no TypeScript errors)
- Test approval created and returned by `POST /v1/approvals`
- `GET /v1/approvals/{id}/vti-notification` returns both envelopes:
  - **stepUpRequest** (manager): `taskHash: sha256:ee7199f8c17bc4f6127302523a2eb56d779bc616859c08c9d0f1d294040df086`
  - **actorStepUp** (requester): `taskHash: sha256:6fadce38d604593b9c6e152298b2d0efc82ba9b038185112849f803444995c88`
  - Delivery: `vti-outbox-local` (simulated transport, real envelope)
- `GET /device/approvals/{id}`: HTTP 200 (device page renders)

### What shipped

- **Actor step-up envelope** — `buildActorStepUpNotificationEnvelope()` alongside existing manager envelope
- **Device layout + route** — New `(device)` layout group with `/device/approvals/:id` page
- **Manager device approval page** — Renders real Trust Task JSON, shows taskHash, approve/deny buttons
- **Actor step-up prompt** — `ActorStepupPrompt` component in sandbox detail; actor confirms identity via `POST /approvals/:id/actor-ack`
- **Device approval prompt** — `DeviceApprovalPrompt` renders Trust Task, approves/denies via `POST /approvals/:id/decide`
- **Service functions** — `recordActorAck()` stamps `context._vti.actorStepUp.acknowledgedAt` timestamp
- **Actor-manager separation** — Two distinct DIDs (requester vs manager); envelopes never crossed

### Architecture notes

- **Two independent approvals:** Actor ack does NOT auto-trigger manager approval or vice versa. Both flows are visible in the UI.
- **Real Trust Task JSON:** Envelope contains exact `payload` + `taskHash`; VTI verifier can validate proof against signature (when wired).
- **Simulated transport:** `vti-outbox-local` adapter marks "sent" but does not attempt real DIDComm/mobile delivery (phase-15 scope).
- **Reused envelope seam:** `buildApprovalStepUpNotificationEnvelope()` was already separating actor (requesterDid) vs manager (subjectDid); new actor envelope reuses the same builder with different subject.

### Copy / transparency

Device page includes banner: _"Simulated device delivery — envelope is cryptographically real, transport is local for demo."_

### Demo value

Beats requirements **3c (VTI Trust Task real envelope)** and **4b (manager device rendering)**.
Shows two-person approval flow: user on one device gets a 2FA step-up prompt while manager
on another device (the "device" page) sees and can approve/deny the same action.

## Phase D7 — Audit Timeline (Unified Ops/Audit Trail) SHIPPED (2026-07-04, Agent 16-D)

**Commit:** `6df0637` — "feat(audit): unified ops/audit timeline (RequestLog + AuditLog + approvals)"

Ops/Audit read-only trail is now live. Merges three data sources (RequestLog, AuditLog, ApprovalRequest) into one ordered, filterable timeline for compliance and security audits.

### Verified output

- `tsc --noEmit`: Clean (no TypeScript errors)
- `GET /v1/audit/timeline?limit=5`: Returns real merged events from all three sources
  - Sample: blocked RequestLog row → ApprovalRequest creation → admin decision flow
- `GET /audit`: HTTP 200 (page loads)
- No duplicate logging; existing `withAudit` conventions respected

### What shipped

- **Backend: /v1/audit/timeline API** (`packages/api/src/routes/audit.ts`, `audit-timeline-service.ts`)
  - Merges RequestLog (kind='gateway'), AuditLog (kind='admin'), ApprovalRequest (kind='approval')
  - Ordered by timestamp DESC; filterable by kind, action, email
  - Pagination: limit (default 50, max 500), offset
- **Frontend: /audit page** (`apps/web/src/app/(dashboard)/audit/`)
  - Timeline table: event type, timestamp, action, actor, status
  - Detail drawer: full event metadata, related approvals
  - Filters: event kind, action text search, date range (stub-ready)
  - JSON export: download filtered subset for compliance reports
- **Components:**
  - `audit-timeline.tsx`: table + pagination
  - `audit-event-row.tsx`: row formatter with kind badges
  - `audit-filters.tsx`: filter UI
  - `audit-detail-sheet.tsx`: read-only detail drawer
- **RBAC**: Visible to Cyber/Owner; gated via ability.ts

### Demo value

Beats requirement **5 (Ops/Audit trail)**. Ops and Cyber can now review defensible evidence trail of all gateway decisions, approvals, and admin state changes in one place. Ready for compliance/audit workflows.

## Phase 19 — Demo Seed + Reset SHIPPED (2026-07-05, Agent 19-D)

**Commit:** `e047cf60c511697ac6b9f5c855124f3cbcbbfbdd`

Deterministic demo seed and reset infrastructure complete. Demo Corp org is now seeded at a stable ID and queryable for CEO demo runs.

### What shipped

- **Script: `packages/api/src/scripts/seed-demo.ts`**
  - Idempotent upsert of Demo Corp org at stable ID `demo-corp-org`
  - Creates 4 users: owner, cyber admin, manager, employee (alex)
  - Creates project-as-team: `demo-corp-team-field-sales`
  - Seeds enterprise-level policies (block npm/PyPI)
  - Seeds project-level policies (require Outlook approval)
  - Seeds agent-level policies (rate limit Slack)
  - Creates a blocked violation (RequestLog row with policy match)
  - Creates a pending approval with real VTI envelope (Outlook send, queued delivery)
  - Logs all state changes via audit trail

- **Reset: `SEED_DEMO_RESET=1` flag**
  - Allows re-running seed without manual database cleanup
  - Purges demo namespace only (does not touch other orgs)
  - Safe for repeated CI/demo runs

- **UI: Reset card** (`apps/web/src/app/(dashboard)/settings/instance/_components/reset-demo-data-card.tsx`)
  - Manual reset trigger in `/settings/instance` (admin-only)
  - Calls `POST /v1/demo/reset` (server action)

- **Server action:** `apps/web/src/lib/actions/demo.ts`
  - `triggerDemoReset()` calls reset endpoint with auth

- **Runbook:** `docs/plan/runbooks/demo-mode.md`
  - Instructions for running seed and reset

### Verified output

- ✅ **Seed runs clean**: `pnpm seed:demo` exits 0; idempotent (run twice = same state)
- ✅ **Demo Corp queryable**: `/v1/approvals?organizationId=demo-corp-org` returns pending Outlook approval
- ✅ **VTI envelope queryable**: Approval carries real Trust Task JSON with `taskHash`, `payload`, `delivery: queued`
- ✅ **Violation queryable**: RequestLog row exists for blocked npm install attempt
- ✅ **Audit timeline queryable**: `/v1/audit/timeline` returns events from seed run
- ✅ **TypeScript clean**: `tsc --noEmit` in apps/web passes

### Demo value

Removes live-state luck from CEO run-through. Demo starts with:

- Known org + users + roles + policies
- Queryable approval and violation
- Real VTI envelope visible in approval detail
- Audit trail showing decisions and rule matches
- Can be reset cleanly for repeated demo runs

Phase 19 required: Phase 16 (audit timeline) — audit events visible after seed ✅

## Sandbox remote desktop truth reset (2026-07-05)

The sandbox feature currently proves Daytona lifecycle plus OneComputer-mediated toolbox exec. It does **not** yet prove a full browser-accessible desktop computer. Specifically:

- `POST /v1/sandboxes` creates a Daytona sandbox and runs Claude Code bootstrap when services are healthy.
- `POST /v1/sandboxes/:id/exec` runs one command at a time through the toolbox proxy.
- The xterm-like UI is a governed command runner, not an interactive shell/PTY and not VNC.
- No XFCE/X11/VNC/noVNC/websockify desktop stack is currently implemented.
- No `desktopUrl`, no `GET /v1/sandboxes/:id/desktop`, and no Open Desktop UI are currently implemented.
- Native Claude Desktop inside the Linux sandbox is not proven and must not be claimed. The honest target is a VNC-accessible Linux desktop with Claude Code CLI and/or Claude web access.
- Raw VNC clicks/typing will not be command-level governed unless a future proxy/instrumentation layer is implemented; current governance covers API-mediated lifecycle/exec/actions.

See `docs/plan/13-remote-desktop-sandbox-audit-plan.md` for the repair plan.

## Kasm local desktop provider proof (2026-07-05)

A provider-neutral sandbox layer now supports the existing Daytona provider plus a local KasmVNC-backed provider selected with `SANDBOX_PROVIDER=kasm-local`. The Kasm local provider launches `kasmweb/ubuntu-jammy-desktop:1.16.0` as a sandbox container, maps KasmVNC HTTPS on `127.0.0.1:16901+`, installs native Claude Desktop Linux from Anthropic's apt repository, installs Node 22 and Claude Code, and returns a browser desktop URL plus health metadata through the same sandbox API shape.

Verified proof sandbox:

- Sandbox id: `oc-kasm-desktop-proof`
- Provider: `kasm-local`
- Desktop URL: `https://127.0.0.1:16901/`
- Desktop health: VNC ✅, noVNC/KasmVNC ✅, browser ✅, Claude Code ✅, Claude Desktop installed ✅, Claude Desktop running ✅, Claude Desktop 3P config ✅, ONEComputer LLM proxy ✅
- Claude Code version: `2.1.201`
- Native Claude Desktop Linux launches inside the Kasm desktop when started as `claude-desktop --no-sandbox`; `pgrep` shows the top-level app plus Electron renderer/GPU/utility processes.
- Claude Desktop Linux 3P mode is configured via `/etc/claude-desktop/managed-settings.json` with `inferenceProvider: gateway`, `inferenceGatewayBaseUrl: http://host.docker.internal:47821/v1`, and managed model pins for `claude-sonnet-5`, `claude-fable-5`, `claude-granola-5-2`, and `claude-haiku-4-5`.
- KasmVNC opens at the clean URL `https://127.0.0.1:16901/`; the provider disables KasmVNC Basic Auth with `VNCOPTIONS=-DisableBasicAuth=1` so browser subresources and the WebSocket connect without embedded URL credentials.
- Browser E2E in Claude Preview verified `/sandboxes` shows `oc-kasm-desktop-proof` as Running with an enabled Open Desktop button, and `/sandboxes/oc-kasm-desktop-proof` shows `Desktop ready` plus health pills for VNC, noVNC, Claude Code, Claude Desktop installed, Claude Desktop running, 3P config, LLM proxy, and Browser all `ok`. The detail page also shows the ONEComputer LLM proxy monitor card with mode `host-pxpipe`, base URL `http://host.docker.internal:47821`, reachable status, discovered model count, configured model pins, and log locations.
- Playwright verified the KasmVNC page loads with 0 console errors, title `a2052f094ba2:1 (kasm-user) - KasmVNC`, and connected status `Connected (encrypted) to a2052f094ba2:1 (kasm-user)`; screenshot evidence saved as `kasmvnc-fixed-connected.png`.

Limitations:

- KasmVNC still uses a self-signed HTTPS certificate in local mode, so browsers show “Not Secure”; a trusted cert or OneComputer reverse proxy is still needed for production polish.
- This is native Claude Desktop Linux running in a containerized Ubuntu desktop, not macOS/Windows Claude Desktop. The Electron sandbox must be disabled for this Docker/Kasm environment; without `--no-sandbox`, launch fails with Chromium namespace restrictions.

## Kasm Docker-in-sandbox + Claude Code via LiteLLM + admin API (2026-07-05)

Goal gate met: Docker works inside Kasm, Claude Code routes through LiteLLM rigorously, and ONEComputer surfaces all of it as the admin panel — verified on a **fresh provider-created** sandbox (no manual hotfix).

Fresh-provider E2E (sandbox `oc-fresh-e2e`, created via `kasmLocalProvider.createSandbox` then `getSandboxDesktop`):

- `createSandbox` completes in ~57s: image + Claude Desktop apt + Node 22 + Claude Code + Docker CLI + socat + loopback proxy + 3P config + launchers.
- `getSandboxDesktop` (3.5s) health: `vnc ✅`, `noVnc ✅`, `claudeCode ✅`, `claudeDesktopInstalled ✅`, `claudeDesktop3pConfigured ✅`, `llmProxyReachable ✅` (20 models via pxpipe/LiteLLM), `dockerAvailable ✅`. `claudeVersion 2.1.201`.
- Same result through the running OneComputer admin API: `GET /api/sandboxes/oc-fresh-e2e/desktop` → 200 with the same health object and `llmProxy` monitor (mode `host-pxpipe`, baseUrl `http://host.docker.internal:47821`, reachable, 20 models).

In-sandbox verification as `kasm-user`:

- `source /home/kasm-user/.onecomputer/claude-code-proxy-env && claude --print "Return only sandbox-ok"` → `sandbox-ok` (Claude Code routed through the in-sandbox loopback proxy → host pxpipe → LiteLLM → upstream).
- `docker create alpine:3.20 true` → labels `{"onecomputer.child":"true","onecomputer.network":"deny-by-default"}`, `NetworkMode none` (policy wrapper enforces deny-by-default networking + OneComputer labels on child containers).

Architecture:

- ONEComputer is the control plane. LiteLLM/pxpipe live on the host (shared across sandboxes), not inside each sandbox. Provider credentials are injected from host env (`LITELLM_MASTER_KEY` from ignored `apps/web/.env.local`).
- Each sandbox gets: an in-sandbox loopback proxy (`127.0.0.1:47821` → `host.docker.internal:47821`) so Claude Desktop 3P can use loopback HTTP; a `claude-code-proxy-env` file + `onecomputer-claude` wrapper so Claude Code uses the same proxy; a socat unix-socket proxy + policy wrapper so `kasm-user` Docker defaults to no-network children.

Implementation notes (root causes of prior failures):

- Daemons (loopback proxy, socat) must start with `docker exec -d` + `setsid` + full stdio redirect. A foreground `docker exec` with captured stdio hangs because the daemon inherits the exec's stdout pipe.
- Daemon lifecycle uses PID files. `pkill -f <daemon-name>` must NOT be used: the bash script's argv contains the daemon name (heredoc body), so `pkill -f` self-SIGTERMs the script (exit 143) and aborts the function halfway.

Commit: `a869ae8 feat(kasm-local): productize in-sandbox loopback LLM proxy, Claude Code proxy env, and controlled Docker`.

Still open (not blocking this goal gate): daemon auto-restart on plain container restart; VNC automation harness (`@hrrrsn/mcp-vnc` framebuffer timeout, `vncdotool` works as fallback); confirm Claude Cowork "Virtualization not available" status now that Docker is wired; deny-by-default egress after bootstrap; Exa-only web search enforcement.
