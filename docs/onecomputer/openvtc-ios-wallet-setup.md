# OpenVTC iOS wallet setup for the ONEComputer Azure E2E

## Current state

The iOS repository is already cloned locally at:

```text
/Users/gini/Desktop/Project ONEComputer/openvtc/vta-mobile-agent-ios
```

It is a SwiftUI VTA mobile agent, not a mock UI. It contains:

- Keychain-backed holder identity (`did:key`);
- Trust Task authentication against a VTA;
- DIDComm mediator listening;
- human review for structured authorization requests;
- DID-signed `auth/step-up/approve-response/0.2` responses;
- optional APNs contentless wake-up support.

The package pins `vta-mobile-core-v0.6.11` and supports iOS 16+. XcodeGen is
installed on the development Mac and the project can be regenerated with:

```bash
cd /Users/gini/Desktop/Project\ ONEComputer/openvtc/vta-mobile-agent-ios
xcodegen generate
```

The Mac currently has only the Command Line Tools, not the full Xcode app. A
real iOS build, simulator, code signing, camera QR scanning, and APNs testing
therefore require installing Xcode and selecting it as the active developer
directory:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

`swift package resolve` succeeds. Plain `swift test` on macOS is expected to
fail because `VtaMobileCore.xcframework` contains iOS slices only. Use an iOS
Simulator destination for tests; use a physical iPhone for APNs and biometric
testing.

## Azure staging values

The current staging VTA publishes:

```text
VTA URL: https://onecomputer-openvtc.eastus2.cloudapp.azure.com/vta
VTA DID: did:key:z6MkqNyBB84sjXoicmo8M9amNByZxDAWwMAwdhcANb3tMwtj
ONEComputer decision URL: https://onecomputer-openvtc.eastus2.cloudapp.azure.com/v1/openvtc-approvals
```

The mediator DID is public configuration but deliberately remains sourced from
the VM rather than copied into secrets or tickets:

```bash
ssh onecomputer-azure \
  "sudo awk -F'\\\"' '/^mediator_did/{print \\\$2}' /var/lib/openvtc/vta/config.toml"
```

For the first staging connection, enter the VTA URL, VTA DID, and mediator DID
in Settings. Leave Push gateway URL empty: the Azure E2E currently uses a live
DIDComm mediator listener; the production contentless APNs push gateway has
not yet been deployed to this VM.

The app also supports a `cierge-pair://v1?...` QR payload. Generate one locally
from the public values after retrieving the mediator DID; do not put wallet
private material in the QR code.

## Critical compatibility boundary

The current Azure manager wallet (`openvtc-wallet.service`) receives a
ONEComputer-specific DIDComm message:

```text
ONEComputer API -> DIDComm bridge -> mediator -> manager DID
  body = { protocol, approvalId, document, push }
```

The iOS app currently expects the VTA's direct DIDComm body to be the bare
`auth/step-up/approve-request/0.1` document and submits its signed response to
the VTA at `/api/trust-tasks`. The current ONEComputer gateway instead expects
the signed document at:

```text
POST /v1/openvtc-approvals/{approvalId}/decide
```

Therefore, simply pointing the iOS app at the Azure VTA will authenticate the
phone but will not yet make it the manager approval device for the hosted
ONEComputer flow.

## Mobile adapter status

The thin adapter is implemented locally in the iOS commit `cb8f1ed`:

- `DidcommReceive` unwraps the ONEComputer application envelope;
- the existing review UI sees the canonical OpenVTC authorization context;
- `decideOneComputerApproval` signs the standard response and posts it to the
  configured decision URL;
- Settings and QR pairing can carry the decision URL without private material.

It is syntax-checked locally but cannot receive a full iOS typecheck until Xcode
is installed. The first device run is still required before routing the Azure
manager DID to a phone.

## Required integration slice

The safe integration is a thin adapter in the iOS app, not a second wallet or a
second cryptographic protocol:

1. Unwrap the ONEComputer DIDComm body and validate `protocol`, `approvalId`,
   recipient, and the embedded canonical Trust Task before showing it.
2. Render the existing human review UI using the canonical
   `org.openvtc.authorization-context` embedded in the request.
3. Build the existing OpenVTC-specified `approve-response/0.2` with the
   Keychain-held holder key.
4. POST only the signed response to the ONEComputer decision endpoint over
   HTTPS, with the approval ID bound to the response URL and payload.
5. Keep the VTA auth/mediator session and OpenVTC proof verification intact;
   never add a portal approval button or copy the private key out of Keychain.
6. Enroll the phone's public holder DID in the staging mediator/VTA and route
   `OPENVTC_APPROVER_DID` to that DID only after the app has been built and its
   public DID is visible.

This preserves the existing security model: the phone signs locally, the
ONEComputer gateway independently verifies the proof, and the web UI remains a
read-only status surface.

## Local build commands after Xcode installation

```bash
cd /Users/gini/Desktop/Project\ ONEComputer/openvtc/vta-mobile-agent-ios
xcodegen generate
xcodebuild -resolvePackageDependencies \
  -project VtaMobileAgentApp.xcodeproj \
  -scheme VtaMobileAgentApp
xcrun simctl list devices available | grep -i iPhone
xcodebuild test \
  -scheme VtaMobileAgent-Package \
  -destination 'platform=iOS Simulator,name=<installed iPhone>'
xcodebuild build \
  -project VtaMobileAgentApp.xcodeproj \
  -scheme VtaMobileAgentApp \
  -destination 'platform=iOS Simulator,name=<installed iPhone>'
```

For the first real-device install, enable automatic signing for bundle ID
`org.openvtc.vta.agent`, enable Push Notifications only when the APNs gateway
is ready, and test the mediator listener before enabling background push.

## Promotion gates

- [ ] Full Xcode installed and the package tests pass on an iOS Simulator.
- [ ] Physical iPhone install succeeds with Keychain identity creation.
- [ ] Phone authenticates to the staging VTA.
- [ ] Phone establishes a DIDComm mediator listener.
- [ ] Phone's public holder DID is enrolled and routed as the manager DID.
- [ ] ONEComputer wrapper is displayed and reviewed in the app.
- [ ] Signed approval reaches `/v1/openvtc-approvals/{id}/decide`.
- [ ] Rust gateway verifies it and releases one real Graph action.
- [ ] APNs contentless wake is tested only after `vti-push-gateway` is deployed.
- [ ] Staging open/direct mediator delivery is replaced with production closed
      ACL/keylist provisioning before release.
