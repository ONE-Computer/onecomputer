# 012: run clean-state V4 MVP acceptance

Status: `blocked`

Gate: H
Depends on: 011
Unblocks: none

## Outcome

A human-reviewed clean-state report proves the complete V4 MVP against exact
source, schema, policy, protocol, and image versions without relying on legacy
code or undeclared host state.

## In scope

- Build the complete topology from a clean documented environment and empty
  ONEComputer/LiteLLM test storage.
- Run employee workspace, model, OneDrive read, physical approve/deny delete,
  evidence, administrator, lifecycle, isolation, outage, restart, concurrency,
  replay, mutation, and cleanup journeys.
- Inspect every container, network, volume, port, privilege, credential mount,
  route, grant, schema migration, version pin, and retention setting.
- Produce an invariant-by-invariant pass/fail report and operator recovery
  guide.
- Repeat the critical golden path after full service restart and after
  workspace delete/recreate.

## Out of scope

- Legacy comparison/migration, production rollout, unsupported connector/model
  claims, or converting known limitations into implicit acceptance.

## Required verification

- [ ] Every V4 invariant maps to passing evidence with no unexplained skip.
- [ ] Compromised-workspace bypass matrix fails while governed paths work.
- [ ] One physical approval yields one exact delete; all negative variants yield
  zero provider executions.
- [ ] Model routing, budgets, guardrails, streaming, and evidence pass under
  normal and degraded conditions.
- [ ] Tenant/role/browser/API/workspace isolation and credential redaction pass.
- [ ] Full restart and delete/recreate preserve durable truth and leave no
  resource leak.
- [ ] UI accessibility/security and container hardening pass.
- [ ] No runtime, import, schema, container, database, or plan dependency on the
  legacy OneCLI branch exists.
- [ ] A human reviews residual risks and explicitly accepts or rejects MVP.

## Evidence required

Include `mvp-report.md`, invariant matrix, exact bill of materials, clean-start
runbook, topology inspection, complete probe matrix, physical-device record,
screenshots/accessibility report, residual-risk register, and recovery result.

## Stop conditions

- Any required case is skipped, simulated at the wrong trust boundary, flaky,
  or dependent on undeclared state.
- A prohibited secret or sensitive payload appears in evidence.
- A legacy component is required for the golden path.

## Completion record

Not complete.
