# OpenVTC-native authentication boundary

ONEComputer is a relying party and business-enforcement layer; OpenVTC is the
source of identity, keys, proof, step-up, and approval transport. Do not add
new production authentication or permission primitives to ONEComputer when an
OpenVTC primitive already exists.

## First vertical slice

`AUTH_MODE=openvtc` enables the browser-wallet login path:

1. ONEComputer issues a short-lived, single-use SIOPv2 nonce at
   `POST /v1/openvtc/auth/challenge`.
2. The OpenVTC wallet self-issues an EdDSA `id_token`, bound to
   `OPENVTC_RP_DID` and that nonce, and submits the standard
   `auth/authenticate/0.1` Trust-Task envelope to ONEComputer.
3. `@openvtc/rp-sdk` verifies algorithm, `iss === sub`, audience, nonce,
   freshness, and the `did:key` signature. Failed verification never creates
   a session.
4. The wallet receives only a one-time, 60-second exchange code. The browser
   exchanges it once at `POST /v1/openvtc/session` for a 15-minute HttpOnly
   ONEComputer session cookie.

Set all of the following before enabling the mode:

```sh
AUTH_MODE=openvtc
OPENVTC_RP_DID=did:web:your-onecomputer-control-did
OPENVTC_APPROVER_DID=did:key:<manager-approver-did>
OPENVTC_SESSION_SECRET=<at-least-32-random-bytes>
```

`OPENVTC_SESSION_SECRET` signs only the short-lived ONEComputer browser
session. It is not a wallet key and must not be shared with the client.

## Wiki-aligned identity model

The OpenVTC Wiki is the architecture source of truth for this integration:

- Use the holder's P-DID/M-DID identity model and VTC membership credentials;
  do not treat a raw email or a bare `did:key` as enterprise authority.
- A VMC/M-DID claim from the company's VTC/trust registry maps a person to a
  company and role. A ONEComputer `OrganizationMember` row is a business
  projection of that verified claim, not the source of truth.
- Use the VTA as the signing and key-custody oracle. ONEComputer must not mint
  or persist employee/manager private keys.
- Prefer Trust Spanning Protocol (TSP) for Trust-Task delivery when the peer
  advertises it; use DIDComm v2 as the interoperability fallback; use REST
  only as an explicitly authenticated edge adapter.
- Use the currently implemented canonical Trust-Task pair
  `auth/step-up/approve-request/0.1` + signed
  `auth/step-up/approve-response/0.2` for the governed Outlook action. The
  response's `sessionId` is the single-use ONEComputer approval id and its
  `challenge` is the random request nonce. Use a distinct generic
  `confirm/*` protocol only if/when that protocol is actually adopted by the
  OpenVTC Trust-Task registry; do not invent a local wire shape.

## Deliberate limits before production cutover

- The nonce and exchange-code stores are process-local. Move them to Redis
  before running multiple web replicas.
- The first slice accepts `did:key` via OpenVTC's audited `KeyResolver`.
  Add the pinned OpenVTC resolver for `did:peer`, `did:webvh`, and `did:web`
  before making those identifiers available in the UI.
- The current `User` table requires an email. A non-routable, stable
  `@openvtc.identity` value is used only as a migration database key; it is
  **not** a claimed email. Verified VMC/M-DID membership claims must replace
  this mapping before production authority is enabled.

## Ownership split

| OpenVTC owns                                                                         | ONEComputer owns                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Login, DID/key lifecycle, credentials, step-up, DIDComm delivery, proof verification | Company policy authoring, sandbox lifecycle, gateway policy enforcement, audit correlation |

Entra and `ONECOMPUTER_E2E_DEMO_AUTH` remain temporary migration harnesses.
They must be removed from the production path once OpenVTC login and
credential-to-membership mapping are live.

## Permissioning migration inventory

The following existing ONEComputer code is migration work, not a new
authority plane:

| Current code                                            | OpenVTC replacement                                                       | ONEComputer end state                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| NextAuth / Entra / local-persona session resolution     | SIOPv2 wallet login and OpenVTC session credentials                       | Consume verified subject and claims only                 |
| Browser-local `openvtc-wallet.ts` Ed25519 manager key   | VTA/browser-wallet key custody and canonical `approve-response/0.2` proof | Verify the proof and correlate it to the approval        |
| `approvalDid` and public-key JWK registration on `User` | VTA-held DID key + VTC credential/trust-registry resolution               | Store only approved DID and evidence reference for audit |
| `vti-outbox-local` and simulated mobile notification    | OpenVTC DIDComm mediator plus push wake                                   | Create a Trust Task and receive a verified response      |
| Organization member role chosen from email invitations  | VMC/M-DID + trust-registry claims                                         | Map verified claims to ONEComputer business scopes       |

The company policy itself remains in ONEComputer: it determines whether an
action needs approval. Who may approve, how their device is authenticated,
and whether their signature is valid are OpenVTC concerns.

## Approval-device boundary

The ONEComputer portal is an **approval-status viewer**, never the approval
device. In `AUTH_MODE=openvtc`, the approval queue deliberately disables its
Approve/Deny controls and tells the manager to act in a separate OpenVTC
wallet/VTA surface. The production sequence is:

1. ONEComputer creates a policy-bound, RP-signed
   `auth/step-up/approve-request/0.1` Trust Task and sends it through OpenVTC
   TSP (preferred) or DIDComm/mediator transport.
2. The independent wallet (browser extension, PWA/native VTA, or CLI) verifies
   the RP proof, shows the reason/action details, and signs an
   `auth/step-up/approve-response/0.2` with a key that ONEComputer does not
   hold. For the delegated manager flow, the response issuer is the manager,
   while `payload.subject` remains the employee who initiated the action.
   A denial is also signed and retained for audit; it can never release the
   held action.
3. ONEComputer verifies the proof, the issuer's VMC/M-DID/trust-registry
   authorization, the exact challenge/session/action binding, and the
   single-use pending state before releasing exactly one gateway request.

The wallet-facing edge is `POST /v1/openvtc-approvals/:id/decide` with
`{ document, comment? }`. It intentionally does not accept a ONEComputer
browser cookie; the signed response is the authentication factor. The route
still requires a pre-provisioned OpenVTC manager identity and an owner/admin/
manager membership projection, while the gateway independently verifies the
Data Integrity proof before release.

A separate browser origin alone is not sufficient. The required property is
independent key custody plus a cryptographically bound transaction summary;
the wallet may be a browser extension/PWA, native VTA, or CLI according to the
manager's operating environment.
