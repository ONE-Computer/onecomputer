# 011: implement governed model routing, budgets, and guardrails

Status: `blocked`

Gate: H
Depends on: 010
Unblocks: 012

## Outcome

One workspace-scoped model alias enforces tenant policy, routing, budgets,
usage evidence, and explicit guardrail/fallback failure behavior through the
qualified LiteLLM lane.

## In scope

- Configure one stable product alias with an approved primary model and bounded
  fallback policy.
- Issue tenant/workspace/audience-bound access and enforce model allowlists,
  token/rate/cost budgets, and usage attribution.
- Add selected input/output guardrails appropriate to the MVP and define which
  service owns each decision.
- Normalize streaming/non-streaming usage, cost, latency, route, fallback,
  guardrail, and denial evidence without storing prompts/responses by default.
- Surface safe model availability/budget state in the UI.

## Out of scope

- Broad provider/model catalog, autonomous model selection, full DLP claims,
  prompt archives, training/evaluation platform, or silent fallback to a model
  outside policy.

## Required verification

- [ ] Allowed alias works with scoped credential; unassigned/raw provider/model
  names and cross-workspace grant reuse fail.
- [ ] Budget/rate exhaustion denies deterministically and is attributable.
- [ ] Primary outage follows the explicit approved fallback policy; disallowed
  fallback never occurs.
- [ ] Guardrail deny, timeout, outage, malformed response, and unknown result
  follow the recorded fail policy without leaking prohibited data.
- [ ] Streaming cannot bypass policy, budgets, guardrails, or usage evidence.
- [ ] Model/provider keys remain outside workspace, browser, Control payloads,
  logs, and artifacts.
- [ ] Gateway/Control restart preserves grants, budget truth, and attribution.

## Evidence required

Include alias/routing config, grant matrix, budget/rate probes, fallback matrix,
guardrail failure matrix, streaming evidence, normalized usage records, and
secret/prompt-response retention scan.

## Stop conditions

- Usage cannot be attributed to tenant/user/workspace.
- Fallback or guardrail behavior is implicit or fail-open for protected policy.
- A provider key must enter the workspace.

## Completion record

Not complete.
