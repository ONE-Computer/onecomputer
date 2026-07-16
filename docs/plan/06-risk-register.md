# 06 — Risk Register

Ranked by blast radius × likelihood. Each entry states what's verified true today, not what a prior scorecard claimed.

## P0 — Security

### R1. Historical secret leak (rotate immediately if not already done)

`AUDIT.md` (2026-06-28) documents a plaintext JFrog `_authToken` committed at `../onecomputer-secure-claude-computer-poc/repos/invgini-core-web/.npmrc:9`. That path is a sibling POC repo, not this checkout, but the token may still be live.

**Action:** confirm the token has been rotated in JFrog Artifactory and purged from that repo's git history. Do not assume private-repo status means it's still secret. Not re-verified in this session — check before next external demo.

### R2. No real cryptographic signer for VTI/step-up approvals

Current signer path is real for the gateway's own DID (`vti_signer.rs` has genuine sign/verify/tamper tests, verified 2026-07-04), but the broader "Affinidi VTI verifier" described in `AUDIT.md` was, as of 2026-06-28, an alias for generic HTTP fetch behind a local HMAC mock — not real DID/JWT verification. Not re-audited this session; treat as still true until re-checked.

**Impact:** a "manager approved via VTI" event cannot yet be cryptographically trusted end-to-end from a real external verifier.

### R3. Integration test suite silently no-ops without env vars

Verified 2026-07-04 (see [`05-e2e-and-readiness-gates.md`](./05-e2e-and-readiness-gates.md)): 6 of 8 `apps/gateway/tests/integration.rs` tests early-return with a "skipping" message when `DATABASE_URL`/`SECRET_ENCRYPTION_KEY` are unset, and CI has no documented step that sets them. `cargo test` reporting "8 passed" is not reliable evidence unless those vars are confirmed set.

**Action:** fix in Phase 22 (CI/E2E automation) — CI must set both vars and the test runner should fail loudly (not skip) if they're missing.

### R4. Flaky external network dependency inside the test suite

`http_proxy_without_auth_forwards` calls real `http://httpbin.org/get`. Verified 2026-07-04: failed twice locally (503, then `WouldBlock` timeout) with real env vars set. This will cause intermittent CI failures unrelated to actual gateway behavior once R3 is fixed and the test actually runs.

**Action:** replace with a local mock upstream (e.g. spin a throwaway `TcpListener` in the test) before wiring this suite into CI.

## P1 — Product-critical gaps (block pilot readiness)

### R5. VTI mobile/VTA delivery is local outbox simulation only

`deliveryStatus: sent_to_vti_adapter` (verified 2026-07-04 via `e2e-goal-proof.mjs`) means the envelope was written to a local outbox, not delivered over DIDComm to a real device. No signed manager response verification exists. This is Phase 15 — the single largest gap between "demo" and "pilot."

### R6. Gateway does not yet self-initiate manual-approval holds

The proven E2E path creates the ApprovalRequest via a direct call to `/v1/internal/gateway/manual-approval`, not via a live Rust-gateway request that got policy-blocked mid-flight and called that endpoint itself. Phase 14. Until closed, "the gateway can pause a risky action and wait for a human" is demoed via API choreography, not via the actual proxy path an agent would use.

### R7. No live Outlook-send or SharePoint connector

Phase 16/17. The only Outlook client that exists is read-only and lives in a vendored sibling POC (`AUDIT.md`), not in this repo. The core demo narrative ("Outlook send requires approval") currently has no real Outlook write surface to gate.

### R8. RBAC UI gap — no visible member/role management

This is exactly what Phase 9 (next up) addresses. Until it ships, there's no `/settings/members` or `/settings/roles` page — enterprise buyers have no way to see who can do what.

## P2 — Readiness / go-to-market risk

### R9. No demo mode / seeded org

Phase 19. An investor demo currently depends on live Daytona/Postgres state being in a good mood. One seeded, reset-able org would remove that fragility.

### R10. CI is weaker than local checks

Local `cargo test` + `tsc --noEmit` are clean (verified 2026-07-04), but per R3, CI likely doesn't set the env vars needed for the integration suite to mean anything, and there's no Playwright/browser E2E in CI at all. Phase 22.

### R11. Self-graded status docs have a track record of overstating readiness

`AUDIT.md` documents a prior "95/100 controlled-pilot readiness" scorecard that was hand-graded by the same LLM author with no formula, contradicted by that same repo's own `vti95-state.json` admitting a 25/100 baseline. **Standing rule:** any readiness percentage in this repo's docs (including this plan folder) must be re-derived from a command you ran yourself this session, not copied from a prior doc. The `00-current-state.md` 70/45/25 percentages were carried over from `AUDIT.md` and have not been independently re-derived by a scoring formula — treat them as informed estimates, not measurements.

## Not risks — resolved since last audit

- `condition_match::matches()` "always returns true" (AUDIT.md, 2026-06-28) — **stale.** Verified 2026-07-04: real per-condition logic (`body_json_matches`, `mcp_tool_matches`) with passing/failing unit test pairs. Removed from active risk list.

- **R-SW. Strictest-wins not enforced in real gateway** — **CLOSED 2026-07-04 (commit 9e178ec).** Cross-scope policy merge (`merge_rule_sets()`) is now in `policy.rs` on the real enforcement path. 7 matrix tests cover: org-block-overrides-agent-allow, project-raises-floor, agent-rate-limit-over-project-allow, no-rules-defaults-allow, no-bleed-to-other-paths, and two regressions. Previously the strictest-wins logic lived only in `protective-guardrails-service.ts` with `enforcement: "simulator_only_not_enforced"`.
