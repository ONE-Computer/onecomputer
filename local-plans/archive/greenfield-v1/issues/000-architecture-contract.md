# 000: freeze the first-principle architecture contract

Status: `complete`

Gate: A
Depends on: none
Unblocks: 001

## Outcome

A reviewed architecture contract fixes V4's trust boundaries, ownership,
protocol seams, MVP slice, non-goals, and acceptance language before application
code is scaffolded.

## In scope

- Validate every V4 invariant against the enterprise governed-agent objective.
- Produce architecture, trust-boundary, deployment, and critical-operation
  sequence diagrams.
- Freeze component ownership, database authority, identity/grant claims,
  gateway qualification contract, approval lifecycle, evidence policy, network
  profiles, and UI/API boundaries.
- Record ADRs for LiteLLM-as-candidate, no custom gateway by default, separate
  PostgreSQL, private workspace controller, OpenVTC adapter timing, Kasm trust
  level, and absence of OneCLI.
- Define a glossary for workspace, capability, governed operation, decision,
  execution lease, receipt, and evidence event.

## Out of scope

- Application scaffolding, vendor containers, schemas, UI mockups, and live
  integrations.
- Migration, rollback, or compatibility design for the discarded prototype.

## Required verification

- [x] Every product ask maps to an owning component and later issue.
- [x] Every trust boundary has an enforcement point and failure behavior.
- [x] The destructive-tool sequence identifies who may create, approve, lease,
  execute, and evidence an operation.
- [x] The browser, workspace, MCP server, LiteLLM, and vendor databases are not
  accidental authorities.
- [x] Claims about Kasm, guardrails, DLP, and MDM are explicitly bounded.
- [x] A human reviews and accepts or amends the contract.

## Evidence required

The accepted baseline is
`local-plans/v4-greenfield-governed-agent-platform.md`: it contains the target
topology, component ownership, trust model, prohibited routes, lifecycle,
gateway decision criteria, and delivery map. The human review is recorded by
the 2026-07-19 direction to proceed with Kasm as Issue 001.

## Stop conditions

- Product scope or trust ownership remains ambiguous.
- A component needs conflicting authority.
- The MVP cannot be described as one concrete end-to-end slice.

## Completion record

Accepted on 2026-07-19 as the architecture baseline for product-first delivery.
The reviewed topology, ownership boundaries, prohibited direct routes, and MVP
slice are recorded in `local-plans/v4-greenfield-governed-agent-platform.md`.
This closes the planning gate only; each implementation issue still owns the
deployed security evidence for its boundary.
