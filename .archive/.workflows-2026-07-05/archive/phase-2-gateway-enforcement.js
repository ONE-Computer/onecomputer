export const meta = {
  name: "phase-2-gateway-enforcement",
  description:
    "Wire real enforcement into the OneComputer Rust gateway: condition matching, MCP tool whitelist, channel routing, Prometheus metrics",
  phases: [
    {
      title: "Build",
      detail: "4 parallel agents each own one gap file; no file collisions",
    },
    {
      title: "Verify",
      detail: "Adversarial check: is each gap wired to a real request path?",
    },
    {
      title: "Integrate",
      detail:
        "cargo clippy + cargo test across all changes; smoke test with a real request",
    },
    { title: "Capture", detail: "gbrain + STATE.md update" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;

// Precise codebase facts from scout (2026-06-28):
// - condition_match.rs:8  matches() returns true unconditionally (OSS stub)
// - condition_match.rs:4  needs_body_buffer() returns false (OSS stub)
// - policy.rs:32          PolicyRule { name, path_pattern, method, action, conditions_raw: Option<serde_json::Value> }
// - schema.prisma:404     conditions Json? shape: [{target, operator, value}]
//                         targets: "body_json:<jsonpath>", "method", "host", "path"
//                         operators: "eq", "neq", "contains", "regex", "exists"
// - gateway/forward.rs:161-181  body buffer path: gated on needs_body_buffer()
// - gateway/forward.rs:198      evaluate() callsite; condition_buffer: Option<Vec<u8>>
// - No MCP/JSON-RPC parsing anywhere in the codebase
// - No Prometheus crate in Cargo.toml (has: tokio, hyper, axum, serde, sqlx, jsonwebtoken, anyhow, tracing)
// - telemetry.rs logs to Postgres only (request_logs table)
// - No channel concept — AppConnection+Secret are host-pattern based

const CTX = `
## Ground rules
Repo: ${REPO}, gateway: ${GW}
Read AUDIT.md first: ${REPO}/AUDIT.md
A gap is DONE only when: (1) the implementation is called from gateway/forward.rs
or gateway/websocket.rs on a real request, (2) tests assert behavior with no skip
guards, (3) cargo clippy -D warnings passes.

## Key types (do not re-derive, just use these)
PolicyRule { name: String, path_pattern: String, method: Option<String>,
             action: PolicyAction, conditions_raw: Option<serde_json::Value> }
conditions_raw shape: [{target: String, operator: String, value: String}]

## How to build
cd ${REPO} && cargo build -p onecli-gateway 2>&1 | grep "^error" | head -20
## How to test one module
cargo test -p onecli-gateway <module_name> 2>&1 | tail -20
## How to check all
cargo clippy -p onecli-gateway -- -D warnings 2>&1 | grep "^error" | head -20
`;

// ─── G1: condition_match.rs ───────────────────────────────────────────────────
const G1 = `${CTX}

## G1 — Wire condition_match.rs: replace the OSS stub with real evaluation

File to edit: ${GW}/condition_match.rs  (currently 19 lines, full stub)

### Implement needs_body_buffer
Return true if ANY rule has a condition with target starting with "body_json:".
Parse conditions_raw as Vec<{target, operator, value}>.

### Implement matches(rule, body)
Evaluate every condition in conditions_raw. All must pass (AND logic).
Conditions to handle:
- target "body_json:<path>": parse body as JSON, extract field at <path>
  (support simple dot notation: "$.action" → body["action"], "$.a.b" → body["a"]["b"])
  apply operator against condition.value
- target "method" | "host" | "path": these are pre-filtered upstream — return true
  (document this with a comment)
- unknown target: return true (fail-open for forward compat)
If conditions_raw is None or empty: return true.

Operators: eq (case-sensitive string equal), neq, contains, exists (field present
and non-null), regex (use the regex crate — add to Cargo.toml if absent).

### Implement prepare_body
Keep the existing pass-through BUT: call needs_body_buffer first. If it returns
true for the rules passed in: buffer the body (up to 256KB max):
  let bytes = body.collect().await?.to_bytes();
  Ok((Some(bytes.to_vec()), reqwest::Body::from(bytes)))
else keep the existing pass-through.
Update the signature to accept rules: &[PolicyRule].
Update the callsite in gateway/forward.rs:161-181 to pass rules.

### Tests in #[cfg(test)] at bottom of condition_match.rs
1. no_conditions_returns_true
2. body_json_eq_match — target "body_json:$.action" eq "send", body b"{\\"action\\":\\"send\\"}" → true
3. body_json_eq_no_match — same rule, body b"{\\"action\\":\\"read\\"}" → false
4. body_json_exists — target "body_json:$.secret" exists, body b"{\\"secret\\":\\"x\\"}" → true
5. needs_buffer_true_for_body_condition — rule with "body_json:$.x" → true
6. needs_buffer_false_otherwise — rule with "method" target → false

Run: cargo test -p onecli-gateway condition_match 2>&1 | tail -15
Return: diff summary, test results (pass count), clippy clean (yes/no).`;

// ─── G2: mcp.rs (new file) ────────────────────────────────────────────────────
const G2 = `${CTX}

## G2 — Add MCP JSON-RPC parser: new file ${GW}/mcp.rs

### Why
The gateway currently does byte-level forwarding. We need to inspect MCP
tools/call requests to enforce per-tool policies (allow bash, block send_email).

### Create ${GW}/mcp.rs
\`\`\`rust
// MCP JSON-RPC 2.0 request parsing for per-tool policy enforcement.
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct McpRequest {
    pub method: String,
    #[serde(default)]
    pub params: Option<McpParams>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct McpParams {
    pub name: Option<String>,   // tool name for tools/call
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Parse a request body as MCP JSON-RPC 2.0.
/// Returns None if the body is not valid MCP JSON.
pub(crate) fn parse_mcp(body: &[u8]) -> Option<McpRequest>

/// Returns true iff this is a tools/call request.
pub(crate) fn is_tools_call(body: &[u8]) -> bool

/// Extracts the tool name from a tools/call request.
pub(crate) fn tool_name(body: &[u8]) -> Option<String>
\`\`\`

Add "mcp_tool:<name>" as a new condition target in condition_match.rs::matches():
  - Parse body as McpRequest
  - If not tools/call: return true (non-tool MCP calls pass)
  - Extract tool name, compare with operator against condition.value

Also update needs_body_buffer: return true if any condition has target
starting with "mcp_tool:".

Wire pub(crate) mod mcp; into ${GW}/main.rs (find the mod declarations block).

### Tests in #[cfg(test)] in mcp.rs
1. parse_tools_call — valid JSON → method "tools/call", params.name Some("bash")
2. parse_tools_list — method "tools/list" → name None
3. parse_invalid — garbage → None
4. is_tools_call_true / false
5. tool_name_extracted — tools/call with name "read_file" → Some("read_file")

Run: cargo test -p onecli-gateway mcp 2>&1 | tail -15
Return: diff, test results, clippy clean.`;

// ─── G3: channel.rs (new file) ────────────────────────────────────────────────
const G3 = `${CTX}

## G3 — Add Channel routing abstraction: new file ${GW}/channel.rs

### Why
Today routing is by outbound host. A Channel maps an inbound path prefix to a
named connector with a protocol. This lets policy rules reference channel names
and enables per-channel auth (Phase 3 VP injection needs this).

### Create ${GW}/channel.rs
\`\`\`rust
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChannelProtocol { Mcp, A2a, Rest }

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Channel {
    pub id: String,
    pub name: String,
    pub route_prefix: String,    // e.g. "/agents/sharepoint"
    pub target_endpoint: String, // e.g. "https://sharepoint.temasek.internal/mcp"
    pub protocol: ChannelProtocol,
}

#[derive(Debug, Default)]
pub(crate) struct ChannelRegistry { pub channels: Vec<Channel> }

impl ChannelRegistry {
    /// Load from ONECLI_CHANNELS env var (JSON array). Empty registry if unset.
    pub fn from_env() -> Self

    /// Return first channel whose route_prefix is a prefix of the request path.
    pub fn match_path(&self, path: &str) -> Option<&Channel>
}
\`\`\`

Load ChannelRegistry at gateway startup in main.rs.
Pass as Arc<ChannelRegistry> through the call chain to forward_request.
In forward_request (gateway/forward.rs): call registry.match_path(&path).
If Some(channel): add response headers x-onecli-channel-id and x-onecli-channel-name.
If channel.protocol == Mcp: set a flag to enable MCP body buffering (for G2).

Wire mod channel; in main.rs.

### Tests in #[cfg(test)] in channel.rs
1. match_prefix — "/agents/sharepoint/list" matches route_prefix "/agents/sharepoint"
2. no_match — "/other/path" does not match "/agents/sharepoint"
3. empty_registry_no_match
4. from_env_empty_when_unset — ONECLI_CHANNELS unset → empty registry
5. protocol_deserializes — "mcp"/"a2a"/"rest" → correct enum variants

Run: cargo test -p onecli-gateway channel 2>&1 | tail -15
Return: diff, test results, clippy clean.`;

// ─── G4: metrics.rs (new file) ────────────────────────────────────────────────
const G4 = `${CTX}

## G4 — Add Prometheus /metrics endpoint: new file ${GW}/metrics.rs

### Add to ${REPO}/apps/gateway/Cargo.toml under [dependencies]
prometheus = { version = "0.13", features = ["process"] }
once_cell = "1"   (check if already present; it may be)

### Create ${GW}/metrics.rs
Use once_cell::sync::Lazy for the global registry and metric definitions:

- REQUESTS_TOTAL: IntCounterVec, labels [method, status_class]
  (status_class: "2xx"|"3xx"|"4xx"|"5xx"|"blocked"|"error")
- REQUESTS_BLOCKED_TOTAL: IntCounterVec, labels [rule_name]
- REQUEST_DURATION_SECONDS: HistogramVec, labels [method], default buckets
- ACTIVE_CONNECTIONS: IntGauge (no labels)
- INJECTIONS_TOTAL: IntCounterVec, labels [provider]

All names prefixed agent_trust_gateway_.

Expose these pub(crate) functions:
  record_request(method: &str, status: u16, duration_secs: f64)
  record_blocked(rule_name: &str)
  record_injection(provider: &str)
  connection_opened()
  connection_closed()
  render_metrics() -> String   // prometheus::TextEncoder().encode_to_string(&default_registry())

### Wire into gateway
1. In gateway/forward.rs: after upstream response received, call
   metrics::record_request(method, status, elapsed.as_secs_f64())
   If decision is Blocked: metrics::record_blocked(&rule_name)
   If injection happened: metrics::record_injection(provider)
   (Find existing injection_count / decision variables in forward.rs)

2. In gateway/mitm.rs: connection_opened() at accept, connection_closed() at drop.

3. Add a /metrics route to the axum HTTP server in main.rs.
   The gateway already runs an axum server (find it — likely the dashboard/API port).
   Add: .route("/metrics", get(|| async { metrics::render_metrics() }))

### Tests in #[cfg(test)] in metrics.rs
1. record_increments_counter — call record_request, assert counter > 0
2. blocked_counter — call record_blocked("test_rule"), assert blocked counter == 1
3. render_contains_prefix — render_metrics() contains "agent_trust_gateway_"
4. connection_gauge — opened then closed → gauge back to 0

Run: cargo test -p onecli-gateway metrics 2>&1 | tail -15
Return: diff, test results, /metrics route location, clippy clean.`;

// ─── VERIFY schema ────────────────────────────────────────────────────────────
const VERIFY_SCHEMA = {
  type: "object",
  required: [
    "gap",
    "verdict",
    "wired_to_request_path",
    "tests_assert",
    "clippy_clean",
    "issues",
  ],
  properties: {
    gap: { type: "string" },
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "VAPOR"] },
    wired_to_request_path: { type: "boolean" }, // called from forward.rs or websocket.rs
    tests_assert: { type: "boolean" }, // tests have real assertions, no skip guards
    clippy_clean: { type: "boolean" },
    test_count_pass: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
  },
};

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Build");

const buildResults = await parallel([
  () => agent(G1, { label: "G1:condition_match", phase: "Build" }),
  () => agent(G2, { label: "G2:mcp_parser", phase: "Build" }),
  () => agent(G3, { label: "G3:channel_routing", phase: "Build" }),
  () => agent(G4, { label: "G4:prometheus", phase: "Build" }),
]);
log(`Build done. ${buildResults.filter(Boolean).length}/4 agents completed.`);

phase("Verify");

const verifyResults = await parallel(
  [
    "G1:condition_match",
    "G2:mcp_parser",
    "G3:channel_routing",
    "G4:prometheus",
  ].map(
    (label, i) => () =>
      agent(
        `
You are an adversarial Rust reviewer for the OneComputer gateway.
Read AUDIT.md first: ${REPO}/AUDIT.md. Then read the actual file.

Gap: ${label}
Implementer summary: ${buildResults[i] ?? "(none)"}

Check the actual file on disk:
1. Is the new function CALLED from gateway/forward.rs or gateway/websocket.rs?
   grep -n "${
     label.includes("condition")
       ? "condition_match::matches\\|needs_body_buffer"
       : label.includes("mcp")
         ? "mcp::"
         : label.includes("channel")
           ? "registry.match_path\\|ChannelRegistry"
           : "metrics::record_request\\|render_metrics"
   }" \\
     ${GW}/gateway/forward.rs ${GW}/gateway/websocket.rs ${GW}/main.rs 2>/dev/null | head -10
2. Do the tests have real assertions (not just "it compiled")?
   cargo test -p onecli-gateway ${label.split(":")[1]} 2>&1 | tail -10
3. Does cargo clippy pass?
   cd ${REPO} && cargo clippy -p onecli-gateway -- -D warnings 2>&1 | grep "^error" | head -5

Verdict REAL = wired + tests assert + clippy clean.
Verdict PARTIAL = code exists but not wired OR tests weak.
Verdict VAPOR = file exists but never called / tests skip.`,
        { label: `verify:${label}`, phase: "Verify", schema: VERIFY_SCHEMA },
      ),
  ),
);

phase("Integrate");

const integrateResult = await agent(
  `
${CTX}

## Full integration check after all 4 gateway gaps

### Step 1 — full compile
cd ${REPO} && cargo build -p onecli-gateway 2>&1 | tail -10

### Step 2 — full test suite
cargo test -p onecli-gateway 2>&1 | tail -20
Report total: X passed, Y failed, Z ignored.

### Step 3 — clippy clean
cargo clippy -p onecli-gateway -- -D warnings 2>&1 | grep "^error" | head -10

### Step 4 — verify wiring grep
grep -rn "condition_match::matches\\|mcp::is_tools_call\\|registry.match_path\\|metrics::record_request" \\
  ${GW}/gateway/forward.rs ${GW}/gateway/websocket.rs 2>/dev/null
(Every gap should have at least one hit — missing = PARTIAL)

### Step 5 — smoke: start the gateway and make a request that hits the new code
If the gateway binary can be started without a DB (check main.rs for --no-db flag
or if DATABASE_URL is optional at startup):
  cd ${REPO} && cargo run -p onecli-gateway -- --help 2>&1 | head -10

### Capture to gbrain
pkill -f "gbrain serve"; sleep 1
Create ~/brain/projects/onecomputer-phase2-result.md:
  title: Phase 2 gateway enforcement — result
  tags: [phase-2, gateway, result]
  Body: for each G1-G4: verdict, wired (yes/no), test count.
  Overall: cargo build pass/fail, total tests pass/fail, clippy clean.
  What is NOT yet done: source auth (deferred to Phase 3), JWT/JWKS validation.
gbrain import ~/brain/ && gbrain embed --stale

### Return
Build pass/fail, test counts, wiring grep hits per gap, clippy clean, gbrain updated.`,
  { label: "integrate:full", phase: "Integrate" },
);

phase("Capture");
await agent(
  `
${CTX}
Append to ${REPO}/STATE.md under the sprint section:
## Phase 2 gateway enforcement (2026-06-28)
Verify results: ${JSON.stringify(verifyResults.filter(Boolean).map((v) => ({ gap: v.gap, verdict: v.verdict, wired: v.wired_to_request_path })))}
Integration: ${integrateResult?.slice(0, 200) ?? "see logs"}

# Stagger gbrain import to avoid PGLite lock collision with parallel Phase 1
sleep 90
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale`,
  { label: "capture", phase: "Capture" },
);

const verdicts = verifyResults.filter(Boolean);
return {
  built: buildResults.filter(Boolean).length,
  verdicts: {
    real: verdicts.filter((v) => v.verdict === "REAL").length,
    partial: verdicts.filter((v) => v.verdict === "PARTIAL").length,
    vapor: verdicts.filter((v) => v.verdict === "VAPOR").length,
  },
  integrate: integrateResult?.slice(0, 300),
};
