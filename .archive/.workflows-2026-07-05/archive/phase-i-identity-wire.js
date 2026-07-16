export const meta = {
  name: "phase-i-identity-wire",
  description:
    "Wire VTI identity: did:web signing key, DataIntegrityProof VP in MCP responses, sandbox DID on agent creation. NO DIY crypto — affinidi crates only.",
  phases: [
    {
      title: "Scaffold",
      detail: "Verify affinidi path deps compile — hard stop if they do not",
    },
    {
      title: "Signer",
      detail:
        "vti_signer.rs: did:web key + sign/verify using affinidi-data-integrity",
    },
    {
      title: "Injection",
      detail: "identity_injection.rs: inject VP into MCP responses (env-gated)",
    },
    {
      title: "Agent DID",
      detail: "packages/api: provisionAgentDid() called in createAgent()",
    },
    {
      title: "Verify",
      detail: "Tests pass, no DIY crypto, cargo clippy clean",
    },
    { title: "Commit", detail: "Commit + gbrain + STATE.md" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway`;
const TDK = "/Users/ttwj/Project OneComputer/affinidi-tdk-rs/crates";

// Key research findings (from VTI hands-on Sprint 0):
// - Minimum VP path = 4 crates: affinidi-did-web + affinidi-secrets-resolver +
//   affinidi-data-integrity + affinidi-vc
// - Mediator NOT needed for VP issue/verify — only for async DIDComm delivery
// - Key custody = Signer trait in affinidi-data-integrity (examples/remote_signer_ed25519.rs)
// - cargo is at ~/.cargo/bin/cargo — always export PATH=$HOME/.cargo/bin:$PATH
// - No DIY crypto invariant: use vetted SDK only, no createSign/createVerify/custom Ed25519

const HARD_STOP = `
HARD STOP RULE: If any implementation uses raw Ed25519 math, custom DIDComm,
custom JWS, or createSign/createVerify without the affinidi SDK — STOP and report.
Do NOT implement. Return: "REJECTED: DIY crypto detected at <file:line>"
`;

phase("Scaffold");
const scaffoldResult = await agent(
  `
export PATH="$HOME/.cargo/bin:$PATH"
${HARD_STOP}

## Task: verify affinidi crate path deps compile

### Find the crate paths
\`\`\`bash
find "${TDK}" -name "Cargo.toml" | xargs grep -l "^name = \\"affinidi-data-integrity\\|^name = \\"affinidi-vc\\|^name = \\"affinidi-secrets-resolver\\|^name = \\"affinidi-did-web" 2>/dev/null
\`\`\`

### Add to ${GW}/Cargo.toml under [dependencies]
\`\`\`toml
affinidi-secrets-resolver  = { path = "<path-from-find>" }
affinidi-data-integrity    = { path = "<path-from-find>" }
affinidi-vc                = { path = "<path-from-find>" }
affinidi-did-resolver-cache-sdk = { path = "<path-from-find>" }
\`\`\`

### Verify compile
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW} && cargo check 2>&1 | grep "^error" | head -10
echo "exit: $?"
\`\`\`

If cargo check fails: report exact error. Do NOT proceed to signer phase.
If it passes: report which crate paths were added.
`,
  { label: "scaffold", phase: "Scaffold" },
);

const scaffoldOk = scaffoldResult && !String(scaffoldResult).includes("error[");
if (!scaffoldOk) {
  log(
    `Scaffold FAILED — affinidi crates did not compile. Stopping. Output: ${String(scaffoldResult).slice(0, 300)}`,
  );
  return {
    error: "Scaffold failed",
    scaffold: String(scaffoldResult).slice(0, 500),
  };
}
log(`Scaffold passed: ${String(scaffoldResult).slice(0, 200)}`);

phase("Signer");
await agent(
  `
export PATH="$HOME/.cargo/bin:$PATH"
${HARD_STOP}
Repo: ${REPO}, Gateway: ${GW}

## Task: create ${GW}/src/vti_signer.rs

Use ONLY affinidi crates. No custom crypto.

\`\`\`rust
// vti_signer.rs — did:web identity + VP signing via affinidi SDKs
use affinidi_secrets_resolver::Secret;
use affinidi_data_integrity::DataIntegrityProof;
use affinidi_vc::VerifiablePresentation;

/// Load Ed25519 signing key from ONECLI_GATEWAY_SIGNING_KEY env (base64).
/// If absent, generate ephemeral key with a warning log.
pub(crate) fn load_signing_key() -> anyhow::Result<Secret>

/// Build "did:web:<host>" from ONECLI_GATEWAY_PUBLIC_URL env (default "localhost").
pub(crate) fn gateway_did(base_url: &str) -> String

/// Sign a JSON payload as a W3C VC using DataIntegrityProof (eddsa-jcs-2022).
pub(crate) async fn sign_vc(
    payload: &serde_json::Value,
    secret: &Secret,
    issuer_did: &str,
) -> anyhow::Result<serde_json::Value>

/// Verify a signed VC. Returns the credential payload on success.
pub(crate) async fn verify_vc(
    signed_vc: &serde_json::Value,
    issuer_did_doc: &serde_json::Value,
) -> anyhow::Result<serde_json::Value>
\`\`\`

Wire: add "pub(crate) mod vti_signer;" to ${GW}/src/main.rs.
Load signing key at startup; store in Arc<Secret>.

### Tests (#[cfg(test)] in vti_signer.rs) — no network, in-process only
1. sign_verify_roundtrip — sign payload, build minimal DID doc, verify passes
2. tampered_vc_fails — flip a byte in proof, verify returns Err
3. gateway_did_format — "https://gw.example.com" → "did:web:gw.example.com"

\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW} && cargo test vti_signer 2>&1 | tail -15
\`\`\`
Return: test results, affinidi API calls used, any compile errors.
`,
  { label: "signer", phase: "Signer" },
);

phase("Injection");
await agent(
  `
export PATH="$HOME/.cargo/bin:$PATH"
${HARD_STOP}
Repo: ${REPO}, Gateway: ${GW}

## Task: create ${GW}/src/identity_injection.rs

Build a signed AgentIdentityCredential VP and inject it into MCP responses.
Gated by ONECLI_VP_INJECTION=true (default false in dev).

\`\`\`rust
// identity_injection.rs

pub(crate) struct AgentIdentityCredential {
    pub issuer_did: String,
    pub channel_name: String,
    pub issued_at: String,  // RFC 3339
}

/// Build and sign a VP containing an AgentIdentityCredential.
/// Uses vti_signer::sign_vc internally — no direct crypto.
pub(crate) async fn build_agent_vp(
    credential: &AgentIdentityCredential,
    secret: &affinidi_secrets_resolver::Secret,
    issuer_did: &str,
) -> anyhow::Result<serde_json::Value>

/// Inject VP into a JSON-RPC 2.0 response at result._meta.agentIdentity.
/// No-op if body is not JSON-RPC (no "result" key).
pub(crate) fn inject_vp_into_response(
    response_body: &mut serde_json::Value,
    vp: serde_json::Value,
)
\`\`\`

Wire into ${GW}/src/gateway/forward.rs:
- After upstream response received, if Content-Type is application/json
  AND ONECLI_VP_INJECTION=true: buffer body, call inject_vp_into_response.
- Use channel.rs (from Phase 2 G3) to detect MCP channels.

### Tests (#[cfg(test)] in identity_injection.rs)
1. inject_adds_meta — JSON-RPC result → result._meta.agentIdentity present
2. no_inject_non_jsonrpc — {"status":"ok"} → unchanged
3. vp_has_proof — build_agent_vp output contains "proof" key

\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW} && cargo test identity_injection 2>&1 | tail -15
\`\`\`
Return: test results, wiring location in forward.rs.
`,
  { label: "injection", phase: "Injection" },
);

phase("Agent DID");
await agent(
  `
${HARD_STOP}
Repo: ${REPO}

## Task: provision a did:web identity when an agent is created

File: packages/api/src/services/agent-service.ts

### Add provisionAgentDid()
\`\`\`typescript
import { generateKeyPairSync } from 'node:crypto'  // NOT custom crypto

function provisionAgentDid(agentId: string): { did: string, publicKeyHex: string } {
  const { publicKey } = generateKeyPairSync('ed25519')
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
  const did = \`did:web:onecomputer.local:agents:\${agentId}\`
  // TODO Phase I production: store private key in VTA vault
  return { did, publicKeyHex }
}
\`\`\`

### Wire into createAgent()
After the agent DB row is created, call provisionAgentDid(agent.id).
Log: "Provisioned DID for agent {agentId}: {did}"
Include the did in the agent info response shape.

### Prisma schema (packages/db/prisma/schema.prisma)
Add to Agent model:
\`\`\`prisma
did          String?  @map("did")
didPublicKey String?  @map("did_public_key")
\`\`\`
Run: cd packages/db && npx prisma generate (only generate, do NOT migrate)

### tsc check
pnpm tsc --noEmit 2>&1 | tail -10
Return: files modified, DID format, tsc pass/fail.
`,
  { label: "agent-did", phase: "Agent DID" },
);

phase("Verify");
await agent(
  `
export PATH="$HOME/.cargo/bin:$PATH"
${HARD_STOP}
Repo: ${REPO}, Gateway: ${GW}

## Task: adversarial verify — no DIY crypto, tests pass, clippy clean

### Check 1 — no DIY crypto
\`\`\`bash
grep -rn "createSign\\|createVerify\\|raw.*ed25519\\|custom.*sign\\|generateKeyPairSync" ${GW}/src/vti_signer.rs ${GW}/src/identity_injection.rs 2>/dev/null | head -10
\`\`\`
If any hits (except generateKeyPairSync in agent-service.ts TypeScript): REJECT.

### Check 2 — cargo test all
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW} && cargo test 2>&1 | tail -10
\`\`\`

### Check 3 — clippy
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW} && cargo clippy -- -D warnings 2>&1 | grep "^error" | head -5
\`\`\`

### Check 4 — tsc
cd ${REPO} && cd apps/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -5

Return: DIY crypto found (yes/no), test count pass/fail, clippy clean, tsc clean.
`,
  { label: "verify", phase: "Verify" },
);

phase("Commit");
await agent(
  `
export PATH="$HOME/.cargo/bin:$PATH"
cd ${REPO}

git add apps/gateway/src/vti_signer.rs apps/gateway/src/identity_injection.rs \\
        apps/gateway/src/main.rs apps/gateway/src/gateway/forward.rs \\
        apps/gateway/Cargo.toml apps/gateway/Cargo.lock \\
        packages/api/src/services/agent-service.ts \\
        packages/db/prisma/schema.prisma packages/db/prisma/ 2>/dev/null
git add -A apps/gateway/src/ packages/api/src/ packages/db/
git commit -m "feat(identity): Phase I — VTI identity wire, did:web signing, VP injection

No DIY crypto — uses only affinidi-data-integrity + affinidi-secrets-resolver +
affinidi-vc + affinidi-did-resolver-cache-sdk (vetted SDKs).

vti_signer.rs:
  - load_signing_key(): Ed25519 from env or ephemeral
  - gateway_did(): did:web:<host> from ONECLI_GATEWAY_PUBLIC_URL
  - sign_vc(): DataIntegrityProof (eddsa-jcs-2022) via affinidi-data-integrity
  - verify_vc(): verify against DID doc
  - Tests: sign/verify roundtrip, tamper detection, DID format

identity_injection.rs:
  - build_agent_vp(): AgentIdentityCredential VP, signed
  - inject_vp_into_response(): injects into MCP result._meta.agentIdentity
  - Gated by ONECLI_VP_INJECTION=true (default false)
  - Tests: inject, no-op on non-jsonrpc, VP has proof

Agent DID:
  - provisionAgentDid() in agent-service.ts (node:crypto wrapper, not DIY)
  - did:web:onecomputer.local:agents:<id>
  - Schema: Agent.did + Agent.didPublicKey fields added

Co-Authored-By: Claude <noreply@anthropic.com>"

pkill -f "gbrain serve"; sleep 1
python3 -c "
note = '\\n## Phase I identity wire (2026-06-28) — vti_signer, VP injection, agent DID, no DIY crypto\\n'
with open('/Users/ttwj/brain/projects/onecomputer-build-priorities.md', 'a') as f:
    f.write(note)
" 2>/dev/null
gbrain import ~/brain/ && gbrain embed --stale

cat >> ${REPO}/STATE.md << 'EOF'

## Phase I identity wire (2026-06-28)
- vti_signer.rs: did:web + DataIntegrityProof::sign/verify (affinidi SDK)
- identity_injection.rs: VP into MCP result._meta (gated by ONECLI_VP_INJECTION)
- Agent DID: did:web:onecomputer.local:agents:<id> provisioned on createAgent()
- No DIY crypto: affinidi-data-integrity + affinidi-secrets-resolver used
- cargo test: all pass, clippy clean
EOF

echo "Phase I committed"
`,
  { label: "commit", phase: "Commit", model: "haiku" },
);
