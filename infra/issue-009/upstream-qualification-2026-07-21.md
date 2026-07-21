# Issue 009 upstream OpenVTC qualification

Date: 2026-07-21

This note records the upstream code and specifications inspected before
implementing ONEComputer's physical approval adapter. The temporary research
checkouts were not added to this repository.

## Pinned upstream sources

| Source | Revision | Role |
| --- | --- | --- |
| `OpenVTC/verifiable-trust-infrastructure` | `b0b6df7a3685f405bcfb18060caadc0418fd8ffa` | VTA service, mobile core, task-consent implementation, DIDComm/TSP delivery |
| `OpenVTC/vta-mobile-agent-ios` | `dd02a49513387b25b3090b5b404d99249fc2cbbf` | Official iOS approver application |
| `OpenVTC/vta-browser-plugin` | `68b4d6c8d19203fac4b1ff401fa56bd8c564175c` | Official browser agent and JS proof implementation |
| `OpenVTC/vti-push-gateway` | `d233d656d9d9290e31abb653a1ee025b0e907bb7` | Contentless APNs/FCM/Web Push wake service |
| `trustoverip/dtgwg-trust-tasks-tf` | `894fcc6bcaf968eb652bc43b0a24057933fb59fc` | Canonical Trust Tasks framework, bindings, task-consent schemas and prose |
| `OpenVTC/openvtc` | `66e992c2d1cb983246949e81efc8cac2962c2c80` | OpenVTC community/persona CLI; not the VTA approval runtime |

All listed repositories report themselves as original repositories rather than
GitHub forks. The older Linux Foundation URL for `openvtc` redirects to the
current `OpenVTC/openvtc` repository.

## What OpenVTC is in this integration

OpenVTC is not a single approval API. The relevant pieces are:

- Trust Tasks: versioned, typed request/response documents.
- Data Integrity: `eddsa-jcs-2022` proofs whose verification method identifies
  the signing DID key.
- DIDComm or TSP plus a mediator: authenticated, encrypted task delivery.
- A VTA: a trust-task executor, policy engine, key/identity service, and durable
  grant owner for tasks it executes.
- A mobile or browser agent: a separate approver identity that displays a safe
  request and signs a decision.
- An optional push gateway: a contentless wake doorbell. The actual task remains
  encrypted in the mediator and is pulled after wake.

The mobile private key remains in the native signer/Secure Enclave path. The
Rust mobile core canonicalizes the task and asks the native signer only to sign
the resulting bytes.

## Protocol selection

### Rejected: `auth/step-up`

`auth/step-up/approve-response/0.2` elevates a VTA authentication session. It
binds the subject, session ID, challenge, decision, evidence, and granted ACR.
It is useful for VTA administration but is not an authorization for one exact
OneDrive delete.

### Selected: `task-consent`

`task-consent/request/0.1` is authored by the executor and includes:

- a fresh challenge;
- the exact payload digest;
- executor-authored effects and safe summaries;
- side-effect and disclosure classifications;
- requester and approver-set information;
- an expiry and optional prior-state pin.

`task-consent/decision/0.1` is signed by the approver and echoes the challenge
and payload digest with an explicit `approve` or `deny`. The specification says
the proof, not the transport session, is the authorization. The executor must
verify the proof, resolve the signer, check current approver membership,
re-derive the digest, assert the state pin, and consume the challenge only at
execution.

The task-consent specifications are Draft and target Trust Tasks framework
`0.2`; ONEComputer must reject unknown versions rather than silently adapting
them.

## Cryptographic verification contract

For the upstream DID-signed path:

1. Require a strict Trust Task envelope with the exact decision type URI.
2. Require `proof.type = DataIntegrityProof`,
   `proof.cryptosuite = eddsa-jcs-2022`, and
   `proof.proofPurpose = assertionMethod`.
3. Resolve the proof's `verificationMethod` to a currently enrolled Ed25519
   key and take the proven signer identity from that verification result.
4. Remove `proofValue` from the proof configuration and remove `proof` from the
   document.
5. Build the signing input as
   `SHA-256(JCS(proofConfig)) || SHA-256(JCS(documentWithoutProof))`.
6. Decode the multibase base58btc proof value and verify Ed25519.
7. Bind recipient, issuer/proven signer, issued/expiry time, operation owner,
   challenge, payload digest, policy version, and current resource state before
   recording any decision.

Transport success, a UI tap, a bearer identity, or a row edited to `approved`
is insufficient.

## Stock iOS compatibility finding

The official iOS app pins `vta-mobile-core-v0.6.14` and includes a real
task-consent approval sheet. Approval or denial uses the holder DID key and
posts the signed decision to the configured VTA at `/api/trust-tasks` with the
holder's VTA access token. Live/background delivery expects a configured VTA
DID, VTA URL, and mediator; APNs wake additionally needs the official push
gateway, an Apple App ID, APNs key, and a physical device.

The VTA service's task-consent path is coupled to VTA-native tasks: its fixed
dispatcher dry-runs the real VTA handler, stores pending consent, verifies the
phone decision, and issues a grant consumed when that same VTA task is
resubmitted. It does not expose the original signed decision as an approval for
an arbitrary external executor.

Therefore an unmodified VTA cannot simply be placed between ONEComputer and the
phone. Doing so would make the VTA the grant owner and leave Control trusting a
status rather than verifying the signed decision.

## Browser-agent finding

The official browser plugin already contains compatible JCS/Ed25519 proof
signing and verification, a distinct approver identity protected by WebAuthn
PRF, and task-consent UI/mediator handling. It is a credible first physical
surface, but choosing it changes Issue 009's current acceptance criterion from
the user's iPhone VTA Mobile Agent to an installed browser agent. That choice
must be explicit.

## Recommended implementation boundary

Implement the common, transport-independent portion in ONEComputer first:

- a strict task-consent codec and `eddsa-jcs-2022` verifier;
- an enrolled-approver/key trust model scoped to tenant and user;
- durable approval tasks, delivery outbox, attempts, verified decisions, and
  redacted evidence;
- exact challenge/digest/state binding into the existing operation service;
- atomic decision recording and at-most-one execution lease;
- a physical profile in which the local HMAC fixture endpoint is unavailable.

For iPhone delivery, prefer contributing or adopting an upstream
external-executor profile in the official mobile app. If that is unavailable,
the bounded alternative is a ONEComputer adapter that implements the VTA auth,
HTTPS Trust Tasks, and mediator subset the official app expects while leaving
the signed task-consent document unchanged. Do not fork the cryptographic
protocol or invent a ONEComputer-only approval envelope.

## External prerequisites for the physical pass

- A build of the official iOS agent on a real iPhone (the source repository is
  not an App Store install path).
- A Mac/Xcode signing path for bundle `org.openvtc.vta.agent` or an upstream
  TestFlight/build supplied by the project.
- A reachable TLS executor endpoint and a DID usable by the phone.
- A reachable DIDComm/TSP mediator. Background push additionally requires an
  APNs-capable official push gateway and Apple credentials; foreground live
  mediator listening can qualify the first pass without APNs.
- Enrollment of the phone approver DID/public key in ONEComputer. No private
  device material is copied to Control.

## Research conclusion

The cryptographic and task semantics are suitable and unusually close to
ONEComputer's existing operation/lease design. The physical transport is not a
drop-in service integration. The next implementation can safely build the
common verifier and durable adapter records, but the physical surface requires
an explicit choice between upstream iOS external-executor work and the already
more accessible official browser agent.
