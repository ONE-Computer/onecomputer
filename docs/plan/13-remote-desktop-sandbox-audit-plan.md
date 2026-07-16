# 13 — Remote desktop sandbox audit + repair plan

Date: 2026-07-05  
Branch: `feature/upstream-selective-merge`

## Executive truth reset

The current OneComputer sandbox feature is a real Daytona-backed sandbox lifecycle plus a governed one-command exec console. It is **not yet** a browser-accessible desktop computer. There is no implemented XFCE/X11/VNC/noVNC stack, no desktop health API, no `desktopUrl`, and no UI path that opens or embeds a remote desktop.

The cornerstone demo requirement therefore remains open:

> Boot a real sandboxed computer with browser-accessible VNC/noVNC, openable from OneComputer, with Claude Code or a Claude-accessible environment inside, governed by OneComputer policy/approval/audit.

Honest Claude wording: unless a native Claude Desktop Linux app is actually installed and launched inside the sandbox, the demo must say **"remote desktop with Claude Code CLI / Claude web"**, not "Claude Desktop in the sandbox".

## Verified / inspected code paths

### API sandbox lifecycle

- `packages/api/src/routes/sandboxes.ts`
  - Mounts authenticated/RBAC-protected sandbox routes under `/v1/sandboxes`.
  - `GET /` lists Daytona sandboxes.
  - `POST /` creates Daytona sandbox and audits `AUDIT_ACTIONS.CREATE`.
  - `GET /:id` fetches Daytona sandbox.
  - `POST /:id/exec` runs one command via toolbox proxy.
  - `DELETE /:id` deletes sandbox and audits `AUDIT_ACTIONS.DELETE`.
  - Missing: `GET /:id/desktop`, `POST /:id/desktop/restart`, desktop-open audit action.

- `packages/api/src/services/daytona-service.ts`
  - Daytona API: `DAYTONA_API_URL` default `http://127.0.0.1:3000`.
  - Daytona bearer token default is the local dev key.
  - Toolbox proxy: `DAYTONA_PROXY_URL` default `http://127.0.0.1:4000`.
  - `createSandbox(name)` posts `/api/sandbox`, polls until `started`, then calls `bootstrapSandbox()`.
  - `execInSandbox()` posts to `/toolbox/<id>/process/execute` with `{ command }`.
  - `SandboxInfo` only has `id`, `name`, `state`, `toolboxUrl`, `claudeVersion?`, `bootstrapped`.
  - Missing: desktop fields and persistent local sandbox metadata.

- `packages/api/src/services/sandbox-bootstrap.ts`
  - Configures npm registry / optional gateway proxy.
  - Installs Claude Code CLI with:
    - `npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global`
    - `PATH=/home/daytona/.npm-global/bin:$PATH`
  - Verifies `claude --version` and parses version line.
  - Missing: XFCE, VNC server, noVNC, websockify, browser, terminal launcher, desktop log/status file.

### Web UI

- `apps/web/src/lib/api/sandboxes.ts`
  - Typed fetch wrappers for list/get/create/exec/delete.
  - Missing desktop API wrapper and desktop health type.

- `apps/web/src/app/(dashboard)/sandboxes/page.tsx`
  - Server-fetches `/v1/sandboxes` for list page.

- `apps/web/src/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx`
  - Shows sandbox list and “New Sandbox”.
  - Creation copy says Claude Code pre-installed.
  - Dropdown has “Exec terminal” and “Delete”.
  - Missing “Open Desktop”, desktop readiness, noVNC health, desktop boot copy.

- `apps/web/src/app/(dashboard)/sandboxes/[id]/page.tsx`
  - Server-fetches `/v1/sandboxes/:id` and renders detail.

- `apps/web/src/app/(dashboard)/sandboxes/[id]/_components/sandbox-detail.tsx`
  - Primary card is currently `Console`.
  - Governed action and details appear below.
  - Missing primary remote-desktop card / iframe / new-tab URL / desktop health timeline.

- `apps/web/src/app/(dashboard)/sandboxes/[id]/_components/sandbox-terminal.tsx`
  - xterm-like UI but explicitly one-command-at-a-time.
  - Each Enter calls `POST /v1/sandboxes/:id/exec`.
  - It is not an interactive pty/shell and not a remote desktop.

### Auth/IAM inspected paths

- `apps/web/src/lib/auth/auth-provider.tsx`
  - Local mode hardcodes authenticated user:
    - `id: local-admin`
    - `email: admin@localhost`
  - Local `signOut: async () => {}` is a no-op.
  - OAuth mode uses NextAuth sign-in/out.

- `apps/web/src/lib/auth/auth-server.ts`
  - Local mode upserts local user and bootstraps a default organization/project.
  - OAuth mode uses NextAuth session.

- `apps/web/src/app/auth/login/page.tsx`
  - Delegates to login content; local-vs-OAuth copy needs explicit review in R7.

## Live verification status

Attempted local API verification on 2026-07-05:

```bash
curl http://127.0.0.1:10256/v1/sandboxes
```

Result in this audit session: connection refused on port `10256`. Therefore this pass could inspect source truth but could not complete live API/browser proof. When services are running, R0 must be completed with:

- `GET /v1/sandboxes`
- `POST /v1/sandboxes`
- `GET /v1/sandboxes/:id`
- `POST /v1/sandboxes/:id/exec`:
  - `echo hello`
  - `claude --version`
  - `ps aux | grep -Ei 'vnc|novnc|websockify|xfce'`
  - `ss -ltnp || netstat -ltnp`
- Browser:
  - `/sandboxes`
  - `/sandboxes/[id]`
  - sign-out behavior in local mode

## What currently works

Based on source inspection and previous current-state documentation:

1. Daytona-backed sandbox creation path exists.
2. Daytona toolbox exec path exists through OneComputer API.
3. Claude Code CLI bootstrap exists and verifies `claude --version` when successful.
4. Sandbox create/delete audit exists for API-mediated lifecycle actions.
5. UI can list sandboxes and show a detail page.
6. The console accurately labels itself as “one command per line” and “Not a full interactive shell.”

## What does not work / is not implemented

1. No real remote desktop stack:
   - no XFCE/X11 startup
   - no TigerVNC/x11vnc
   - no noVNC/websockify
   - no browser in sandbox
   - no terminal launcher in desktop
2. No `desktopUrl` or desktop route.
3. No noVNC iframe or open-desktop button.
4. No desktop health check or boot log.
5. No persistence for desktop metadata; list/get normalize Daytona responses only.
6. No proof that Daytona exposes port `6080` directly.
7. No reverse proxy for noVNC/WebSocket traffic.
8. No keystroke-level VNC governance. Existing governance covers API-mediated actions, not raw VNC clicks/typing.
9. Native Claude Desktop inside Linux sandbox is not proven and should not be claimed.
10. Local auth sign-out is a no-op and should be labelled/hid to avoid demo embarrassment.

## IAM truth table

| Mode                 | Login                                           | Logout                                       | User identity                     | Org/RBAC truth                                                                                                               | Demo note                                                           |
| -------------------- | ----------------------------------------------- | -------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Local demo mode      | No real login; app treats user as authenticated | No real logout; current `signOut` is a no-op | `local-admin` / `admin@localhost` | Local server bootstraps a default organization/project; UI persona role may come from localStorage and may not equal DB role | Must be labelled “Local demo mode — no real logout”                 |
| OAuth/Entra mode     | Real NextAuth sign-in                           | Real NextAuth sign-out                       | NextAuth session user             | First sign-in maps/bootstrap path; manager/admin escalation requires actual assignment                                       | Suitable for real IAM claims only after assignment verified         |
| Demo-corp seeded org | Depends on mode                                 | Depends on mode                              | In local mode still `local-admin` | `local-admin` is not automatically a seeded demo-corp member; `X-Project-Id: demo-corp-team-field-sales` may 401             | Do not treat as bug unless implementing persona switching/demo auth |

## Target architecture

### Sandbox runtime

Bootstrap a Daytona sandbox into a real desktop host with:

- Lightweight Linux desktop: XFCE preferred.
- VNC server: TigerVNC or x11vnc.
- noVNC + websockify on internal port `6080`.
- VNC on internal port `5901`.
- Browser: Chromium or Firefox ESR.
- Terminal emulator.
- Node/npm.
- Claude Code CLI installed under `/home/daytona/.npm-global` and PATH configured.
- Desktop launchers:
  - `Claude Code Terminal`
  - `Claude Web`
  - `OneComputer Demo README`
- Logs/status:
  - `/home/daytona/.onecomputer/bootstrap.log`
  - `/home/daytona/.onecomputer/desktop-status.json`

### API

Extend `SandboxInfo`:

```ts
interface SandboxInfo {
  id: string;
  name: string;
  state: string;
  toolboxUrl: string;
  claudeVersion?: string;
  bootstrapped: boolean;
  desktopUrl?: string;
  desktopReady?: boolean;
  desktopHealth?: {
    vnc: boolean;
    noVnc: boolean;
    claudeCode: boolean;
    browser: boolean;
  };
  bootLogTail?: string;
}
```

Add routes:

- `GET /v1/sandboxes/:id/desktop`
- optional `POST /v1/sandboxes/:id/desktop/restart`

Persist sandbox metadata in DB if migrations are acceptable:

- `id`, `organizationId`, `projectId`, `ownerId`, `daytonaId`, `name`, `state`, `desktopUrl`, `desktopReady`, `claudeVersion`, `bootstrapped`, `createdAt`, `updatedAt`.

### Networking

Required unanswered question: how Daytona exposes sandbox port `6080`.

Preferred demo path:

1. Direct Daytona/public/preview URL if available.
2. Return that URL as `desktopUrl`.
3. UI opens noVNC in a new tab.

Hardening path:

1. OneComputer-authenticated reverse proxy for noVNC HTTP and WebSocket traffic.
2. Short-lived signed desktop session token.
3. Audit desktop-open event.
4. Document that raw VNC interactions are still not command-level governed unless instrumented.

### UI

- List page:
  - Show desktop state: Creating / Booting desktop / Desktop ready / Error.
  - Show “Open Desktop” only when `desktopReady`.
- Detail page:
  - Primary card: “Remote Desktop”.
  - iframe only if same-origin/proxy works; otherwise new-tab button.
  - Secondary card: governed exec console for diagnostics.
  - Health/log/timeline card.
  - Honest copy: “Claude Code is available in the sandbox terminal”; do not claim native Claude Desktop unless true.

## Phased implementation plan

### R0 — Audit and truth reset

- Complete live API/browser verification when services are running.
- Produce this document, update current-state doc, update E2E matrix, append gbrain.
- Commit: `docs: audit remote desktop sandbox gap`.

### R1 — Manual desktop bootstrap proof

- Create one Daytona sandbox.
- Determine OS/package manager.
- Prototype idempotent install/start script for XFCE, VNC, noVNC, websockify, browser, terminal, Claude Code.
- Prove processes, ports, noVNC page, and `claude --version`.
- Determine Daytona port exposure method.
- Commit script/docs.

### R2 — Productize desktop bootstrap in API

- Add `sandbox-desktop-bootstrap.ts` or extend bootstrap service.
- Add `bootstrapClaudeCode()`, `bootstrapDesktop()`, `checkDesktopHealth()`.
- Write logs/status files in sandbox.
- Add `GET /v1/sandboxes/:id/desktop`.
- Extend `SandboxInfo`.
- Add tests.

### R3 — noVNC access path

- Implement direct desktop URL if Daytona supports port exposure.
- Else implement OneComputer reverse proxy with WebSocket support.
- Add UI “Open Desktop”.

### R4 — Desktop-first UX

- Make remote desktop the primary sandbox detail card.
- Keep command console as diagnostic secondary UI.
- Add health/timeline/log display.

### R5 — Claude experience inside desktop

- Add desktop launchers for Claude Code terminal, Claude web, README.
- Verify `claude --version` inside VNC terminal.
- Document auth limitations; do not bake secrets into image.

### R6 — Governance/audit integration

- Add audit action for desktop opened.
- Keep exec governed.
- Document that raw VNC interactions are not command-by-command policy-enforced.
- Ensure `/audit` shows lifecycle.

### R7 — IAM/local auth cleanup

- Label local demo mode.
- Hide or replace fake sign-out in local mode.
- Login page says “Continue as local admin” in local mode.

### R8 — Browser E2E

- Browser test: create sandbox → wait desktop health → open noVNC → see desktop → open terminal → `claude --version` → delete → audit lifecycle.
- Store screenshots/evidence.

## Demo risks

| Risk                                                 | Severity | Mitigation                                                                                                                                                                        |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daytona does not expose arbitrary sandbox ports      | High     | Implement WebSocket-capable OneComputer reverse proxy or local tunnel                                                                                                             |
| Desktop install is slow/flaky                        | High     | Build Daytona snapshot with desktop preinstalled after prototype                                                                                                                  |
| noVNC WebSocket proxy complexity                     | High     | Direct preview URL for demo, proxy in hardening phase                                                                                                                             |
| Claude Code auth unavailable in sandbox              | Medium   | Show installed CLI/version/help and browser Claude web path; document auth                                                                                                        |
| Native Claude Desktop unavailable in Linux/container | Medium   | Kasm/Jammy proof now launches native Claude Desktop Linux with `claude-desktop --no-sandbox`; keep UI health split between installed/running and document Electron sandbox caveat |
| VNC interactions not governed                        | Medium   | Govern launch/API actions; be explicit about current limitation                                                                                                                   |
| Local logout no-op                                   | Medium   | R7 copy/UI cleanup before demo                                                                                                                                                    |

## Kasm native Claude Desktop proof update (2026-07-05)

Daytona arbitrary port exposure remains unproven, so the working provider path is `SANDBOX_PROVIDER=kasm-local`. The provider now defaults to `kasmweb/ubuntu-jammy-desktop:1.16.0`, installs `claude-desktop` from Anthropic's apt repository, and installs Claude Code with Node 22. Native Claude Desktop Linux is not merely present on disk: it stays running inside the Kasm desktop when launched with `claude-desktop --no-sandbox`, which avoids Chromium namespace sandbox failure inside Docker. Health is split into `claudeCode`, `claudeDesktopInstalled`, and `claudeDesktopRunning` to avoid overstating CLI success as native app success.

Remaining hardening is browser delivery polish: KasmVNC local HTTPS/basic-auth currently needs a trusted cert, OneComputer proxy, or full Kasm Workspaces session URL for clean automated browser proof.

## Acceptance criteria

The repair is not complete until a browser shows a real remote desktop session, not merely API success. Minimum demo pass:

1. Click New Sandbox.
2. Sandbox starts.
3. Desktop health reports ready.
4. Click Open Desktop.
5. Browser loads noVNC and shows a real Linux desktop.
6. Terminal inside VNC can run `claude --version` or equivalent Claude-accessible workflow.
7. Lifecycle actions are visible in audit.
8. UI copy honestly distinguishes Claude Code/web from native Claude Desktop.
