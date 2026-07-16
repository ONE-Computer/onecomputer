# OneComputer — Workflow Scripts

Five `/workflow` scripts covering Phases 1-5. Each delivers a working
vertical slice with a live smoke test at the end — not just compiled code.

## Running order

```bash
# Phase 0: manual — DO THESE FIRST (no workflow can do them for you)
# 1. Rotate the JFrog token + git filter-repo on the POC repo
# 2. Add DATABASE_URL to .github/workflows/ci.yml

# Then run in order:
/workflow .workflows/phase-1-sandbox-wiring.js       # Daytona adapter + Claude in sandbox
/workflow .workflows/phase-2-gateway-enforcement.js  # condition matching + MCP parser + channels + Prometheus
/workflow .workflows/phase-3-identity.js             # did:web + VP signing + sandbox DID + OAuth consent
/workflow .workflows/phase-4-package-gate.js         # Verdaccio + gateway blocklist + sandbox npm config
/workflow .workflows/phase-5-connectors.js           # SharePoint read-only + Outlook write + step-up gate

# Phase 1 and 4 are independent — can run concurrently.
# Phase 2 and 3 are independent — can run concurrently.
# Phase 5 needs Phase 2 (channels) and Phase 3 (step-up) ideally done first.
```

---

## Phase 1 — Sandbox Wiring (`phase-1-sandbox-wiring.js`)

**Delivers:** `POST /v1/sandboxes` in the OneComputer API creates a real Daytona
sandbox with Claude Code installed and npm pointed at the package gate.

| What                    | Details                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `DaytonaSandboxService` | TypeScript adapter: create, exec, stop, delete, list — wraps Daytona API + toolbox |
| `bootstrapSandbox()`    | Installs `@anthropic-ai/claude-code` via npm on sandbox start                      |
| Package gate config     | npm registry → Verdaccio:4873 (Phase 4), HTTPS_PROXY → gateway:10255               |
| Smoke test              | Creates a real sandbox, installs Claude, verifies `claude --version`               |

**Key facts wired in:** toolbox exec goes to port 4000 (not 3000); sandbox runs
as `uid=1000(daytona)`; npm global install needs `--prefix /home/daytona/.npm-global`.

---

## Phase 2 — Gateway Enforcement (`phase-2-gateway-enforcement.js`)

**Delivers:** The Rust gateway actually enforces policy — conditions match on
request body, MCP tool names can be allow/deny listed, all requests are metered
in Prometheus.

| Gap                | File                 | What it does                                                                                  |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| G1 condition_match | `condition_match.rs` | `matches()` evaluates `conditions_raw` JSON — `body_json:$.action eq send` works              |
| G2 MCP parser      | `mcp.rs` (new)       | Parses JSON-RPC 2.0 `tools/call`, extracts tool name for `mcp_tool:<name>` conditions         |
| G3 Channel routing | `channel.rs` (new)   | Path-prefix → `{id, name, target_endpoint, protocol}` abstraction; tags requests              |
| G4 Prometheus      | `metrics.rs` (new)   | `/metrics` endpoint, `agent_trust_gateway_*` series (requests, blocked, latency, connections) |

**Verify:** each gap must be called from `gateway/forward.rs` — not just exist.

---

## Phase 3 — Identity Layer (`phase-3-identity.js`)

**Delivers:** Every MCP response carries a signed `AgentIdentityCredential` VP.
Every sandbox agent has a `did:web` identity. OAuth connectors return `consent_required`
instead of a generic error.

| Gap              | File                          | What it does                                                                              |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| I1 VTI signer    | `vti_signer.rs` (new)         | Gateway `did:web` key + `DataIntegrityProof::sign` using affinidi crates — no DIY crypto  |
| I2 VP injection  | `identity_injection.rs` (new) | Injects signed VP into MCP `result._meta.agentIdentity`                                   |
| I3 Sandbox DID   | `agent-service.ts`            | `provisionAgentDid()` called in `createAgent()` — `did:web:onecomputer.local:agents:<id>` |
| I4 OAuth consent | `apps.ts` / connectors route  | HTTP 401 `consent_required` + `authorization_url` when credentials missing                |

**Hard stop:** if any agent produces DIY crypto (raw Ed25519, custom DIDComm),
the workflow stops and rejects those changes.

**Scaffold phase:** verifies affinidi crate path deps compile before any implementation.
Crates from: `/Users/ttwj/Project OneComputer/affinidi-tdk-rs/crates/`

---

## Phase 4 — Package Gate (`phase-4-package-gate.js`)

**Delivers:** `npm install` in a sandbox goes through Verdaccio (not npmjs.org
directly). Gateway 403s all direct registry access.

| What                       | Details                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Verdaccio                  | Docker container, port 4873, proxies npmjs.org                                              |
| Gateway blocklist extended | Adds `crates.io`, `files.pythonhosted.org`, `cdn.jsdelivr.net`, `raw.githubusercontent.com` |
| Sandbox bootstrap          | npm registry config → `http://host.docker.internal:4873`                                    |
| Smoke test                 | `npm install express` in a sandbox → Verdaccio → works                                      |

**Note on JFrog:** JFrog Artifactory OSS free tier does NOT support npm/PyPI proxy.
It is used for generic artifact storage and Maven/Gradle only.
Verdaccio is the npm gate. Future: pip gate via a PyPI proxy (devpi or Verdaccio PyPI plugin).

---

## Phase 5 — Connectors (`phase-5-connectors.js`)

**Delivers:** SharePoint (read-only) and Outlook (read + step-up-gated write)
as governed MCP tools through the gateway.

| What                 | Details                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| SharePoint connector | `sharepoint-connector.ts` — GET only; write-surface AST test                        |
| Outlook connector    | `outlook-connector.ts` — read free, write gated by `vti-consent-service.ts` step-up |
| Step-up gate WIRED   | `authorizePersonalConnectorRetrievalWithVtiConsent` finally called from a real path |
| MCP tools            | `mcp-tools.ts` — tool manifests for Claude discovery                                |
| Channel configs      | `ONECLI_CHANNELS` env — SharePoint + Outlook channels with policy rules             |

**Note:** Phase 5 needs a real Microsoft 365 tenant + OAuth token to test live.
The smoke test is code-level only (write-surface audit, TypeScript compile, grep for step-up wiring).

---

## What each workflow guarantees

Every workflow ends with a **Capture phase** that:

1. Writes a `~/brain/projects/onecomputer-phase<N>-result.md` to gbrain
2. Updates `STATE.md` with real phase results
3. States what is REAL vs TODO — no self-grading

A gap is marked **REAL** only if:

- A test asserts behavior that would fail if the code was removed
- The code is called from a real request path (verified by grep)
- `cargo clippy -D warnings` or `tsc --noEmit` passes
