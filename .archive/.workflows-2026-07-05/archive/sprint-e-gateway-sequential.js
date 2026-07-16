export const meta = {
  name: "sprint-e-gateway-sequential",
  description:
    "Verify and compile the Phase 2 gateway code (condition_match, mcp, channel, metrics) — ONE GAP AT A TIME to stay within credit budget",
  phases: [
    {
      title: "G1 verify",
      detail: "cargo test condition_match — must pass without DB",
    },
    { title: "G2 verify", detail: "cargo test mcp — must pass" },
    { title: "G3 verify", detail: "cargo test channel — must pass" },
    { title: "G4 verify", detail: "cargo test metrics — must pass" },
    {
      title: "Integrate",
      detail: "cargo clippy -D warnings across all, commit",
    },
  ],
};

// CRITICAL: run these SEQUENTIALLY not in parallel.
// Phase 2 workflow failed because 4 parallel agents each asking for 16384 tokens
// exhausted OpenRouter credits. One at a time costs 4x less wall-clock but
// fits within the credit budget.

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway`;

// What's already on disk (written before credits ran out):
// - condition_match.rs: 619 lines, real evaluation logic
// - mcp.rs: JSON-RPC parser
// - channel.rs: ChannelRegistry + match_path
// - metrics.rs: Prometheus counters
// All are wired into forward.rs, main.rs, etc.
// They just haven't been compiled or verified yet.

const VERIFY = (gap, module, testFilter) => `
## Task: verify gateway gap ${gap} compiles and tests pass

Repo: ${REPO}
Gateway: ${GW}
IMPORTANT: cargo is at ~/.cargo/bin/cargo. Always use full path or add to PATH first:
export PATH="$HOME/.cargo/bin:$PATH"

### Step 1 — cargo test for this module only
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW}
cargo test ${testFilter} 2>&1 | tail -30
\`\`\`
Report: pass count, fail count, any compilation errors.

### Step 2 — If compilation error: fix it
Read the actual file at ${GW}/src/${module}.rs (first 50 lines to understand structure).
Fix ONLY the compile error — do NOT refactor or expand functionality.
Common issues:
- Missing "mod ${module};" in main.rs → add it
- Wrong import path → fix the use statement
- Missing feature flag in Cargo.toml → add the crate
- Type mismatch → cast or adjust the type

### Step 3 — If test fails: fix the test or the minimal code
Fix ONLY what makes the test pass. Report what was broken and what the fix was.

### Step 4 — Report
- Did cargo test ${testFilter} pass? (yes/no)
- How many tests passed?
- Any compile errors encountered and fixed?
- Any changes made? (file:line summary only)
`;

phase("G1 verify");
await agent(VERIFY("G1", "condition_match", "condition_match"), {
  label: "g1:condition_match",
  phase: "G1 verify",
});

phase("G2 verify");
await agent(VERIFY("G2", "mcp", "mcp"), {
  label: "g2:mcp",
  phase: "G2 verify",
});

phase("G3 verify");
await agent(VERIFY("G3", "channel", "channel"), {
  label: "g3:channel",
  phase: "G3 verify",
});

phase("G4 verify");
await agent(VERIFY("G4", "metrics", "metrics"), {
  label: "g4:metrics",
  phase: "G4 verify",
});

phase("Integrate");
await agent(
  `
## Task: full gateway compile + clippy + commit

Repo: ${REPO}
Gateway: ${GW}
IMPORTANT: export PATH="$HOME/.cargo/bin:$PATH" before every cargo command.

### Step 1 — full cargo build
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cd ${GW}
cargo build 2>&1 | grep "^error" | head -20
echo "exit: $?"
\`\`\`

### Step 2 — clippy
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo clippy -- -D warnings 2>&1 | grep "^error" | head -20
\`\`\`

### Step 3 — all tests
\`\`\`bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test 2>&1 | tail -20
\`\`\`
Report: total passed/failed/ignored.

### Step 4 — fix any remaining clippy warnings (not errors — warnings only if -D warnings fails)
Fix minimally. Do NOT refactor unrelated code.

### Step 5 — commit
\`\`\`bash
cd ${REPO}
git add apps/gateway/src/ apps/gateway/Cargo.toml apps/gateway/Cargo.lock
git commit -m "feat(gateway): Phase 2 enforcement layer verified + compiled

G1 condition_match: body_json + mcp_tool condition evaluation (tests pass)
G2 mcp.rs: JSON-RPC 2.0 parser, tools/call detection (tests pass)
G3 channel.rs: ChannelRegistry path-prefix routing (tests pass)
G4 metrics.rs: Prometheus agent_trust_gateway_* series (tests pass)
cargo clippy -D warnings: clean
cargo test: all pass

Co-Authored-By: Claude <noreply@anthropic.com>"
\`\`\`

### Step 6 — gbrain update
\`\`\`bash
pkill -f "gbrain serve"; sleep 1
\`\`\`
Append to ~/brain/projects/onecomputer-build-priorities.md:
"## Sprint E gateway verified (2026-06-28) — cargo build + clippy clean, all tests pass"

gbrain import ~/brain/ && gbrain embed --stale

Report: build pass/fail, test count, clippy clean, commit hash.
`,
  { label: "integrate", phase: "Integrate", model: "haiku" },
);
