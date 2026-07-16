export const meta = {
  name: "phase-3-identity",
  description:
    "Wire VTI/Affinidi identity: did:web gateway signing key, signed VP in MCP responses, sandbox DID at provisioning, OAuth consent_required flow",
  phases: [
    {
      title: "Scaffold",
      detail:
        "Add affinidi crate path deps and verify they compile — hard stop if they dont",
    },
    {
      title: "Build",
      detail:
        "I1 VTI signer (Rust) + I2 VP injection (Rust) + I3 sandbox DID (TS) + I4 OAuth delegation (TS) in parallel",
    },
    {
      title: "Verify",
      detail:
        "Adversarial review: no DIY crypto, wired to request path, tests assert",
    },
    { title: "Capture", detail: "gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;
const TDK = "/Users/ttwj/Project OneComputer/affinidi-tdk-rs/crates";

// Affinidi crate locations (verified in this repo):
// TDK/core/affinidi-secrets-resolver/  — Secret::generate_ed25519(), ZeroizeOnDrop
// TDK/credentials/affinidi-data-integrity/  — DataIntegrityProof::sign/verify, eddsa-jcs-2022
// TDK/credentials/affinidi-vc/  — VerifiablePresentation, PresentationBuilder
// TDK/identity/affinidi-did-resolver-cache-sdk/  — DIDCacheClient
// VTI hands-on: ~/brain/projects/onecomputer-vti-hands-on.md
// MEDIATOR is NOT needed for VP issue/verify — local crypto only

const CTX = `
## Ground rules
Repo: ${REPO}
Read AUDIT.md: ${REPO}/AUDIT.md
Read no-DIY-crypto page: ~/brain/concepts/no-diy-crypto-invariant.md
HARD STOP rule: if any implementation uses raw Ed25519 math, createSign/createVerify
without a vetted SDK, or custom DIDComm — it is REJECTED. Use affinidi crates only.
Agent model has no DID fields (schema.prisma:170-189). All DID work is new.
VTI mediator is NOT needed for VP sign/verify — that is local crypto.
affinidi-tdk-rs crates at: ${TDK}/
`;

// ─── SCAFFOLD ─────────────────────────────────────────────────────────────────
const SCAFFOLD = `${CTX}

## Scaffold: add affinidi path deps to gateway Cargo.toml and verify compile

### Step 1 — find correct crate paths
ls ${TDK}/core/ ${TDK}/credentials/ ${TDK}/identity/

### Step 2 — add to ${REPO}/apps/gateway/Cargo.toml under [dependencies]
affinidi-secrets-resolver  = { path = "${TDK}/core/affinidi-secrets-resolver" }
affinidi-data-integrity    = { path = "${TDK}/credentials/affinidi-data-integrity" }
affinidi-vc                = { path = "${TDK}/credentials/affinidi-vc" }
affinidi-did-resolver-cache-sdk = { path = "${TDK}/identity/affinidi-did-resolver-cache-sdk" }

### Step 3 — check compile
cd ${REPO} && cargo check -p onecli-gateway 2>&1 | grep "^error" | head -20

If cargo check fails: report the exact error. Common causes:
- Wrong path (crate moved) → find the correct dir with:
  find ${TDK} -name "Cargo.toml" | xargs grep -l "^name = \\"affinidi-data-integrity\\|affinidi-vc\\|affinidi-secrets-resolver" 2>/dev/null
- Missing transitive dep → add it too
- Feature flag required → check the crate's Cargo.toml for required features

### Return
Exact crate paths added, cargo check exit code, first error if any.
STOP and report if cargo check fails — do NOT proceed to Build phase.`;

// ─── I1: VTI signer ───────────────────────────────────────────────────────────
const I1 = `${CTX}

## I1 — Create ${GW}/vti_signer.rs: did:web key + VP signing using affinidi crates

### What to build (Rust, no DIY crypto)

\`\`\`rust
// vti_signer.rs
// Wraps affinidi-secrets-resolver + affinidi-data-integrity + affinidi-vc
// to give the gateway a did:web identity and the ability to sign VPs.

use affinidi_secrets_resolver::Secret;
use affinidi_data_integrity::DataIntegrityProof;
use affinidi_vc::VerifiablePresentation;

/// Load or generate the gateway's Ed25519 signing key.
/// Reads ONECLI_GATEWAY_SIGNING_KEY (base64 private key).
/// If unset, generates an ephemeral key and logs a warning.
pub(crate) fn load_signing_key() -> anyhow::Result<Secret>

/// Build the gateway's did:web DID string.
/// Reads ONECLI_GATEWAY_PUBLIC_URL env var (e.g. "https://gateway.example.com").
/// Returns "did:web:gateway.example.com".
pub(crate) fn gateway_did(base_url: &str) -> String

/// Sign a JSON payload as a minimal Verifiable Credential.
/// Returns the signed VC JSON with a DataIntegrityProof (eddsa-jcs-2022).
pub(crate) async fn sign_vc(
    payload: &serde_json::Value,
    secret: &Secret,
    issuer_did: &str,
) -> anyhow::Result<serde_json::Value>

/// Verify a signed VC. Returns the inner credential payload on success.
/// issuer_did_doc: the resolved DID document JSON for the issuer.
pub(crate) async fn verify_vc(
    signed_vc: &serde_json::Value,
    issuer_did_doc: &serde_json::Value,
) -> anyhow::Result<serde_json::Value>
\`\`\`

Wire mod vti_signer; into main.rs.
Load the signing key at gateway startup; store in an Arc<Secret> passed to forward.rs.

### Tests (#[cfg(test)] in vti_signer.rs) — no network, no mediator
1. sign_verify_roundtrip — generate key, sign payload, build minimal DID doc,
   verify succeeds, inner payload matches
2. tampered_vc_fails_verify — flip one byte in the proof signature, verify returns Err
3. gateway_did_format — "https://gw.example.com" → "did:web:gw.example.com"
4. ephemeral_key_generated_when_no_env — unset ONECLI_GATEWAY_SIGNING_KEY → key is generated

Run: cargo test -p onecli-gateway vti_signer 2>&1 | tail -20
Return: diff, test results, which affinidi API calls were used.`;

// ─── I2: VP injection ─────────────────────────────────────────────────────────
const I2 = `${CTX}

## I2 — Create ${GW}/identity_injection.rs: inject signed VP into MCP responses

Depends on I1 (vti_signer.rs) being present. If not: create a stub sign_vc
that returns Ok(payload.clone()) with a TODO comment and proceed.

### What to build

\`\`\`rust
// identity_injection.rs
// Injects a signed AgentIdentityCredential VP into MCP JSON-RPC responses.
// Only active when ONECLI_VP_INJECTION=true (default: false in dev).

/// Build an AgentIdentityCredential VP for the given channel.
pub(crate) async fn build_channel_vp(
    channel_name: &str,
    channel_id: &str,
    issuer_did: &str,
    secret: &affinidi_secrets_resolver::Secret,
) -> anyhow::Result<serde_json::Value>
// Credential subject: { channelId, channelName, issuedAt: now_rfc3339 }
// Sign with vti_signer::sign_vc

/// Inject the VP into an MCP JSON-RPC 2.0 response body.
/// Mutates result._meta.agentIdentity in place.
/// No-op if the body is not a JSON-RPC response (no "result" key).
pub(crate) fn inject_vp_into_response(
    response_body: &mut serde_json::Value,
    vp: serde_json::Value,
)
\`\`\`

Wire into gateway/forward.rs after the upstream response body is received:
1. Only if Content-Type is application/json AND ONECLI_VP_INJECTION env = "true"
2. Buffer the response body (already streamed — collect it, max 4MB)
3. Parse as JSON, call inject_vp_into_response
4. Re-serialize and return the modified body

Wire mod identity_injection; in main.rs.

### Tests (#[cfg(test)] in identity_injection.rs)
1. inject_adds_meta — valid JSON-RPC result {} → result._meta.agentIdentity is present
2. inject_no_op_non_jsonrpc — {"status":"ok"} (no "result") → unchanged
3. vp_has_proof — build_channel_vp output contains "proof" key
4. inject_preserves_existing_result — other result fields unchanged after injection

Run: cargo test -p onecli-gateway identity_injection 2>&1 | tail -20
Return: diff, test results, where in forward.rs it is called.`;

// ─── I3: Sandbox DID provisioning (TypeScript) ────────────────────────────────
const I3 = `${CTX}

## I3 — Add DID provisioning to agent creation in the TypeScript API

File: ${REPO}/packages/api/src/services/agent-service.ts

### What to add

1. A DID provisioner function:
\`\`\`typescript
// Uses node:crypto (NOT a custom implementation)
import { generateKeyPairSync } from 'node:crypto'

function provisionAgentDid(agentId: string): { did: string, publicKeyHex: string } {
  const { publicKey } = generateKeyPairSync('ed25519')
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
  const did = \`did:web:onecomputer.local:agents:\${agentId}\`
  // TODO Phase 3 production: store private key in VTA vault, not locally
  return { did, publicKeyHex }
}
\`\`\`

2. Call provisionAgentDid in createAgent() after the DB row is created.
   Update the agent row with did and didPublicKey (if those columns exist after
   a migration — check schema.prisma:170-189. If columns don't exist yet, just
   log the DID and note "TODO: add did column to Agent model in schema.prisma").

3. Return the did in the agent info response shape.

### Tests (agent-service.test.ts)
Check if vitest or jest is configured: grep -r "vitest\\|jest" ${REPO}/packages/api/package.json
Create or add to the test file:
1. createAgent_returns_did — mock DB create, assert returned agent has did starting "did:web:"
2. did_contains_agent_id — did includes the agent's id string
3. public_key_hex_is_string — publicKeyHex is a non-empty hex string

### Return
Diff summary, whether DID column exists in schema, test results, what is TODO.`;

// ─── I4: OAuth consent_required (TypeScript) ─────────────────────────────────
const I4 = `${CTX}

## I4 — Add consent_required OAuth flow to connectors

### Context
When an agent tries to use a connector (SharePoint, Outlook, etc.) with no stored
credentials, return a structured 401 consent_required response instead of a generic
error. This follows TGW's model and enables the future Outlook/SharePoint wiring.

### Files to touch
- ${REPO}/packages/api/src/routes/apps.ts (or apps.ts — find the route that
  returns app connection credentials to an agent)
- ${REPO}/packages/api/src/services/app-blocklist-service.ts (for context only)

### What to add

1. A ConsentRequiredError type:
\`\`\`typescript
// In packages/api/src/types.ts or a new connectors-types.ts
export interface ConsentRequiredResponse {
  error: 'consent_required'
  provider: string
  connectionId: string
  authorizationUrl: string  // where the user should go to authorize
  message: string
}
\`\`\`

2. In the route/service that checks connection credentials:
Find where AppConnection status is checked. If status !== 'connected' OR
credentials is null/empty: return HTTP 401 + ConsentRequiredResponse.
Look up the app's authorization URL from the app registry
(packages/api/src/apps/*.ts — each defines authUrl or authorizationUrl).

3. Add a stub OAuth callback route (for future use):
POST /oauth/callback/:provider → logs the code, returns {ok: true, status: 'pending'}
Wire into app.ts.

### Tests
1. returns_401_when_no_credentials — mock AppConnection with null credentials → 401
2. response_has_consent_required_shape — error field === 'consent_required'
3. authorization_url_is_string — non-empty string

### Return
Files modified, test results, what is genuinely TODO (token exchange, real auth URL per provider).`;

// ─── VERIFY schema ────────────────────────────────────────────────────────────
const VERIFY_SCHEMA = {
  type: "object",
  required: [
    "gap",
    "verdict",
    "no_diy_crypto",
    "wired",
    "tests_pass",
    "issues",
  ],
  properties: {
    gap: { type: "string" },
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "VAPOR"] },
    no_diy_crypto: { type: "boolean" }, // false = hard reject
    wired: { type: "boolean" }, // called from forward.rs / createAgent / connector route
    tests_pass: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
  },
};

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Scaffold");

const scaffoldOk = await agent(SCAFFOLD, {
  label: "scaffold:affinidi-deps",
  phase: "Scaffold",
});
const scaffoldPassed =
  scaffoldOk && !scaffoldOk.toLowerCase().includes("error[");
log(
  `Scaffold: ${scaffoldPassed ? "PASS — affinidi crates compile" : "FAIL — check errors"}`,
);
if (!scaffoldPassed) {
  return {
    error:
      "Scaffold failed — affinidi crates did not compile. Fix paths before proceeding.",
    scaffold: scaffoldOk,
  };
}

phase("Build");

// I1+I2 are Rust (different files, no collision). I3+I4 are TypeScript (different files).
const buildResults = await parallel([
  () => agent(I1, { label: "I1:vti_signer", phase: "Build" }),
  () => agent(I2, { label: "I2:vp_injection", phase: "Build" }),
  () => agent(I3, { label: "I3:agent_did", phase: "Build" }),
  () => agent(I4, { label: "I4:oauth_consent", phase: "Build" }),
]);
log(`Build done. ${buildResults.filter(Boolean).length}/4 agents completed.`);

phase("Verify");

const verifyResults = await parallel(
  ["I1:vti_signer", "I2:vp_injection", "I3:agent_did", "I4:oauth_consent"].map(
    (label, i) => () =>
      agent(
        `
You are an adversarial reviewer. Read AUDIT.md: ${REPO}/AUDIT.md
Read no-DIY-crypto: ~/brain/concepts/no-diy-crypto-invariant.md

Gap: ${label}. Summary: ${buildResults[i] ?? "(none)"}

CRITICAL: grep the actual file for any of these — if found, verdict=VAPOR, no_diy_crypto=false:
  createSign, createVerify, generateKeyPairSync (only allow in I3 for node:crypto wrapper),
  custom DIDComm, custom JWS, raw Ed25519 arithmetic
  grep -rn "createSign\\|createVerify\\|raw.*ed25519\\|diy.*crypto" ${GW}/ 2>/dev/null

Then check:
- Is it wired? (grep for function name in forward.rs / createAgent / connector route)
- Tests assert real behavior? (run cargo test or pnpm tsc --noEmit)
- clippy clean? (cargo clippy -p onecli-gateway -- -D warnings 2>&1 | grep "^error" | head -5)

Return structured verdict.`,
        { label: `verify:${label}`, phase: "Verify", schema: VERIFY_SCHEMA },
      ),
  ),
);

// Hard stop on any DIY crypto
const violations = verifyResults.filter((v) => v && !v.no_diy_crypto);
if (violations.length)
  log(
    `⛔ DIY crypto detected in: ${violations.map((v) => v.gap).join(", ")} — MUST revert`,
  );

phase("Capture");

await agent(
  `
${CTX}
Create ~/brain/projects/onecomputer-phase3-result.md:
  title: Phase 3 identity — result
  tags: [phase-3, identity, vti, result]
  Body: scaffold result, per-gap verdict, diy_crypto_violations count,
  what is wired vs TODO, next step (wire VP injection into a real request end-to-end).
Append to ${REPO}/STATE.md: Phase 3 identity section with verdicts.
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`,
  { label: "capture", phase: "Capture" },
);

const v = verifyResults.filter(Boolean);
return {
  scaffold: scaffoldPassed,
  built: buildResults.filter(Boolean).length,
  diy_crypto_violations: violations.length,
  verdicts: {
    real: v.filter((x) => x.verdict === "REAL").length,
    partial: v.filter((x) => x.verdict === "PARTIAL").length,
    vapor: v.filter((x) => x.verdict === "VAPOR").length,
  },
};
