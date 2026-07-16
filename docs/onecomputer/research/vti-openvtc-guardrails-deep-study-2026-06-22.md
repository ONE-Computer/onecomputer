# OneComputer × Affinidi/OpenVTC/VTI Deep Study — Guardrails Runtime Architecture

> **2026-06-28 audit note:** The product-boundary decision here (OneComputer owns
> the runtime control plane; Affinidi/OpenVTC owns the trust substrate) is still
> the right call and is preserved. But implementation status described as
> "implemented" should be treated as **scaffold until verified** — much of it is
> `simulator_only_not_enforced` or a local HMAC mock. See
> [`AUDIT.md`](../../../AUDIT.md) for what actually works. The `/workspace/agent/...`
> paths refer to an LLM agent sandbox, not this repo.

Date: 2026-06-22 SGT  
Branch: `feature/onecomputer-phase1-rebrand`  
Research workspace: `/workspace/agent/research/affinidi-vti`

## Executive decision

OneComputer should **not** build its own DIDComm, wallet, mobile 2FA, proof format, consent protocol, or bespoke policy-provenance layer.

OneComputer should own the **runtime control plane**:

- action normalization for agents/computers/connectors;
- policy decision/evaluation UX;
- approval-chain orchestration;
- dashboards for CISO, compliance, builder, and agent owner;
- runtime evidence timeline;
- integration adapters for AWS/E2B/Daytona/NanoClaw/InvestmentGini.

Affinidi/OpenVTC/VTI should provide the **trust substrate**:

- VTA for DIDs, keys, contexts, access-control policy, signing, DIDComm, vault/device primitives;
- VTC for community/org governance, members, roles, credentials, policy/admin UX;
- Trust Tasks as the transport-agnostic work envelope;
- DIDComm as preferred inter-component transport;
- VTA mobile/browser agents for passkey/biometric step-up and approvals;
- DID hosting / WebVH service for resolvable enterprise identities.

This keeps OneComputer lean and differentiated: **governed AI computers with verifiable action control**, not a crypto/wallet vendor clone.

## Repos refreshed / cloned

Local clone base: `/workspace/agent/research/affinidi-vti`.

| Repo                                      | Latest inspected head | OneComputer relevance                                                            |
| ----------------------------------------- | --------------------: | -------------------------------------------------------------------------------- |
| `OpenVTC/verifiable-trust-infrastructure` |             `8054748` | VTA/VTC core, SDK, ACL, audit, Trust Task specs, Nitro enclave, MCP bridge.      |
| `OpenVTC/openvtc`                         |             `1117e32` | User-facing OpenVTC app/CLI, personas, multi-membership, join flows.             |
| `OpenVTC/dtg-credentials`                 |             `f5051e0` | VC types and signing/verifying helpers.                                          |
| `trustoverip/dtgwg-trust-tasks-tf`        |             `0e6c4d0` | Canonical Trust Task registry/specs: step-up, consent, vault, policy, push, ACL. |
| `OpenVTC/vti-didcomm-js`                  |             `14acf27` | Browser/Node DIDComm v2 primitives.                                              |
| `OpenVTC/vti-push-gateway`                |             `d233d65` | Contentless push doorbell, wake handles, allowlist, Trust Task endpoint.         |
| `OpenVTC/vta-browser-plugin`              |             `34b0679` | Browser wallet/session, passkeys, DIDComm-only VTA support, PWA/MV3 forms.       |
| `OpenVTC/vta-mobile-agent-ios`            |             `d73cf0b` | Mobile biometric AAL1→AAL2 step-up and approval UX.                              |
| `OpenVTC/rp-sdk-js`                       |             `65013dd` | SIOPv2 id_token verification and future step-up middleware.                      |
| `OpenVTC/vti-setup`                       |             `1e1e68d` | Deployment recipes for VTA/WebVH/DIDComm mediator.                               |
| `affinidi/affinidi-tdk-rs`                |             `e37c7d9` | Affinidi Rust TDK, mediator crates, VTA SDK alignment.                           |
| `affinidi/affinidi-tdk`                   |             `cc7b002` | JS/TS Affinidi SDK/TDK packages.                                                 |
| `affinidi/affinidi-webvh-service`         |             `6f1f024` | DID hosting control/server/witness/watcher and passkey auth.                     |
| `affinidi/affinidi-trust-registry-rs`     |             `1068f41` | Trust registry direction; not current-week active, but strategic.                |

`vti-message-bridge` appears in the Week 25 report but was not publicly cloneable from the probed GitHub locations. Treat it as private/non-public unless Affinidi grants access. Use the Week 25 report and Trust Task specs as public evidence of its shape.

## What changed in the latest OpenVTC work

The Week 25 report reframes the whole stack as: **invited in, locked down**.

High-signal changes:

1. **Invitation-based joining** — verifiable invitations, fresh/unlinkable identity, logged admission.
2. **Everything recorded** — sensitive actions write tamper-evident records; consent gates decide what is allowed in.
3. **Production hardening** — host isolation, sign-in/upload checks, secret redaction, remote device kill-switch.
4. **Messaging bridge** — WhatsApp/Signal/Slack to trust agent and personal AI, guarded by default-deny consent.
5. **Next focus** — one rulebook for every entity: people, organisations, and AI agents.

This is precisely aligned with OneComputer’s direction: AI agents and AI computers should be governed like verifiable entities, not like opaque bot jobs borrowing a human token.

## Key architecture patterns to copy

### 1. Prefer DIDComm over bespoke REST authentication

VTI workspace guidance is explicit: DIDComm authcrypt should be the preferred inter-component protocol wherever the counterparty can speak it. REST/HTTPS is fallback.

For OneComputer this means:

- Do not design “REST + custom signature headers” first.
- Model action/approval messages as Trust Tasks.
- Route over DIDComm when talking to VTA, mediator, mobile/browser agents, push gateway, or future message bridge.
- Keep HTTPS fallback only for AWS/runtime components that cannot speak DIDComm yet.

### 2. Use Trust Tasks as the stable contract

Trust Tasks are self-contained, transport-agnostic, JSON-based work units. Existing specs already cover much of OneComputer’s desired control surface:

- `auth/step-up/policy` — policy floors and per-entry overrides.
- `auth/step-up/approve-request` / `approve-response` — 2FA, self/delegated approval, passkey/WebAuthn proof.
- `confirm/request` / `confirm/response` — generic explicit user confirmation.
- `consent/request` / `consent/decision` — default-deny inbound connector gating.
- `policy/evaluate` — dry-run policy evaluation and trace.
- `vault/release` / `vault/proxy-login` — credential release/proxy with step-up and short TTL.
- `push/register`, `push/provision`, `push/wake` — mobile/browser wake-up without leaking task content.
- `acl/grant`, `acl/revoke`, `acl/change-role` — access-control changes.
- `device/wipe`, `device/disable`, `device/set-wake` — device lifecycle and kill-switch patterns.

OneComputer should define only a small extension family where needed, e.g. `onecomputer/action/request`, `onecomputer/action/decision`, `onecomputer/evidence/append`, after first exhausting existing specs.

### 3. Strictest-wins policy composition

`auth/step-up/policy` already has the exact merge model we need:

- system-wide floor;
- per-entry override;
- override may make the rule stricter, never weaker;
- no step-up method => fail closed;
- self-lockout refused;
- break-glass rollback path retained.

Map this to OneComputer:

| OpenVTC concept          | OneComputer mapping                            |
| ------------------------ | ---------------------------------------------- |
| Maintainer floor         | Global cyber/governance policy                 |
| AclEntry.stepUp override | Personal agent-owner policy / project policy   |
| Operation-class          | Agent/computer action type                     |
| Self step-up             | User approves own agent action                 |
| Delegated step-up        | Manager/compliance/cyber/data steward approves |
| DelegatedAny             | Bounded reviewer pool, never “any holder”      |
| Non-escalating carve-out | Safe self-service operations only              |

Rule: **Governance can raise floors and deny. Users can add stricter personal limits. Users cannot weaken governance.**

### 4. Approval chains are DAGs of Trust Tasks

OneComputer should implement approval chains as a small workflow engine over Trust Tasks:

```text
ActionRequest
  -> GuardrailsDecision(requireApproval)
  -> ApprovalStep(owner self step-up)
  -> ApprovalStep(data steward delegated)
  -> ApprovalStep(compliance delegatedAny)
  -> ApprovalStep(cyber delegated)
  -> FinalDecision(allow/deny)
  -> EvidenceAppend
```

Each node should record:

- approver DID / role criterion;
- required evidence kind: `didSigned`, `webauthn`, or later VTA-specific proof;
- TTL and challenge binding;
- target action digest;
- policy IDs and rule traces;
- outcome and denial reason.

### 5. Use mobile/browser VTA for step-up, not a custom 2FA app

The VTA mobile app is already designed for biometric AAL1→AAL2 step-up. The push gateway pattern is also correct: push notification is only a **contentless doorbell**; actual sensitive task content is pulled from a DIDComm mediator after wake.

OneComputer should:

- use VTA mobile for high-risk approval UX;
- use VTA browser plugin/PWA for admin and builder approvals;
- keep OneComputer UI as the CISO/builder console, not the private-key wallet;
- never send sensitive task content through APNs/FCM/Web Push payloads.

### 6. Use VTC as the governance community model

The Week 25 roadmap says OpenVTC is moving toward one rulebook for every member — people, organisations, and AI agents.

OneComputer should model:

- each enterprise/customer as a VTC or VTC-like trust community;
- humans, agents, computers, connectors, runtimes, and service integrations as members/entities;
- roles such as `agent_owner`, `project_owner`, `data_steward`, `compliance_reviewer`, `cyber_reviewer`, `runtime_operator`, `break_glass_admin`;
- policies enforced at join time and at action time;
- trust-registry integration later for recognized entities and cross-org trust.

### 7. Use DID hosting / WebVH for resolvable identities

For enterprise-friendly DIDs, `affinidi-webvh-service` is strategically important. It provides DID hosting server/control/witness/watcher, supports VTA-managed or self-managed modes, and offers scripted/non-interactive setup.

For OneComputer:

- agent/computer DIDs should eventually be resolvable via WebVH/DID hosting;
- dev can start with `did:key` for local mocks;
- production should support `did:webvh` for enterprise-controlled, auditable identities.

## Proposed OneComputer target design

```text
Agent / Computer / Connector
        |
        v
OneComputer Action Gateway (PEP)
  - normalize action
  - redact sensitive inputs
  - compute action digest
  - emit ActionRequest Trust Task
        |
        v
Guardrails Decision Engine (PDP)
  - global policy floor
  - dept/project/data policy
  - personal owner policy
  - runtime risk/anomaly/rate limits
  - VTI proof/role verification
        |
        +--> deny -> evidence
        +--> allow -> execute -> evidence
        +--> require approval/2FA
                  |
                  v
Approval Orchestrator
  - build approval DAG
  - route via VTA browser/mobile/DIDComm
  - collect approve-response / confirm-response
  - re-evaluate with proof
                  |
                  v
Runtime Adapter / Connector Proxy
  - AWS/E2B/Daytona/NanoClaw/M365/Telegram/etc.
                  |
                  v
Evidence Ledger + CISO Console
```

## Action taxonomy v0

Start with these normalized action classes. They are protective and CISO-relatable.

| Action class                 | Default posture                                                   | Likely VTI mechanism                  |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `email.send.external`        | Require self step-up; delegated approval for high-risk recipients | `auth/step-up/*`, `confirm/*`         |
| `file.read.batch`            | Rate limit; require approval above threshold                      | `policy/evaluate`, evidence           |
| `file.delete.recursive`      | Deny by default; cyber/project owner delegated approval           | `auth/step-up/policy`, `approve-*`    |
| `sharepoint.share.external`  | Require data steward + compliance approval                        | approval DAG                          |
| `secret.release`             | Prefer proxy-login; release only with short TTL + step-up         | `vault/proxy-login`, `vault/release`  |
| `connector.message.inbound`  | Default-deny until owner consent                                  | `consent/request`, `consent/decision` |
| `connector.message.outbound` | Step-up for external send / attachment                            | `confirm/*`, `approve-*`              |
| `runtime.network.egress`     | Allowlist, deny unknown domains                                   | PDP + runtime adapter                 |
| `runtime.package.install`    | Allow low-risk, approval for native/system packages               | action policy                         |
| `agent.mandate.change`       | Require owner + cyber approval if broadening authority            | `acl/*`, `auth/step-up/*`             |
| `policy.change`              | Require governance/admin proof and dry-run                        | `policy/evaluate`, `policy/upsert`    |
| `device.disable_or_wipe`     | Cyber delegated approval + audit                                  | `device/disable`, `device/wipe`       |

## Backlog changes required

### P9 — Guardrails Runtime Controls overhaul

Replace the current compliance-document-heavy “Policy Engine” framing with protective runtime controls.

Deliverables:

- action taxonomy and normalizer;
- strictest-wins policy merge;
- policy simulation/dry-run;
- evidence for allow/deny/approval;
- first 12 protective templates;
- UI copy: “Guardrails”, “Step-up”, “Approvals”, “Limits”, “Evidence”, “Break-glass”.

### P10 — Approval Orchestrator

Deliverables:

- approval DAG schema;
- approver resolver: owner/project/data/compliance/cyber/recipient;
- local mock approval provider;
- VTI adapter interface for `approve-request` / `approve-response`;
- challenge binding, TTL, replay refusal;
- evidence export.

### P11 — VTA mobile/browser integration seam

Deliverables:

- evaluate `vta-mobile-agent-ios` as fork/reference for OneComputer 2FA;
- evaluate `vta-browser-plugin` PWA/MV3 as admin/user wallet approval surface;
- wire mock DIDComm flow first;
- keep APNs/FCM/Web Push contentless only;
- no secrets in push or browser local storage.

### P12 — VTC / Trust Community model

Deliverables:

- model OneComputer tenant as VTC-like community;
- roles and credentials for humans/agents/computers/connectors;
- Trust Registry roadmap;
- agent onboarding/invitation model;
- multi-persona / per-project agent identity model.

### P13 — Production VTI handoff / vendor collaboration

Deliverables:

- concise spec to Affinidi: OneComputer action-control Trust Tasks;
- identify existing specs reused vs extension specs needed;
- vendor-maintained VTA mobile/browser strategy;
- cross-org pilot design with InvestmentGini as first customer.

## Design principles for future coding agents

1. **No DIY crypto.** Use VTI/Affinidi/OpenVTC libraries and specs.
2. **DIDComm first.** REST is fallback.
3. **Trust Tasks first.** Do not invent ad hoc action/approval JSON unless it is clearly a OneComputer extension spec.
4. **Strictest wins.** Personal policy can be stricter, never weaker than global policy.
5. **Default deny for unknown inbound surfaces.** Consent must exist before connector delivery.
6. **Proof before privilege.** Verified signature/WebAuthn/DID proof is necessary but not sufficient; role authorization must also pass.
7. **Short TTL for secret release.** Prefer proxy-login over raw release.
8. **Contentless push only.** Sensitive task content stays in encrypted DIDComm mediator flow.
9. **Audit/evidence always.** Every deny, allow, approval, release, and policy change emits evidence.
10. **Keep OneComputer as product/control-plane.** Let Affinidi/OpenVTC own trust substrate where possible.

## Open questions

1. Can Affinidi provide access to `vti-message-bridge`? It is the most directly relevant missing repo.
2. Which VTA deployment mode should OneComputer pilot first: local/dev VTA, managed VTA, or VTA inside Nitro Enclave?
3. Should OneComputer propose formal `onecomputer/*` Trust Task specs upstream or keep them internal until stable?
4. What is the minimum role/credential model for a 2-customer pilot: Temasek Trust + EDB?
5. Can the VTA mobile app be directly forked/white-labeled, or should OneComputer only integrate with it?

## Files and source references

Research artifacts:

- `/workspace/agent/research/affinidi-vti/_analysis/repo-heads-and-recent-commits.md`
- `/workspace/agent/research/affinidi-vti/_analysis/onecomputer-vti-patterns.md`

High-signal source files:

- `verifiable-trust-infrastructure/README.md`
- `verifiable-trust-infrastructure/CLAUDE.md`
- `dtgwg-trust-tasks-tf/specs/auth/step-up/policy/0.2/spec.md`
- `dtgwg-trust-tasks-tf/specs/auth/step-up/approve-request/0.2/spec.md`
- `dtgwg-trust-tasks-tf/specs/auth/step-up/approve-response/0.2/spec.md`
- `dtgwg-trust-tasks-tf/specs/consent/request/1.0/spec.md`
- `dtgwg-trust-tasks-tf/specs/consent/decision/1.0/spec.md`
- `dtgwg-trust-tasks-tf/specs/vault/release/0.2/spec.md`
- `vta-mobile-agent-ios/README.md`
- `vta-browser-plugin/README.md`
- `vti-push-gateway/README.md`
- `rp-sdk-js/README.md`
- `affinidi-webvh-service/README.md`
