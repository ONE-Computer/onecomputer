# OneComputer — Remote Server Setup (Azure `sandbox03`)

This documents the Azure VM that hosts the Cowork-capable sandbox, the self-hosted Gitea, and the Claude Code coding agent. It is the deployment/test environment and central git source-of-truth for the OneComputer project.

**Last updated:** 2026-07-05

---

## 1. Host: Azure VM `onecomputer-sandbox03`

| Property          | Value                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public IP         | `23.102.117.5`                                                                                                                                                              |
| Region            | eastus2                                                                                                                                                                     |
| Size              | `Standard_D4s_v3` (4 vCPU, 16 GB RAM, 128 GB disk)                                                                                                                          |
| OS                | Ubuntu 22.04 LTS (gen2, Trusted Launch)                                                                                                                                     |
| Subscription      | `1GiniResearch-AI` (`1f08b2fa-0cc6-4bba-b7ee-6c8678764f38`)                                                                                                                 |
| Resource group    | `rg-terencetan-7213`                                                                                                                                                        |
| Azure CLI profile | `sandbox03` (`az account show`)                                                                                                                                             |
| **Nested KVM**    | ✅ Works — `/dev/kvm` present, `vmx` flag, `kvm-ok` passes, `/dev/vhost-vsock` present. This is the Cowork-capable host (Apple Silicon Docker Desktop cannot provide this). |

### SSH access

```bash
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5
```

SSH key: `onecomputer-sandbox03-key` (private key at `/Users/ttwj/.ssh/1783255163_678688`).

### Open ports (NSG `onecomputer-sandbox03-nsg`)

- `22` — host SSH
- `3000` — Gitea web UI
- `2222` — Gitea git SSH
- `5901` — raw VNC (Kasm)
- `6901` — KasmVNC HTTPS
- `10254` — OneComputer web (when running on the VM)

---

## 2. Gitea — self-hosted GitHub-equivalent

| Property       | Value                                           |
| -------------- | ----------------------------------------------- |
| Web UI         | http://23.102.117.5:3000/                       |
| Admin user     | `onecomputer`                                   |
| Admin password | `OneComputer!2026`                              |
| Org            | `onecli` (all repos private)                    |
| Git HTTP clone | `http://23.102.117.5:3000/onecli/<repo>.git`    |
| Git SSH clone  | `ssh://git@23.102.117.5:2222/onecli/<repo>.git` |
| API token      | stored in macOS keychain + `/tmp/gitea-token`   |

### Repositories (full history + branches + tags)

`onecli/onecomputer` (main OneComputer repo, 7 branches incl. `feature/upstream-selective-merge`), `onecli/onecomputer-appstream-linux-ssh`, `onecli/onecomputer-secure-claude-computer-poc`, `onecli/onecomputer-windows-experiments`, `onecli/affinidi-tdk-rs`, `onecli/daytona-oss`, `onecli/graphify`, `onecli/dom-to-pptx`, `onecli/pptxgenjs`, `onecli/tgw-reference`.

**Excluded (sensitive):** gbrain, all Temasek repos — not pushed.

### Push gotcha

The `onecomputer` repo has a husky pre-push hook that runs pnpm and blocks pushes. Always push with `--no-verify`:

```bash
git push --no-verify origin <branch>
```

---

## 3. Claude Code coding agent (on the VM)

A Claude Code agent runs on the VM host, powered by the Mac's LiteLLM via a reverse SSH tunnel. Use it to delegate OneComputer dev tasks.

### Run the agent

```bash
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5
source /etc/onecomputer/claude-code-proxy-env   # sets ANTHROPIC_BASE_URL + key + model
cd ~/work/onecomputer                            # or any repo under ~/work
claude                                            # interactive
# or one-shot:
claude --print "do something"
```

Convenience wrapper: `/usr/local/bin/onecomputer-claude` (sources the env, then runs `claude`).

### Model routing

- `ANTHROPIC_BASE_URL=http://127.0.0.1:47821` → reverse SSH tunnel → Mac's pxpipe → LiteLLM → OpenRouter (GLM 5.2).
- **Model name: `claude-granola-5-2`** (routes to `openrouter/z-ai/glm-5.2`).
- ⚠️ Do **not** use `claude-sonnet-5` / `claude-fable-5` etc. — those route to AWS Bedrock, which is currently blocked by the Temasek Organizations SCP (`bedrock:InvokeModel` explicit deny on accounts 541279446811 and 365225441296). Only the `claude-granola-5-2` / `claude-quartz-*` (OpenRouter) routes work.
- Config: `/etc/onecomputer/claude-code-proxy-env` (root-owned, mode 644, contains `LITELLM_MASTER_KEY`).

### Gitea auth (preconfigured)

- `~/.git-credentials` has the Gitea token; `git config --global credential.helper store` is set.
- Git identity: `OneComputer Agent <agent@onecomputer.local>`.
- `core.hooksPath = /dev/null` globally (disables husky pre-push on the VM).
- Working dir: `~/work/` (onecomputer repo cloned at `~/work/onecomputer`).

### Verified

- `claude --version` → `2.1.201 (Claude Code)`.
- `claude --print "Return only the word: sandbox-ok"` → returns `sandbox-ok` (routes through LiteLLM).
- Agent can clone, branch, commit, and push to Gitea (tested + cleaned up).

---

## 4. Reverse SSH tunnel (Mac → VM, for LLM proxy)

The Mac's LiteLLM/pxpipe stack binds to `127.0.0.1` only. A reverse SSH tunnel exposes it on the VM's loopback so the VM agent (and the in-Kasm Claude Desktop) can reach it.

### Keep the tunnel up

```bash
# from the Mac:
ssh -i /Users/ttwj/.ssh/1783255163_678688 \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N \
  -R 47821:127.0.0.1:47821 \
  -R 4100:127.0.0.1:4100 \
  -R 6006:127.0.0.1:6006 \
  azureuser@23.102.117.5
```

- `47821` → Mac pxpipe (Claude Code / Claude Desktop endpoint)
- `4100` → Mac LiteLLM API + dashboard
- `6006` → Mac Phoenix traces

The tunnel must be running for the VM agent to reach LiteLLM. If `curl http://127.0.0.1:47821/v1/models` fails on the VM, the tunnel is down — restart it from the Mac.

### In-Kasm Claude Desktop connectivity

The Kasm container (`onecomputer-kasm-cowork`) cannot reach the VM's `127.0.0.1:47821` directly (different network namespace). A socat bridge on the VM forwards the docker bridge to the tunnel:

```
container → 172.17.0.1:47821 (socat) → 127.0.0.1:47821 (tunnel) → Mac pxpipe
```

Status: being wired (see Linear ONE-5).

---

## 5. Kasm sandbox container (Cowork-capable)

```bash
# on the VM:
docker run -d --name onecomputer-kasm-cowork \
  --shm-size=512m --cap-add NET_ADMIN \
  --device /dev/kvm --device /dev/vhost-vsock --group-add 109 \
  -e VNC_PW=onecomputer -e VNC_RESOLUTION=1440x900 \
  -e VNCOPTIONS=-DisableBasicAuth=1 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 127.0.0.1:16901:6901 \
  kasmweb/ubuntu-jammy-desktop:1.16.0
```

- KasmVNC desktop: https://23.102.117.5:16901/ (Basic Auth disabled; self-signed cert)
- `/dev/kvm` + `/dev/vhost-vsock` passthrough → Cowork prerequisites met (`kvm-ok` passes inside container).
- Installed inside: Claude Desktop 1.18286.0, Claude Code 2.1.201, qemu-system-x86, ovmf, virtiofsd.
- Open: wire LLM proxy (ONE-5), verify Cowork probe "supported" (ONE-6).

---

## 6. Linear — project management

Linear is the central PM tool (repo `.md` TODOs are no longer source of truth).

- Team: `ONEComputer` (key `ONE`)
- 7 projects (epics), 43 issues, 37 labels
- Web UI: https://linear.app (login terencetanwj@gmail.com)
- API key: `~/linear-api-key.txt`

---

## 7. Common operations

```bash
# SSH in
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5

# Check the agent + tunnel are healthy
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5 \
  'curl -s -o /dev/null -w "litellm=%{http_code}\n" http://127.0.0.1:47821/v1/models'

# Run a delegated task with the agent
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5 \
  'source /etc/onecomputer/claude-code-proxy-env && cd ~/work/onecomputer && claude --print "fix issue ONE-X"'

# Recreate the Kasm sandbox
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5 \
  'docker rm -f onecomputer-kasm-cowork && <docker run command above>'

# Stop / start the VM (save cost)
az vm deallocate --name onecomputer-sandbox03 --resource-group rg-terencetan-7213 --no-wait
az vm start    --name onecomputer-sandbox03 --resource-group rg-terencetan-7213 --no-wait
```

---

## 8. Known issues / gotchas

- **Bedrock SCP block**: the Temasek Organizations SCP denies `bedrock:InvokeModel` on both configured AWS accounts. Use `claude-granola-5-2` (OpenRouter) only until a Bedrock-authorized credential is provided.
- **Reverse tunnel must be re-established** if the Mac sleeps or network changes — it's a foreground SSH process, not a service.
- **KasmVNC self-signed cert** — browsers show "Not Secure" (ONE-39 open).
- **Daemon auto-restart** — the in-Kasm loopback proxy + socat need re-launching on container restart (ONE-8 open).

---

## 9. GUI environment + browser automation (added 2026-07-05)

The VM has a full virtual desktop + Chrome + Playwright so the agent can browse, screenshot, and interact with web UIs.

### Stack

- **Xvfb** virtual display `:99` (1440x900x24)
- **XFCE4** desktop session running on `:99`
- **x11vnc** raw VNC on port `5902` (no password; NSG not exposed externally — local only)
- **noVNC** web view on port `6902` → http://23.102.117.5:6902/vnc.html (watch the agent's desktop in your browser)
- **Google Chrome** 150 (`google-chrome` / `/usr/local/bin/chrome`)
- **Playwright** (chromium) at `~/work/agent-tools/node_modules/playwright`
- **@playwright/mcp** MCP server at `/opt/node22/lib/node_modules/@playwright/mcp/cli.js`, registered with Claude Code

### Auto-start

`onecomputer-desktop.service` systemd unit starts Xvfb + XFCE + x11vnc + noVNC on boot.

```bash
sudo systemctl status onecomputer-desktop
```

### Use the agent with browser tools

```bash
ssh -i /Users/ttwj/.ssh/1783255163_678688 azureuser@23.102.117.5
source /etc/onecomputer/claude-code-proxy-env
cd ~/work/onecomputer   # or ~/work/agent-tools
claude   # interactive — the playwright MCP tools (browser_navigate, browser_snapshot, browser_click, etc.) are auto-available
```

Verified: agent can `browser_navigate` + `browser_snapshot` a live page and report its content.

### Run a browser script directly

```bash
ssh ... azureuser@23.102.117.5 'cd ~/work/agent-tools && DISPLAY=:99 node pw-test.mjs'
```

---

## 10. Security hardening (added 2026-07-05)

### Public exposure (locked down)

Only **two** ports are now public on the VM:
| Port | Service | Auth |
|---|---|---|
| 22 | host SSH | SSH key only (no password login) |
| 3000 | Gitea web (via nginx) | **HTTP Basic Auth** (user , see password below) + Gitea login |

**Closed to public** (accessible only via SSH tunnel): noVNC (6902), KasmVNC (6901/16901), raw VNC (5901), OneComputer web (10254), Gitea git SSH (2222). These have no/weak auth and must never be public.

### Gitea basic-auth proxy

- nginx on port 3000 → proxies to Gitea on (localhost-only).
- Basic-auth credentials: user , password .
- Stored on the VM at (root-readable, mode 600).
- Without the password, Gitea returns .
- The agent pushes to directly (bypassing the proxy) using the Gitea token.

### Firewall

- enabled: deny incoming by default, allow 22 + 3000, allow internal docker0.
- Azure NSG also restricts to 22 + 3000 (defense-in-depth at the cloud layer).

### SSH brute-force protection

- enabled on (bans IPs after repeated failed auth).

### Accessing private services via SSH tunnel

Private ports are reachable by tunneling through SSH (your SSH key is the auth):

## 11. Dev stack start commands (added 2026-07-05, ONE-105)

Stands up the OneComputer dev stack on this VM: Postgres + Next.js API/web (port 10254) + demo seed. The Rust policy gateway (10255) does **not** build on this VM
— see "Gateway blocker" below. Postgres + API + seed are the critical win and are
verified working.

### Prerequisites (already installed on this VM)

- Node 22 + pnpm 9 at `/opt/node22/bin` (add to PATH: `export PATH=/opt/node22/bin:$PATH`).
- `pnpm install` already run at `~/work/onecomputer` (deps present).
- Rust toolchain is installed (`~/.cargo`) + `build-essential`/`libssl-dev` via apt — but
  the gateway still can't build (see blocker).

### Start order (run from `~/work/onecomputer`)

```bash
export PATH=/opt/node22/bin:$PATH
cd ~/work/onecomputer

# 1. Ensure .env exists (DATABASE_URL=postgresql://onecomputer:onecomputer@localhost:5432/onecomputer)
#    If missing: cp .env.example .env   (defaults are correct for this VM)

# 2. Postgres (container onecomputer-postgres-1, postgres:18-alpine, port 5432)
pnpm db:up
# wait for healthy:
docker exec onecomputer-postgres-1 pg_isready -U onecomputer

# 3. Prisma client + schema
pnpm db:generate
pnpm db:push            # applies schema to DB (no migration history needed)

# 4. Demo seed (idempotent) — needs DATABASE_URL from .env, so wrap with dotenv
pnpm exec dotenv -e .env -- pnpm --filter @onecli/api seed:demo

# 5. Next.js API + web on :10254 (background, logs to /tmp/onecomputer-logs/web-dev.log)
mkdir -p /tmp/onecomputer-logs
nohup pnpm dev:web > /tmp/onecomputer-logs/web-dev.log 2>&1 &
echo "web dev pid $!"

# 6. Verify (DB-backed routes return 200):
curl -s -o /dev/null -w "health HTTP %{http_code}\n" http://127.0.0.1:10254/api/health
curl -s -o /dev/null -w "agents HTTP %{http_code}\n"  http://127.0.0.1:10254/api/agents
curl -s -o /dev/null -w "rules   HTTP %{http_code}\n"  http://127.0.0.1:10254/api/rules
```

### Verified running (2026-07-05)

- `onecomputer-postgres-1` — `docker ps`, healthy, `127.0.0.1:5432->5432/tcp`.
- `GET http://127.0.0.1:10254/` → 200.
- `GET /api/health` → 200, `/api/agents` → 200 (returns seeded Default Agent),
  `/api/rules` → 200, `/api/members` → 200 (Demo Corp owner/admin/manager/member).
- Demo seed wrote: org `demo-corp-org`, project `demo-corp-team-field-sales`,
  4 members, 5 policy rules, 1 agent (`b45114d8-…`), 1 pending Outlook-send approval.

### Notes / gotchas

- `/api/sandboxes` returns **HTTP 500**, NOT a stack-down bug: that route calls the
  Daytona adapter, which 401s because `DAYTONA_API_URL`/`DAYTONA_API_KEY` are unset on
  this VM (no Daytona stack here). The API itself is healthy — every DB-backed route
  returns 200. To fix `/api/sandboxes`, point `DAYTONA_API_URL`/`DAYTONA_API_KEY` at a
  Daytona instance or stub the adapter.
- `seed:demo` runs via `tsx` and does **not** auto-load `.env`; always invoke it through
  `pnpm exec dotenv -e .env -- ...` or `DATABASE_URL` is missing and the seed fails.
- API path quirk: the Hono app mounts under `/v1` internally and the Next.js rewrite
  (`apps/web/src/app/api/[[...route]]/route.ts`) prepends another `/v1`, so the public
  path is `/api/<route>` (e.g. `/api/agents`), **not** `/api/v1/<route>` (that 404s
  with `/v1/v1/...`).

### Gateway blocker (port 10255 — NOT running)

`apps/gateway/Cargo.toml` hardcodes **absolute macOS path dependencies** into a sibling
`affinidi-tdk-rs` repo that does not exist on this VM:

```
affinidi-secrets-resolver = { path = "/Users/ttwj/Project OneComputer/affinidi-tdk-rs/crates/core/affinidi-secrets-resolver" }
affinidi-crypto           = { path = "/Users/ttwj/Project OneComputer/affinidi-tdk-rs/crates/core/affinidi-crypto" }
# ... + 7 more affinidi-* path deps
```

`cargo build --release` fails immediately: `failed to read .../affinidi-crypto/Cargo.toml
— No such file or directory`. These path deps are **not behind a Cargo feature**, so there
is no `--no-default-features` escape. To unblock: either (a) check out `affinidi-tdk-rs`
at `~/work/affinidi-tdk-rs` and rewrite the paths, or (b) replace the path deps with the
crates.io registry versions (the `Cargo.toml` comments mention a `[patch]` unification
that already pulls registry versions transitively). Filed as a follow-up; not blocking
DB+API verification.
