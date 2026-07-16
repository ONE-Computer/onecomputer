# 05 — E2E Tests and Readiness Gates

## Standard verification sequence

Run this exact sequence before trusting any "done" claim, and after every workflow run:

```bash
# 1. TypeScript
cd "/Users/ttwj/Project OneComputer/implementation/onecomputer/apps/web"
npx tsc --noEmit

# 2. Rust gateway
export PATH="$HOME/.cargo/bin:$PATH"
cd "/Users/ttwj/Project OneComputer/implementation/onecomputer/apps/gateway"
cargo test
cargo clippy -- -D warnings

# 3. Core goal proof
cd "/Users/ttwj/Project OneComputer/implementation/onecomputer"
node scripts/onecomputer/e2e-goal-proof.mjs
```

Last verified: 2026-07-04, branch `feature/upstream-selective-merge`.

| Check                                   | Result                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| `tsc --noEmit`                          | clean, 0 errors                                                  |
| `cargo test` (unit)                     | 447 passed, 0 failed                                             |
| `cargo test` (integration, default env) | 8 passed — **see caveat below**                                  |
| `cargo clippy -- -D warnings`           | clean                                                            |
| `e2e-goal-proof.mjs`                    | `ok: true`, `deliveryStatus: sent_to_vti_adapter`, `caveats: []` |

## Caveat: integration test suite is weaker than "8 passed" implies

Running `cargo test` without `DATABASE_URL`/`SECRET_ENCRYPTION_KEY` exported causes 6–7 of the 8 integration tests in `apps/gateway/tests/integration.rs` to hit an early `return` guard and print `skipping: DATABASE_URL not set` (or `SECRET_ENCRYPTION_KEY not set`) to stderr — they still report `ok` because the test function exits without an assertion failure, not because they verified anything. This matches a real, previously-documented gap in `AUDIT.md` ("CI never sets `DATABASE_URL`, so 8 passed asserts nothing").

Verified 2026-07-04:

- With env vars unset (default shell): 6 of 8 tests are pure no-ops.
- With `DATABASE_URL=postgresql://onecomputer:onecomputer@localhost:5433/onecomputer` and `SECRET_ENCRYPTION_KEY` sourced from repo `.env`: all 8 tests actually execute logic. One test, `http_proxy_without_auth_forwards`, is flaky — it makes a real network call to `http://httpbin.org/get` and failed twice with a 503 / `WouldBlock` read timeout. This is a live external dependency in the test suite, not a gateway defect.

**Rule going forward:** always export `DATABASE_URL` and `SECRET_ENCRYPTION_KEY` before `cargo test` so the integration suite actually runs:

```bash
cd "/Users/ttwj/Project OneComputer/implementation/onecomputer"
set -a && source .env && set +a
DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer" \
  cargo test --manifest-path apps/gateway/Cargo.toml
```

Do not report "cargo test: N passed" without confirming these env vars were set, or the number is meaningless.

`condition_match.rs` correction: `AUDIT.md` (2026-06-28) describes `matches()` as a stub that "always returns `true`." Reading the current file (624 lines, verified 2026-07-04) shows this is stale — `matches()` calls `condition_matches()` → `body_json_matches()` / `mcp_tool_matches()` with real per-condition logic and dedicated passing/failing unit tests (`matches_mcp_tool_eq_allows_matching_tool`, `matches_mcp_tool_eq_blocks_non_matching_tool`). Treat this AUDIT.md line item as fixed; don't keep citing it as an open gap.

## Readiness ladder (unchanged from `00-current-state.md`)

| Stage                     | Estimate | Gate to move up                                                                               |
| ------------------------- | -------: | --------------------------------------------------------------------------------------------- |
| Prototype/demo            |   70–75% | current                                                                                       |
| Controlled internal pilot |   40–45% | Phase 14 (live gateway callback) + Phase 15 (real VTA delivery) + Phase 17 (Outlook approval) |
| Enterprise production     |   20–25% | Phase 22 (CI) + Phase 23 (security hardening) + Phase 24 (deploy architecture)                |

## E2E goal proof — what it actually proves

`scripts/onecomputer/e2e-goal-proof.mjs` output fields, and what each one is real evidence of:

| Field                                 | Proves                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sandboxStarted: true`                | `POST /v1/sandboxes` created a real Daytona sandbox and it reached `state: started`                              |
| `claudeVersion`                       | Claude Code CLI is installed and runnable inside the sandbox via `/v1/sandboxes/:id/exec`                        |
| `ruleId`                              | `POST /v1/rules` created a real `manual_approval` PolicyRule row                                                 |
| `approvalId`                          | `POST /v1/internal/gateway/manual-approval` created a real ApprovalRequest row                                   |
| `vtiTaskHash`                         | The ApprovalRequest's VTI step-up envelope has a real `sha256:` digest of the requested action                   |
| `deliveryStatus: sent_to_vti_adapter` | `POST /v1/approvals/:id/vti-notification/trigger` transitioned delivery state — **local outbox simulation only** |
| `caveats: []`                         | No known-broken step was hit during this run                                                                     |

What it does **not** prove: no real mobile/VTA DIDComm delivery, no signed manager response, no live Rust-gateway-initiated callback (the approval was created via the internal API route directly, not via a gateway request that got policy-blocked in flight).

## Next E2E gate to build

A second proof script that starts from a gateway-intercepted request (not a direct internal API call), to close the Phase 14 gap: sandbox → Claude Code → tool call → gateway policy hold → gateway calls `/v1/internal/gateway/manual-approval` itself → approval → gateway releases the held request. Until this exists, "the gateway can hold and resume a request" is not proven end-to-end.
