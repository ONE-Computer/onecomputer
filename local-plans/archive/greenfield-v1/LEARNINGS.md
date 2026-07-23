# Learnings from the disposable prototype

## Status of the previous codebase

The inherited application was produced through rapid experimentation and is
treated as disposable. It is not a production baseline, migration source,
rollback dependency, or architectural constraint for V4.

No application code, database schema, UI dependency, gateway patch, or Docker
topology from that branch is implicitly trusted or carried into greenfield.
Useful behavior must be re-derived from product requirements and independently
implemented and tested.

## Product learning

The product is not a OneCLI distribution, MCP catalog, Kasm dashboard, or
approval app. Its purpose is to let enterprise users benefit from autonomous
and coding agents inside a bounded workspace while the enterprise retains
enforceable control over:

- user and workload identity;
- model and tool availability;
- critical tool actions;
- workspace network reachability;
- credentials and provider access;
- budgets and guardrails;
- durable, attributable evidence.

The core product loop is:

```text
identity -> workspace grant -> model/tool request -> policy decision
         -> allow | deny | approval_required
         -> exact execution at most once -> evidence
```

## Architecture learning

1. **The workspace is untrusted.** Claude Code, claw-style agents, arbitrary
   user code, browser extensions, and local processes may ignore conventions or
   become compromised.
2. **Proxy variables are compatibility, not enforcement.** Network policy must
   prevent direct provider, MCP, metadata, database, Docker, and cross-workspace
   access even after environment variables are removed.
3. **Governance must be owned.** Tenant state, capabilities, policy, governed
   operations, approvals, execution leases, and evidence belong in a separate
   ONEComputer database and domain model.
4. **Vendor gateways are data planes, not authorities.** LiteLLM may implement
   model/MCP routing and OAuth, but ONEComputer decides enterprise capability
   policy and verifies approval authority.
5. **Do not build a custom gateway by default.** First qualify LiteLLM against
   the exact identity, policy-hook, argument-binding, failure, and resume
   contract. Build only the smallest missing seam proven necessary.
6. **Approval is not a database status or UI button.** It is a verified,
   expiring decision bound to one canonical operation digest. It grants at most
   one exact execution.
7. **Physical OpenVTC transport is separable from approval semantics.** A local
   signed fixture can validate the state machine and cryptographic binding;
   Affinidi VTA Mobile Agent integration comes after the contract is stable.
8. **Kasm is a workspace adapter, not MDM or a hostile multi-tenant VM
   boundary.** Stronger isolation tiers may later require VMs or microVMs.
9. **The public API must not control Docker directly.** Privileged workspace
   lifecycle belongs in a private controller with a narrow authenticated API.
10. **One product surface is desirable, one runtime is not.** Users should see
    a coherent dashboard while web, control, workspace, gateway, and approval
    responsibilities remain separated.

## Prototype failures retained as V4 acceptance cases

The prior implementation exposed concrete failure modes. The old fixes are not
reused, but these cases must appear in V4 verification:

- unauthenticated CONNECT or HTTP proxy traffic reached upstream;
- malformed credentials were interpreted as anonymous access;
- a normal gateway or portal approval could release an externally governed
  action;
- unknown/malformed policy conditions and cache failures could fail open;
- substring host checks accepted hostile suffixes and mishandled equivalent
  host forms;
- an entrypoint could silently replace the selected authentication mode;
- credentials appeared in held process arguments;
- browser approval bridge routes lacked sufficient tenant scoping;
- container-running, desktop-ready, tooling-ready, governance-ready, and
  model-ready were conflated;
- asynchronous provisioning caused readiness races;
- stale desktop relays, deterministic port collisions, partial resources, and
  ownership-changing reconciliation were possible;
- restart and delete/recreate behavior was not a first-class acceptance case.

These are threat cases, not reasons to preserve the old modules.

## LiteLLM experiment retained as a hypothesis

An isolated July 2026 experiment showed LiteLLM executing a read-only Linear
MCP tool server-side through chat completions. It also exposed limitations:

- the master key was required because a least-privilege access group had not
  been configured;
- 47 exposed tools contributed roughly 14k input tokens;
- client-side versus gateway-side execution changed with approval settings;
- the experiment did not prove ONEComputer's pre-execution policy contract,
  durable approval correlation, failure behavior, or safe resume.

V4 must reproduce the result with a pinned release, non-master workspace key,
small toolset, mock MCP server, and complete negative matrix. The old document
is research evidence only.

## OpenVTC learning

The prototype demonstrated useful local cryptographic cases: signed approve and
deny, tamper rejection, wrong-key rejection, expiry, operation mismatch, and
replay rejection. It did not validate the physical iOS VTA Mobile Agent,
partner transport contract, push/background behavior, or production key
custody. V4 must not describe fixture evidence as physical-device acceptance.

## UI learning

Useful journey ideas may be retained from screenshots or user observation, but
not by importing the legacy UI. The owned UI should be clean, minimal, and
task-oriented in the spirit of ChatGPT and Manus:

- workspace and agent status;
- available capabilities and connections;
- pending requests and their safe summaries;
- activity/evidence;
- authorized security and platform administration.

The browser displays server decisions; it never owns policy, secrets, signing
keys, LiteLLM master credentials, or Docker authority.

## Explicitly discarded assumptions

- The OneCLI fork must be upgraded, separated, or retired in waves.
- The OneCLI database is a source of truth.
- The inherited Rust gateway is a necessary product component.
- A secured legacy rollback lane must precede greenfield implementation.
- Existing routes, schemas, and UI are cheaper to migrate than to replace.
- More security tests against the disposable topology advance the MVP.

## What may be referenced without being copied

- sanitized test scenarios and observed failure modes;
- interaction ideas captured as screenshots or written journeys;
- the isolated LiteLLM experiment and its unanswered questions;
- public upstream documentation and pinned vendor releases;
- protocol-independent cryptographic test vectors after independent review.
