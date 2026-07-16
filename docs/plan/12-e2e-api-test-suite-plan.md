# E2E API Test Suite (Phase 1, API-only)

Tracked as task #20. User request: build a CSV-tracked E2E suite, API-first,
then browser. Chosen shape (per user's AskUserQuestion answers): Node `.mjs`
scripts following the existing `scripts/onecomputer/e2e-gateway-approval-proof.mjs`
proof-script convention, plus a single versioned CSV
(`docs/plan/e2e-test-matrix.csv`) as the source of truth for both the test
matrix definition and the latest run result.

## Layout

```
scripts/onecomputer/e2e/
  lib/
    api-client.mjs   # req/get/post/patch/del + session/project header helpers
    db.mjs           # psql helpers (two-tier connection fallback)
    poll.mjs         # pollUntil, lifted from the existing proof script
    csv-tracker.mjs  # RFC 4180 CSV read/targeted-row-update/write
    report.mjs       # report()/summarize()/isMainModule() — shared JSON-out convention
  api/
    auth.mjs         # AUTH-01..03 (done)
    policy.mjs       # POLICY-01..07 (next)
    members.mjs      # MEMBER-01..06
    sandbox.mjs       # SANDBOX-01..06
    approvals.mjs      # APPROVAL-01..07
    audit.mjs           # AUDIT-01..03
  run-all.mjs           # orchestrator (last)
```

## CSV mechanics

`docs/plan/e2e-test-matrix.csv` — one row per test case (32 total across
auth/policy/members/sandbox/approvals/audit), 13 columns. Only
`status`, `last_run_at`, `last_run_evidence` are ever rewritten by scripts,
and only for rows matching ids the script actually executed. Row order and
every other column are preserved byte-for-byte, so `git diff` on the CSV
after a run stays limited to the touched rows.

Status vocabulary: `not_run`, `pass`, `fail`, `blocked` (precondition/env not
met, e.g. Daytona down), `skip` (deliberately deferred, e.g. RBAC-negative
tests pending a session-override investigation — see Open risks below).

## Rollout (one commit per phase, matches project convention)

1. **1a — scaffold + auth**: `lib/*`, CSV (32 rows, `not_run`),
   `api/auth.mjs` (AUTH-01..03). Verified live: 3/3 pass against the running
   API at `http://127.0.0.1:10254`.
2. **1b — policy** (`api/policy.mjs`, POLICY-01..07): 6/7 pass live.
   POLICY-06 (demo-corp project scoping via `X-Project-Id`) is `blocked`,
   not `fail` — confirmed root cause: the local dev session always
   authenticates as the single bootstrapped `local-admin` user
   (`apps/web/src/lib/auth/auth-server.ts`), who is not an
   `OrganizationMember` of `demo-corp-org`. `resolveProjectId`
   (`packages/api/src/middleware/auth/resolve.ts:38-69`) correctly rejects
   `X-Project-Id: demo-corp-team-field-sales` for an identity with no
   membership in that project's org, so `authenticateSession` returns null
   and the request 401s before ever reaching the route handler. This is the
   concrete manifestation of the identity-switching limitation flagged in
   planning — not a bug to fix in this phase, see Open risks.
3. **1c — members** (`api/members.mjs`, MEMBER-01..06): 6/6 pass live.
   Two deviations from the original test-step wording, both documented in
   the CSV `notes` column:
   - MEMBER-04/05 (PATCH role / DELETE) cannot reuse MEMBER-03's invite:
     `inviteMember` (`packages/api/src/services/member-service.ts`) only
     creates an `Invitation` row, never an `OrganizationMember` row, and
     there is no invite-accept API route anywhere in this codebase (invites
     are only consumable through the web app's onboarding UI). PATCH/DELETE
     both do `db.organizationMember.findFirst(...)` and 404 otherwise, so
     the script seeds a throwaway `User` + `OrganizationMember` row directly
     via SQL, exercises PATCH/DELETE against it, and cleans up in a
     `finally` block regardless of assertion outcome.
   - MEMBER-06 (demo-corp seed sanity) hits the same identity-switching
     limitation as POLICY-06 — `local-admin` cannot list members scoped to
     `demo-corp-org` via `X-Project-Id`. Verified via a direct `psql` count +
     role query against `organization_members` instead of the API.
4. **1d — sandbox** (`api/sandbox.mjs`, SANDBOX-01..06): 6/6 pass live
   against real Daytona (create → poll to `started` → list/get → exec
   `echo hello` via the toolbox proxy → delete). Preflight (SANDBOX-01) hits
   the app's own `GET /v1/sandboxes` rather than Daytona's ports directly —
   proves both Daytona reachability and the app's client config in one
   call; on failure marks SANDBOX-02..06 `blocked`, not `fail`. SANDBOX-06
   (delete) needed a poll-for-absence rather than a single immediate GET —
   Daytona's control-plane list endpoint lagged a beat behind the DELETE in
   the first run, so the test polls up to 15s for the sandbox to disappear
   from the list instead of asserting on one GET.
5. **1e — approvals + audit + orchestrator** (`api/approvals.mjs`
   APPROVAL-01..07, `api/audit.mjs` AUDIT-01..03, `run-all.mjs`): 9/10 pass
   live. APPROVAL-01 is `blocked` for the same reason as POLICY-06/
   MEMBER-06 — cannot list demo-corp's pending approvals via
   `X-Project-Id` as `local-admin`. One real script bug caught and fixed:
   `POST /v1/approvals/:id/actor-ack` 403'd on the first run because the
   approval's `requestedBy` was a synthetic string (`'e2e-script'`) that
   didn't match the authenticated session's actual `userId` — the service
   enforces that only the original requester can ack their own step-up.
   Fixed by sourcing `requestedBy` from a live `getSession()` call instead
   of a placeholder string.
   `run-all.mjs` runs all six area scripts in sequence, aggregates every
   result, writes the whole CSV in one pass, and reports success as "no
   `fail` rows" (an area-level `blocked` is an expected, documented state,
   not a suite failure). Full-suite live run: **30 pass / 2 blocked / 0
   fail across all 32 rows** — both blocked rows (POLICY-06, APPROVAL-01)
   trace to the same root cause documented above, and MEMBER-06 works
   around the identical limitation via direct SQL instead of hitting it.

## Phase 2 browser E2E status (2026-07-05)

Phase 2 browser-level E2E has been executed live with the in-app Codex browser
against `http://127.0.0.1:10254`. Browser rows were appended to
`docs/plan/e2e-test-matrix.csv` without changing the completed API rows.

Result across 31 browser rows: **25 pass / 4 blocked / 2 skip / 0 fail**.

Passed browser coverage:

- Auth/local bootstrap: `/` redirects/lands at `/overview` without a real login,
  and reload keeps the `Admin admin@localhost` local session.
- Members/roles read flows and invite/remove flows: members page shows
  `admin@localhost` as `Owner/Platform`, roles matrix shows Owner/Cyber
  Admin/Manager/Employee, invite creates a shareable invite URL, and a
  throwaway real member can be removed through the UI.
- Policy create/disable/delete: custom endpoint block rule creation, toggle
  disabled state, and deletion passed. Allow semantics are exposed through the
  application-permission `Always allow` flow; existing browser-visible
  `e2e-allow-*` allow rules were also visible in the list.
- Sandbox list/create/detail/exec/delete: a new Daytona sandbox
  `phase2-ui-sandbox-1783241238615` reached `Running`, opened at
  `/sandboxes/1c0ef455-45d2-4bbf-9375-aaecf84f6dca`, executed `echo hello`
  through the row-menu Exec terminal with exit code 0, and was deleted from the
  list.
- Approvals/device/actor flows: `/approvals` showed live pending counts and
  seeded requests; browser approve and deny changed counts and removed cards
  from pending; `/device/approvals/7637e9e6-7759-44fc-ba2d-f60122b54671`
  displayed the Trust Task envelope including requester DID, action digest,
  task hash, task type, and delivery status; sandbox actor step-up
  acknowledgement changed to `Identity confirmed`.
- Audit timeline/filter/export: `/audit` showed current admin/approval/gateway
  events, kind filtering worked with `Gateway`, and JSON export fired a browser
  download with the active filter.

Blocked/skip rows:

- `POLICY-06-UI`, `MEMBER-06-UI`, and `APPROVAL-01-UI` are blocked by the
  already-known demo-corp identity-switching gap: local dev always renders as
  `local-admin`/`admin@localhost`, there is no visible project/team selector,
  and `local-admin` is not a demo-corp org member.
- `MEMBER-04-UI` is blocked in this browser run by the Radix Select portal not
  exposing/clicking role options in the in-app browser. The seeded real member
  row appeared and was removable, but the browser could not choose `Manager`
  from the role combobox.
- `POLICY-07-UI` is skipped because manual approval ingest is an internal
  `POST /v1/internal/gateway/manual-approval` path with no browser surface.
- `APPROVAL-04-UI` is skipped because no browser notify/send/trigger VTI button
  exists on `/approvals` or `/device/approvals/[id]`; the API row covers
  `/v1/approvals/:id/vti-notification/trigger`.

Issues observed during browser verification and recorded in the CSV notes:

- `/overview` logs a real React hydration error: a `div` from the Skeleton
  metric loader is rendered inside a `p` in the CISO command center metric
  area.
- The app-permission modal logs repeated Next image warnings for provider SVGs
  where width or height is modified without the other.
- Audit copy currently renders `approvedd` / `deniedd` in admin event rows.
- The sandbox detail xterm console is visible, but in-app browser typing did
  not feed `echo hello`; the list-page Exec terminal dialog is the verified
  working browser exec surface.
- Radix Select option portals were hard to drive from the in-app browser in
  member-role and audit-kind selects; audit kind filtering was still verified
  via `Gateway`.

## Suite status (2026-07-05)

All planned Phase 1 (API-first) areas are implemented and passing live:
auth, policy, members, sandbox, approvals, audit — 32/32 rows have a real
run result (30 `pass`, 2 `blocked`, 0 `fail`, 0 `not_run`). Phase 2
browser-level E2E now has 31/31 rows with a real run result (25 `pass`, 4
`blocked`, 2 `skip`, 0 `fail`, 0 `not_run`).

## Open risks (carried from planning, not blocking 1a)

- **RBAC-negative testing is not yet possible via the API.** The demo-corp
  seed's 4 users (`demo-owner`/`demo-cyber`/`demo-manager`/`demo-alex`) are
  real DB rows with real roles, but `GET /v1/auth/session` in local dev
  always authenticates as the single bootstrapped local-dev user — there is
  no session-provider hook to "become" one of the demo users. A true
  "member tries to approve, gets 403" test needs either a test-only session
  override or per-role API key issuance, neither confirmed to exist yet.
  Deferred past Phase 1; will be tracked as `skip` rows if/when added.
- Sandbox tests depend on live Daytona (ports 3000/4000) — gated by a
  preflight in `sandbox.mjs`/`run-all.mjs` that marks all sandbox rows
  `blocked` (not `fail`) if unreachable.
- Demo-context tests (`POLICY-06`, `MEMBER-06`, `APPROVAL-*`) require
  `DEMO_MODE_ENABLED` server-side (`packages/api/src/lib/env.ts`) — true by
  default outside cloud/production, not explicitly overridden in local
  `.env`.
