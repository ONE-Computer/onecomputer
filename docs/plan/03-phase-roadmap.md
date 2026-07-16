# 03 — Phase Roadmap to YC / Khosla Readiness

## Readiness ladder

| Stage                | Meaning                               | Target                |
| -------------------- | ------------------------------------- | --------------------- |
| Prototype            | local demo works                      | now: ~70%             |
| Internal pilot       | one company/team can safely use it    | target after Phase 17 |
| Investor demo        | crisp 5-minute story with polished UI | target after Phase 21 |
| Enterprise diligence | security, CI, deploy architecture     | target after Phase 26 |

## Phase list

### Phase 0 — Baseline stabilization

Goal: clean repo, stable services, repeatable tests.

Deliverables:

- web 200
- Postgres migrated
- cargo test/clippy clean
- TypeScript clean
- gbrain updated

Status: mostly done.

### Phase 1 — Sandbox API

Goal: ONEComputer API creates a Daytona sandbox.

Deliverables:

- `daytona-service.ts`
- `sandbox-bootstrap.ts`
- `/v1/sandboxes`
- Claude Code auto-install

Status: done.

### Phase 2 — Gateway enforcement

Goal: policy engine parses body/MCP/channel/metrics.

Deliverables:

- `condition_match.rs`
- `mcp.rs`
- `channel.rs`
- `metrics.rs`
- tests and clippy

Status: code and tests done; live proxy E2E still partial.

### Phase 3 — VTI identity

Goal: did:web signing and VP injection.

Deliverables:

- `vti_signer.rs`
- `identity_injection.rs`
- agent DID fields
- no-DIY-crypto tests

Status: component done; live MCP response proof still needed.

### Phase 4 — Package gate

Goal: npm goes through Verdaccio; direct public registries blocked.

Deliverables:

- Verdaccio :4873
- sandbox npm registry config
- gateway blocklist extended

Status: mostly done; live 403 via proxy needs stronger proof.

### Phase 5 — Core E2E goal proof

Goal: sandbox + Claude + policy + VTI trigger.

Deliverables:

- `scripts/onecomputer/e2e-goal-proof.mjs`
- approval -> VTI notification envelope
- trigger delivery status

Status: done locally with no caveats.

### Phase 6 — UX first impressions

Goal: role-based landing, nav, overview, empty states.

Status: partially done; needs final visual pass.

### Phase 7 — Persona surface polish

Goal: make each persona surface feel designed.

Deliverables:

- Cyber severity badges
- Manager countdowns
- Employee live exec polish
- Activity drawer
- Connection unlocks

Status: workflow created/running earlier; verify final output.

### Phase 8 — Coherence pass

Goal: shared page headers, status badges, skeletons, dialogs, copy.

Status: workflow created; run after Phase 7.

### Phase 9 — Enterprise admin / RBAC UX

Goal: visible user/member/role management.

Deliverables:

- `/settings/members`
- `/settings/roles`
- role badge
- member invite / role assignment

Status: script exists; run next.

### Phase 10 — Enterprise onboarding

Goal: replace OneCLI developer Get Started with enterprise checklist.

Deliverables:

- setup checklist
- persona quick starts
- onboarding progress

Status: script exists; run after Phase 9.

### Phase 11 — RBAC explainability

Goal: users understand why actions are blocked.

Deliverables:

- PermissionGate
- disabled action reasons
- RBAC audit panel
- approval policy builder

Status: script exists; run after Phase 10.

### Phase 12 — Upstream security fixes

Goal: port OneCLI hardening.

Deliverables:

- secret wildcard validation
- public suffix guard
- app-permission path fixes
- 1Password scope guard already ported

Status: partially done.

### Phase 13 — Upstream approval summaries

Goal: human-readable approval cards.

Deliverables:

- `summary.rs`
- Gmail summary
- Calendar summary
- MIME parser
- structured approval preview

Status: not done.

### Phase 14 — Live gateway manual-approval bridge

Goal: Rust proxy creates ApprovalRequest automatically.

Deliverables:

- gateway calls `/v1/internal/gateway/manual-approval`
- approval ID ties back to gateway hold
- manager approval unblocks action

Status: API side exists; Rust callback incomplete.

### Phase 15 — Real VTA/mobile delivery

Goal: replace `vti-outbox-local` with real DIDComm/VTA delivery.

Deliverables:

- delivery adapter interface
- VTA endpoint config
- signed approval response verification

Status: not done.

### Phase 16 — SharePoint read-only connector

Goal: read/search SharePoint safely.

Deliverables:

- Graph API search/read
- no write surface
- policy/evidence

Status: not done.

### Phase 17 — Outlook write with approval

Goal: killer demo action.

Deliverables:

- Outlook read
- Outlook send requires manager approval
- VTI notification contains human-readable summary
- approved response unlocks send

Status: not done.

### Phase 18 — Enterprise V0 deploy flow

Goal: deploy app -> governed URL -> passport.

Status: stubbed; real deploy not wired.

### Phase 19 — Demo mode / seed data

Goal: investor demo does not depend on live luck.

Deliverables:

- seeded org/users/roles
- seeded approvals
- seeded violation
- seeded sandbox
- reset demo button

Status: not done.

### Phase 20 — Investor demo script

Goal: 5-minute story.

Deliverables:

- demo script
- screenshots
- video/gif
- one-page architecture

Status: not done.

### Phase 21 — Product narrative / landing

Goal: YC/Khosla pitch clarity.

Deliverables:

- 1-liner
- wedge
- why now
- buyer
- moat
- pricing hypothesis

Status: not done.

### Phase 22 — CI/E2E automation

Goal: make local proof repeatable in CI.

Deliverables:

- Postgres service in GitHub Actions
- cargo tests
- TypeScript tests
- Playwright E2E
- sandbox mock or Docker runner

Status: not done.

### Phase 23 — Security hardening

Goal: pass initial diligence.

Deliverables:

- token leak handled by compliance
- secret scanning
- RBAC negative tests
- audit immutability plan
- threat model

Status: partial.

### Phase 24 — Deployment architecture

Goal: buyer can deploy it.

Deliverables:

- AWS reference architecture
- VPC/private gateway
- Daytona runner on Linux/EKS
- RDS/Postgres
- Redis
- VTA deployment option

Status: not done.

### Phase 25 — Metrics and business model

Goal: pricing and usage model.

Deliverables:

- sandboxes/hour
- agent seats
- approvals/month
- tool calls
- connector usage
- cost dashboard

Status: not done.

### Phase 26 — Fundraising readiness

Goal: investor-ready package.

Deliverables:

- deck
- demo video
- architecture graph
- customer discovery plan
- pilot target list
- diligence folder

Status: not done.
