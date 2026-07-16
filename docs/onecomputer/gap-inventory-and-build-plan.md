# OneComputer Gap Inventory and Build Plan

Date: 2026-06-21  
Status: readiness is **3/10** after the first real sandbox governed Streamlit URL

## Why this doc exists

The current demo was confusing because it mixed three different states:

1. a **dry-run Streamlit deploy** that only creates passport/evidence/Dockerfile;
2. a previous **Lambda IAM/VTI live proof** that is not Streamlit;
3. a future **multi-user OneComputer platform** that does not exist yet.

This doc lays out the gaps so we can plan and build the real platform instead of polishing a misleading dashboard.

## Current truth

| Question                                               | Honest answer                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| What is the deployed Streamlit app URL?                | Sandbox governed URL exists: `https://on-b13d1c62c4654e65acb04540a1f6369c.ecs.ap-southeast-1.on.aws`.                         |
| What works for Streamlit today?                        | Detection, passport, evidence pack, guarded Dockerfile, CodeBuild/ECR build, ECS Express deploy, sandbox auth gate.           |
| Is there multi-user/admin support?                     | Not in the OneComputer product sense. Current base is still mostly local/single-user OneCLI-style.                            |
| Is CISO approval possible today?                       | No. CISO can review a real proof URL, but pilot requires IAM/VTI, registry persistence, admin roles, revoke, evidence export. |
| Is Head of Digital Transformation demo possible today? | Yes, but only as a product direction and first working slice. Not as finished deployment platform.                            |

## Product architecture we actually need

OneComputer needs two first-class UX surfaces:

### 1. Local builder UX

Audience: business user / power user / Claude Code user.

Goal:

> “Deploy my local Streamlit / Node.js app safely without learning AWS, Docker, IAM, databases, or cyber evidence.”

Required flow:

1. Select local app folder.
2. Auto-detect framework: Streamlit first, then Node.js/Express/Next.js API apps.
3. Ask simple questions:
   - owner;
   - purpose;
   - data classification;
   - intended users/groups;
   - expiry;
   - connectors/secrets.
4. Show preflight result in plain English.
5. Deploy and return a governed URL; for simple apps, optionally provision a small managed database.
6. Let owner request renewal, pause, delete, or add users.

### 2. Admin / CISO UX

Audience: CISO, cyber, platform/admin, digital transformation governance.

Goal:

> “Govern all AI-built apps and agents across the organization.”

Required flow:

1. Inventory all apps/agents.
2. Filter by owner, data class, runtime, risk, approval state, expiry.
3. Review pending app deploys.
4. Approve/deny/request changes.
5. View evidence pack and policy version.
6. Revoke/pause/quarantine runtime.
7. Export evidence to SIEM/GRC/ITSM.

## Gap inventory

### A. UX / information architecture gaps

| Gap                                        | Severity | Why it matters                             | Build target                                      |
| ------------------------------------------ | -------: | ------------------------------------------ | ------------------------------------------------- |
| Builder and admin personas are mixed       |       P0 | Users and CISO see different mental models | Separate Builder Deploy UX and Admin Control Room |
| Dashboard implies Streamlit is deployed    |       P0 | Misleads stakeholders                      | Use explicit status: dry-run only / no URL yet    |
| App fleet shown before the core demo story |       P1 | Causes cognitive overload                  | First show journey, then details                  |
| Too much CISO jargon for local user        |       P1 | Builder UX feels scary                     | Hide governance detail behind “Advanced evidence” |
| No simple “what do I do next?” CTA         |       P1 | Demo has no momentum                       | Primary CTA: “Deploy real Streamlit URL”          |

### B. Multi-user / admin gaps

| Gap                                      | Severity | Why it matters                            | Build target                          |
| ---------------------------------------- | -------: | ----------------------------------------- | ------------------------------------- |
| No real org/tenant model for OneComputer |       P0 | Enterprise requires organization boundary | Organization model                    |
| No role model                            |       P0 | Admin, owner, reviewer, viewer differ     | RBAC: admin/app-owner/reviewer/viewer |
| No review queue                          |       P0 | CISO cannot approve or block              | Admin approval queue                  |
| No app ownership lifecycle               |       P0 | Stale apps become shadow IT again         | Owner, expiry, renewal workflow       |
| No user/group access UX                  |       P0 | Sharing cannot be governed                | Named users/groups and access grants  |
| No audit actor identity                  |       P0 | Evidence needs who did what               | Authenticated actor on every event    |

### C. Streamlit deploy/runtime gaps

| Gap                              | Severity | Why it matters                        | Build target                            |
| -------------------------------- | -------: | ------------------------------------- | --------------------------------------- |
| No deployed Streamlit URL        |       P0 | Core value not proven                 | Build/push/deploy Streamlit to AWS      |
| Manual image build/push required |       P0 | Kills local user UX                   | Managed build service or CodeBuild path |
| No auth in front of Streamlit    |       P0 | Public Streamlit URL is not CISO-safe | IAM/VTI access proxy/gateway            |
| No runtime revoke                |       P0 | CISO needs kill switch                | Pause/revoke runtime access             |
| No runtime logs in evidence      |       P0 | Audit incomplete                      | Capture deploy/access/revoke events     |
| No app health/status             |       P1 | Admin cannot trust deploy state       | Health check and status polling         |

### D. Node.js + simple database gaps

Sunzi judgment: this is the right second wedge, but only if we keep it narrow. Do not become a generic Heroku/Vercel clone. Support the common shadow-IT shape: a small Node.js app with one simple database and 5-10 users.

| Gap                            | Severity | Why it matters                                                      | Build target                                           |
| ------------------------------ | -------: | ------------------------------------------------------------------- | ------------------------------------------------------ |
| No Node.js framework detection |       P0 | Many vibe-coded apps are Express/Next/API apps, not Streamlit       | Detect `package.json`, start script, port, framework   |
| No database intent capture     |       P0 | Users will quietly use local SQLite/JSON files or hardcoded DB URLs | Ask: no DB / key-value / Postgres-like relational      |
| No managed DB provisioning     |       P0 | A Node app without persistence is not enough for real shadow apps   | Provision DynamoDB-on-demand first; Postgres/RDS later |
| No DB credential custody       |       P0 | DB secrets can leak into code/env/screenshots                       | Broker credentials; use managed secret path            |
| No migrations/seed safety      |       P1 | Vibe-coded DB apps often break on first deploy                      | Detect migration command and run gated migration       |
| No data classification mapping |       P1 | DB data changes cyber risk more than stateless apps                 | Data class controls table, retention, backup, export   |

Narrow v1 scope:

1. Node.js apps with `package.json` and a clear `start` script.
2. HTTP service on a detected or declared port.
3. Simple persistence options:
   - `none` for stateless apps;
   - `dynamodb` for small key-value/document data;
   - `postgres` marked as later/harder path.
4. Same governed URL and evidence model as Streamlit.

Do not support in v1:

- arbitrary Kubernetes;
- complex multi-service docker-compose;
- self-managed databases inside the app container;
- production finance/PII workloads;
- long-running background workers.

### E. CISO / security gaps

| Gap                               | Severity | Why it matters                      | Build target                                |
| --------------------------------- | -------: | ----------------------------------- | ------------------------------------------- |
| Evidence is local JSON only       |       P0 | Not audit-grade                     | Persist evidence in backend DB              |
| No immutable/signature/hash chain |       P1 | Evidence tampering concern          | Signed evidence envelope                    |
| Secret scan is basic heuristic    |       P1 | Could miss real secrets             | Add stronger scanner / provider integration |
| No dependency/SCA scan            |       P1 | Streamlit requirements may be risky | Dependency risk check                       |
| No egress policy                  |       P1 | App can exfiltrate data             | Network egress allowlist/logging            |
| No SIEM/GRC export                |       P1 | Cyber workflows need integration    | JSON/CSV webhook export                     |
| No policy versioning              |       P1 | Approval must reference policy      | Policy artifact ID and version              |

### F. OneCLI fork/product gaps

| Gap                                              | Severity | Why it matters                              | Build target                                 |
| ------------------------------------------------ | -------: | ------------------------------------------- | -------------------------------------------- |
| Internal package scopes still `@onecli/*`        |       P2 | Cosmetic/confusing, but not critical yet    | Rename after core demo works                 |
| OneCLI credential gateway ≠ OneComputer platform |       P0 | Need app/runtime/product layer              | Add OneComputer app registry/runtime modules |
| No separate docs IA                              |       P1 | Docs still mix OneCLI, InvGini, OneComputer | New docs home: builder/admin/security        |
| No install/distribution path                     |       P2 | Users cannot install `onecomputer`          | CLI packaging later                          |

## Recommended build sequence

### Milestone 1: truthful demo UX

Status: mostly done in latest UI pass.

- Show no Streamlit URL yet.
- Split builder/admin UX.
- Show readiness 1/10.
- Show gaps and next milestone clearly.

### Milestone 2: real Streamlit URL

Status: achieved as a sandbox proof on 2026-06-21.

Goal:

```bash
onecomputer deploy ./streamlit-app
# returns https://<private-governed-url>
```

Build:

1. Managed image build path. ✅ CodeBuild
2. Push to ECR or equivalent. ✅ ECR
3. Deploy to ECS/App Runner/Lambda container. ✅ ECS Express
4. Put access gate in front. ✅ sandbox basic auth; IAM/VTI still P0
5. Return URL. ✅ ECS Express URL
6. Write deploy event to evidence. ✅ local evidence pack

### Milestone 3: Node.js + simple DB support

Sunzi principle: `以弱胜强，贵在集中` — add one adjacent runtime that users actually have, not every runtime.

Goal:

```bash
onecomputer deploy ./node-app --db dynamodb
# returns https://<governed-url> and a managed table/grant
```

Build:

1. Detect Node.js app:
   - `package.json`;
   - package manager;
   - framework hints: Express, Fastify, Next.js, Hono, Vite server;
   - `start` script;
   - port/env needs.
2. Generate guarded Node container:
   - app listens internally;
   - OneComputer access gateway / proxy gates public access;
   - health endpoint generated or configured.
3. Add simple DB choice:
   - default: no DB;
   - first managed DB: DynamoDB on-demand for small key-value/document apps;
   - later: Postgres/RDS for relational apps.
4. Capture DB evidence:
   - table/DB name;
   - data classification;
   - owner;
   - backup/retention;
   - credential custody;
   - revoke path.
5. Deploy to same runtime path as Streamlit:
   - CodeBuild;
   - ECR;
   - ECS Express or App Runner;
   - governed URL.

Acceptance test:

1. Deploy sample Node.js task tracker.
2. Create/read/update one record in managed DB.
3. Verify no-auth blocked, auth allowed.
4. Revoke access or stop route.
5. Evidence pack shows app + DB + access events.

### Milestone 4: app registry + persisted passport

Build:

1. `onecomputer_apps` table.
2. `onecomputer_app_passports` table.
3. `onecomputer_evidence_events` table.
4. API routes for create/list/get/export.
5. Dashboard reads real data, not static mock.

### Milestone 5: multi-user admin model

Build:

1. Organization and membership model.
2. Roles: admin, security reviewer, app owner, viewer.
3. Review queue.
4. Access grants and expiry.
5. Admin actions: approve, deny, pause, revoke.

### Milestone 6: CISO-grade controls

Build:

1. Runtime revoke actually blocks access.
2. Evidence export.
3. Stronger scanning.
4. SIEM/GRC/ITSM integration hooks.
5. Policy versioning.

## Demo messaging after this correction

Say:

> “We are at 1/10 readiness. The dry-run proves the passport/evidence model. The product needs two UX surfaces: local builder deploy and admin/CISO control room. The next build milestone is a real private Streamlit URL with IAM/VTI access and revoke.”

Do not say:

> “The Streamlit app is deployed.”

## Immediate next engineering task

Build Milestone 3: Node.js + simple DB support, without losing the CISO path.

Subtasks:

1. Add Node.js app detector.
2. Add sample Node.js task tracker app.
3. Add `--db none|dynamodb|postgres-later` deploy option.
4. Generate guarded Node Dockerfile.
5. Provision DynamoDB on-demand table for the sample app.
6. Deploy through the same CodeBuild/ECR/ECS path.
7. Capture app + DB evidence.
8. Keep IAM/VTI gateway and revoke as the next security milestone.
