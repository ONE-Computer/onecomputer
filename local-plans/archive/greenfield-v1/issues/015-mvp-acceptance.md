# 015: run clean-state MVP acceptance

Status: `blocked`

Gate: N
Depends on: 014
Unblocks: none

## Outcome

A human-reviewed clean-state report proves the complete ONEComputer MVP from
sign-in and sandbox policy through real-agent chat, governed Microsoft tools,
device-backed approval, exact execution, and redacted audit evidence using
pinned source, images, schemas, profiles, policies, and protocol versions.

## In scope

- Build the topology from documented empty ONEComputer/LiteLLM test storage.
- Run sign-in, policy assignment, sandbox configuration/lifecycle, Microsoft
  connection, real-agent model and tool use, approve/deny, audit, isolation,
  outage, restart, replay, concurrency, deletion, and cleanup journeys.
- Inspect containers, networks, volumes, ports, privileges, credentials,
  routes, grants, migrations, pins, retention, and recovery behavior.
- Repeat the critical path after full service restart and workspace
  stop/start/delete/recreate.
- Produce an invariant-by-invariant report, bill of materials, residual-risk
  register, and recovery guide.

## Out of scope

- Legacy migration, production rollout, unsupported connector/model claims,
  broad enterprise hardening, or treating a known limitation as a pass.

## Required verification

- [ ] Every architecture invariant maps to passing evidence with no unexplained
  skip, including the deferred Issue 009 denial and restart checks.
- [ ] Compromised-workspace bypass probes fail while the governed real-agent
  path works.
- [ ] One device-backed approval yields one exact delete; all negative variants
  yield zero provider executions.
- [ ] Identity, roles, policies, model budgets, Microsoft credential custody,
  tenant/workspace/agent isolation, and evidence attribution survive restart.
- [ ] Browser/agent/UI accessibility, security, loading/degraded states,
  container hardening, secret redaction, and retention checks pass.
- [ ] Clean rebuild and workspace delete/recreate leave no resource, credential,
  connection, agent identity, or authority leak.
- [ ] No runtime dependency on legacy OneCLI code or database exists.
- [ ] The product owner reviews residual risks and explicitly accepts or rejects
  the MVP.

## Evidence required

Include `mvp-report.md`, invariant matrix, exact bill of materials, clean-start
runbook, topology inspection, full probe matrix, device-approval record,
screenshots/accessibility report, residual-risk register, and recovery result.

## Stop conditions

- Any required case is skipped, simulated at the wrong trust boundary, flaky,
  or dependent on undeclared state.
- A prohibited secret or sensitive payload appears in evidence.

## Completion record

Not complete. Blocked on Issue 014.
