# VTI Mobile 2FA Fork Study (ONE-138)

**Goal:** Pick the fork/depend/build-fresh approach for a OneComputer-branded mobile 2FA approver that receives VTI step-up requests and signs approve/deny responses.

**Date:** 2026-07-05
**Author:** Claude on GLM5.2 (PM-assisted; agent stalled, PM wrote from prior research + local clone)

## The candidates

The OpenVTC/verifiable-trust-infrastructure repo (Apache-2.0, latest commit `0bf7713 feat(vta-mobile-core): signed denial for step-up approve-response`, pushed 2026-07-03) contains the full VTI stack. Three mobile-approver candidates:

### (a) `vta-mobile-core` — the Rust FFI library

- **What it is:** A Rust crate (`vta-mobile-core/`) compiled via UniFFI into `VtaMobileCore.xcframework` for iOS. Exposes a Swift API (`VtaMobileCore.swift`, ~126 KB generated).
- **What it provides:** `MediatorSession` (connect + `receive_next` over a mediator WebSocket, pulling VTA-pushed DIDComm messages like `auth/step-up/approve-request/0.1`), key custody (Ed25519 seed, multibase-encoded), DIDComm session management (reuses the affinidi ATM client via `vta-sdk[session]`).
- **Reuse:** ~90% — the entire network + crypto + DIDComm stack is here. We'd consume the xcframework.
- **Build:** Rust cross-compile to `aarch64-apple-ios` + the iOS staticlib. Releases are published as prebuilt xcframeworks (v0.5.0 latest).

### (b) `vta-mobile-agent-ios` — the full iOS app

- **What it is:** A separate repo (referenced in release notes) — the complete iOS application that consumes `VtaMobileCore.xcframework` via SwiftPM.
- **What it provides:** The full UI (approver screen, key management, mediator connection) + the engine.
- **Reuse:** ~100% of the engine, ~70% of the UI (we'd rebrand).
- **Build:** Xcode + SwiftPM, signed iOS app. Slower to iterate.

### (c) PWA / `vta-browser-plugin` style — web wallet

- **What it is:** A browser-based wallet (the VTI repo has SIOPv2 wallet-login flows for the VTC admin UI — `vtc-service/admin-ui/src/lib/wallet.ts`; there's also a `vta-browser-plugin` referenced as a PWA/MV3 extension).
- **What it provides:** Web-based approve/deny without a native app. Uses the same `vta-sdk` DIDComm client (the Rust SDK is the engine; a WASM/JS binding would be needed, OR a backend proxy that holds the keys).
- **Reuse:** ~50% — the DIDComm protocol logic, but the mobile-core FFI is iOS-only so we'd need a JS binding or a backend mediator.
- **Build:** Fastest to a clickable demo (no app-store signing), but weaker key custody (browser key storage vs iOS Keychain).

## How it integrates with our existing gateway step-up

Our hold→approve→release chain (proven in ONE-107/ONE-135):

1. Gateway holds a request (ManualApproval rule) → creates an ApprovalRequest.
2. Manager approves → gateway poll observes → releases the held request.

The VTI step-up flow maps onto step 2:

1. **VTA pushes** `auth/step-up/approve-request/0.1` over DIDComm → mediator (when the gateway creates the ApprovalRequest, it triggers a VTA step-up notification).
2. **Mobile approver** (this ticket) — `MediatorSession` pulls the request off the mediator → displays "Alex's Agent wants to send mail via graph.microsoft.com — approve?" → user taps approve.
3. **Signed response** — the mobile signs the canonical
   `auth/step-up/approve-response/0.2` Trust Task with the manager's DID key →
   sends it back over DIDComm → the gateway verifies the `eddsa-jcs-2022`
   proof and delegated subject/action binding.
4. **Gateway releases** the held request only if the signed response verifies.

This is what makes Step 7 (2FA step-up) and Step 8 (powered by VTI) real: the approval is a cryptographically signed, DID-bound Verifiable Credential from a separate device — not a DB row flip.

## Recommendation

**For the demo timeline: build a thin OneComputer-branded iOS app on top of `vta-mobile-core` (option a), with a PWA fallback (option c) for fast iteration.**

Rationale (1 paragraph): `vta-mobile-core` gives us the entire DIDComm + crypto + mediator stack as a prebuilt xcframework — we don't reimplement any crypto (the "no DIY crypto" rule). A thin iOS shell (SwiftUI: one "approvals" list + an approve/deny sheet) on top of it is ~1-2 weeks of work and gives a real, Keychain-backed 2FA approver that brand-matches ONEComputer. Forking `vta-mobile-agent-ios` (option b) brings more UI than we need and ties us to their IA. A PWA (option c) is faster to a clickable demo (no signing) but has weaker key custody and would need a JS binding to `vta-sdk` that doesn't exist yet — so use it only as a fast-iteration preview, not the pilot target. **Fork `vta-mobile-core` (depend, not fork — consume the xcframework via SwiftPM) + build a thin OneComputer iOS app.**

## Licensing

- OpenVTC/verifiable-trust-infrastructure is **Apache-2.0**. We can consume, fork, and rebrand freely; we must preserve the LICENSE + NOTICE for the reused crates and attribute. No copyleft risk.
- The affinidi TDK crates (already used by our gateway via `affinidi-tdk-rs`) are also Apache-2.0.

## Follow-up build tickets (PM to file in Linear)

1. **Clone + mirror OpenVTC/verifiable-trust-infrastructure to Gitea** (part of ONE-139) — so the iOS app's SwiftPM can resolve the xcframework from our infra, and we can pin a version.
2. **Build a thin OneComputer iOS app shell** consuming `VtaMobileCore.xcframework` via SwiftPM — SwiftUI: approvals list + approve/deny sheet. Brand as ONEComputer.
3. **Wire the mobile approver to a mediator** — configure a DIDComm mediator (run `vta-service` as the mediator, OR use the VTI local-dev mediator) + provision a manager DID/key on the device.
4. **End-to-end step-up integration** — gateway creates ApprovalRequest → VTA
   pushes `auth/step-up/approve-request/0.1` → mobile receives → user
   approves/denies → signed `approve-response/0.2` → gateway verifies →
   releases held request. This closes Steps 7+8.
5. **PWA fast-iteration preview** (optional, parallel) — a web wallet that calls a backend proxy holding the manager key, for demoing without an iOS device.

## Open questions for the build tickets

- Do we run our own `vta-service` mediator, or use the OpenVTC hosted one? (Affects provisioning + latency.)
- The gateway's `vti_signer.rs` and our TS port (ONE-55) must produce signatures that verify against the same DID key the mobile app uses — key interop is critical (ONE-141 covers the canonicalization side; this is the key-custody side).
- For the demo, can we use a single pre-provisioned manager DID/key (printed QR or config) to avoid the full VTA provisioning flow?
