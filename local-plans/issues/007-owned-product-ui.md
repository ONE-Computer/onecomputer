# 007: build the owned MVP product UI

Status: `blocked`

Gate: E
Depends on: 006
Unblocks: 008

## Outcome

A clean, minimal ONEComputer interface lets authorized users operate the proven
workspace/governance slice without exposing vendor internals or moving authority
into the browser.

## In scope

- Scaffold `apps/web` with Next.js 16, shadcn/ui, Tailwind CSS v4, and the latest
  qualified active Node LTS pinned by patch and image digest.
- Establish owned design tokens, light/dark themes, typography, navigation,
  responsive layouts, loading/empty/error states, and accessible components.
- Implement employee workspace launch/status/open/stop, assigned capabilities,
  operation/request status, and redacted activity/evidence journeys.
- Implement role-gated policy/profile and integration-health surfaces needed by
  the MVP administrator.
- Use server-mediated Control APIs, CSRF/idempotency protections, correlation
  IDs, and typed errors.
- Keep the visual direction calm and task-oriented, informed by ChatGPT/Manus
  interaction principles without cloning their assets or layouts.

## Out of scope

- OneCLI UI, vendor deep links for normal users, browser policy evaluation,
  browser secrets, simulated green health, broad analytics, connector
  marketplace, physical approval controls, or decorative feature breadth.

## Required verification

- [ ] Every UI state comes from authoritative APIs and preserves tenant/role
  scoping on direct URL and mutation attempts.
- [ ] Browser bundles, storage, network traces, errors, and source maps contain
  no gateway master key, provider credential, signing material, or Docker token.
- [ ] Workspace lifecycle and fixture approval operation status work through the
  real deployed backend.
- [ ] Unknown/degraded readiness is distinct from ready; denied/expired/replayed
  operations cannot be presented as successful.
- [ ] Keyboard, focus, semantic structure, contrast, reduced motion, mobile,
  desktop, loading, empty, long-content, and failure cases pass.
- [ ] Production container is non-root, least-privilege, read-only where
  practical, and exposes only the intended web port.
- [ ] Visual regression/screenshots cover the critical journeys without
  containing sensitive data.

## Evidence required

Include route/role matrix, browser security scan, accessibility results,
responsive screenshots, state-source map, container inspection, and live
journey results.

## Stop conditions

- UI requires direct vendor database/API secrets.
- A visual fixture becomes product authority or integration evidence.
- Authorization depends on hidden navigation rather than server enforcement.

## Completion record

Not complete.
