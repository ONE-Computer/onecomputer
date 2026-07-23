# Issue 005 signed policy integrity profile

Date: 2026-07-23

Decision: ONEComputer signs the complete effective workspace policy in Control
and independently verifies it at every external grant/provisioning boundary.
The projected sandbox copy is public diagnostic material, never an authority.

## Threat and trust boundary

The sandbox user may change Claude Desktop, Hermes Claw, browser, MCP, model,
base-URL, environment, or projected-policy files. Those changes cannot mint a
LiteLLM key, agent bridge token, egress grant, controller request, or valid
policy signature. Control, the workspace controller, LiteLLM/MCP grant path,
and egress proxy remain outside the sandbox.

The implementation specifically rejects signature/digest mutation, a copied
bundle for another workspace, unknown/revoked/expired keys, expired or
future-dated policy, rollback below the assigned version, and a derived route
that differs from the signed model or Control route.

## Signature profile

- Envelope: `onecomputer-effective-policy/v1`
- Payload schema version: `1`
- Canonicalization: RFC 8785 JCS through the owned canonical JSON function
- Algorithm: Ed25519 only; algorithm/profile fields are strict literals
- Payload digest: SHA-256 with
  `onecomputer/effective-policy/payload/v1\0` domain separation
- Signature input: key ID plus digest with
  `onecomputer/effective-policy/signature/v1\0` domain separation
- Binding: tenant, subject, workspace UUID, complete runtime policy, agent
  resource allocation, model gateway route, MCP Control route, issuance,
  not-before, expiry, and signing key
- Public key profile: `onecomputer-policy-key-set/v1`, with active, retiring,
  and revoked states plus activation and expiry windows
- Maximum bundle validity: 24 hours

Strict schemas reject additional fields, unsupported profiles/algorithms, and
malformed base64url, signatures, digests, timestamps, routes, policies, agents,
and key records.

## Custody, rotation, and projection

The Ed25519 PKCS8 private key is supplied only to Control through its runtime
secret environment. It does not enter source, the web build, controller,
workspace image, sandbox environment, logs, or projected files. Public SPKI
metadata is registered durably in `policy_signing_keys` and supplied to the
controller and sandbox.

Rotation uses an overlapping public key set. A new active signer may issue
while the previous key is retiring; setting a verification record to revoked
immediately rejects its bundles. Missing signer/key configuration prevents
Control or the controller from starting, and missing signatures prevent
provisioning.

The workspace receives root-owned, read-only-to-normal-user diagnostic copies:

- `/etc/onecomputer/policy/signed-policy.json`
- `/etc/onecomputer/policy/verification-keys.json`

Changing or replacing either copy cannot affect external verification.

## Enforcement path

Control signs and immediately self-verifies before deriving grants. The
verified policy—not request or sandbox values—is used for:

1. per-agent LiteLLM keys and exact model aliases;
2. per-agent Control bridge identities and MCP tool/effect policy;
3. workspace-bound egress proxy grants and policy hashes;
4. controller provisioning and exact external route bindings; and
5. Kasm policy/resource projection.

The controller independently verifies the bundle before accepting grants,
requires the signed model and MCP destinations to equal each derived route,
and verifies the egress grant tenant, subject, workspace, and policy digest.

## Verification record

- Automated suite: 128/128 passed.
- Full workspace TypeScript/Vite build passed.
- Live transition: the pre-signing sandbox reported `unavailable`; a Control
  stop/restart rebuilt it and reported `match`.
- Live assigned/projected/enforced policy: version 9 with digest
  `00a54d5a723cb0b866379b2ca30c1b07d63abc39231a95126ac6b177e9493d63`.
- Live key: `psk_policy_2026_07_23`, active Ed25519.
- Live workspace image:
  `sha256:a08f0bb545c6743f84638606c034688072529c26ba7b25d9322cf21783dd663d`.
- Both Claude Desktop and Hermes Claw, plus identity, network, models, and
  tools, returned ready after the signed rebuild.
- The two projected public files are `root:root` mode `0644`; runtime
  inspection found no signing private key, provider master key, database,
  Entra, Microsoft, or Docker credential in the sandbox process environment.
- The temporary local qualification session was revoked; the five-minute
  inspection window contained one revoked and zero active qualification
  sessions.

Policy content digest is the drift authority. Bundle digests can differ when
Control renews the same canonical policy with a new bounded validity window;
the UI intentionally compares the signed effective policy version/digest and
key rather than treating credential refresh time as policy drift.
