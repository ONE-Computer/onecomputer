# V4 progressive issues

The V4 architecture plan is authoritative. These issues define execution order
and the minimum proof required before proceeding.

## Status model

- `blocked`: a dependency or reviewed decision is incomplete.
- `ready`: all dependencies are accepted and implementation may begin.
- `in_progress`: implementation is active.
- `verification`: implementation exists but required proof is incomplete.
- `decision_required`: evidence invalidated an assumption and owner input is
  required.
- `complete`: all acceptance and evidence requirements passed.

Issues 000–004 are the accepted architecture, Kasm, LiteLLM, owned governance,
and approval foundation. Their product-visible fixture journey was accepted on
2026-07-20; broader policy and physical-delivery concerns are now explicit work
in active Issues 005 and 009 rather than hidden verification tails.

On 2026-07-20 the product owner retired the drifted Issue 005–013 roadmap and
replaced it with the active sequential Issue 005–011 MVP path below. Historical
specifications are preserved under `archive/retired-2026-07-20/`; they are not
active dependencies. Existing Kasm, UI, LiteLLM, governed-operation, Microsoft
OAuth, and bounded Microsoft-read evidence is carried forward and must not be
needlessly repeated. Issues 005–007 passed human review and Issue 008 is the
next ready issue. Completing an issue may
make only its immediate successor ready. Gate-closing issues require explicit
human review.

## Execution rules

1. Work only on the first ready issue and do not implement its successor in the
   same task unless explicitly requested.
2. Read the V4 trust invariants, current issue, and dependency evidence before
   editing.
3. Record preflight: repository, branch, status, expected files, external
   systems, secrets, destructive fixtures, and exact version/image pins.
4. Inspect the real code and deployed topology; do not implement from prose
   alone.
5. Start security-relevant behavior with a failing contract or regression.
6. Keep vendor behavior behind owned adapters and never read vendor databases.
7. Unknown identity, policy, schema, state, or dependency result denies.
8. Happy-path proof is insufficient. Run the issue's negative, tenant,
   mutation, timeout, replay, concurrency, restart, and bypass cases.
9. Do not weaken an invariant, add allow-by-default behavior, or skip a required
   probe to close an issue.
10. Do not place credentials in source, arguments, logs, screenshots, fixtures,
    or artifacts.
11. Pin all vendor releases and images used for a decision; mutable tags are
    invalid evidence.
12. New architectural work outside issue scope requires a written amendment or
    new issue, not opportunistic implementation.
13. Never import or copy code from the legacy OneCLI branch. Reimplement only
    independently justified contracts and behavior.

## Roadmap reset and carry-forward rule

The active roadmap is deliberately product-sequential: identity/policy,
policy-built workspace, real model, governed Microsoft tools, physical
approval, golden path, then clean acceptance. A replacement issue may cite
historical evidence, but it passes only its own unchecked requirements. Old
issue numbers in `infra/issue-*` evidence remain historical labels and do not
re-enter the active dependency chain.

## Common evidence protocol

Write a redacted bundle under:

```text
.artifacts/v4/issues/<issue-id>/<UTC timestamp>/
```

Every bundle contains:

- `manifest.json`: issue, source revision, branch, dirty files, dependency
  evidence, image/schema/policy versions, timestamps, commands, and result;
- `tests.log`: exact commands and exit codes, redacted;
- `probes.json`: machine-readable positive and negative results;
- `inspection.json`: relevant runtime, configuration, network, data, and log
  inspection;
- `residual-risks.md`: limitations without overstating assurance;
- `recovery.md`: safe recovery/cleanup procedure and result.

An issue is complete only when its behavior exists, non-goals remain absent,
required clean-state and failure tests pass, deployed claims are inspected, the
evidence is internally consistent, and the completion record points to the
bundle.

## Human-assisted physical device rule

For Issue 009, Codex may prepare the disposable task, observe server state,
verify signatures, and clean up. The user controls the iPhone and performs only
explicit steps such as opening VTA Mobile Agent, reviewing a safe challenge,
approving, denying, backgrounding, disconnecting, or reconnecting.

A statement that a button was tapped is not authority evidence. Passing
requires the server to receive and cryptographically verify the exact signed
decision. Never request device keys, seeds, bearer tokens, or full sensitive
task contents in chat.

## Issue index

| ID | Gate | Outcome | Depends on | Gate closer |
| --- | --- | --- | --- | --- |
| 000 | A | Record the accepted first-principle architecture | — | Yes |
| 001 | B | Launch a real Kasm sandbox from ONEComputer | 000 | No |
| 002 | B | Qualify and integrate the LiteLLM gateway slice | 001 | Yes |
| 003 | C | Extend governance contracts and owned PostgreSQL | 002 | No |
| 004 | C | Build durable operations and fixture approvals | 003 | No |
| 005 | D | Establish real identity and durable policy assignments | 004 | Yes |
| 006 | E | Launch a policy-built managed agent workspace | 005 | Yes |
| 007 | F | Enable one governed real-model route | 006 | Yes |
| 008 | G | Govern the Microsoft 365 MCP capability surface | 007 | Yes |
| 009 | H | Integrate OpenVTC physical approval and durable evidence | 008 | Yes |
| 010 | I | Complete the end-to-end Microsoft 365 MVP journey | 009 | Yes |
| 011 | J | Run clean-state MVP acceptance | 010 | Yes |

## Assignment template

```text
Implement only local-plans/issues/NNN-....md on mike/greenfield-v1.
Follow local-plans/issues/README.md and the V4 invariants.
Do not start the next issue. Report preflight and expected files before edits.
If any required proof is unavailable, leave the issue in verification or
decision_required rather than weakening acceptance.
```
