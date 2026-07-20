# 007: enable one governed real-model route

Status: `verification`

Gate: F
Depends on: 006
Unblocks: 008

## Outcome

The preconfigured agent inside Kasm can use one stable ONEComputer model alias
through LiteLLM with a real provider, scoped attribution, explicit limits, and
no provider credential in the workspace.

## In scope

- Select and pin one MVP provider/model route behind the stable alias
  `onecomputer-assistant`.
- Store the provider credential only in the gateway's approved secret boundary.
- Authorize the alias through the effective tenant/user/workspace/agent policy.
- Enforce basic token, request-rate, and cost budgets with attributable usage.
- Define an explicit MVP fallback policy; `no fallback` is acceptable and must
  fail honestly.
- Exercise streaming and non-streaming through the actual in-workspace agent.
- Surface safe availability and budget state in ONEComputer Web.

## Out of scope

- A model catalog, autonomous model selection, broad guardrail/DLP claims,
  prompt archives, multiple providers, or silent unapproved fallback.

## Required verification

- [x] The assigned alias works from the persistent sandbox agent key.
- [x] Raw provider/model names, unassigned aliases, cross-user/workspace keys,
  expired/revoked keys, and direct provider access deny.
- [x] Rate, token, and cost exhaustion fail deterministically and attribute the
  denial to the exact tenant/user/workspace/agent.
- [x] Provider outage follows the recorded fallback policy and never silently
  routes outside it.
- [x] Streaming cannot bypass alias policy, budgets, attribution, or evidence.
- [x] Provider keys and prompt/response bodies are absent from workspace,
  browser, Control payloads, logs, and retained evidence by default.
- [x] Gateway restart preserves routing configuration and usage truth.

## Evidence required

Include exact model/provider pin, alias config, policy/grant matrix, normal and
streaming transcripts with content redacted, budget/rate/failure probes, usage
records, restart result, and secret/retention scan.

## Stop conditions

- A provider key must enter the workspace or Control/browser payload.
- Usage cannot be attributed to the owned identity chain.
- Fallback or budget behavior is implicit or fail-open.

## Completion record

Machine qualification passed on 2026-07-20. The issue is paused for the required
human review of the rebuilt workspace image, sandbox CLI, and safe Web budget
surface before it can be marked complete.
