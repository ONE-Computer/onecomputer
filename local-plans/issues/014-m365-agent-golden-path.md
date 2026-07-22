# 014: run the complete human Microsoft 365 agent journey

Status: `verification`

Gate: M
Depends on: 013
Unblocks: 015

## Outcome

A human completes the MVP acceptance journey entirely through ONEComputer and
the real sandbox agent: configure the sandbox, connect Microsoft 365, chat,
read work data, request a protected deletion, approve or deny it, and inspect
the resulting audit trail.

## In scope

- Start from an authenticated employee with no active workspace or Microsoft
  connection but with an assigned administrator-authored MVP policy.
- Configure and launch the approved real-agent sandbox profile.
- Connect the employee's Microsoft 365 account through ONEComputer.
- Ask the agent natural-language questions over bounded Outlook Mail, Calendar,
  OneDrive, and Teams data.
- Create disposable examples that demonstrate one governed write in Mail or
  Calendar and one Teams send/reply, in addition to the OneDrive lifecycle.
- Create uniquely named disposable OneDrive fixtures and run one approved and
  one denied delete journey.
- Inspect the policy reason, OpenVTC decision, exact provider result, agent
  response, and audit evidence in the owned UI.
- Repeat the critical journey after workspace and service restart, then clean
  all disposable data and temporary grants through supported paths.

## Out of scope

- Administrator scripts or the qualification CLI as acceptance surfaces,
  production user data, unsupported providers/connectors, bulk mutation, or
  production rollout.

## Required verification

- [ ] Steps 1–7 of the product-owner MVP journey succeed through visible user
  interfaces with no hidden administrator action during the journey.
- [ ] The agent can use only the selected model aliases and assigned Microsoft
  tools for the connected user and workspace.
- [ ] Approved delete executes exactly once; denied delete executes zero times;
  both are explained consistently in chat, operation, and audit views.
- [ ] Policy changes made in ONEComputer affect new agent actions and cannot
  rewrite an existing pending operation.
- [ ] Provider credentials, Microsoft OAuth tokens, approval private keys, and
  infrastructure credentials remain outside the workspace and evidence.
- [ ] A fresh disposable-data rerun after restart reproduces the result and
  cleanup leaves no temporary operation authority or fixture behind.

## Evidence required

Include a numbered user-journey record, safe screenshots, exact source/image/
profile/policy pins, chat/tool/operation/approval/receipt correlation, provider
counters, rerun result, and cleanup inventory.

## Stop conditions

- Any positive step requires the temporary CLI, LiteLLM admin UI, direct Graph
  calls, database edits, or undeclared host configuration.
- One approval can execute more than one provider action.

## Completion record

Not complete. A partial golden-path rehearsal passed on 2026-07-22: the user
launched the managed workspace, instructed the real agent to find and delete a
disposable OneDrive file, approved the exact OpenVTC request, saw the agent
resume, confirmed the file deletion, and inspected the successful audit state.
The expanded Mail, Calendar, OneDrive, and Teams tool projection has also been
observed in the real sandbox. On 2026-07-22 the product owner explicitly
authorized this issue to enter verification while the small Issue 012 live
policy matrix and Issue 013 denial/restart checks remain deferred. The
sequencing exception does not waive those checks. The complete journey still
requires Microsoft connection from the prescribed starting state, natural-
language Mail, Calendar, OneDrive, and Teams reads, governed disposable writes,
an administrator policy change, one approved and one denied action,
restart/reconnect repetition, audit inspection, and supported cleanup. The
exact UI-only runbook is maintained in `infra/issue-014/README.md`.
