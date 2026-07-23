# V4: greenfield governed agent platform

Status: accepted architecture baseline; product slices active

## Product objective

ONEComputer gives enterprise power users a flexible workspace in which they
may run coding agents, autonomous agents, and arbitrary development tooling.
The enterprise retains enforceable boundaries around identity, network access,
models, tools, critical actions, credentials, budgets, guardrails, and evidence.

The MVP proves one complete, trustworthy path rather than broad integration
coverage.

## MVP proof

One authenticated employee can:

1. start a managed Kasm workspace;
2. use a coding or agent client through a workspace-scoped credential;
3. call one routed model alias;
4. discover only an assigned MCP server and bounded toolset;
5. perform one read-only OneDrive capability;
6. request one destructive OneDrive capability;
7. have the destructive operation approved or denied through OpenVTC;
8. execute an approved operation at most once; and
9. inspect a redacted, attributable evidence timeline.

A compromised workspace cannot reach model providers, Microsoft Graph,
upstream MCP servers, control databases, Docker, approval keys, another
workspace, or unrestricted public egress directly.

## Non-goals for MVP

- Migration from or compatibility with the inherited OneCLI fork.
- A custom general-purpose MCP or model gateway unless qualification proves it
  necessary.
- Broad connector coverage beyond the OneDrive proof.
- Full MDM, EDR, SIEM, DLP, CASB, or hostile multi-tenant VM claims.
- Multi-region control-plane availability.
- A plugin marketplace or end-user connector builder.
- Autonomous execution of critical actions without explicit enterprise policy.

## First-principle trust model

### Untrusted or potentially compromised

- all software and users inside a workspace;
- agent prompts, model output, MCP tool descriptions, and MCP results;
- browser input and client-supplied tenant/workspace identifiers;
- public networks and external provider responses;
- vendor gateway implementation details not covered by a pinned contract.

### Trusted with minimized authority

- ONEComputer Control owns policy and durable governance state;
- the private workspace controller owns only runtime lifecycle authority;
- LiteLLM holds only the provider/MCP authority required for its data plane;
- the OpenVTC verifier trusts only configured issuers/keys and exact signed
  contract versions;
- the egress layer enforces network destinations independently of applications.

### Non-negotiable invariants

1. Every workspace request has authenticated tenant, user/credential owner,
   agent actor, workspace, and audience context.
2. Removing proxy variables or modifying the workspace cannot create direct
   provider/MCP access.
3. A workspace credential is short-lived and cannot be reused by another
   tenant, workspace, audience, or gateway.
4. ONEComputer evaluates every governed tool call immediately before execution
   using canonical server, tool, schema, arguments, subject, and resource data.
5. Unknown identity, policy, schema, state, timeout, or dependency failure
   denies protected execution.
6. A normal browser, administrator API, gateway UI, or database status change
   is not approval authority for a critical operation.
7. Approval is valid only when cryptographically verified and bound to the exact
   operation digest, decision, approver, nonce, audience, and expiry.
8. One approval can issue at most one exact execution lease.
9. Provider credentials and gateway master credentials never enter the
   workspace or browser.
10. Evidence is tenant-scoped, correlated, redacted, append-oriented, and does
    not store secrets or full sensitive payloads by default.
11. Public web/API compromise does not expose Docker or host-control authority.
12. UI state never substitutes for server authorization.

## Target topology

```text
Browser
  |
  v
ONEComputer Web ----> ONEComputer Control API ----> ONEComputer PostgreSQL
                              |                       governance truth
                              |
                              +----> OpenVTC adapter/verifier
                              +----> LiteLLM admin/policy adapter
                              +----> Evidence sink
                              |
                              +----> private Workspace Controller ----> Kasm

Kasm workspace on an isolated per-workspace network
  |
  +----> pinned LiteLLM gateway ----> model providers
  |             |
  |             +----> pinned MCP server ----> Microsoft Graph
  |             |
  |             +----> pre-execution policy call to Control
  |
  +----> controlled DNS and profile egress ----> approved web/package targets

No OneCLI runtime or database is required by the MVP.
```

## Component ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Product journeys and server-mediated presentation | Policy decisions, provider secrets, signing keys, Docker |
| `apps/control-api` | Auth context, use cases, policy endpoint, operation APIs | Docker socket, provider execution |
| `apps/workspace-controller` | Private Kasm lifecycle API | Public sessions, policy, approvals, provider credentials |
| `packages/contracts` | Versioned schemas, canonicalization, hashes, errors | Database or vendor clients |
| `packages/control` | Policy and governed-operation orchestration | Vendor database types, Docker implementation |
| `packages/db` | Owned schema, repositories, transactions, outbox, leases | OneCLI/LiteLLM database imports |
| `packages/litellm-adapter` | Versioned admin/policy/data-plane contract | Enterprise approval authority |
| `packages/openvtc-adapter` | Task transport and signed-decision verification | Operation truth or provider execution |
| `packages/kasm-adapter` | Workspace runtime implementation | Product policy and browser auth |
| LiteLLM | Model/MCP routing, scoped keys, encrypted per-user delegated OAuth, quotas, baseline guardrails | Canonical user/agent identity, final capability policy, and approval truth |
| MCP server | Provider protocol translation | Approval authority or tenant policy |
| Network enforcement | Reachability and egress boundary | Product-level capability decisions |

Begin as a modular monolith plus a separate privileged workspace controller.
Do not create a microservice for every domain object.

## Authoritative data

Use a new, independently deployed PostgreSQL database. The minimum durable
entities are:

- tenant, user, and external identity mapping;
- agent identity, ownership/delegation, and workspace assignment;
- vendor user and gateway-key mapping;
- workspace and workspace grant;
- capability and capability assignment;
- policy and version;
- governed operation and canonical digest;
- approval task and verified decision reference;
- execution lease and execution receipt;
- outbox delivery state;
- evidence event and correlation identifiers.

No vendor database is queried as an authoritative product store.

## Governed operation lifecycle

```text
received
  +--> denied
  +--> allowed --> executing --> succeeded | failed
  +--> pending_approval --> denied | expired | cancelled
                         --> approved --> executing --> succeeded | failed
```

Transitions are durable and compare-and-swap/transactional. Approval, retry,
worker restart, duplicate callbacks, and concurrent requests cannot create a
second execution lease. Provider execution receives an idempotency key when the
provider supports one and records the limitation when it does not.

## Gateway strategy

LiteLLM is a candidate, not a predetermined dependency. Qualification must
prove:

- workspace-scoped non-master keys and deny-by-default MCP discovery;
- bounded server/tool exposure;
- model alias and budget scope;
- gateway-side MCP execution where required;
- an immediate pre-execution policy hook containing exact authenticated
  identity, server, tool, schema, and canonical arguments;
- deny before upstream connection on policy timeout, outage, malformed result,
  unknown result, or identity mismatch;
- evidence available through supported APIs/hooks rather than LiteLLM database
  reads;
- a safe durable operation reference and approved retry/resume mechanism;
- behavior across the exact Claude Code/Anthropic and OpenAI-compatible routes
  selected for MVP.

The decision may be pass, partial, or fail. Partial permits only a narrow
version-tested plugin/wrapper for a proven gap. Fail requires a separate design
decision before any custom gateway is built.

## Approval strategy

Approval semantics are implemented before physical OpenVTC transport:

1. Control persists the canonical operation and returns a stable operation ID.
2. A local test signer exercises approve/deny/binding/expiry/replay/concurrency.
3. The gateway retries or resumes only with the stable operation reference.
4. Control issues one exact execution lease after verifying the decision.
5. Physical Affinidi transport later replaces the fixture adapter without
   changing operation or policy semantics.

The mobile display receives a safe, bounded summary. Raw secrets, provider
tokens, or complete sensitive payloads are not sent to the device.

## Workspace and network strategy

Each workspace receives an isolated network identity and short-lived grants.
Its selected profile defines controlled DNS and optional approved web/package
egress. The workspace cannot route directly to providers, upstream MCP servers,
databases, Docker, host metadata, another workspace, or unrestricted alternate
DNS/QUIC paths.

Kasm is the first adapter because it provides the required interactive desktop.
The architecture does not claim Kasm/Docker equals VM isolation. A future trust
tier may substitute a VM or microVM behind the same workspace contract.

## Model governance

LiteLLM supplies aliases, routing, budgets, quotas, and baseline guardrails.
ONEComputer owns which tenant/workspace/user may use an alias and the enterprise
policy/evidence correlation. MVP must define explicit behavior for provider
failure, fallback, guardrail outage, budget exhaustion, streaming, and usage
accounting.

## Product UI

Build the owned surface with Next.js 16, shadcn/ui, Tailwind CSS v4, and the
latest qualified active Node LTS pinned by patch version and image digest at
implementation time.

The visual direction is calm, minimal, and task-oriented, taking cues from
ChatGPT and Manus without cloning either. Primary journeys are:

- employee workspace launch and status;
- assigned capabilities and connection readiness;
- operation/request status and safe approval summaries;
- redacted activity and evidence;
- security policy and workspace profiles for authorized roles;
- platform integrations, health, and version pins for platform administrators.

Product design and the interactive UI prototype lead delivery. Each selected
journey then drives a server-mediated vertical slice, beginning with the Kasm
sandbox lifecycle in Issue 001. Fixtures may support visual development, but
they cannot define authorization or count as integration acceptance.

## Technology rules

- TypeScript/Node is the default for owned services unless measured constraints
  justify another runtime.
- Pin package managers, container images, schemas, and vendor releases.
- New containers run non-root, with read-only filesystems where practical,
  dropped capabilities, `no-new-privileges`, health checks, and runtime secrets.
- No mutable production tags.
- No browser-side secrets or vendor master keys.
- No imports from the legacy OneCLI repository.
- Architecture tests enforce dependency direction.
- Logs use structured correlation IDs and bounded redacted fields.

## Delivery gates

| Gate | Outcome | Issues |
| --- | --- | --- |
| A–C | Architecture, Kasm, LiteLLM, and governance foundations work | 000–004 |
| D–G | Identity, policy-built workspace, model route, and Microsoft tools work | 005–008 |
| H | Device-backed OpenVTC approval and durable evidence work | 009 |
| I | A configurable real conversational agent launches in Kasm | 010 |
| J | The real agent uses only governed Microsoft 365 tools | 011 |
| K | Administrators manage effective workspace, agent, model, and tool policy | 012 |
| L | Agent-triggered approval and audit UX works end to end | 013 |
| M | The complete human Microsoft 365 agent journey passes | 014 |
| N | Clean-state MVP acceptance passes | 015 |

Only the first `ready` implementation gate may change product code. A paused
verification gate may remain open only through the documented sequencing
exception, and its proof still blocks the later acceptance gate. Gate reports
require explicit human review before the next gate begins.

## Evidence standard

Every technical claim requires deployed evidence proportional to the boundary:

- unit tests for pure contracts and policy;
- contract tests for vendor adapters;
- integration tests for database transitions and callbacks;
- live topology probes for network, identity, credentials, and execution;
- restart/concurrency/replay tests for durable operations;
- device-backed evidence only when the WebAuthn browser agent or a later
  qualified VTA Mobile Agent is actually used;
- screenshots/accessibility checks for UI, never as authority evidence.

Evidence is stored redacted under `.artifacts/v4/issues/<id>/<timestamp>/` and
records exact source revision, image digests, schema versions, commands, result,
and residual risk.

## Stop conditions

Stop and request a decision when:

- LiteLLM cannot expose the required pre-execution context or safe resume;
- a proposed workaround would make the client or MCP server the approval
  authority;
- a critical path would require a LiteLLM master key in a workspace;
- network containment requires weakening workspace isolation;
- an O365 MCP candidate cannot meet the minimum scopes, schema identity,
  resource binding, or receipt requirements;
- the selected OpenVTC approval profile or device prerequisite is unavailable;
- a test passes only by manual database mutation, skipped negative cases, or an
  allow-by-default fallback.

## Explicit absence of migration work

V4 has no legacy baseline gate, migration waves, fork retirement, compatibility
adapter, old-schema import, or fallback deployment. The old branch may be read
for sanitized learning only. It is never a runtime dependency or acceptance
target.
