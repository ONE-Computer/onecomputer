export const meta = {
  name: "sprint-2-identity",
  description:
    "Wire the VTI/Affinidi identity layer: real signer, DID:web + VP per channel, sandbox DID at spin-up, OAuth delegation",
  phases: [
    {
      title: "Scaffold",
      detail:
        "Add affinidi crate deps + DID:web key generation — must compile before anything else wires in",
    },
    {
      title: "Implement",
      detail:
        "I1 signer + I2 VP injection in parallel; I3 sandbox DID; I4 OAuth delegation",
    },
    {
      title: "Verify",
      detail:
        "Adversarial review: no DIY crypto, real assertions, wired to request path",
    },
  ],
};

// ─── Shared context ───────────────────────────────────────────────────────────
const CONTEXT = `
## Repo + ground rules
- Repo: /Users/ttwj/Project OneComputer/implementation/onecomputer
- Rust gateway: apps/gateway/src/
- TypeScript API: packages/api/src/
- AUDIT.md: /Users/ttwj/Project OneComputer/implementation/onecomputer/AUDIT.md
- VTI hands-on: ~/brain/projects/onecomputer-vti-hands-on.md
- TGW recreation plan: ~/brain/projects/onecomputer-tgw-recreation.md

## CRITICAL: no-DIY-crypto invariant
/apps/gateway/src/ must NEVER implement custom Ed25519 signing, DIDComm, or
credential proof formats. Use ONLY these vetted Affinidi crates:
  affinidi-did-web             (DID:web resolution + document building)
  affinidi-secrets-resolver    (Ed25519 key storage as Secret, ZeroizeOnDrop)
  affinidi-data-integrity      (DataIntegrityProof::sign/verify, eddsa-jcs-2022)
  affinidi-vc                  (VerifiablePresentation, PresentationBuilder)
  affinidi-did-resolver-cache-sdk  (cached DID resolution)

These crates are already cloned at:
  /Users/ttwj/Project OneComputer/affinidi-tdk-rs/

Add them to apps/gateway/Cargo.toml as path dependencies until published:
  affinidi-did-web = { path = "../../../affinidi-tdk-rs/crates/identity/did-methods/did-web" }
  affinidi-secrets-resolver = { path = "../../../affinidi-tdk-rs/crates/core/affinidi-secrets-resolver" }
  affinidi-data-integrity = { path = "../../../affinidi-tdk-rs/crates/credentials/affinidi-data-integrity" }
  affinidi-vc = { path = "../../../affinidi-tdk-rs/crates/credentials/affinidi-vc" }
  affinidi-did-resolver-cache-sdk = { path = "../../../affinidi-tdk-rs/crates/identity/affinidi-did-resolver-cache-sdk" }

Verify they compile FIRST before implementing any logic. If a path is wrong,
find the correct path with: find /Users/ttwj/Project OneComputer/affinidi-tdk-rs
-name "Cargo.toml" | xargs grep -l "^name = \\"affinidi-" | head -20

## Agent schema (from vti-hands-on.md verified)
- Agent model has NO did/key fields (schema.prisma:170-189 — only id/name/identifier/accessToken)
- agent-service.ts:9 mints only aoc_ bearer tokens
- DID provisioning is entirely new work
`;

// ─── I1: Wire real VTI signer ────────────────────────────────────────────────
const I1_PROMPT = `${CONTEXT}

## Your task: I1 — Wire the real Affinidi VTI signer into OneComputer

### Current state
The gateway's verifier seam (examples/node/access-gateway/src/server.mjs:272)
accepts any HTTP backend returning {ok:true, payload}. The "signer" in the
TypeScript API is the constant string "external_vti_or_enterprise_signer_required"
(packages/api/src/services/policy-artifact-service.ts:88).

### What to implement (Rust gateway side — where crypto belongs)
Create apps/gateway/src/vti_signer.rs:

1. A key-loading function:
   pub(crate) fn load_gateway_signing_key() -> anyhow::Result<affinidi_secrets_resolver::Secret>
   Read from env var ONECLI_GATEWAY_SIGNING_KEY (base64-encoded Ed25519 private key)
   OR generate a fresh ephemeral key if the env var is absent (with a log warning).
   Use affinidi_secrets_resolver::Secret::generate_ed25519() for generation.

2. A DID:web builder:
   pub(crate) fn gateway_did_web(base_url: &str) -> String
   Returns "did:web:<host>" from the gateway's public URL (ONECLI_GATEWAY_PUBLIC_URL
   env var, default "localhost").

3. A sign function:
   pub(crate) async fn sign_grant(
     payload: &serde_json::Value,
     secret: &affinidi_secrets_resolver::Secret,
     gateway_did: &str,
   ) -> anyhow::Result<serde_json::Value>
   Build a minimal W3C Verifiable Credential around the payload, sign it with
   DataIntegrityProof::sign (eddsa-jcs-2022), return the signed JSON.

4. A verify function:
   pub(crate) async fn verify_grant(
     signed_vc: &serde_json::Value,
     resolver: &affinidi_did_resolver_cache_sdk::DIDCacheClient,
   ) -> anyhow::Result<serde_json::Value>  // returns inner payload on success
   Use DataIntegrityProof::verify against the resolved DID document.

5. Replace the HMAC mock in examples/node/access-gateway/src/server.mjs:
   Add a note comment: "TODO: replace with call to Rust VTI signer service at
   ONECLI_VTI_SIGNER_URL — see vti_signer.rs for the Rust implementation"
   (Do NOT touch the Node.js implementation itself — it lives in an example
   directory and is not the production path. Just note the seam.)

### Tests (vti_signer.rs #[cfg(test)])
1. sign_and_verify_roundtrip — sign a payload, verify it with the same key's DID
   document (build a minimal in-memory DID doc for the test), assert payload matches.
2. verify_tampered_fails — modify the signed VC, assert verify returns Err.
3. gateway_did_web_format — "https://gateway.example.com" → "did:web:gateway.example.com"

DO NOT test against the live mediator or network — use in-process only.

If any affinidi crate path is wrong or fails to compile, STOP and report the
exact cargo error. Do NOT work around it by reimplementing the crypto.

### How to check
cargo test -p onecli-gateway vti_signer 2>&1 | tail -20

### gbrain
Append "## I1 VTI signer — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── I2: DID:web + VP injection per channel ──────────────────────────────────
const I2_PROMPT = `${CONTEXT}

## Your task: I2 — DID:web identity + VP injection into MCP/A2A responses

This is TGW's headline feature: every proxied response carries a signed
AgentIdentityCredential VP in its metadata.

### Depends on
- I1 (vti_signer.rs) must be implemented first — if not present, create a stub
  that compiles (sign_grant returns Ok(payload.clone())) and mark with TODO.
- G4 (channel.rs) must be present — VP is injected per channel. If absent, inject
  for all requests where the path indicates MCP (G2's is_mcp_tools_call).

### What to implement
Create apps/gateway/src/identity_injection.rs:

pub(crate) struct AgentIdentityCredential {
  pub issuer_did: String,
  pub channel_name: String,
  pub issued_at: String,   // ISO 8601
}

pub(crate) async fn build_agent_vp(
  credential: &AgentIdentityCredential,
  secret: &affinidi_secrets_resolver::Secret,
  issuer_did: &str,
) -> anyhow::Result<serde_json::Value>
// Build a VerifiablePresentation containing an AgentIdentityCredential VC,
// sign with DataIntegrityProof (eddsa-jcs-2022), return the signed VP JSON.

pub(crate) fn inject_vp_into_mcp_response(
  response_body: &mut serde_json::Value,
  vp: serde_json::Value,
)
// Inject into result._meta.agentIdentity in a JSON-RPC 2.0 response.
// If result._meta doesn't exist, create it.
// If it's not a JSON-RPC response (no "result" key), no-op.

### Wire into gateway/forward.rs
After the upstream response is received and before it's streamed back:
1. Buffer the response body if Content-Type is application/json AND
   either channel.protocol == Mcp (from G4) OR path contains "/mcp"
2. Parse as JSON, call inject_vp_into_mcp_response
3. Re-serialize and return the modified body

Add a flag ONECLI_VP_INJECTION_ENABLED (env var, default false) so this can be
tested without it running on every request in dev.

### Tests (identity_injection.rs #[cfg(test)])
1. inject_into_mcp_response — valid JSON-RPC result → _meta.agentIdentity present
2. no_inject_non_jsonrpc — {"status":"ok"} (no "result" key) → unchanged
3. vp_has_proof_field — build_agent_vp result contains "proof" key
4. vp_issuer_matches — vp.issuer == issuer_did

### How to check
cargo test -p onecli-gateway identity_injection 2>&1 | tail -20

### gbrain
Append "## I2 VP injection — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── I3: Sandbox DID provisioning at spin-up ─────────────────────────────────
const I3_PROMPT = `${CONTEXT}

## Your task: I3 — Sandbox agent DID provisioning at spin-up (TypeScript API)

The Agent model currently has no DID fields. This task adds DID provisioning
to the agent creation flow.

### Scope: TypeScript API side only
File: packages/api/src/services/agent-service.ts

### What to implement
1. Add a DID provisioning helper:
   async function provisionAgentDid(agentId: string): Promise<{did: string, keyRef: string}>
   - Generate a did:web: "did:web:onecomputer.local:agents:" + agentId
   - Generate an Ed25519 keypair (use node:crypto createEd25519KeyPair, NOT a custom impl)
   - Store the public key reference in a new DB field (see step 2)
   - Return {did, keyRef: <public key hex>}
   - Add a log: "Provisioned DID for agent {agentId}: {did}"
   Mark the private key storage as TODO: "store in VTA vault, not local DB — see I1"
   For now, just log it and return (do NOT store private key anywhere).

2. Add a Prisma migration (or schema addition — choose whichever is less disruptive):
   In packages/db/prisma/schema.prisma, add to the Agent model:
     did          String?  @map("did")
     didPublicKey String?  @map("did_public_key")
   Generate: pnpm db:generate
   DO NOT run db:migrate (that needs a live DB — just generate the client).

3. Wire provisionAgentDid into createAgent() in agent-service.ts:
   After the agent DB row is created, call provisionAgentDid(agent.id) and
   update the agent row with the did field.

4. Export the DID in the agent info response:
   In packages/api/src/routes/agents.ts (or wherever agent info is returned),
   include the did field in the response shape.

### Tests
Add to packages/api/src/services/agent-service.test.ts (create if absent):
1. createAgent_provisions_did — mock the DB, call createAgent, assert returned
   agent has a did field that starts with "did:web:"
2. did_format — did contains the agent id

Use vitest or jest (check package.json for the test runner). If no test file
exists, create one with describe/it/expect.

### How to check
pnpm --filter @onecli/api test 2>&1 | tail -20
(If no test runner configured, just run: pnpm tsc --noEmit from the repo root
and confirm no new type errors)

### gbrain
Append "## I3 sandbox DID — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── I4: OAuth credential delegation runtime ─────────────────────────────────
const I4_PROMPT = `${CONTEXT}

## Your task: I4 — OAuth credential delegation runtime (TypeScript API)

Today AppConnection.credentials stores OAuth tokens but there's no 3-legged
on-demand consent flow. When an agent tries to use a connector whose OAuth
token is absent or expired, it gets a generic error. This adds the consent_required
response pattern matching TGW's model.

### What to implement
File: packages/api/src/routes/connectors.ts (or apps.ts — find the route that
returns connection status to an agent)

1. Add a consent_required response shape:
   interface ConsentRequiredResponse {
     error: "consent_required"
     authorization_url: string    // OAuth authorize URL for the user to visit
     connection_id: string
     provider: string
   }

2. In the route that returns a connection's credentials to an agent request, add:
   If the connection exists but has no credentials (or they're expired):
     - Look up the provider's OAuth authorize URL from the app registry
       (packages/api/src/apps/ — each app has an authUrl or similar)
     - Return HTTP 401 with the ConsentRequiredResponse body
     - Log: "consent_required for connection {id}, provider {provider}"

3. Add a callback handler route:
   POST /v1/oauth/callback/:provider
   This receives the OAuth code from the redirect, exchanges for tokens,
   stores encrypted in AppConnection.credentials, returns {ok: true}.
   For now, stub the token exchange: log "TODO: exchange code for tokens",
   return {ok: true, status: "pending"}.

4. Document the consent flow in a comment at the top of the route file.

### Tests
Add to packages/api/src/routes/connectors.test.ts (create if absent):
1. returns_consent_required_when_no_credentials — mock AppConnection with no
   credentials, call the route, assert 401 + error == "consent_required"
2. returns_authorization_url — assert authorization_url is non-empty string

### How to check
pnpm tsc --noEmit 2>&1 | tail -10

### gbrain
Append "## I4 OAuth delegation — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`;

// ─── Verify schema ────────────────────────────────────────────────────────────
const VERIFY_SCHEMA = {
  type: "object",
  required: [
    "gap",
    "verdict",
    "no_diy_crypto",
    "tests_pass",
    "real_enforcement",
    "issues",
  ],
  properties: {
    gap: { type: "string" },
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "VAPOR"] },
    no_diy_crypto: { type: "boolean" }, // false = IMMEDIATE REJECT
    tests_pass: { type: "number" },
    real_enforcement: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
    diff_summary: { type: "string" },
  },
};

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Scaffold");

// I1 must compile first — everything else depends on the affinidi crate deps loading
const scaffoldResult = await agent(
  `${CONTEXT}
  ## Scaffold task: verify affinidi crates compile as path deps
  Add these to apps/gateway/Cargo.toml under [dependencies] and verify cargo check passes.
  Find the correct paths first:
  find /Users/ttwj/Project\\ OneComputer/affinidi-tdk-rs -name "Cargo.toml" | xargs grep -l "^name = \\"affinidi-data-integrity\\|^name = \\"affinidi-vc\\|^name = \\"affinidi-secrets-resolver\\|^name = \\"affinidi-did-web" 2>/dev/null | head -10
  Then add as path deps and run:
  cd /Users/ttwj/Project\\ OneComputer/implementation/onecomputer && cargo check -p onecli-gateway 2>&1 | grep "^error" | head -20
  Report: which crates compiled, which failed with exact error, final cargo check exit code.`,
  { label: "scaffold:affinidi-deps", phase: "Scaffold" },
);

log(`Scaffold result: ${scaffoldResult?.slice(0, 200)}`);

phase("Implement");

// I1+I2 in parallel (both Rust, different files); I3+I4 in parallel (both TypeScript)
const implResults = await parallel([
  () => agent(I1_PROMPT, { label: "I1: VTI signer", phase: "Implement" }),
  () => agent(I2_PROMPT, { label: "I2: VP injection", phase: "Implement" }),
  () => agent(I3_PROMPT, { label: "I3: sandbox DID", phase: "Implement" }),
  () => agent(I4_PROMPT, { label: "I4: OAuth delegation", phase: "Implement" }),
]);

log(
  `Implement phase done. ${implResults.filter(Boolean).length}/4 agents completed.`,
);

phase("Verify");

const verifyResults = await parallel(
  implResults.filter(Boolean).map((summary, i) => {
    const labels = [
      "I1:vti_signer",
      "I2:vp_injection",
      "I3:sandbox_did",
      "I4:oauth_delegation",
    ];
    return () =>
      agent(
        `You are an adversarial reviewer for the OneComputer identity layer.
      Read AUDIT.md first: /Users/ttwj/Project OneComputer/implementation/onecomputer/AUDIT.md
      Read no-DIY-crypto invariant: ~/brain/concepts/no-diy-crypto-invariant.md
      Gap: ${labels[i]}. Implementer summary: ${summary || "(none)"}

      CRITICAL CHECK: does the code use any of these — createSign, createVerify,
      generateKeyPair (raw), Ed25519 manual math, custom DIDComm, custom JWS?
      If yes: verdict = VAPOR, no_diy_crypto = false, immediate reject.

      Otherwise check:
      1. Read the actual files. Is it wired into forward_request or the agent create flow?
      2. Tests assert behavior that would fail if implementation was broken?
      3. cargo clippy (Rust) or tsc --noEmit (TypeScript) passes?

      Return structured verdict.`,
        {
          label: `verify:${labels[i]}`,
          phase: "Verify",
          schema: VERIFY_SCHEMA,
        },
      );
  }),
);

// Hard stop on DIY crypto
const diyCryptoViolations = verifyResults.filter((v) => v && !v.no_diy_crypto);
if (diyCryptoViolations.length > 0) {
  log(
    `HARD STOP: DIY crypto detected in ${diyCryptoViolations.map((v) => v.gap).join(", ")}. These must be reverted.`,
  );
}

const verdicts = verifyResults.filter(Boolean);
return {
  scaffold: scaffoldResult?.slice(0, 300),
  gaps_implemented: implResults.filter(Boolean).length,
  diy_crypto_violations: diyCryptoViolations.length,
  verdicts: {
    real: verdicts.filter((v) => v.verdict === "REAL").length,
    partial: verdicts.filter((v) => v.verdict === "PARTIAL").length,
    vapor: verdicts.filter((v) => v.verdict === "VAPOR").length,
  },
  verify_details: verdicts,
};
