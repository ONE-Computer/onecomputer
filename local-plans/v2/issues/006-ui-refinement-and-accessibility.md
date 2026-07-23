# 006: refine the complete V2 UI and accessibility

Status: `verification`

Priority: P3
Depends on: 005
Unblocks: V2 acceptance

## Outcome

The complete ONEComputer journey is coherent, responsive, accessible, and
visually polished: users can understand workspace and agent readiness, use
native clipboard behavior, see bounded connectivity, act on companion approval
requests, and diagnose signed-policy integrity without learning the underlying
Kasm, proxy, LiteLLM, Web Push, or cryptographic implementation.

## In scope

- Audit and refine the information architecture, visual hierarchy, wording,
  states, spacing, responsiveness, interaction consistency, and accessibility
  across workspace, sandbox settings, agent selection, connections and tool
  policy, governed operations, companion devices, activity/audit, and
  administration.
- Give each asynchronous capability an honest preparing, ready, degraded,
  blocked, expired, disconnected, retrying, and failed state where applicable.
- Make the P0 clipboard permission/recovery path and P1 egress/agent state easy
  to understand without exposing implementation details.
- Make pending approvals and companion notification health prominent while
  keeping safe summaries and deliberate approve/deny gestures.
- Present expected, projected, and enforced policy integrity/drift in language
  appropriate to normal users and administrators.
- Establish reusable UI tokens/components and remove accidental duplication
  while preserving owned security and lifecycle boundaries.
- Define and verify a documented keyboard, focus, contrast, motion, zoom,
  screen-reader, touch-target, and responsive support target.
- Add bounded visual-regression, accessibility, and critical-journey coverage.

## Out of scope

- Changing the V2 trust model, moving enforcement into the browser, redesigning
  vendor-native Claude/Hermes-Claw/Kasm interfaces, hiding security failures to
  simplify the UI, adding unrelated product features, or replacing functional
  backend contracts solely for visual consistency.

## Required implementation

- An inventory of routes, roles, critical journeys, reusable patterns, and
  inconsistent states before editing.
- A small owned design-token/component layer for typography, color, spacing,
  focus, status, forms, feedback, empty states, dialogs/drawers, and responsive
  layout.
- Consistent server-owned state mapping and reason codes; the UI must never
  infer approval, policy, agent, network, clipboard, or workspace authority
  from optimistic local state.
- Keyboard and screen-reader semantics, visible focus, skip/navigation support,
  logical focus restoration, appropriate live regions, reduced-motion
  behavior, scalable text, contrast-safe status cues, and non-color-only
  meaning.
- Responsive layouts for the declared desktop/tablet/mobile browser matrix,
  including the companion approval journey.
- Safe telemetry and error boundaries that help diagnose state without
  collecting secrets, clipboard contents, notification payloads, raw task
  content, or sensitive provider responses.

## Required verification

- [ ] A normal user can start/recover a workspace, understand per-agent
      readiness, copy/paste normally, distinguish allowed/blocked connectivity,
      review a safe approval request, and inspect activity without expert help.
- [ ] An administrator can select agents, understand effective network policy,
      manage companion-device state where authorized, change tool effects, and
      identify policy projection/enforcement drift without editing files.
- [ ] Every critical route has reviewed loading, empty, success, degraded,
      permission-denied, validation, conflict, disconnected, expired, and
      server-failure states relevant to that route.
- [ ] The defined keyboard-only, screen-reader, zoom/reflow, contrast,
      reduced-motion, touch, and responsive checks pass on the declared support
      matrix with no keyboard trap or lost focus after asynchronous updates.
- [ ] Approve/deny, destructive lifecycle actions, policy changes, agent
      removal, device revocation, and retry behavior remain deliberate,
      correctly scoped, idempotent, and protected from double submission.
- [ ] Tenant/role authorization, redaction, server-owned policy/approval truth,
      clipboard privacy, and security reason accuracy are unchanged.
- [ ] Automated critical-journey, visual-regression, and accessibility checks
      pass, and the production build has no material console/runtime errors.
- [ ] Human review confirms a consistent visual system and acceptable
      responsiveness on the declared desktop and mobile viewport set.

## Evidence required

Include the before/after route and journey inventory, component/token record,
safe screenshots at declared viewports, state matrix, keyboard/focus transcript,
automated accessibility and visual-regression output, critical-journey results,
role and redaction regression results, production build output, residual
accessibility limitations, and cleanup.

## Stop conditions

- A visual simplification would hide a security-relevant state, imply approval
  or readiness before server confirmation, weaken authorization, or expose
  sensitive content.
- A critical journey depends on an unresolved backend defect from Issues
  001–005; return it to the owning issue rather than masking it in the UI.
- The supported browser/viewport or accessibility target cannot be stated and
  verified with the available product decision and test environment.

## Completion record

Implementation, automated checks, deployed build, and bounded desktop/mobile
browser review are complete. Product-owner visual confirmation remains.

- Inventory, component/token record, accessibility target, browser checks, and
  residual human verification:
  `local-plans/v2/decisions/006-ui-refinement-record.md`
- Automated suite: 128/128 passed; the full workspace build passed.
- Desktop 1440×1024, mobile 390×844, mobile navigation/focus, modal/drawer
  semantics, and companion 390×844 were reviewed against the established Calm
  Launchpad direction.
- The production web container was rebuilt and is serving the refined UI.
