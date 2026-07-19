# 001: launch a real Kasm sandbox from ONEComputer

Status: `complete`

Gate: B
Depends on: 000
Unblocks: 002

## Outcome

An authenticated employee can use the existing ONEComputer workspace journey
to create or reuse one real Kasm sandbox, observe honest lifecycle state, open
the session, restart it, and stop it through server-mediated APIs.

This is the first product slice. It proves the visible workspace promise before
model, MCP, approval, and broader governance capabilities are added.

## In scope

- Keep the selected employee UI in `apps/web` as the product entry point and
  connect its workspace actions to typed Control API operations.
- Establish only the minimum monorepo, shared workspace contracts, and owned
  database migration needed by this vertical slice; later issues extend these
  foundations instead of replacing them.
- Add the minimum `apps/control-api` workspace routes required for create/get,
  open, restart, stop, and delete, with authenticated tenant and subject context,
  correlation IDs, idempotency, and typed errors.
- Add a private `apps/workspace-controller` and `packages/kasm-adapter`; only
  the controller receives Kasm administration or Docker authority.
- Pin the Kasm release, workspace image, API contract, and container digests
  used by this slice.
- Persist the minimum owned workspace identity and lifecycle record required to
  recover create/restart/stop operations without treating Kasm as product truth.
- Implement one-sandbox-per-grant behavior, TTL, readiness dimensions, launch
  URL handoff, reconciliation, and delete/recreate cleanup.
- Show honest `not_created`, `provisioning`, `ready`, `open`, `restarting`,
  `stopping`, `stopped`, and `failed` states in the existing UI.
- Start with a deny-by-default sandbox network that permits only the Kasm
  session path and dependencies explicitly required for provisioning. Later
  issues add governed model, MCP, web, and package destinations.

## Out of scope

- LiteLLM, model providers, MCP servers, OneDrive, OpenVTC, approval flows,
  broad web/package egress, production autoscaling, or hostile multi-tenant VM
  isolation claims.
- Provider credentials, gateway master keys, or policy authority inside the
  sandbox or browser.
- A general-purpose workspace marketplace, image builder, or administrator
  console.

## Required verification

- [x] Clicking the primary workspace action creates or reuses exactly one Kasm
  sandbox for the authenticated tenant, subject, and workspace grant.
- [x] Concurrent create/retry requests with the same idempotency key cannot
  create duplicate Kasm sessions, containers, networks, or product records.
- [x] The browser can reach only the public Web and Control API; it receives no
  Kasm admin credential, Docker authority, host-control token, or internal URL.
- [x] Public Web and Control API containers have no Docker socket or Kasm admin
  credential; only the private workspace controller has lifecycle authority.
- [x] Cross-tenant, cross-subject, guessed workspace ID, expired grant, and
  direct controller/Kasm access fail before lifecycle mutation.
- [x] Refresh, Control restart, controller restart, duplicate callback, and
  Kasm/API timeout recover to one honest lifecycle state without manual data
  mutation.
- [x] Open, restart, stop, delete, and delete/recreate work from the product UI
  and leave no orphaned session, container, network, port, token, or grant.
- [x] Sandbox probes cannot reach model providers, upstream MCP servers,
  Microsoft Graph, PostgreSQL, Docker, host metadata, another sandbox, or
  unrestricted public egress.
- [x] Loading, empty, degraded, failed, retry, and stopped states are visibly
  distinct from ready and accessible by keyboard and screen reader.
- [x] Logs, browser storage, network traces, errors, and screenshots contain no
  prohibited credential or sensitive Kasm response.

## Evidence required

Include the lifecycle contract, UI/API state map, pinned versions and digests,
tenant/subject authorization matrix, idempotency and concurrency results,
restart/reconciliation results, network probe matrix, browser security scan,
container privilege inventory, cleanup inventory, and responsive journey
screenshots.

## Stop conditions

- The browser or public Control API requires Kasm administration or Docker
  authority.
- Kasm identifiers or status are accepted as tenant ownership without an owned
  authenticated workspace record.
- Create/retry/reconciliation can produce duplicate or orphaned sandboxes.
- The sandbox requires broad egress or can directly reach a prohibited target.
- Passing requires hiding a failed or unknown lifecycle dimension behind a
  generic ready state.

## Completion record

Completed locally on 2026-07-19 using the pinned `kasm-local` provider and
managed desktop-relay boundary proven in the experimentation branch. The
greenfield implementation keeps lifecycle authority in the private workspace
controller, persists product ownership in PostgreSQL, and connects the selected
employee UI through the typed Control API.

Evidence: `.artifacts/v4/issues/001/20260719T080700Z/verification.md` and
`workspace-ready.png` (local, intentionally ignored).

The optional Kasm Workspaces Developer API adapter is also present. Live
qualification of that deployment mode requires an external Kasm server and is
not a blocker for the local Kasm/Docker capability accepted by Issue 000.

## Post-completion follow-up

The pinned `kasmweb/ubuntu-jammy-desktop` image is Kasm's broad general-purpose
desktop and includes many applications that ONEComputer did not select, such as
Signal, Telegram, Slack, Zoom, OBS, Thunderbird, and multiple editors and
browsers. It was suitable for proving the lifecycle, but it is not the intended
employee product image.

During workspace containment hardening, replace it with a pinned, owned minimal
image containing only the approved browser, terminal, editor, ONEComputer
launchers, and required runtimes. Record the package inventory, image digest,
update process, vulnerability scan, and confirmation that removed applications
and launchers are absent. This follow-up does not reopen the completed Issue 001
lifecycle proof.
