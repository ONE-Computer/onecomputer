# 000: freeze the first-principle architecture contract

Status: `ready`

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

- [ ] Every product ask maps to an owning component and later issue.
- [ ] Every trust boundary has an enforcement point and failure behavior.
- [ ] The destructive-tool sequence identifies who may create, approve, lease,
  execute, and evidence an operation.
- [ ] The browser, workspace, MCP server, LiteLLM, and vendor databases are not
  accidental authorities.
- [ ] Claims about Kasm, guardrails, DLP, and MDM are explicitly bounded.
- [ ] A human reviews and accepts or amends the contract.

## Evidence required

Include reviewed ADR index, diagram sources, requirement-to-component matrix,
threat inventory, unresolved decisions, and review record.

## Stop conditions

- Product scope or trust ownership remains ambiguous.
- A component needs conflicting authority.
- The MVP cannot be described as one concrete end-to-end slice.

## Completion record

Not complete.
