# 010: launch a configurable real conversational agent workspace

Status: `complete`

Gate: I
Depends on: 009 implementation checkpoint
Unblocks: 011

## Outcome

An authenticated user selects an approved sandbox profile in ONEComputer,
starts the workspace, and chats through a real agent client whose model traffic
uses only the workspace-scoped LiteLLM route. The temporary qualification CLI
is no longer the product interaction surface.

## In scope

- Add an owned **Sandbox settings** page for the user's assigned workspace.
- Define a versioned workspace profile containing the approved agent client,
  image, launch command, model alias, resource limits, persistence mode, and
  allowed gateway endpoints.
- Qualify candidate agent clients against the actual Ubuntu/Kasm environment.
  Claude Desktop may be selected only if its supported build can be pinned and
  can use the LiteLLM base URL and governed MCP route without provider login or
  direct credentials; otherwise select the smallest supported agent client
  that satisfies the same product journey.
- Build the selected client into the approved workspace image and launch it as
  the primary application.
- Mint a workspace/agent-scoped LiteLLM credential in Control and deliver it to
  the runtime without exposing provider API keys to the user or image.
- Route Claude, OpenAI, and GLM provider choices through owned model aliases in
  LiteLLM; provider secrets remain server-side.
- Preserve the workspace's user data and configuration across UI stop/start and
  host/service restart according to the selected profile.
- Show the effective profile, model route, and lifecycle state in ONEComputer.

## Out of scope

- Microsoft 365 tool invocation, tool policy editing, OpenVTC approval UX,
  arbitrary user-supplied images, arbitrary shell access to host services, or
  supporting multiple agent clients in the first pass.

## Required implementation

- Versioned sandbox-profile contract and durable assignment.
- Owned settings/read model and start/restart/stop integration.
- Pinned agent image/build with a deterministic health/readiness contract.
- Control-issued, revocable agent identity and LiteLLM virtual key.
- Egress rules that allow only declared gateway/update destinations and deny
  direct model-provider endpoints.
- Honest unavailable/degraded states when the assigned model or gateway cannot
  be prepared.

## Required verification

- [ ] A user can select/save the approved profile, start the workspace, open the
  real agent client, and complete normal and streaming chats.
- [ ] The effective LiteLLM base URL, model alias, agent identity, and budget are
  correct for the assigned workspace after restart.
- [ ] The workspace contains no OpenAI, Anthropic, GLM, Microsoft, LiteLLM
  master, Docker, PostgreSQL, or Control service credential.
- [ ] Direct provider, Graph, upstream MCP, PostgreSQL, Docker, and OpenVTC
  routes fail from the workspace while the governed model route succeeds.
- [ ] Wrong user/workspace/profile/model/key, revoked assignment, expired key,
  gateway outage, image failure, and concurrent lifecycle actions fail closed.
- [ ] UI stop/start and service restart preserve the intended workspace data;
  explicit workspace deletion removes it through the owned lifecycle.
- [ ] The temporary CLI is not required for any positive product check.

## Evidence required

Include the candidate decision record, exact client/image pins, profile and
assignment records, model-route traces, workspace credential inspection,
network bypass matrix, lifecycle persistence result, screenshots, and cleanup.

## Stop conditions

- The selected client requires direct provider authentication, cannot use the
  governed base URL/MCP route, has no supportable Linux/Kasm build, or cannot be
  pinned and redistributed under acceptable terms.
- Passing requires placing a provider or platform credential in the image,
  browser storage, command line, logs, or user-visible configuration.

## Completion record

Implementation and automated qualification completed on 2026-07-21. Claude
Desktop Linux is pinned and launches under a root-managed gateway policy; all
three LiteLLM aliases passed normal and streaming Anthropic Messages requests.
The local user is assigned immutable policy version 5. The product owner
accepted the functional UI and model-routing review and explicitly authorized
Issues 011–013 to proceed together for the demo journey.
