# ADR-006: Qualify the OpenVTC browser agent with an HTTPS external-executor profile

Status: accepted for Issue 009 qualification

Date: 2026-07-21

## Decision

Use the Trust Tasks HTTPS `0.1` binding for the first physical OpenVTC approval
surface. A minimal browser-agent profile will reuse the official browser
agent's distinct `did:key` approver identity, WebAuthn PRF-wrapped Ed25519 key,
task-consent rendering, and `eddsa-jcs-2022` signing behavior.

The browser agent will:

1. enroll its public approver DID and receive a revocable, hashed-at-rest
   transport credential;
2. poll a scoped ONEComputer approval inbox for a recipient-specific, signed
   `task-consent/request/0.1` document;
3. verify the Control executor signature and render only its signed effects;
4. require a fresh WebAuthn user-verification ceremony before unwrapping the
   approver key for one decision; and
5. send the signed `task-consent/decision/0.1` to the standard
   `POST /trust-tasks` HTTPS endpoint.

The transport credential identifies the enrolled channel and controls inbox
access. It is not approval authority. Control accepts an approval only after
independently verifying the decision proof and all live operation bindings.

## Why not deploy the complete browser VTA wallet first

The upstream browser extension is a broad VTA wallet. It expects VTA onboarding,
DIDComm key agreement, an Affinidi mediator, VTA ACLs, and a full VTA task
dispatcher. Its manifest also requests capabilities needed by its wider wallet
and relying-party features, including all-site content scripts, cookies, tabs,
and unrestricted host access.

Issue 009 needs only a physically separate approval agent. Deploying the full
wallet and a VTA would add unrelated authority and still would not let Control
verify and consume the signed decision for an externally executed task.

## Compatibility boundary

This is an external-executor profile, not a new approval protocol:

- request and decision type URIs remain the upstream task-consent `0.1` URIs;
- proof construction remains upstream `eddsa-jcs-2022`;
- request delivery uses the published Trust Tasks HTTPS `0.1` binding;
- upstream browser-agent code is reused with revision and license attribution;
- ONEComputer-specific code is limited to enrollment, inbox polling, product
  branding, and the executor endpoint;
- a future mediator/DIDComm transport or iOS agent uses the same persisted task
  and decision documents.

## Security constraints

- The extension receives no Microsoft token, LiteLLM key, PostgreSQL access, or
  raw operation payload.
- The manifest must use only the Control origin required for the qualification;
  it must not inherit the upstream wallet's all-site/cookie permissions.
- Transport token hashes, enrollment status, delivery attempts, task expiry,
  verified decisions, leases, and receipts are durable Control data.
- Revocation, expiry, wrong recipient, proof failure, or task mutation must fail
  before a lease is issued.
