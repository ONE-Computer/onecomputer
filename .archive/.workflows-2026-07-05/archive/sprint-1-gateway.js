export const meta = {
  name: "sprint-1-gateway",
  description:
    "Implement the 5 OneComputer gateway gaps: condition matching, MCP parser, source auth, channel routing, Prometheus metrics",
  phases: [
    {
      title: "Implement",
      detail: "5 agents in parallel, one per gap, each in its own worktree",
    },
    {
      title: "Verify",
      detail:
        "Adversarial review: does each gap actually enforce, not just model?",
    },
    {
      title: "Integrate",
      detail:
        "Compile check + cargo test with real assertions + gbrain capture",
    },
  ],
};

// ─── Shared context injected into every agent ────────────────────────────────
const CONTEXT = `
## Repo + ground rules
- Repo: /Users/ttwj/Project OneComputer/implementation/onecomputer
- Rust gateway: apps/gateway/src/
- AUDIT.md is the ground truth — read it before touching anything.
- A feature is NOT done unless: (a) the test in #[cfg(test)] or #[tokio::test]
  ASSERTS behavior (not skips on DATABASE_URL), (b) the code path is actually
  reached by a real request (not simulator_only), (c) no DIY crypto.
- condition_match.rs:8 — matches() currently returns true unconditionally (OSS stub).
- policy.rs:32 — PolicyRule { name, path_pattern, method, action, conditions_raw }.
- schema.prisma:404 — conditions Json? shape: [{target, operator, value, key?}]
  targets: "host"|"path"|"method"|"header:<name>"|"body_json:<jsonpath>"
  operators: "eq"|"neq"|"contains"|"regex"|"exists"
- The conditions JSON is already plumbed end-to-end into conditions_raw on the
  in-memory PolicyRule. The stub just ignores it.
- gateway/forward.rs:161-181 — body buffering gated on needs_body_buffer().
  condition_buffer is Option<Vec<u8>>, currently always None in OSS.
- No Prometheus crate in Cargo.toml — must add it.
- No MCP/JSON-RPC parsing anywhere in the gateway.
- No channel model — AppConnection+Secret are the closest (host-pattern based).
- Docker CLI at /Applications/Docker.app/Contents/Resources/bin/docker if needed.
- cargo check/clippy: cd apps/gateway && cargo clippy 2>&1 | head -30
`;

// ─── G1: condition_match.rs — wire conditions_raw evaluation ─────────────────
const G1_PROMPT = `${CONTEXT}

## Your task: G1 — Implement condition_match::matches() in apps/gateway/src/condition_match.rs

The stub returns true unconditionally. Replace it with real predicate evaluation.

### What to implement
condition_match.rs has three exports. Implement all three:

1. needs_body_buffer(rules: &[PolicyRule]) -> bool
   Return true if ANY rule has conditions_raw with a target that starts with
   "body_json:" — only buffer the body when needed.

2. matches(rule: &PolicyRule, body: Option<&[u8]>) -> bool
   Evaluate rule.conditions_raw (a Vec of {target, operator, value, key?}) against
   the request. For the OSS implementation, handle these targets:
   - "host", "path", "method" — these are already filtered upstream (host in
     connect.rs, path/method in matches_request in policy.rs), so return true for
     them (they're pre-filtered, not double-evaluated here).
   - "header:<header-name>" — requires the body/context. Since headers are NOT
     passed into matches() (only body is), return true for header conditions for now
     and add a TODO comment noting headers need to be added to the signature.
   - "body_json:<jsonpath>" — parse body as JSON, evaluate jsonpath (use a simple
     dot-notation: "$.field" or "$.a.b"), apply operator.
   - unknown target → return true (fail-open for forward compat).
   If conditions_raw is None or empty Vec → return true.

3. prepare_body — keep as-is (pass-through) but update needs_body_buffer to
   actually trigger buffering. The forward.rs callsite at line 161-181 already
   calls needs_body_buffer and conditionally buffers up to MAX_DEFAULT_INTERCEPT_BODY.

### Operators to implement
- "eq": value == condition.value (string compare, case-insensitive for headers)
- "neq": value != condition.value
- "contains": value.contains(condition.value)
- "regex": Regex::new(&condition.value).ok()?.is_match(value) — use the 'regex'
  crate (check Cargo.toml: if absent add regex = "1" to apps/gateway/Cargo.toml)
- "exists": value is non-empty / body field exists

### conditions_raw shape (from Prisma schema.prisma:404)
The JSON is Vec<Condition> where each Condition is:
  { "target": "body_json:$.action", "operator": "eq", "value": "send_email" }
Deserialize with a local struct:
  #[derive(serde::Deserialize)] struct Condition { target: String, operator: String, value: String }
Use serde_json::from_value on conditions_raw.

### Tests to add (at the bottom of condition_match.rs in #[cfg(test)])
Write at minimum 4 tests:
1. no_conditions_matches_everything — None conditions_raw → true
2. body_json_eq_matches — conditions_raw targets "body_json:$.action" eq "send",
   body = br#"{"action":"send"}"# → true
3. body_json_eq_no_match — same rule, body = br#"{"action":"read"}"# → false
4. needs_buffer_true_when_body_condition — rule with "body_json:$.x" → true
5. needs_buffer_false_otherwise — rule with "method" target → false

These must ASSERT and not skip on any env var.

### How to check
cd /Users/ttwj/Project OneComputer/implementation/onecomputer && \\
  cargo test -p onecli-gateway condition_match 2>&1 | tail -20

### Capture to gbrain
After tests pass, run: pkill -f "gbrain serve"; sleep 1
Append to ~/brain/projects/onecomputer-build-priorities.md a section
"## G1 condition_match — status (2026-06-28)" noting:
- Implemented: yes/no
- Tests: pass count
- What was NOT implemented (e.g. header conditions deferred)
Then: gbrain import ~/brain/ && gbrain embed --stale

Return: diff summary, test output (pass/fail), any TODO left, gbrain updated.`;

// ─── G2: MCP/JSON-RPC body parser ────────────────────────────────────────────
const G2_PROMPT = `${CONTEXT}

## Your task: G2 — Add MCP/JSON-RPC body parser to the gateway

The gateway currently does byte-level forwarding. Add protocol-aware MCP parsing
so policy rules can match on MCP tool names (tools/call) — the foundation for
per-tool allow/deny policies.

### Where to add it
Create apps/gateway/src/mcp.rs. This module is called from condition_match.rs
when target is "mcp_tool:<tool-name>" (a new target type to add alongside
"body_json:").

### What to implement

1. A parser: parse_mcp_method(body: &[u8]) -> Option<McpRequest>
   McpRequest { method: String, tool_name: Option<String> }
   JSON-RPC 2.0: {"jsonrpc":"2.0","method":"tools/call","params":{"name":"<tool>",...}}
   Only parse what we need — method field and params.name for tools/call.
   Use serde_json. Keep it small (<60 lines).

2. A helper: is_mcp_tools_call(body: &[u8]) -> bool
   Returns true iff method == "tools/call".

3. Wire into condition_match.rs (after G1 lands, or alongside it):
   Add "mcp_tool:<name>" as a target type in matches():
   - Parse body as McpRequest
   - If method != "tools/call" → return true (non-tool calls pass through)
   - Extract params.name, compare with operator against condition.value
   This means needs_body_buffer should also return true when any condition has
   target starting with "mcp_tool:".

4. Wire mcp.rs into the module tree: add "pub(crate) mod mcp;" to main.rs or
   lib.rs (whichever is the crate root — check gateway/src/main.rs or lib.rs).

### Tests (in mcp.rs #[cfg(test)])
1. parse_tools_call — valid tools/call JSON → method="tools/call" tool_name=Some("bash")
2. parse_tools_list — {"method":"tools/list"} → method="tools/list" tool_name=None
3. parse_invalid — garbage bytes → None
4. is_tools_call_true / is_tools_call_false

### How to check
cargo test -p onecli-gateway mcp 2>&1 | tail -20

### Capture to gbrain
Append "## G2 MCP parser — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

Return: diff summary, test output, any TODO, gbrain updated.`;

// ─── G3: Source auth per channel ─────────────────────────────────────────────
const G3_PROMPT = `${CONTEXT}

## Your task: G3 — Add source auth (API key + JWT/JWKS) per policy scope

Today all inbound auth is a single agent bearer token checked in connect.rs.
Add per-channel source auth so specific host patterns can require an additional
API key or validate a JWT.

### Scope (keep it small and testable)
This sprint implements the DATA MODEL and ENFORCEMENT POINT only — no UI, no DB
migration (that's a follow-up). Use a JSON config file or environment variable
for the initial source-auth rules. This gives a working, testable enforcement
path without a schema migration.

### What to implement

1. Create apps/gateway/src/source_auth.rs with:

   pub(crate) struct SourceAuthRule {
     pub host_pattern: String,         // glob, e.g. "sharepoint.temasek.internal"
     pub mode: SourceAuthMode,
   }
   pub(crate) enum SourceAuthMode {
     ApiKey { header: String, value: String },
     // JWT(JwksUrl) — stubbed for now, returns Ok always, add TODO
   }
   pub(crate) fn check_source_auth(
     rules: &[SourceAuthRule],
     host: &str,
     req_headers: &hyper::HeaderMap,
   ) -> Result<(), String>  // Err = deny reason

   Matching: use inject::host_matches(host, &rule.host_pattern) (already exists).
   ApiKey mode: extract header from req_headers, compare with constant-time
   comparison (use subtle crate if available, else std::iter::zip byte compare).
   If no rule matches → Ok(()) (default allow — caller has the agent token).

2. Load rules from env var ONECLI_SOURCE_AUTH_RULES (JSON array of SourceAuthRule)
   at gateway startup in main.rs. Deserialize once, pass as Arc<Vec<SourceAuthRule>>
   through to forward_request via ProxyContext or a new param.

3. Wire check_source_auth() into gateway/forward.rs BEFORE evaluate() (line ~198).
   If check_source_auth returns Err, return response::source_auth_denied() — add
   this response helper to gateway/response.rs (HTTP 403, JSON body
   {"error":"source_auth_denied","reason":"<msg>"}).

4. Wire into gateway/websocket.rs too (same pattern as forward.rs).

### Tests (in source_auth.rs #[cfg(test)])
1. no_rules_always_ok — empty rules → Ok
2. api_key_match_passes — rule requires x-api-key: secret123, header present → Ok
3. api_key_missing_fails — header absent → Err
4. api_key_wrong_value_fails — wrong value → Err
5. host_pattern_no_match_skips — rule for "other.host", request to "my.host" → Ok

### How to check
cargo test -p onecli-gateway source_auth 2>&1 | tail -20

### Capture to gbrain
Append "## G3 source auth — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

Return: diff summary, test output, what's deferred (JWT/JWKS), gbrain updated.`;

// ─── G4: Channel routing abstraction ─────────────────────────────────────────
const G4_PROMPT = `${CONTEXT}

## Your task: G4 — Add a Channel routing model

Today the gateway routes by outbound host (the CONNECT destination). Add an
inbound Channel abstraction: a named route prefix → target endpoint + protocol +
policy bindings. This is the TGW "channel" concept that enables multi-sandbox,
multi-connector governance.

### Scope
Data model + in-memory registry only. No DB migration. Channels loaded from a
JSON config file (ONECLI_CHANNELS env var) or a channels.json file at startup.
The MITM proxy's existing host-based routing is NOT changed — channels are
additive: an inbound request matching a channel prefix is *also* tagged with the
channel metadata (id, name, protocol) so policy rules can use it.

### What to implement

1. Create apps/gateway/src/channel.rs:

   #[derive(Debug, Clone, serde::Deserialize)]
   pub(crate) struct Channel {
     pub id: String,
     pub name: String,
     pub route_prefix: String,       // e.g. "/agents/sharepoint"
     pub target_endpoint: String,    // e.g. "https://sharepoint.temasek.internal/mcp"
     pub protocol: ChannelProtocol,
   }
   #[derive(Debug, Clone, serde::Deserialize)]
   pub(crate) enum ChannelProtocol { Mcp, A2a, Rest }

   pub(crate) struct ChannelRegistry { channels: Vec<Channel> }
   impl ChannelRegistry {
     pub fn load_from_env() -> Self   // reads ONECLI_CHANNELS JSON
     pub fn match_request(&self, path: &str) -> Option<&Channel>
     // match_request: return first channel whose route_prefix is a prefix of path
   }

2. Wire into mitm.rs / forward.rs:
   - Load ChannelRegistry once at startup in main.rs, pass as Arc<ChannelRegistry>
   - In forward_request, call registry.match_request(&path)
   - If Some(channel): add "x-onecli-channel-id" and "x-onecli-channel-name"
     response headers (strip them from upstream first), log the channel match
   - If channel.protocol == Mcp: enable MCP body buffering
     (is_mcp_tools_call from G2 if available, else just enable buffering)
   - The target_endpoint is NOT used to rewrite the upstream yet (that's the
     Channel-based routing sprint). Just tag. Add a TODO comment.

3. Add ChannelId to ProxyContext or pass it through as Option<&Channel> where
   needed so future policy rules can reference input.channel.name (TGW contract).

### Tests (channel.rs #[cfg(test)])
1. match_exact_prefix — "/agents/sharepoint/something" matches route_prefix "/agents/sharepoint"
2. no_match — "/agents/other" doesn't match "/agents/sharepoint"
3. empty_registry — no channels loaded → None
4. protocol_enum_roundtrip — Mcp/A2a/Rest deserializes from JSON strings

### How to check
cargo test -p onecli-gateway channel 2>&1 | tail -20

### Capture to gbrain
Append "## G4 channel routing — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

Return: diff summary, test output, what's deferred (target_endpoint rewriting), gbrain updated.`;

// ─── G5: Prometheus /metrics endpoint ────────────────────────────────────────
const G5_PROMPT = `${CONTEXT}

## Your task: G5 — Add Prometheus /metrics endpoint to the gateway

The gateway currently logs to Postgres only. Add a Prometheus text endpoint
emitting the agent_trust_gateway_* series matching the TGW reference spec.

### What to implement

1. Add the prometheus crate to apps/gateway/Cargo.toml:
   prometheus = { version = "0.13", features = ["process"] }

2. Create apps/gateway/src/metrics.rs:
   Use a lazy_static or once_cell global Registry with these metrics:
   - REQUESTS_TOTAL: IntCounterVec (labels: method, host, status)
   - REQUESTS_BLOCKED_TOTAL: IntCounterVec (labels: rule_name)
   - REQUEST_DURATION_SECONDS: HistogramVec (labels: method, host, buckets: default)
   - ACTIVE_CONNECTIONS: IntGauge
   - INJECTION_COUNT_TOTAL: IntCounterVec (labels: provider)

   Name them with the prefix agent_trust_gateway_ to match TGW spec.

   Expose:
   pub(crate) fn record_request(method: &str, host: &str, status: u16, duration_secs: f64, injected: bool, provider: Option<&str>)
   pub(crate) fn record_blocked(rule_name: &str)
   pub(crate) fn connection_opened()
   pub(crate) fn connection_closed()
   pub(crate) fn metrics_handler() -> String  // prometheus::TextEncoder output

3. Wire record_request() into gateway/forward.rs at the end of forward_request()
   (line ~510, after the response is received). The latency is already computed
   there (start = Instant::now() at ~line 133). Status from upstream response.

4. Wire connection_opened/closed into gateway/mitm.rs around the per-connection
   spawn (line ~55 accept loop).

5. Add a /metrics route to the HTTP server in main.rs. The gateway listens on
   two ports: GATEWAY_PORT (default 10255, MITM proxy) and a separate HTTP server
   for the dashboard API. Find where the HTTP API routes are registered and add:
   GET /metrics → metrics_handler() text/plain; version=0.0.4

   If the HTTP server is in packages/api (Node.js), add a Rust HTTP server on a
   separate port (e.g. GATEWAY_METRICS_PORT, default 9090) in main.rs using axum
   (already in Cargo.toml if present, else add axum = "0.7").

### Tests (metrics.rs #[cfg(test)])
1. record_increments_counter — call record_request, gather metrics, assert
   agent_trust_gateway_requests_total > 0
2. blocked_counter — call record_blocked, assert
   agent_trust_gateway_requests_blocked_total{rule_name="test"} == 1
3. metrics_handler_returns_text — output contains "agent_trust_gateway_"

### How to check
cargo test -p onecli-gateway metrics 2>&1 | tail -20

### Capture to gbrain
Append "## G5 Prometheus metrics — status (2026-06-28)" to
~/brain/projects/onecomputer-build-priorities.md
pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

Return: diff summary, test output, the exact metric names added, gbrain updated.`;

// ─── VERIFY schema ────────────────────────────────────────────────────────────
const VERIFY_SCHEMA = {
  type: "object",
  required: [
    "gap",
    "verdict",
    "tests_pass",
    "tests_total",
    "real_enforcement",
    "issues",
    "gbrain_updated",
  ],
  properties: {
    gap: { type: "string" }, // G1-G5
    verdict: { type: "string", enum: ["REAL", "PARTIAL", "VAPOR"] },
    tests_pass: { type: "number" },
    tests_total: { type: "number" },
    real_enforcement: { type: "boolean" }, // does a real request actually hit the code?
    issues: { type: "array", items: { type: "string" } },
    gbrain_updated: { type: "boolean" },
    diff_summary: { type: "string" },
  },
};

// ─── Orchestration ────────────────────────────────────────────────────────────
phase("Implement");

// Fan out all 5 gaps in parallel — each is a separate file, no collision
const implResults = await parallel([
  () => agent(G1_PROMPT, { label: "G1: condition_match", phase: "Implement" }),
  () => agent(G2_PROMPT, { label: "G2: MCP parser", phase: "Implement" }),
  () => agent(G3_PROMPT, { label: "G3: source auth", phase: "Implement" }),
  () => agent(G4_PROMPT, { label: "G4: channel routing", phase: "Implement" }),
  () => agent(G5_PROMPT, { label: "G5: Prometheus", phase: "Implement" }),
]);

log(
  `Implement phase done. ${implResults.filter(Boolean).length}/5 agents completed.`,
);

phase("Verify");

// Independent adversarial reviewer for each gap — checks real enforcement, not just modeling
const verifyPromptFor = (gapLabel, implSummary) => `
You are an adversarial code reviewer for the OneComputer gateway. Your job is to
REJECT unless evidence is strong. Read AUDIT.md first:
/Users/ttwj/Project OneComputer/implementation/onecomputer/AUDIT.md

Gap being reviewed: ${gapLabel}
Implementer summary: ${implSummary || "(no summary provided)"}

Check the actual files in the repo (read them — do not trust the summary):
1. Does the implementation actually get called on a real request, or is it
   simulator_only / never wired into forward_request / websocket.rs?
2. Do the tests ASSERT behavior that would fail if the code was broken?
   (No DATABASE_URL skip-guards, no tautological assertions)
3. Does cargo clippy -D warnings pass?
   cd /Users/ttwj/Project OneComputer/implementation/onecomputer && cargo clippy -p onecli-gateway 2>&1 | grep "^error" | head -10
4. Does cargo test for this gap pass?
   cargo test -p onecli-gateway ${gapLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")} 2>&1 | tail -10

Give verdict: REAL (wired + tests assert), PARTIAL (code exists but not wired or tests weak),
or VAPOR (code exists but never reached / tests skip / clippy fails).
List specific issues. Be harsh — the prior codebase had "95/100" while being mostly vapor.`;

const verifyResults = await parallel(
  implResults.filter(Boolean).map((summary, i) => {
    const labels = [
      "G1:condition_match",
      "G2:mcp",
      "G3:source_auth",
      "G4:channel",
      "G5:metrics",
    ];
    return () =>
      agent(verifyPromptFor(labels[i], summary), {
        label: `verify:${labels[i]}`,
        phase: "Verify",
        schema: VERIFY_SCHEMA,
      });
  }),
);

phase("Integrate");

// Final integrator — compiles the full gateway, runs all tests, writes gbrain summary
const integrationSummary = await agent(
  `
You are the integration agent for the OneComputer Sprint 1 gateway work.

Repo: /Users/ttwj/Project OneComputer/implementation/onecomputer

## Step 1 — Full compile check
cd /Users/ttwj/Project OneComputer/implementation/onecomputer
cargo clippy -p onecli-gateway -- -D warnings 2>&1 | head -40

## Step 2 — Run all gateway tests
cargo test -p onecli-gateway 2>&1 | tail -30
Report: how many tests pass, how many fail.

## Step 3 — Verify enforcement is wired
Grep for each new function being called from forward.rs and websocket.rs:
grep -n "condition_match::matches\\|check_source_auth\\|parse_mcp_method\\|registry.match_request\\|metrics::record_request" \\
  apps/gateway/src/gateway/forward.rs apps/gateway/src/gateway/websocket.rs 2>/dev/null

## Step 4 — Write integration report to gbrain
Create ~/brain/projects/onecomputer-sprint-1-result.md with frontmatter:
---
title: "Sprint 1 gateway — integration result"
type: project
aliases: [sprint-1-result, gateway-sprint-1]
tags: [sprint, gateway, result]
updated: 2026-06-28
---
Body: for each gap G1-G5 — verdict (REAL/PARTIAL/VAPOR), test count, wired to forward.rs (yes/no).
Overall: how many of the 5 gaps are REAL vs PARTIAL vs VAPOR.
What remains to do for the next sprint.

pkill -f "gbrain serve"; sleep 1 && gbrain import ~/brain/ && gbrain embed --stale

## Return
Report: compile result (pass/fail + error count), test pass/fail counts,
wiring grep output, gbrain page created.`,
  { label: "integrate", phase: "Integrate" },
);

// Final output
const verdicts = verifyResults.filter(Boolean);
const real = verdicts.filter((v) => v.verdict === "REAL").length;
const partial = verdicts.filter((v) => v.verdict === "PARTIAL").length;
const vapor = verdicts.filter((v) => v.verdict === "VAPOR").length;

return {
  gaps_implemented: implResults.filter(Boolean).length,
  verdicts: { real, partial, vapor },
  verify_details: verdicts,
  integration: integrationSummary,
};
