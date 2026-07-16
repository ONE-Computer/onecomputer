# ONEComputer — Master Build Plan (2026-06-28)

## The 4 Personas (renamed)

| #   | Name         | Who                                       | North star                                                         |
| --- | ------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| 1   | **Cyber**    | CISO, security ops, compliance            | Real-time org fleet · violations feed · kill switch · audit export |
| 2   | **Manager**  | BU head, team lead                        | Approval queue · 2FA step-up · team agent summary                  |
| 3   | **Employee** | Developer / analyst managing 20-30 agents | Vercel-feel: boot sandbox, see status, exec, install connectors    |
| 4   | **Platform** | The product itself                        | One-command deploy → governed URL → app passport                   |

---

## What exists today (verified)

### ✅ Real and working

| Component                 | File                                                       | Notes                                                      |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Rust MITM gateway         | `apps/gateway/src/policy.rs`                               | Real deny-by-default, Block>ManualApproval>RateLimit>Allow |
| npm/pypi 403 blocklist    | `app-blocklist-service.ts` → `policy.rs:80` → 403          | Strongest enforcement piece                                |
| Upstream secret injection | `secret_inject.rs`                                         | Bearer + x-api-key + generic; ahead of TGW                 |
| Daytona adapter           | `packages/api/src/services/daytona-service.ts`             | create/exec/list/stop/delete, toolbox via port 4000        |
| Sandbox bootstrap         | `sandbox-bootstrap.ts`                                     | Claude 2.1.195 installed via npm; verified                 |
| `/v1/sandboxes` routes    | `packages/api/src/routes/sandboxes.ts`                     | Mounted, live                                              |
| Activity page             | `/activity`                                                | Live-polling request logs, real                            |
| Rules page                | `/rules`                                                   | Live CRUD + policy modes, real                             |
| Connections page          | `/connections`                                             | Real OAuth flows                                           |
| Gateway G1-G4 code        | `condition_match.rs`, `mcp.rs`, `channel.rs`, `metrics.rs` | Written, `cargo check` passes; not yet tested              |
| Postgres                  | Port 5433                                                  | 72 migrations applied                                      |
| Web app                   | Port 10254                                                 | HTTP 200, AUTH_MODE=local                                  |

### ❌ Missing / hardcoded

| What                    | Surface                                              | Priority   |
| ----------------------- | ---------------------------------------------------- | ---------- |
| RBAC enforcement        | **Everywhere** — zero checks in any route            | P0 blocker |
| Employee sandbox UI     | `/sandboxes` page shell exists, no `_components/`    | Sprint A   |
| Cyber live console      | `/console` hardcoded samples                         | Sprint B   |
| Employee agent list     | `/agents` 3 hardcoded records                        | Sprint A   |
| Manager approvals       | `/approvals` — does not exist                        | Sprint C   |
| Gateway tests in CI     | `cargo test` skips all 8                             | Sprint E   |
| Verdaccio npm gate      | Port 4873 — not installed                            | Sprint G   |
| SharePoint connector    | Stub strings only                                    | Sprint H   |
| Outlook write + step-up | Read-only POC only; step-up never wired              | Sprint H   |
| `manager` role in DB    | Role string referenced but not in OrganizationMember | Sprint F   |

---

## Sprint map — all sprints, all roles

### Naming convention

- **Sprint** = UI/product feature (TypeScript, parallel agents OK)
- **Phase** = infrastructure / enforcement (Rust or system-level, sequential)

```
Branch: feature/onecomputer-persona-platform (base)
  ├── feature/rbac-enforcement       (Sprint F — prerequisite for B, C)
  ├── feature/employee-sandbox       (Sprint A — Employee cockpit)
  ├── feature/cyber-live-console     (Sprint B — Cyber console)
  ├── feature/manager-approvals      (Sprint C — Manager approvals)
  ├── feature/platform-deploy        (Sprint D — deploy wizard)
  ├── feature/gateway-enforcement    (Phase E — Rust tests, sequential)
  ├── feature/package-gate           (Sprint G — Verdaccio)
  └── feature/connectors             (Sprint H — SharePoint + Outlook)
```

---

## Execution batches (parallel within each batch, sequential between)

### Batch 0 — Prerequisites (your action, not a workflow)

|     | Action                                                      |
| --- | ----------------------------------------------------------- |
| B1  | Rotate JFrog token + git filter-repo (compliance team)      |
| B2  | ✅ DONE — Postgres port 5433, 72 migrations                 |
| B3  | ✅ DONE — Web app HTTP 200                                  |
| B4  | ✅ DONE — OpenRouter credits topped up                      |
| B5  | Add `DATABASE_URL` to `.github/workflows/ci.yml` — one line |

### Batch 1 — RBAC first (unblocks everything else)

**Sprint F** must land before B and C — without it, kill switch + approvals have no auth guard.

```
Sprint F: RBAC layer                     ~2h    feature/rbac-enforcement
  - Add @casl/ability + @casl/prisma
  - Add "manager" to OrganizationMember.role (Prisma migration)
  - defineAbilityFor() factory (owner/admin/manager/member × resources)
  - Hono middleware: attach ability to context
  - accessibleBy() on all existing resource queries
  - Tests: ability checks pass/fail per role
```

### Batch 2 — Core persona surfaces (parallel, after Sprint F)

All TypeScript/Next.js, different files, safe to run simultaneously.

```
Sprint A (Employee cockpit)              ~1.5h    feature/employee-sandbox
  - sandboxes-content.tsx: list, state badges, 5s polling
  - "Boot sandbox" modal → create + bootstrap progress
  - Exec terminal panel (POST /toolbox/:id/process/execute)
  - agents page: replace 3 hardcoded records with live GET /v1/agents
  - Nav: "Sandboxes" link (Terminal icon)
  RBAC gate: member can only see/exec their own sandboxes

Sprint B (Cyber console)                 ~1.5h    feature/cyber-live-console
  - /console: replace samplePersonalConnectorRegistryPayload() with live data
  - GET /v1/console/overview (fleet + violations + rules summary)
  - Sandbox fleet table: all org sandboxes, kill switch button
  - Violations feed: last 20 blocked requests from RequestLog
  RBAC gate: admin/owner only

Phase E (Gateway tests, sequential)      ~1.5h    feature/gateway-enforcement
  - G1: cargo test condition_match → fix → commit
  - G2: cargo test mcp → fix → commit
  - G3: cargo test channel → fix → commit
  - G4: cargo test metrics → fix → commit
  - Full cargo clippy -D warnings clean
  (one agent at a time — learned from Phase 2 credit failure)
```

### Batch 3 — Second persona tier (parallel, after Batch 2 lands)

```
Sprint C (Manager approvals)             ~1.5h    feature/manager-approvals
  - ApprovalRequest model (Prisma migration)
  - POST/GET/decide /v1/approvals
  - /approvals page: pending queue, approve/deny, countdown
  - Nav: "Approvals" link with pending badge count
  RBAC gate: manager+ can approve; member can only see their own

Sprint G (Package gate)                  ~1h      feature/package-gate
  - docker run verdaccio on port 4873
  - Gateway blocklist extended: crates.io, files.pythonhosted.org
  - Sandbox bootstrap: npm registry → Verdaccio
  - Smoke: npm install express in sandbox → hits Verdaccio
```

### Batch 4 — Identity wire + Platform deploy (parallel)

```
Phase I (VTI identity wire)              ~2h      feature/identity-wire
  - affinidi-data-integrity path deps compile (scaffold already done)
  - vti_signer.rs: did:web key + DataIntegrityProof::sign
  - VP injection into MCP responses (gated by env flag)
  - Agent DID provisioned on createAgent() (did:web:onecomputer.local:agents:<id>)
  HARD STOP: no DIY crypto — vetted SDK only

Sprint D (Platform deploy wizard)        ~2h      feature/platform-deploy
  - /apps: replace 4 hardcoded records with live deployed apps from DB
  - App passport detail page (owner, data class, expiry, evidence hash)
  - Deploy wizard: upload/URL → 3 questions → governed URL
  - Smoke: deploy a Streamlit app → get a URL
```

### Batch 5 — Connectors (after Phase I identity wire)

```
Sprint H (SharePoint + Outlook)          ~2h      feature/connectors
  - sharepoint-connector.ts: read-only Graph API (no write, AST-tested)
  - outlook-connector.ts: read free, write gated by vti-consent-service step-up
  - POST /v1/connectors/sharepoint/search, /read
  - POST /v1/outlook/send → creates ApprovalRequest if no step-up token
  - Channel configs in ONECLI_CHANNELS for both
  RBAC gate: admin can configure; manager/member can use with step-up
```

---

## Workflow credit rules (learned from Phase 2 failure)

| Type             | Rule                                            | Why                                                 |
| ---------------- | ----------------------------------------------- | --------------------------------------------------- |
| Rust (gateway)   | Sequential, one gap at a time                   | 4 parallel Rust agents exhausted OpenRouter credits |
| TypeScript UI    | Max 2 parallel                                  | Safe                                                |
| Verify / capture | `model: 'haiku'`                                | Only reads/writes, no deep reasoning needed         |
| Full phases      | No more than 3 workflows running simultaneously | PGLite lock + Docker memory                         |

---

## gbrain update rule

Every sprint's Capture phase must:

1. Write `~/brain/projects/onecomputer-<sprint>-result.md`
2. Append to `~/brain/projects/onecomputer-build-priorities.md`
3. Update `STATE.md` with honest verdicts (REAL/PARTIAL/VAPOR)
4. `pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`

---

## Files to write (workflow scripts needed)

| Script                          | Status                                        |
| ------------------------------- | --------------------------------------------- |
| `sprint-f-rbac.js`              | ❌ WRITE NEXT                                 |
| `sprint-a-employee-sandbox.js`  | ❌ WRITE (replace `sprint-a-ic-cockpit.js`)   |
| `sprint-b-cyber-console.js`     | ✅ Written (update persona name)              |
| `sprint-c-manager-approvals.js` | ✅ Written                                    |
| `sprint-d-platform-deploy.js`   | ❌ WRITE                                      |
| `phase-e-gateway-sequential.js` | ✅ Written (`sprint-e-gateway-sequential.js`) |
| `sprint-g-package-gate.js`      | ❌ WRITE (extract from phase-4)               |
| `phase-i-identity-wire.js`      | ❌ WRITE (extract from phase-3)               |
| `sprint-h-connectors.js`        | ❌ WRITE (extract from phase-5)               |

---

## Launch order

```
NOW (as soon as you say go):
  Sprint F (RBAC)    — standalone, unblocks everything

AFTER F lands (~2h):
  Sprint A (Employee sandbox) + Sprint B (Cyber console) + Phase E (Gateway tests)

AFTER A+B+E land:
  Sprint C (Manager approvals) + Sprint G (Package gate)

AFTER C+G land:
  Phase I (Identity wire) + Sprint D (Platform deploy)

AFTER I+D land:
  Sprint H (Connectors)
```
