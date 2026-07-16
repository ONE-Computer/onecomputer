# Demo mode — seed, reset, and what the demo data represents

Status: **implemented and verified 2026-07-04** (Agent 19-A/B/C). Seed script lands real
rows through the same services the product uses; reset is idempotent and hard-scoped to the
"Demo Corp" namespace by stable ids — it can never touch a real org.

## What gets seeded

Running the seed creates a self-contained "Demo Corp" org that gives the CEO demo (and any
manual QA pass) a believable, populated instance without depending on live luck:

| Entity                           | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization                     | `Demo Corp` (stable id `demo-corp-org`, slug `demo-corp`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Members (4, one per role)        | Olivia Owner (`owner@demo.onecomputer.local`, Owner/Platform), Casey Cyber (`cyber@demo.onecomputer.local`, Cyber Admin), Morgan Manager (`manager@demo.onecomputer.local`, Manager), Alex Employee (`alex@demo.onecomputer.local`, Employee)                                                                                                                                                                                                                 |
| Project ("Team")                 | `Field Sales Team` (stable id `demo-corp-team-field-sales`) — a Project is the "Team" concept per the phase-17 project-as-team model                                                                                                                                                                                                                                                                                                                          |
| Enterprise (org-scope) policies  | Block `registry.npmjs.org`, block `pypi.org` — created via `policy-rule-service.createPolicyRule`                                                                                                                                                                                                                                                                                                                                                             |
| Team (project-scope) policy      | `manual_approval` on `POST graph.microsoft.com/v1.0/me/sendMail` (Outlook send)                                                                                                                                                                                                                                                                                                                                                                               |
| User/agent-scope policy          | `rate_limit` (20/hour) on `POST slack.com/api/chat.postMessage`, scoped to Alex's agent only                                                                                                                                                                                                                                                                                                                                                                  |
| Agent                            | "Alex's Agent" (`alex-agent`), minted via `agent-service.createAgent` — real access token + `did:web:...` identity                                                                                                                                                                                                                                                                                                                                            |
| Story event 1 — blocked install  | A `RequestLog` row: Alex's agent attempted `GET registry.npmjs.org/left-pad`, decision `blocked`. Populates the Cyber console violations feed and the `/audit` timeline "gateway" event.                                                                                                                                                                                                                                                                      |
| Story event 2 — pending approval | A `pending` `ApprovalRequest` for Alex's agent trying to send an Outlook email, created via `approval-service.createApproval` so it carries a **real** `context._vti.stepUpRequest` (manager step-up) and `context._vti.actorStepUp` (actor step-up, phase-15a). Populates `/approvals`, `/device/approvals/:id`, and the audit timeline "approval" event.                                                                                                    |
| Story event 3 — sandbox          | **Deliberately skipped.** There is no `Sandbox` Prisma model — Daytona sandboxes are live-only (`packages/api/src/services/daytona-service.ts` fetches from the Daytona API and never persists to Postgres). Seeding a fake "running" row would misrepresent state nothing in the product reads back, which `AUDIT.md` explicitly warns against. If you need a sandbox in the demo, spin up a real one against the demo agent's token before the walkthrough. |

Everything is created through the same services the HTTP routes use
(`agent-service`, `policy-rule-service`, `approval-service`), not raw `db.*.create` calls, so
seeded rows carry the same validation, defaults, and audit-relevant shape as data created
through the product. The one exception is `OrganizationMember` — there is no synchronous
"add member" in `member-service` (it's invite-token based), so the seed mirrors the same
minimal-safe upsert `bootstrapOrganization` itself uses for a first member.

## Commands

Run from the repo root (or `packages/api/`):

```bash
# Seed (idempotent — safe to run any number of times, never creates duplicates)
pnpm --filter @onecli/api seed:demo

# Reset then reseed (wipes ONLY the Demo Corp namespace, then reseeds from scratch)
pnpm --filter @onecli/api seed:demo:reset
```

Both read `DATABASE_URL` from the environment the same way the rest of the API does, e.g.:

```bash
DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer" \
  pnpm --filter @onecli/api seed:demo:reset
```

### How reset is scoped (safety)

`seed:demo:reset` sets `SEED_DEMO_RESET=1`, which is required before any delete runs — plain
`seed:demo` never deletes anything. The reset deletes rows in FK-safe order
(`AuditLog`/`RequestLog`/`ApprovalRequest`/`PolicyRule`/`Agent` → `OrganizationMember` →
`Project` → the 4 demo `User` rows → `Organization`), and every `deleteMany` is filtered by
one of:

- `organizationId: "demo-corp-org"` / `projectId: "demo-corp-team-field-sales"` (stable,
  well-known ids chosen specifically so they're unmistakable in logs/DB browsers), or
- `externalAuthId IN (demo-owner, demo-cyber, demo-manager, demo-alex)` for the 4 users.

There is no unscoped `deleteMany({})` anywhere in the reset path — it is structurally
incapable of touching a non-demo org, project, or user. See
`packages/api/src/scripts/seed-demo.ts:resetDemoNamespace`.

### Verified idempotency (2026-07-04 run)

```
$ pnpm --filter @onecli/api seed:demo:reset
[seed-demo] Resetting Demo Corp namespace...
[seed-demo] Demo Corp namespace reset complete. {"auditLogsDeleted":0,"requestLogsDeleted":1,"approvalsDeleted":1,"policyRulesDeleted":4,"agentsDeleted":1,"membersDeleted":4,"projectsDeleted":1,"usersDeleted":4,"orgsDeleted":1,...}
[seed-demo] Seeding Demo Corp...
[seed-demo] organization ready {"id":"demo-corp-org","slug":"demo-corp"}
...
[seed-demo] created agent for alex@demo {"agentId":"5821b822-1ad4-4465-a814-1256e5d64674", ...}
[seed-demo] created blocked install RequestLog {"id":"c3f85a86-01b1-4b2d-8f51-f99ef6e2d4ac", ...}
[seed-demo] created pending Outlook-send approval for alex@demo {"id":"45ac8b31-f0a8-48af-992a-b69f48614465", "hasStepUpRequest":true,"hasActorStepUp":true}

$ pnpm --filter @onecli/api seed:demo    # run again, no reset flag
[seed-demo] Seeding Demo Corp...
[seed-demo] organization ready {"id":"demo-corp-org","slug":"demo-corp"}      # same id
...
[seed-demo] policy rule already exists, skipping: Block public npm registry {"ruleId":"62bd0f98-62e7-43ed-988a-0be696a24b91"}
[seed-demo] agent already exists, skipping creation {"agentId":"5821b822-1ad4-4465-a814-1256e5d64674"}   # same id
[seed-demo] blocked install RequestLog already exists, skipping {"id":"c3f85a86-01b1-4b2d-8f51-f99ef6e2d4ac"}  # same id
[seed-demo] alex@demo Outlook approval already exists, skipping {"id":"45ac8b31-f0a8-48af-992a-b69f48614465","status":"pending"}  # same id
```

Row counts after both runs (via `psql`): `organizations=1`, `projects=1`,
`organization_members=4`, `users=4` (demo), `agents=1`, `policy_rules=4`, `request_logs=1`,
`approval_requests=1` — no duplicates.

## Reset UI (Owner-only, local/demo mode only)

There is a "Reset demo data" card on **Settings → Instance** (`/settings/instance`), gated on:

1. `getRuntimeConfig().authMode !== "cloud"` (client-side — matches every other local-only
   surface in this app, e.g. `role-preference.ts`'s simulated-persona pattern), and
2. the simulated persona role being `owner` (`usePersonaRole()` / `role-preference.ts`) — the
   same "local dev has no real per-request role, so the UI simulates one" pattern the rest of
   the app already uses for role-gated affordances (see `sandboxes-content.tsx`).

Clicking the button opens a confirm dialog ("This deletes all Demo Corp data and reseeds it.
This cannot be undone.") and, on confirm, calls the `resetDemoData` Next.js Server Action
(`apps/web/src/lib/actions/demo.ts`), which runs **in-process** (this app mounts the API's
Hono app directly inside `apps/web/src/app/api/[[...route]]/route.ts` via `app.fetch()`, so
there's no separate network hop between web and API to guard with a shared secret here). It
calls `resetDemoNamespace()` then `runDemoSeed()` directly.

There is also a standalone HTTP route, **`POST /v1/internal/demo/reset`**
(`packages/api/src/routes/internal.ts`), for any caller outside the Next.js process (e.g. the
gateway, or a future ops script). It is guarded by:

- `internalAuth` — the same shared-secret (`X-Gateway-Secret` / `GATEWAY_INTERNAL_SECRET`)
  middleware every other `/v1/internal/*` route uses, and
- a server-side `DEMO_MODE_ENABLED` check (`packages/api/src/lib/env.ts`) that hard-disables
  the route whenever `EDITION=cloud` or `NODE_ENV=production`, regardless of whether a caller
  has the shared secret.

Both paths — the server action and the HTTP route — delegate to the exact same
`resetDemoNamespace()` + `runDemoSeed()` functions the CLI script uses
(`packages/api/src/scripts/seed-demo.ts`), so there is only one implementation of "what demo
reset means." `DEMO_MODE_ENABLED` is the real authorization boundary in both cases; the
client-side Owner+local-mode gate on the button is UX, matching the rest of this app's
simulated-persona pattern (`role-preference.ts`) — not a security control.

Verified live (2026-07-05), same-secret call against the running dev server:

```
$ curl -s -X POST http://127.0.0.1:10254/v1/internal/demo/reset \
    -H "X-Gateway-Secret: dev-secret-change-in-prod"
{"deleted":{"...":"...","orgsDeleted":1,...},"seeded":{"organizationId":"demo-corp-org","projectId":"demo-corp-team-field-sales","agentId":"91e7cfb5-...",...}}

$ curl -s -X POST http://127.0.0.1:10254/v1/internal/demo/reset
{"error":{"message":"unauthorized","type":"authentication_error"}}   # HTTP 401, no secret
```

**Tradeoff note:** if you are short on time, the CLI (`pnpm seed:demo:reset`) is sufficient
for every real demo-day scenario — the UI button and the HTTP route are conveniences for a
live walkthrough where dropping to a terminal would break the narrative.

## Files

- `packages/api/src/scripts/seed-demo.ts` — `runDemoSeed()` (idempotent create/upsert),
  `resetDemoNamespace()` (scoped delete), CLI entrypoint.
- `packages/api/src/routes/internal.ts` — `POST /v1/internal/demo/reset`.
- `packages/api/src/lib/env.ts` — `DEMO_MODE_ENABLED`.
- `apps/web/src/lib/actions/demo.ts` — `resetDemoData` server action used by the UI.
- `apps/web/src/app/(dashboard)/settings/instance/_components/reset-demo-data-card.tsx` — the
  UI (Owner persona + non-cloud gated).
- `apps/web/src/hooks/use-persona-role.ts` — `useIsOwner()`.
- `packages/api/package.json` — `seed:demo`, `seed:demo:reset` scripts.
- `packages/api/package.json` (exports map) — added `./scripts/*` so the web app can import
  `runDemoSeed`/`resetDemoNamespace`.
- `turbo.json` — declared `DEMO_MODE`, `SEED_DEMO_RESET` env vars.
