# 005: sign projected policy and verify it at enforcement points

Status: `blocked`

Priority: P3
Depends on: 004
Unblocks: 006

## Outcome

Every sandbox receives a canonical, signed effective-policy bundle bound to its
tenant, user, workspace, agent, version, and validity window. Privileged
enforcement points outside the sandbox verify and enforce that exact bundle, so
editing a local Claude base URL, model route, tool policy, or agent setting
cannot change the routes or capabilities the workspace actually receives.

## In scope

- Define a versioned canonical effective-policy envelope and deterministic
  digest covering workspace, agents, model aliases, gateway endpoints, MCP
  tools/effects, egress profile, resource limits, issuance, expiry, and key ID.
- Sign bundles in ONEComputer Control with a managed asymmetric signing key;
  keep the private key and signing authority outside every workspace.
- Verify identity binding, canonical bytes, digest, signature, key, version,
  validity, assignment, and revocation at each privileged consumer before
  issuing or accepting a workspace/agent grant.
- Integrate verification with the workspace controller, egress policy compiler,
  LiteLLM/MCP grant path, and any other external decision point found during
  implementation.
- Project the signed bundle and public verification material into the workspace
  for transparent inspection and client diagnostics, while treating that local
  copy and its verification result as untrusted.
- Detect and surface projection drift, tampering, stale/rollback state, unknown
  key, invalid signature, and enforcement-version mismatch.
- Support signing-key rotation, overlap, revocation, short-lived validity, and
  restart-safe reconciliation without accepting an unsigned transition.

## Out of scope

- Making the sandbox trusted, preventing a user from editing their local files,
  using a signature as the only enforcement control, signing arbitrary user
  content, general application/code signing, DRM, or building a general-purpose
  enterprise PKI.

## Required implementation

- A reviewed canonicalization and asymmetric signature profile with domain
  separation, algorithm/key identifiers, test vectors, and downgrade
  prevention.
- Durable signing-key metadata and custody behind an owned signer interface;
  private key material never enters source, images, policy documents, command
  arguments, logs, browser storage, or sandbox storage.
- Atomic policy creation, assignment, signing, projection, verification, grant
  issuance, and refresh semantics that bind all derived grants to the verified
  policy digest.
- External enforcement that uses verified gateway destinations, model aliases,
  tool effects, agent identities, and egress rules rather than values supplied
  by the sandbox application.
- Fail-closed behavior and stable reason codes for missing, malformed,
  unsupported, unsigned, invalid, expired, revoked, stale, future-dated,
  cross-boundary, or unavailable verification state.
- Redacted integrity/audit events and an administrator/user view of expected
  policy version/digest, projected version/digest, enforcement version/digest,
  signing key, validity, and drift state.

## Required verification

- [ ] A valid signed bundle provisions the exact expected workspace, agent,
      model, tool, egress, and resource grants after clean start and restart.
- [ ] Editing the sandbox's Claude base URL to direct Anthropic, changing model
      or MCP endpoints, enabling a blocked tool, changing an approval effect,
      adding an agent, or editing the local bundle cannot change external
      enforcement or issue a valid grant.
- [ ] Byte/content mutation, non-canonical encoding, field omission/addition,
      unknown algorithm/version/key, signature substitution, cross-tenant/user/
      workspace/agent copy, expiry, future issuance, replay, and rollback fail
      closed.
- [ ] Signing-key rotation and revocation, policy refresh, concurrent updates,
      partial projection, controller/proxy/LiteLLM restart, clock-boundary
      behavior, and signer/store outage preserve one consistent verified
      version or deny new privileged activity.
- [ ] An already-bound governed operation retains its immutable policy digest
      and legal path across policy and signing-key rotation; new actions use
      only the new verified assignment.
- [ ] Removing the local verifier, replacing its public key, or falsifying its
      UI/result cannot influence the external verifier.
- [ ] No private key, provider credential, full policy secret, or prohibited
      payload appears in the sandbox, image, API response, logs, screenshots,
      or evidence.

## Evidence required

Include the threat model, canonical schema/profile and test vectors, signer/key
custody decision, public-key and rotation records, signed bundle samples with
safe fixtures, derived-grant correlation, verification/tamper/rollback matrix,
base-URL bypass probes, enforcement-point runtime inspection,
restart/concurrency/outage results, drift UI, and secret scan.

## Stop conditions

- The design treats successful verification inside the sandbox as authority or
  lets the sandbox choose an unverified endpoint, capability, policy effect, or
  enforcement key.
- A signature is used without independent external enforcement, so modifying an
  application's configuration can still bypass the verified values.
- The signing private key, an unrestricted signing API, or a reusable
  privileged grant must enter the workspace.
- Passing requires accepting unsigned policy, a stale fallback with no bounded
  validity, algorithm downgrade, or fail-open behavior during signer or policy
  store outage.

## Completion record

Not complete.
