# InvGini Agent Governance Integration

Last updated: 2026-06-20 SGT  
Branch: `feature/agent-did-governance-autoplan`

## Purpose

OneCLI is the SecOps/admin governance console for the agent fleet. InvestmentGini remains the friendly business-user UX. OneCLI governs connectors, policies, approvals, audit, and incidents.

## Current slice

This branch adds the first Telegram connector surface:

- Telegram app registration.
- Telegram connection category mapping.
- Telegram permission definitions for policy rules.
- Risk notes for `sendDocument`, `sendPhoto`, and `deleteMessage`.

## Intended admin jobs

SecOps should be able to:

- see every InvGini-created agent;
- inspect each agent DID/trust-provider identity;
- see connector access and resource grants;
- force manual approval on risky actions;
- block destructive or external-send actions;
- export audit and receipt packs.

## Telegram default policy recommendation

For autonomous agents:

- allow `sendMessage` only to approved chats;
- require manual approval for `sendPhoto`;
- block or require manual approval for `sendDocument`;
- require manual approval for `deleteMessage`;
- keep `getUpdates` limited because it exposes chat metadata.

## Update cadence

Update this document whenever OneCLI adds an InvGini connector, agent registry view, policy action, approval queue behavior, or audit/receipt integration.

## 2026-06-20 InvGini event ingestion seam

Added `POST /v1/agents/invgini-governance/events` as a validation-first POC seam. InvGini can push `AgentRegistered`, `GrantChanged`, `ActionRequested`, and `ReceiptCreated` events to OneCLI. The endpoint validates the external-agent contract and returns accepted principals. Persistence should be added after OneCLI's non-OneCLI-origin agent data model is finalized.

## 2026-06-20 approval-decision event update

The InvGini event contract now accepts `ActionDecided` events with optional `decidedByUserId` and `decidedAt` fields on `actionRequest`. InvGini remains source-of-truth for the decision in this slice; OneCLI receives the event so the SecOps console can display and audit approval outcomes once persistence lands.

See `docs/invgini-agent-events.example.json` for the cross-system event payload used by the POC contract checks.

## 2026-06-20 SecOps registry UI update

Added a lightweight `GET /v1/agents/invgini-governance` endpoint backed by the current in-process POC registry and a dashboard page at `/agents?view=invgini`. The page gives cybersecurity/admin users a first OneCLI-native view of InvGini-created agent DID identities, latest event, mandates, grants, and pending approval count. This is intentionally non-durable until the permanent external-agent registry schema lands.

## 2026-06-20 durable registry update

Promoted the InvGini registry from in-process POC state to a Prisma-backed schema and migration:

- `InvginiAgentPrincipal`
- `InvginiAgentMandate`
- `InvginiAgentResourceGrant`
- `InvginiAgentActionRequest`

`POST /v1/agents/invgini-governance/events` now upserts principals and authority snapshots into DB. `GET /v1/agents/invgini-governance` reads the durable registry and returns pending action requests for the `/agents?view=invgini` SecOps page. This is still a POC admin experience, but the data is no longer process-local.

## 2026-06-20 API E2E validator update

Added `pnpm --filter @onecli/api validate:invgini-api-e2e`, a DB-backed Hono route validator for the InvGini registry seam. It runs against a migrated Postgres DB and verifies:

1. `AgentRegistered` ingest persists the principal, mandate, and resource-grant snapshot;
2. `GET /v1/agents/invgini-governance` returns the durable registry entry;
3. `ActionRequested` with `PENDING` status appears in `pendingActionRequests`;
4. `ActionDecided` clears the pending queue for that request.

Latest validation used a clean local Postgres DB on port `5435` and returned:

```json
{
  "ok": true,
  "projectId": "00000000-0000-4000-8000-900000000001",
  "principalDid": "did:invgini:agent:00000000000040008000000000000001",
  "mandates": 1,
  "resourceGrants": 1,
  "pendingActionRequests": 0
}
```

## 2026-06-20 command-center dashboard update

Upgraded `/agents?view=invgini` from a basic registry list into a SecOps command-center dashboard. The page now includes:

- fleet KPI cards for total agents, active principals, pending approvals, high-risk queue, connector surfaces, and local-stub trust-provider count;
- a derived governance risk score and guardrail checklist;
- a live operating-signal panel showing the latest event per agent;
- an approval queue table grouped by agent, connector, action, risk tier, resource, and requested time;
- a connector exposure matrix aggregating grants and pending actions by connector;
- search and filters for all agents, pending agents, high-risk agents, and local-stub identities;
- selectable agent detail panel with DID/accountability fields, mandates, grants, and recent action-request history;
- placeholder controls for the next admin actions: Affinidi verifier status, receipt exports, and bulk policy/freeze/revoke workflows.

The API response now also returns recent `actionRequests` in addition to `pendingActionRequests`, so the dashboard can show historical approved/rejected/pending context without losing the fast pending queue.

## 2026-06-20 update: receipt ledger and audit command center

OneCLI now persists InvGini `ReceiptCreated` events in `invgini_agent_action_receipts` and returns `actionReceipts` from `GET /v1/agents/invgini-governance`.

Dashboard additions:

- fleet-level audit-receipt metric;
- non-success receipt contribution to the derived risk score;
- audit receipt ledger table across the fleet;
- per-agent recent receipt inspection in the detail panel.

This moves the page closer to a multinational-bank/Pentagon-grade command center: it no longer only shows identity and pending approvals, but also provides evidence of what agents attempted, completed, denied, or blocked.

## 2026-06-20 update: policy telemetry

InvGini action-request events now support policy telemetry:

- `riskScore`: numeric 0-100 score;
- `policySignals`: structured policy-engine output containing rule IDs, severity, disposition, weights, and messages.

OneCLI persists these fields on `invgini_agent_action_requests`, includes them in `GET /v1/agents/invgini-governance`, and renders the score/messages in the command-center approval queue and agent detail view. The dashboard risk score now also uses action `riskScore`, not only text risk tiers.

## 2026-06-20 update: organization-wide fleet scope

Added an organization/fleet endpoint for the cybersecurity/admin command center:

- `GET /v1/agents/invgini-governance/fleet`
- compatibility alias: `GET /v1/invgini/agents/fleet`

The existing `GET /v1/agents/invgini-governance` endpoint remains project-scoped for current-project workflows. The new fleet endpoint returns InvGini agent registry entries across every project in the caller's organization and includes project metadata on every entry:

```json
{
  "projectId": "00000000-0000-4000-8000-900000000001",
  "project": {
    "id": "00000000-0000-4000-8000-900000000001",
    "name": "InvGini API E2E Project",
    "slug": "invgini-api-e2e-project"
  }
}
```

The `/agents?view=invgini` dashboard now consumes the fleet endpoint, adds a project-scope selector, shows project metadata in approval/receipt tables and agent details, and tracks the number of projects covered. This moves OneCLI closer to the intended SecOps/Pentagon-grade view: monitor all InvGini-created agents as a governed organization-wide coworker fleet, then narrow to one project only when investigating an incident or mandate.

The DB-backed E2E validator now seeds two projects in one organization and verifies that:

1. the project-scoped endpoint still returns only the current project;
2. the fleet endpoint spans both projects;
3. project metadata is present in registry responses.

## 2026-06-20 update: durable SecOps control intents

OneCLI now records durable SecOps/admin control intents for InvGini external agents:

- `FREEZE_AGENT`
- `REQUIRE_APPROVAL`
- `REVOKE_GRANTS`
- `QUARANTINE_CONNECTOR`
- `EXPORT_RECEIPTS`

API endpoints:

- `POST /v1/agents/invgini-governance/:principalId/controls`
- compatibility alias: `POST /v1/invgini/agents/:principalId/controls`

The control record includes action, status, reason, optional connector, optional resource metadata, requesting user/email, and timestamps. `GET /v1/agents/invgini-governance` and `GET /v1/agents/invgini-governance/fleet` include recent `controlActions` on each registry entry.

The `/agents?view=invgini` command center now renders a `SecOps controls` panel in the selected-agent detail view with first-pass actions for freeze, force approval, revoke grants, quarantine connector, and export receipts. These actions currently record OneCLI governance intent and make the dashboard operational; the next composed-service slice should have InvGini backend consume these control intents and enforce them before Graph/SharePoint/Teams/Telegram execution.

The DB-backed E2E validator now creates a `FREEZE_AGENT` control and verifies it is returned in the project-scoped registry response. Latest E2E output includes:

```json
{
  "controlActions": 1,
  "fleetProjects": 2,
  "fleetAgents": 2
}
```

## Validation hardening — 2026-06-20

The InvGini API E2E validation script now locates the target principal by ID instead of assuming the first registry row is the test agent. This keeps the validation stable when the E2E database already contains previous InvGini registry/control rows.

Latest validation evidence:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli-invgini-api-e2e pnpm --filter @onecli/api validate:invgini-api-e2e
```

Result:

```json
{
  "ok": true,
  "projectId": "00000000-0000-4000-8000-900000000001",
  "principalDid": "did:invgini:agent:00000000000040008000000000000001",
  "mandates": 1,
  "resourceGrants": 1,
  "pendingActionRequests": 0,
  "actionReceipts": 1,
  "controlActions": 3,
  "fleetProjects": 2,
  "fleetAgents": 2
}
```

This complements the backend composed test where a OneCLI-compatible `FREEZE_AGENT` control blocks a real InvGini autonomous route and produces a OneCLI-sourced denied receipt.

## 2026-06-20 update: bank-grade SecOps cockpit hardening

Sharpened the `/agents?view=invgini` dashboard beyond a registry/control page into a higher-assurance command cockpit for cybersecurity teams:

- mission-control command bar with posture state, open controls, approval-SLA breaches, and OneCLI policy-signal counts;
- incident command board that prioritizes open freeze/quarantine/revoke controls, stale approval queues, high-risk pending actions, and non-success receipts;
- rules and telemetry intelligence panel that surfaces policy-engine source, severity, disposition, and explanatory messages from action requests and receipt details;
- control coverage matrix for `FREEZE_AGENT`, `REQUIRE_APPROVAL`, `REVOKE_GRANTS`, `QUARANTINE_CONNECTOR`, and `EXPORT_RECEIPTS` across the selected organization/project scope;
- approval and receipt ledgers now show policy-source attribution and approval-SLA status, making it clearer when InvGini backend enforcement was driven by OneCLI rather than only local runtime rules.

This keeps OneCLI positioned as the Pentagon/multinational-bank-grade SecOps dashboard while InvestmentGini remains the business-user-friendly agent UX.

## 2026-06-20 update: live standalone route and unmocked dashboard verification

The OneCLI web app now exposes the InvGini governance registry through explicit Next route handlers as well as the package API/Hono route tree:

- `GET /v1/agents/invgini-governance/fleet`
- `GET /v1/agents/invgini-governance`
- `POST /v1/agents/invgini-governance/events`
- `POST /v1/agents/invgini-governance/:principalId/controls`

The route handlers reuse the same InvGini registry service and auth/session resolution as the API package, which keeps the web dashboard lean and avoids a second bespoke implementation. The dashboard was verified in a standalone Next server with the browser using the real local route, not a CDP fetch mock.

Local NanoClaw verification note: when testing loopback endpoints from the agent container, bypass the OneCLI/NanoClaw HTTP proxy; otherwise `curl http://127.0.0.1:10254/...` can be routed through the host proxy and appear to hit an older server. Use either:

```bash
curl --noproxy '*' http://127.0.0.1:10254/v1/agents/invgini-governance/fleet
```

or launch Chromium with:

```bash
chromium --no-proxy-server --remote-debugging-port=9223 ...
```

Latest unmocked dashboard probe:

```json
{
  "apiState": { "ok": true, "status": 200, "count": 2 },
  "browserErrors": []
}
```

Latest validation evidence:

```bash
pnpm exec prettier --check 'apps/web/src/app/(dashboard)/agents/_components/invgini-agents-content.tsx' apps/web/src/app/v1/[[...route]]/route.ts apps/web/src/lib/api/invgini-next-routes.ts apps/web/src/lib/api/invgini.ts docs/invgini-agent-governance.md
pnpm --filter @onecli/web check-types
pnpm --filter @onecli/web lint
SECRET_ENCRYPTION_KEY=00000000000000000000000000000000 NEXT_PUBLIC_EDITION=oss NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm --filter @onecli/web build
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli-invgini-api-e2e pnpm --filter @onecli/api validate:invgini-api-e2e
```

Result:

```json
{
  "ok": true,
  "controlActions": 7,
  "fleetProjects": 2,
  "fleetAgents": 2
}
```

## 2026-06-20 update: Affinidi identity metadata mirror

OneCLI now accepts and persists `principal.metadata` from InvGini agent governance events. This is the SecOps-side mirror for DID/VC/VTA/VTC issuance details without requiring OneCLI to own InvGini's product flow.

Expected metadata examples:

```json
{
  "affinidi_status": "issued",
  "affinidi_credential_type": "InvGiniAgentAuthorityCredential",
  "affinidi_credential_id": "vc-agent-001",
  "affinidi_credential_offer_uri": "openid-credential-offer://...",
  "affinidi_trust_anchor_did": "did:key:issuer",
  "affinidi_vta_id": "vta-001",
  "affinidi_vtc_id": "vtc-001"
}
```

The `/agents?view=invgini` dashboard uses this metadata to label the fleet as `Affinidi issued`, `Affinidi fallback`, `Affinidi not configured`, or `Affinidi pending` instead of showing only raw provider strings. This preserves OneCLI's role as the SecOps command plane while letting Affinidi or a OneCLI-managed issuer broker perform the credential-heavy work.

## 2026-06-20 VTI message-bridge / Trust Task scout

Terence shared Affinidi-team feedback that a VTI `vti-message-bridge` can sit above NanoClaw-native routing and add verifiable consent, DIDComm, signed/hash-chained Trust Tasks, opaque handles, and VTA-signed policy enforcement. This changes the OneCLI dashboard plan: OneCLI should become the SecOps command center for both InvGini-native governance events and VTI bridge telemetry/receipts.

### OneCLI TODO

- Add a future `VTI bridge` ingestion lane beside the existing InvGini governance event lane. It should accept Trust Task lifecycle events, connector opaque-handle metadata, consent-gate state, VTA/VTC policy references, and hash-chain anchors.
- Keep raw connector IDs out of OneCLI by default; show opaque handles and resolver/status metadata only.
- Extend the dashboard vocabulary from only `ActionRequested/ReceiptCreated` to Trust Task states: `held_by_consent_gate`, `policy_evaluated`, `delivered_to_agent`, `agent_response_signed`, `receipt_anchored`, `bridge_error`.
- Treat OneCLI controls (`FREEZE_AGENT`, `REQUIRE_APPROVAL`, `REVOKE_GRANTS`, `QUARANTINE_CONNECTOR`) as policy intents that can be mirrored into VTA/Trust Registry/bridge allowlists.
- Prefer SDK-side integration: use `vti-didcomm-js` for browser/Node DIDComm/VTA auth when building admin workflows, and keep Rust DIDComm/mediator responsibilities in VTI sidecars.

### Scout result

Public repos cloned locally under `/workspace/agent/research/affinidi-vti`. The exact `vti-message-bridge` repo was not publicly discoverable; closest public implementation patterns are `vti-push-gateway` for opaque handles + VTA allowlists, `dtgwg-trust-tasks-tf` for Trust Task documents/transports, `verifiable-trust-infrastructure` for VTA/VTC/ACL/audit, and `affinidi-tdk-rs` for DIDComm mediator/service crates.

## 2026-06-20 VTI bridge contract-first implementation slice

Added a contract-first VTI bridge lane without implementing DIDComm in OneCLI or InvGini:

- `docs/invgini-vti-bridge-contract.md` defines the OneCLI-facing event contract.
- InvGini `ActionRequested` and `ReceiptCreated` events may include `vtiBridge` metadata.
- OneCLI persists `vtiBridge` JSON on action requests and receipts.
- The schema rejects raw connector identifier fields inside `vtiBridge`; operators see opaque handles and Trust Task/policy/consent references instead.
- Added a first evidence-pack route: `GET /v1/agents/invgini-governance/:principalId/evidence-pack`, returning principal, mandates, grants, requests, receipts, controls, and extracted VTI bridge artifacts.

This keeps OneCLI aligned with the brokered sidecar architecture: OneCLI governs and exports evidence, while the VTI bridge/VTA owns DIDComm, connector custody, raw platform IDs, signed policy, and consent artifacts.

## 2026-06-20 autoplan/UI update: Agent Passport and Evidence Pack panels

Autoplan sharpening for the continuation slice:

- Keep this phase bounded to OneCLI operator UX and the VTI contract seam.
- Do **not** expand into real DIDComm, mediator runtime, or VTA signature verification inside OneCLI.
- Fix visual QA issues before moving on; the first screenshot revealed the right-side detail rail could clip at desktop widths, so the fleet/detail grid now uses `minmax(0, 1fr)` and a bounded right rail.

Dashboard additions:

- The selected-agent detail rail now includes an **Agent Passport** panel with DID, trust provider, Affinidi status, VTI custody posture, opaque handle, and latest Trust Task ID.
- The selected-agent detail rail now includes an **Evidence Pack** panel that loads `/v1/agents/invgini-governance/:principalId/evidence-pack`, summarizes receipts/controls/VTI artifacts, and downloads the JSON bundle for incident or regulatory handoff.
- Added a Next.js API route for the evidence pack so local OSS/dashboard deployments can call the same compatibility path as the backend API.

Validation evidence for this UI slice:

```bash
pnpm --filter @onecli/web check-types
pnpm --filter @onecli/web lint
NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm --filter @onecli/web build
pnpm --filter @onecli/api validate:invgini-api-e2e
pnpm run format:check
```

Visual QA evidence:

- Desktop screenshot: `/workspace/agent/reports/screenshots/onecli-invgini-vti-agent-passport-full-desktop-2026-06-20.png`
- Tablet screenshot: `/workspace/agent/reports/screenshots/onecli-invgini-vti-agent-passport-tablet-2026-06-20.png`
- Chrome DevTools Protocol console/layout probe: no browser console errors; `hasHorizontalOverflow: false` at 1440px.

## 2026-06-20 update: VTI raw-ID rejection hardening

Hardened the InvGini/OneCLI VTI metadata contract:

- InvGini backend now prefers persisted `vti_bridge` metadata and strips nested bridge envelopes from policy telemetry/details before syncing governance events to OneCLI.
- Unsafe envelopes with raw connector identifiers are dropped before mirror sync.
- OneCLI validation rejects additional raw connector key variants such as `messageId`, `message_id`, `userId`, and `user_id` inside `vtiBridge`.
- The InvGini API E2E validator includes a negative raw-ID event case while preserving the positive evidence-pack path with `vtiBridgeArtifacts: 2`.

## 2026-06-20 update: production build TLS hardening

During the cross-repo audit, `pnpm --filter @onecli/web build` failed in the NanoClaw container while `next/font/google` fetched `Source Serif 4` because Turbopack was not using system TLS certificates. The build passed with `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`, so the same setting is now codified in `apps/web/next.config.js` via `experimental.turbopackUseSystemTlsCerts = true`.

This keeps the operator dashboard build reproducible without relying on a one-off shell environment variable. Post-change validation passed:

```bash
pnpm --filter @onecli/web build
pnpm --filter @onecli/web check-types
pnpm --filter @onecli/web lint
pnpm run format:check
```

## 2026-06-20 update: backend-authored composed E2E fixture

The InvGini API validator now accepts `INVGINI_EVENTS_FIXTURE` so it can ingest backend-authored governance events, not only the checked-in hand fixture. This is useful for composed POC verification:

```bash
cd /workspace/agent/implementation/invgini-backend-service
PYTHONPATH=. \
ENVIRONMENT_NAME=local \
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/invgini_backend_did_e2e \
REDIS_URL=mock_value \
INVGINI_COMPOSED_EVENTS_OUTPUT=/workspace/agent/reports/composed-invgini-backend-events-2026-06-20.json \
.venv/bin/python scripts/generate_composed_invgini_governance_events.py

cd /workspace/agent/research/onecli/onecli
createdb -h 127.0.0.1 -p 5435 -U postgres onecli_invgini_composed_e2e 2>/dev/null || true
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli_invgini_composed_e2e \
  pnpm --filter @onecli/db prisma db push --accept-data-loss

DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli_invgini_composed_e2e \
INVGINI_EVENTS_FIXTURE=/workspace/agent/reports/composed-invgini-backend-events-2026-06-20.json \
  pnpm --filter @onecli/api validate:invgini-api-e2e
```

Latest result:

```json
{
  "ok": true,
  "mandates": 1,
  "resourceGrants": 2,
  "actionReceipts": 1,
  "controlActions": 1,
  "vtiBridgeArtifacts": 2,
  "fleetAgents": 2
}
```

This keeps the E2E lean: backend authors the authority/VTI event contract; OneCLI proves ingestion, fleet view, controls, and evidence pack export against that backend-authored contract.

## 2026-06-20 autoplan hardening: Trust Flight Recorder and control lifecycle

This slice promotes the OneCLI command center from “dashboard over current tables” to a truth-backed audit surface:

- Added `InvginiAgentEventLog` as the persisted Trust Flight Recorder for InvGini governance events.
- Event ingest now runs transactionally and upserts event-log rows by deterministic SHA-256 event hash (`projectId + stable event payload`) so replayed bridge events are idempotent.
- Registry entries now expose `eventLogCount` and `lastEventHash` so every fleet card can trace back to immutable ingest evidence.
- Evidence packs now include `eventLogs` in addition to principal, mandates, grants, action requests, receipts, controls, and VTI bridge artifacts.
- Added event-log API routes:
  - `GET /v1/agents/invgini-governance/:principalId/events`
  - compatibility alias: `GET /v1/invgini/agents/:principalId/events`
- SecOps control intents now support lifecycle fields: `expiresAt`, `resolvedAt`, `resolvedByUserId`, `resolvedByEmail`, and `resolutionReason`.
- The Next route seam now gates fleet/evidence/events/control access to organization `owner` or `admin` members for the web dashboard path.
- Validation now rejects raw connector/platform identifiers not only in `vtiBridge`, but also in action/receipt `resource`, receipt `details`, request `policySignals`, and control `resource` payloads.
- The selected-agent detail rail now includes a **Trust Flight Recorder** panel with latest event type, latest event hash, event count, and recent event rows from the evidence pack.

Latest DB-backed E2E result:

```json
{
  "ok": true,
  "projectId": "00000000-0000-4000-8000-900000000001",
  "principalDid": "did:invgini:agent:00000000000040008000000000000001",
  "mandates": 1,
  "resourceGrants": 1,
  "pendingActionRequests": 0,
  "actionReceipts": 1,
  "controlActions": 1,
  "fleetProjects": 2,
  "identityMetadata": "not_issued",
  "eventLogs": 4,
  "vtiBridgeArtifacts": 5,
  "fleetAgents": 2
}
```

Validation commands run in this slice:

```bash
pnpm --filter @onecli/db prisma generate
pnpm --filter @onecli/api check-types
pnpm --filter @onecli/web check-types
pnpm --filter @onecli/db check-types
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli-invgini-api-e2e pnpm --filter @onecli/db prisma migrate deploy
DATABASE_URL=postgresql://postgres@127.0.0.1:5435/onecli-invgini-api-e2e pnpm --filter @onecli/api validate:invgini-api-e2e
pnpm --filter @onecli/api lint
pnpm --filter @onecli/web lint
NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm --filter @onecli/web build
```

## 2026-06-20 update: SecOps control lifecycle resolution

Added an owner/admin control-lifecycle seam so OneCLI control intents do not remain permanently open after an incident review:

- `POST /v1/agents/invgini-governance/:principalId/controls/:controlId/resolve`
- compatibility alias: `POST /v1/invgini/agents/:principalId/controls/:controlId/resolve`

Supported terminal/lifecycle statuses are `APPLIED`, `RESOLVED`, `EXPIRED`, and `CANCELLED`. The route records `resolvedAt`, `resolvedByUserId`, `resolvedByEmail`, and `resolutionReason`. The selected-agent SecOps controls panel now shows a **Mark resolved** button for open/applied controls and displays resolution metadata after closure.

Latest validator output includes:

```json
{
  "resolvedControlStatus": "RESOLVED"
}
```
