# ONEComputer Engineering Plan — Index

This folder is the durable engineering plan for ONEComputer. It replaces the old self-graded phase docs with concrete, testable phases tied to personas, APIs, workflows, and E2E proof.

## Read first

1. `00-current-state.md` — current verified status and caveats
2. `01-north-star-and-personas.md` — product goal and persona model
3. `02-system-architecture.md` — service map, data flow, trust flow
4. `03-phase-roadmap.md` — 26 phase YC/Khosla readiness plan
5. `04-workflow-execution-plan.md` — which workflow agents run when
6. `05-e2e-and-readiness-gates.md` — E2E tests and readiness criteria
7. `06-risk-register.md` — top technical/product risks
8. `07-investor-readiness-plan.md` — what must be true before YC/Khosla pitch
9. `08-graphify-plan.md` — repo graph generation and management graph plan

## Source of truth

- `AUDIT.md` for real-vs-vapor status
- `STATE.md` for latest local proof status
- `~/brain/projects/onecomputer-goal-proof.md` for the core goal proof
- `~/brain/projects/onecomputer-infra-config.md` for ports/config

## Current critical proof

As of 2026-06-28, the local goal path is proven:

```text
ONEComputer API → Daytona sandbox → Claude Code 2.1.195
ONEComputer API → manual_approval PolicyRule
ONEComputer API → ApprovalRequest
ApprovalRequest → VTI auth/step-up/approve-request envelope
VTI notification trigger → sent_to_vti_adapter
```

Production caveat: the VTI adapter is local outbox simulation. Real VTA/mobile DIDComm delivery remains to be wired.
