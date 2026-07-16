# OneCLI

Cloud backend for OneCLI — manages authentication, integrations, and permissions for the OneCLI agent gateway.

## ⚠️ Verified state — read before trusting any "complete / 95 / ready" claim

A rigorous audit on **2026-06-28** (much of this code was LLM-authored) found that
the advertised **95/100 "controlled-pilot readiness" is largely self-assigned
theater** — the scorecard is hand-graded by the same author that wrote the code,
no formula, no independent measurement. The author's own earlier note admits an
honest baseline of **25/100**. Real working production-grade code is ~35-40%.

**The full verified findings live in [`AUDIT.md`](./AUDIT.md). Read it first.**
Short version:

- **Real & worth building on:** Rust MITM proxy + deny-by-default policy engine
  (`apps/gateway/src/policy.rs:65`); npmjs.org/pypi.org 403 blocklist via DB
  policy rows; upstream secret injection (`secret_inject.rs`); AppStream sandbox
  POC (real `boto3.client("appstream")`).
- **Vapor / scaffold (do not trust):** the `affinidi-vti` verifier is an alias
  for generic HTTP fetch behind a local HMAC mock; **no real crypto signer**
  (`signer` is a constant string); guardrail enforcement is stamped
  `simulator_only_not_enforced` and **never wired to a request gate**; the entire
  `apps/gateway/src/cloud/` layer is 13 one-line re-exports and
  `condition_match::matches()` always returns `true`; `cargo test` "passes" by
  skipping all 8 tests when `DATABASE_URL` is unset (CI never sets it); **no MCP
  server exists**; **no DID identity provisioning at sandbox spin-up**;
  Daytona/E2B and Claude-Code/Codex/Cowork install are docs-only.
- **🚨 Secret leak:** `../onecomputer-secure-claude-computer-poc/repos/invgini-core-web/.npmrc:9`
  commits a plaintext JFrog `_authToken`. Rotate it and purge git history.

**New rule:** a feature is "done" only when it has a test that asserts behavior
(runs in CI, not skipped), is exercised through a real enforcement path (not a
`simulator_only` preview), and uses a vetted SDK / real external signer for
crypto. Otherwise call it `preview` / `scaffold` / `contract`.

## Commands

```bash
pnpm dev          # Start development
pnpm build        # Build all
pnpm check        # Lint + types + format
pnpm fix          # Auto-fix lint + format
pnpm db:generate  # Generate Prisma client
pnpm db:migrate   # Run migrations (dev)
pnpm db:studio    # Open Prisma Studio
```

## Structure

```
apps/web/         # Next.js 16 app (App Router)
packages/db/      # Prisma ORM + migrations
packages/infra/   # AWS CDK infrastructure
packages/ui/      # Shared components (shadcn/ui)
packages/eslint-config/
packages/typescript-config/
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `NEXT_PUBLIC_COGNITO_*`: AWS Cognito config (injected at build time in CI)
- `STRIPE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Third-party credentials

## Code Style

- **Use strong typing** - leverage types from external packages; avoid `any` and type assertions
- Prefer named exports over default exports (except Next.js pages/layouts where required)
- Use `@onecli/ui/*` for shared UI imports, `@/` for app-local imports
- Use `cn()` for class merging
- Mark client components with `"use client"`
- Prefer Tailwind utilities over custom CSS
- Use const arrow functions, not function declarations (for components and utilities)

## Component Structure

- **One component per file** - never put multiple components in the same file (includes page.tsx)
- **Page-specific components** - create `_components/` subdirectory in the route folder:
  ```
  app/(dashboard)/overview/
  ├── page.tsx
  └── _components/
      ├── overview-header.tsx
      └── recent-activity.tsx
  ```
- **Props typing** - use base types directly, only create named interface when adding custom props:

  ```tsx
  // ✓ No custom props - use base type directly
  export const Card = ({ className, children, ...props }: React.ComponentProps<"div">) => { ... };

  // ✓ Custom props - create interface
  export interface ServiceCardProps extends React.ComponentProps<"div"> {
    connected?: boolean;
  }
  ```

- **Multi-component features**: Create a directory with an `index.ts` barrel export

## IMPORTANT: shadcn/ui Components

Components in `packages/ui/src/components/` are from shadcn/ui.

**Allowed:**

- Adding new variants/sizes to CVA definitions
- Customizing via `className` when using components
- Wrapping in your own component

**NOT Allowed:**

- Changing existing variant styles
- Modifying component structure or logic
- Removing existing functionality

When adding components, use shadcn CLI or copy from ui.shadcn.com.

## Dependencies

- Use Radix UI only through shadcn/ui, never import directly
- Check shadcn for components before adding dependencies
- Keep bundle size small - prefer lightweight alternatives

## Web App Patterns

- Server components by default, add `"use client"` only when needed
- Pages export `default function` (async for data fetching)
- Auth: AWS Amplify + Cognito (React context in `providers/`)
- Server-side auth: `getServerSession()` from `lib/auth.ts`
- Validation: Zod for API inputs
- **Button loading states** - replace icon with spinner, update text (e.g., "Connecting..."), and disable
- **Verify library APIs are current** - check official docs for deprecated/legacy patterns before implementing

## Audit Logging

All state-changing operations (create, update, delete, regenerate) must be audited. Use the `withAudit` wrapper from `@/lib/services/audit-service`.

**Pattern:**

```typescript
import {
  withAudit,
  AUDIT_ACTIONS,
  AUDIT_SERVICES,
} from "@/lib/services/audit-service";

export const createAgent = async (name: string) => {
  const { userId, accountId } = await resolveUser();
  return withAudit(
    () => createAgentService(accountId, name),
    (agent) => ({
      accountId,
      userId,
      action: AUDIT_ACTIONS.CREATE,
      service: AUDIT_SERVICES.AGENT,
      metadata: { agentId: agent.id, name },
    }),
  );
};
```

**Available constants:**

- `AUDIT_ACTIONS`: `CREATE`, `UPDATE`, `DELETE`, `REGENERATE`
- `AUDIT_SERVICES`: `AGENT`, `SECRET`, `RULE`, `API_KEY`

**Metadata guidelines:**

- Include resource IDs (agentId, secretId, ruleId)
- Include relevant identifiers (name, type)
- Never include sensitive values (tokens, secrets, passwords)

**When to audit:**

- Actions layer (`lib/actions/`) - always use `withAudit`
- API routes (`app/api/`) - call audit service directly with `source: AUDIT_SOURCE.API` (when implemented)
- Read operations - do not audit

## Database (Prisma)

- Schema at `packages/db/prisma/schema.prisma`
- Always run `pnpm db:generate` after schema changes
- Migrations run automatically on container startup via `entrypoint.sh`

## Infrastructure & Deployment

- Environment passed via CDK context: `--context env=dev|prod`
- **IMPORTANT: Never modify AWS resources directly** — all changes go through CDK stacks and GitHub Actions workflows
- Both deploy workflows (`deploy-app.yml`, `deploy-infra.yml`) are manual with environment choice (dev/prod)

---

## OneComputer VTI/OpenVTC Guardrails Doctrine (2026-06-22)

OneComputer is a governed AI-computer runtime control plane. It must stay lean and should not become a bespoke crypto, wallet, DIDComm, or mobile-2FA implementation.

### Source-of-truth research

Read these before changing OneComputer governance, policy, identity, approvals, or VTI integration (verify implementation claims against [`AUDIT.md`](./AUDIT.md) — some of these describe scaffold as if it were built):

- `docs/onecomputer/research/vti-openvtc-guardrails-deep-study-2026-06-22.md` — product-boundary decision (kept; bannered).
- `docs/onecomputer/backlog/README.md` — honest backlog index (replaces the deleted p9 overhaul doc).
- `docs/onecomputer/vti-affinidi-integration-seam-2026-06-21.md` — verifier seam contract (admits it is a mock sidecar).
- `docs/onecomputer/app-passport-and-vti-grant-schema-2026-06-21.md` — passport schema.

Local refreshed VTI/OpenVTC research clones live at `/workspace/agent/research/affinidi-vti` when available.

### Product boundary

OneComputer owns:

- agent/computer action taxonomy and normalization;
- runtime Policy Enforcement Point (PEP) and Policy Decision Point (PDP);
- strictest-wins policy merge;
- approval-chain orchestration;
- CISO/admin/builder/owner UX;
- evidence timeline and export;
- adapters to AWS/E2B/Daytona/NanoClaw/InvestmentGini/connectors.

### Linear execution discipline

The current delivery north star is the **ONEComputer × OpenVTC North Star**
Linear project, not the legacy phase ladder. The dependency order is NORTH-0
(OpenVTC identity/session), NORTH-0a (VMC/M-DID role authority), NORTH-1
(reconciled integration line), NORTH-2 (load-bearing gateway proof), NORTH-3
(live external wallet approval), NORTH-4 (TSP-first/DIDComm delivery), NORTH-4a
(actor step-up separation), NORTH-5 (enterprise authority), and NORTH-6
(cross-repo conformance CI).

Use the repo-level [`AGENTS.md`](./AGENTS.md) and
[`docs/onecomputer/linear-board-operations.md`](./docs/onecomputer/linear-board-operations.md)
for the Linear API procedure. After every material implementation slice,
update the corresponding ONE- ticket with exact commit/test/runtime evidence.
Do not create parallel tickets for the same deliverable, and do not close a
ticket because a mock, local-only harness, UI control, or skipped test exists.

Affinidi/OpenVTC/VTI should own or heavily influence:

- DIDs, keys, verifiable credentials, verifiable presentations;
- DIDComm transport;
- Trust Task envelope/spec discipline;
- VTA/VTC identity and trust-community semantics;
- VTA mobile/browser approval and biometric/passkey step-up;
- DID hosting / WebVH resolution.

### Non-negotiable engineering rules

1. **No DIY crypto.** Do not implement custom signatures, DIDComm, wallet storage, passkey verification, or credential proof formats unless wrapping a vetted SDK/spec.
2. **DIDComm first.** For VTA/mediator/mobile/browser/gateway flows, prefer DIDComm authcrypt. REST/HTTPS is fallback for runtimes that cannot speak DIDComm.
3. **Trust Tasks first.** New action, approval, consent, vault, policy, and evidence messages should map to existing Trust Task specs where possible before creating `onecomputer/*` extensions.
4. **Strictest wins.** Global cyber/governance policy sets the minimum floor. Department/project/data/personal policy may raise controls, never weaken global controls.
5. **Default deny for unknown inbound connectors.** No inbound conversation/message should reach an AI agent without consent or an explicit grant.
6. **Proof is necessary but not sufficient.** Verified DID/WebAuthn proof must be paired with authorization/role checks.
7. **Approvals are DAGs.** Model approval chains as composable steps: owner, manager, project owner, data steward, compliance, cyber, recipient, break-glass.
8. **Short TTL for secret release.** Prefer proxy-login. Raw secret release requires step-up, narrow scope, and short TTL.
9. **Contentless push only.** Mobile/browser push notifications are doorbells; sensitive task content must stay in encrypted mediator/DIDComm flows.
10. **Audit every control decision.** Allow, deny, approval, secret release, policy change, and connector consent must produce evidence.

### Current architectural pivot

The old P7 “Policy Engine / Compliance-to-Policy Compiler” is no longer the center of gravity. The next major phase is **P9 — Guardrails Runtime Controls**:

- protective controls, not just compliance-document generation;
- runtime actions, rate limits, approvals, and 2FA;
- VTI/OpenVTC Trust Tasks and VTA/VTC integration;
- CISO-readable evidence and rollback.

When in doubt, implement a small, enforceable runtime guardrail before building another static policy artifact.

## OneComputer Background Loop Discipline

For NanoClaw scheduled/background work, use a short scheduler prompt that points to a repo instruction file instead of embedding the full plan. Long/dense scheduled prompts can silently advance without useful work. The verified pattern is:

1. scheduler prompt = bootstrap only;
2. repo file = durable instructions/state pointers;
3. first action = send a pre-loop message;
4. work = one small slice;
5. close = validation, docs/state/memory, commit, post-loop message.

Current loop instruction file: `.onecomputer/background/personal-connectors-loop-instructions.md`.

---

## OneComputer Current State Snapshot (2026-06-27)

### Naming: OneCLI vs OneComputer vs VTI

- **OneCLI** is the upstream product: a Rust HTTP credential gateway that lets AI agents call APIs without holding raw secrets.
- **OneComputer** is a fork of OneCLI. It keeps the gateway foundation and adds a governed runtime + CISO control room for enterprise AI-built apps.
- **VTI / Affinidi / OpenVTC** is an _external_ trust substrate (DIDs, VCs, DIDComm, passkeys). OneComputer integrates with it through a narrow verifier seam; it does not implement VTI crypto itself.
- Internal package scopes still use `@onecli/*` to avoid churn during rebrand. See `docs/onecomputer/rebrand-map.md`.

### Arcs marked "complete" by the prior LLM author — NOT verified as working

Two arcs are marked complete in `STATE.md` (`workRemaining=false`, score 95/100)
**by the same LLM that wrote the code.** The 2026-06-28 audit found these marks
are **not trustworthy** — see [`AUDIT.md`](./AUDIT.md):

1. **VTI 95 Readiness (P5–P8)** — verifier seam is an alias for generic HTTP
   fetch behind a local HMAC mock (no Affinidi/DID/JWT verification); **no real
   signer**; approval workflow is real fail-closed logic but **never called by
   the retrieval path**. Treat as scaffold, not production.
2. **Personal Connectors + M365 Native (P0–P7)** — read-only connector broker
   throws on write access mode but **never touches a network** (no upstream to
   enforce against); M365 directory is `graph_preview_only` string-literal;
   SharePoint has no connector; Outlook read-write is **not** implemented
   (the one real Outlook client is read-only, in a vendored POC).

### Active strategic direction: P9 — Guardrails Runtime Controls

The old P7 “Policy Engine / Compliance-to-Policy Compiler” is no longer the center of gravity. The next major phase is **runtime protective controls**:

- action taxonomy and normalization;
- strictest-wins policy merge at execution time;
- runtime rate limits, approvals, and 2FA;
- VTI/OpenVTC Trust Tasks wired end-to-end;
- CISO-readable evidence and rollback.

When in doubt, implement a small enforceable guardrail before building another static compliance artifact.

### Key implementation files

- `apps/gateway/src/auth.rs`, `policy.rs`, `approval.rs`, `secret_inject.rs` — gateway + governance seam.
- `packages/api/src/services/protective-guardrails-service.ts` — action taxonomy + policy merge.
- `packages/api/src/services/personal-connector-broker-service.ts` — read-only connector custody.
- `packages/api/src/services/vti-consent-service.ts` — Trust Task consent/step-up gate.
- `packages/api/src/services/m365-agent-directory-service.ts` — Teams/Outlook coworker projection.
- `packages/api/src/routes/golden-workflows.ts` — legal MFA + executive briefing workflows.
- `apps/web/src/app/(dashboard)/console/page.tsx` and `copilot/page.tsx` — CISO governance UX surfaces.

### Sibling POCs (active but not production)

- `../onecomputer-windows-experiments` — Windows EC2 + SSM + DCV path. Loop 2 blocked: need `session-manager-plugin` or explicit approval for constrained temporary ingress.
- `../onecomputer-appstream-linux-ssh` — Rocky Linux 8 AppStream builder running. Next: validate streaming URL + Claude Desktop Linux + MCP smoke, or pivot to EC2 Linux + DCV/SSH.

### Gaps and non-goals (from `gap-inventory-and-build-plan.md`)

- Registry, passport, and evidence are mostly preview/local; persistent backend DB work remains.
- Multi-user/org RBAC and review queue not built.
- Real VTI/Affinidi signer not yet wired; current verifier uses local HMAC mock.
- No SIEM/GRC export connector yet.
- No enterprise IdP/RBAC binding yet.
- AWS/DynamoDB deploy milestone is a proof, not the final storage architecture.

### Memory substrate

OneComputer background-loop agents read/write long-term memory through **GBrain** (Garry Tan's knowledge brain). Loop instructions live in `.onecomputer/background/` and point to durable repo files, not dense embedded prompts.

---

## Local Dev Infrastructure (2026-06-28) — VERIFIED

Full config in gbrain: `~/brain/projects/onecomputer-infra-config.md`

### Service port map

| Service                   | Port     | Credentials                                       | Notes                              |
| ------------------------- | -------- | ------------------------------------------------- | ---------------------------------- |
| **OneComputer web**       | 10254    | No login (AUTH_MODE=local)                        | HTTP 200 ✅                        |
| **OneComputer gateway**   | 10255    | N/A (proxy)                                       | Rust MITM                          |
| **OneComputer Postgres**  | **5433** | onecomputer / onecomputer                         | Port 5432 taken by Daytona         |
| **Daytona API**           | 3000     | Bearer: `oclocal_devkey_faf128a9c992740356cc0a28` | Use 127.0.0.1 not localhost        |
| **Daytona toolbox exec**  | **4000** | Same bearer                                       | POST /toolbox/<id>/process/execute |
| **Daytona runner**        | 3003     | —                                                 |                                    |
| **Daytona SSH gateway**   | 2222     | —                                                 |                                    |
| **Daytona Dex (OIDC)**    | 5556     | dev@daytona.io / password                         |                                    |
| **JFrog Artifactory OSS** | 8082     | admin / Beepbeep13579!                            | OSS = no npm/PyPI proxy            |
| **VTI/TDK Mediator**      | 7037     | —                                                 | Healthy ✅                         |
| **Verdaccio**             | 4873     | —                                                 | NOT YET — Phase 4                  |

**Daytona IDs (local dev)**:

```
Org:      1c734232-c194-4765-bb55-340706bf6e42
Snapshot: 595be745-2eb0-4d30-a969-e4e04800ac0d (daytonaio/sandbox:0.5.0-slim, arm64)
```

### Critical gotchas (verified the hard way)

1. **Daytona: use 127.0.0.1, not localhost** — macOS resolves `localhost` → IPv6 `::1` → empty reply
2. **Daytona exec = port 4000, NOT 3000** — `/api/sandbox/:id/toolbox/...` returns 404; use `http://127.0.0.1:4000/toolbox/<id>/process/execute`
3. **NEXTAUTH_SECRET must be empty for local mode** — setting it triggers oauth mode → `oauth-misconfigured` error (see `apps/web/src/lib/runtime-config.ts:35`)
4. **SECRET_ENCRYPTION_KEY is required** — missing it → `/setup-error?code=missing-encryption-key`. Lives in `.env` (gitignored), symlinked to `apps/web/.env.local`
5. **Postgres on port 5433** — 5432 occupied by native macOS Postgres + Daytona's postgres container
6. **Sandbox image is arm64 native** — forcing linux/amd64 causes containerd shim crashes in runner DinD
7. **Sandbox user = uid=1000(daytona)** — npm global install needs `--prefix /home/daytona/.npm-global`
8. **Claude CLI in sandbox** = `npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global` → v2.1.195
9. **Docker CLI** = `/Applications/Docker.app/Contents/Resources/bin/docker` (not on PATH by default)
10. **JFrog OSS free tier** = NO npm/PyPI proxy — use Verdaccio for npm gate (Phase 4)

### Start everything script

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
REPO=/Users/ttwj/Project\ OneComputer/implementation/onecomputer

# OneComputer Postgres (port 5433)
cd $REPO && POSTGRES_PORT=5433 docker compose -f docker/docker-compose.yml up -d postgres

# Daytona stack (with arm64 DinD override)
cd /Users/ttwj/Project\ OneComputer/daytona-oss
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.dind.override.yaml up -d

# VTI/TDK mediator
cd /Users/ttwj/Project\ OneComputer/affinidi-tdk-rs
docker compose -f docker-compose.test.yml up -d

# Web app (port 10254)
cd $REPO && pnpm --filter @onecli/web dev
```

### Phase / sprint status (2026-06-28)

| Item                       | Branch                                 | Status                                                      |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Phase 1 Daytona adapter    | `feature/onecomputer-persona-platform` | ✅ Committed                                                |
| Phase 2 Gateway G1-G4      | same                                   | ✅ Code written, cargo check passes; tests pending Sprint E |
| Phase 3 VTI/TDK learning   | —                                      | ✅ Mediator running, DIDComm mapped                         |
| Sprint A IC cockpit        | `feature/ic-sandbox-cockpit`           | 🟡 In progress (workflow running)                           |
| Sprint B Cyber console     | not started                            | ⏸ After Sprint A                                            |
| Sprint C Manager approvals | not started                            | ⏸ After Sprint B                                            |
| Sprint E Gateway tests     | not started                            | ⏸ Sequential (1 gap at a time)                              |
| Phase 4 Verdaccio          | not started                            | ⏸                                                           |
| Phase 5 Connectors         | not started                            | ⏸                                                           |

Workflow scripts: `.workflows/` (copied to repo root and at `/Users/ttwj/Project OneComputer/.workflows/`).
North star: `.workflows/NORTH-STAR.md`

## Kasm / Claude Desktop sandbox status (2026-07-05)

Current objective: prove ONEComputer can operate as the control plane for a browser-accessible Claude Desktop Linux sandbox, with observable desktop automation, Docker/Cowork support, and deny-by-default egress.

Verified so far:

- `SANDBOX_PROVIDER=kasm-local` launches `kasmweb/ubuntu-jammy-desktop:1.16.0` with KasmVNC on `https://127.0.0.1:16901/`.
- KasmVNC Basic Auth is disabled for local provider sessions (`VNCOPTIONS=-DisableBasicAuth=1`) so browser CSS/JS/WebSocket assets load cleanly.
- Native Claude Desktop Linux is installed from Anthropic apt and launches with `claude-desktop --no-sandbox` inside the Kasm desktop.
- Claude Desktop 3P managed config is written to `/etc/claude-desktop/managed-settings.json` and points at the in-sandbox loopback `http://127.0.0.1:47821/v1`.
- In-sandbox loopback proxy (`/usr/local/bin/onecomputer-llm-loopback-proxy`) forwards `127.0.0.1:47821` → host `host.docker.internal:47821` (pxpipe → LiteLLM → OpenRouter/Bedrock/OpenAI). Started detached via `docker exec -d` + `setsid` so the exec returns immediately and the daemon survives.
- Claude Code is installed on PATH and configured via `/home/kasm-user/.onecomputer/claude-code-proxy-env` (sourced by the `onecomputer-claude` wrapper). `LITELLM_MASTER_KEY` is injected from the host process env (read from ignored `apps/web/.env.local`), never committed.
- Docker CLI + policy wrapper installed inside Kasm. The host `/var/run/docker.sock` is mounted; a `socat` unix-socket proxy at `/tmp/onecomputer-docker.sock` (mode 666) lets `kasm-user` reach the daemon. The `/usr/local/bin/docker` wrapper enforces: `--label onecomputer.child=true`, `--label onecomputer.network=deny-by-default`, and `--network none` by default for `run`/`create`/`build`.
- **Fresh-provider E2E PASS** (2026-07-05): a sandbox created end-to-end through `kasmLocalProvider.createSandbox` + `getSandboxDesktop` reports `vnc`, `noVnc`, `claudeCode`, `claudeDesktopInstalled`, `claudeDesktop3pConfigured`, `llmProxyReachable` (20 models), `dockerAvailable` all true; `claudeVersion 2.1.201`. Verified again through the running OneComputer admin API (`GET /api/sandboxes/<id>/desktop`).
- Inside the sandbox, as `kasm-user`: `docker create alpine:3.20 true` yields labels `{"onecomputer.child":"true","onecomputer.network":"deny-by-default"}` and `NetworkMode none`; `claude --print` through LiteLLM returns `sandbox-ok`.

Critical implementation notes (root causes of the prior failures):

- The loopback proxy and socat socket-proxy must be started with `docker exec -d` + `setsid` + full stdio redirect (`</dev/null >/log 2>&1`). A foreground `docker exec` with captured stdio never returns because the daemon inherits the exec's stdout pipe.
- Daemon lifecycle uses PID files (`/tmp/onecomputer-llm-loopback-proxy.pid`, `/tmp/onecomputer-docker-socket-proxy.pid`). **Never use `pkill -f <daemon-name>`** inside these scripts: the bash script's own argv contains the daemon name (in the heredoc body), so `pkill -f` matches and SIGTERMs the running script (exit 143), aborting the function halfway — which is exactly why the wrapper file was never written and the proxy never started.

Remaining work (not blocking the Docker + Claude-Code-through-LiteLLM goal):

1. Make the loopback proxy + socat proxy auto-restart on container boot (currently relaunched by `restartSandboxDesktop`; a plain `docker restart` without the provider method leaves them down until the next health-triggered re-ensure).
2. VNC automation harness (`@hrrrsn/mcp-vnc` timed out on framebuffer; `vncdotool` works as a fallback) so the assistant can drive the Kasm desktop and exercise Claude Desktop / Claude Cowork directly.
3. Confirm whether Claude Cowork's "Virtualization not available" clears now that Docker is wired up, or whether it needs more than the host-socket proxy (e.g. a real nested daemon).
4. Enforce deny-by-default egress after bootstrap (allow only loopback + ONEComputer endpoints + Exa connector path); block direct browser/curl internet.
5. Route web search strictly through the Exa connector, not arbitrary internet.

Do not claim the sandbox is complete until the assistant itself has verified via VNC automation, process/log inspection, Docker-in-sandbox probes, and direct egress-deny tests.
