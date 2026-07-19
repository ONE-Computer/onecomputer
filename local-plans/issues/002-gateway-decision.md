# 002: record the gateway architecture decision

Status: `blocked`

Gate: B
Depends on: 001
Unblocks: 003

## Outcome

A human-reviewed decision selects LiteLLM, a narrowly augmented LiteLLM, or a
separately designed replacement based only on Issue 001 evidence.

## In scope

- Map every gateway invariant and selected client route to qualification
  evidence.
- Classify result as `pass`, `partial`, or `fail`.
- For `partial`, specify the smallest version-tested plugin/wrapper, its threat
  boundary, and the exact requalification cases.
- For `fail`, stop product implementation and write a replacement-gateway
  decision issue; do not infer a broad custom proxy automatically.
- Freeze supported routes, hook schema, identity claims, operation-reference
  behavior, evidence seam, release pin, and requalification triggers.

## Out of scope

- Product code, speculative wrappers, vendor source forks, or silently dropping
  a failed route.

## Required verification

- [ ] Every Gate B criterion has direct evidence or an explicit failure.
- [ ] No accepted design places approval authority in a client, LiteLLM UI, or
  MCP server.
- [ ] The decision identifies upgrade/drift tests and unsupported routes.
- [ ] Residual risks have owners and do not violate V4 invariants.
- [ ] A human records approval of the decision.

## Evidence required

Include the signed-off ADR, criterion matrix, accepted release/contract pin,
residual-risk register, and any conditional issue amendment.

## Stop conditions

- Evidence is incomplete or contradictory.
- A proposed partial solution expands into a general custom gateway.
- Safe approval correlation remains unresolved.

## Completion record

Not complete.
