# 011: run clean-state MVP acceptance

Status: `blocked`

Gate: J
Depends on: 010
Unblocks: none

## Outcome

A human-reviewed clean-state report proves the complete ONEComputer MVP from
sign-in through policy-built workspace, real model, governed Microsoft tools,
physical approval, exact execution, and redacted evidence using pinned source,
images, schemas, policy, and protocol versions.

## In scope

- Build the topology from documented empty ONEComputer/LiteLLM test storage.
- Run employee sign-in, connection, workspace lifecycle, model, Microsoft read,
  physical approve/deny delete, evidence, administrator policy assignment,
  isolation, outage, restart, replay, concurrency, and cleanup journeys.
- Inspect containers, networks, volumes, ports, privileges, credentials, routes,
  grants, schema migrations, version pins, and retention settings.
- Repeat the critical path after full service restart and workspace
  stop/start/delete/recreate.
- Produce an invariant-by-invariant pass/fail report, bill of materials,
  residual-risk register, and recovery guide.

## Out of scope

- Legacy migration, production rollout, unsupported connector/model claims,
  broad enterprise hardening, or treating a known limitation as a pass.

## Required verification

- [ ] Every architecture invariant maps to passing evidence with no unexplained
  skip.
- [ ] Compromised-workspace bypass probes fail while the governed path works.
- [ ] One physical approval yields one exact delete; all negative variants
  yield zero provider executions.
- [ ] Identity, roles, policies, model budgets, Microsoft credential custody,
  tenant/workspace isolation, and evidence attribution survive restart.
- [ ] Browser/UI accessibility, security, loading/degraded states, container
  hardening, secret redaction, and retention checks pass.
- [ ] Clean rebuild and delete/recreate leave no resource or authority leak.
- [ ] No runtime dependency on legacy OneCLI code or database exists.
- [ ] The product owner reviews residual risks and explicitly accepts or rejects
  the MVP.

## Evidence required

Include `mvp-report.md`, invariant matrix, exact bill of materials, clean-start
runbook, topology inspection, full probe matrix, physical-device record,
screenshots/accessibility report, residual-risk register, and recovery result.

## Stop conditions

- Any required case is skipped, simulated at the wrong trust boundary, flaky,
  or dependent on undeclared state.
- A prohibited secret or sensitive payload appears in evidence.

## Completion record

Not complete. Blocked on Issue 010.
