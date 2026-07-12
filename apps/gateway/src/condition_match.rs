use crate::policy::PolicyRule;

/// Returns true iff any rule carries a condition that needs the request body to
/// evaluate. Body-dependent condition targets are `mcp_tool:` and `body_json:`.
pub(crate) fn needs_body_buffer(rules: &[PolicyRule]) -> bool {
    rules.iter().any(rule_needs_body)
}

/// True iff this rule has at least one body-dependent condition
/// (`mcp_tool:` or `body_json:`).
fn rule_needs_body(rule: &PolicyRule) -> bool {
    conditions(rule)
        .into_iter()
        .any(|c| c.target.starts_with("mcp_tool:") || c.target.starts_with("body_json:"))
}

/// Evaluate a rule's conditions against the request body. All must pass (AND).
///
/// - No conditions → match (passes through).
/// - Each condition is `{target, operator, value}`.
/// - `body_json:<path>`: parse the body as JSON, extract the field at `<path>`
///   (simple dot notation: `$.action` → `body["action"]`, `$.a.b` →
///   `body["a"]["b"]`), apply `operator` against `value`
///   (`eq` / `neq` / `contains` / `exists` / `regex`, case-sensitive).
/// - `mcp_tool:` conditions inspect the MCP JSON-RPC body:
///   - If the body is not a `tools/call` request, the condition matches (non-tool
///     MCP calls pass any per-tool condition).
///   - The extracted tool name is compared against `condition.value` using
///     `operator` (`eq` / `ne`, case-sensitive; `eq` default).
/// - `method` | `host` | `path`: pre-filtered upstream by
///   `policy::matches_request` and host routing — always satisfied here.
/// - Any other (unrecognized) target: treated as a match (OSS keeps the
///   conservative default — fail-open for forward compatibility with
///   cloud-only conditions).
/// - When a `mcp_tool:` condition is present but the body is absent, the
///   condition does not match (cannot confirm the tool) — fail closed.
pub(crate) fn matches(rule: &PolicyRule, body: Option<&[u8]>) -> bool {
    let conds = conditions(rule);
    if conds.is_empty() {
        return true;
    }
    conds.iter().all(|c| condition_matches(c, body))
}

/// A single decoded condition from `conditions_raw`.
#[derive(Debug, Clone)]
struct Condition {
    target: String,
    operator: String,
    value: String,
}

/// Decode `conditions_raw` into typed conditions. Malformed entries are skipped
/// (an unparseable condition cannot be evaluated and is ignored).
fn conditions(rule: &PolicyRule) -> Vec<Condition> {
    let Some(raw) = rule.conditions_raw.as_ref() else {
        return Vec::new();
    };
    let arr = match raw.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .filter_map(|entry| {
            let obj = entry.as_object()?;
            let target = obj.get("target")?.as_str()?.to_string();
            let operator = obj
                .get("operator")
                .and_then(|v| v.as_str())
                .unwrap_or("eq")
                .to_string();
            let value = obj.get("value")?.as_str()?.to_string();
            Some(Condition {
                target,
                operator,
                value,
            })
        })
        .collect()
}

/// Evaluate one condition against the body.
fn condition_matches(c: &Condition, body: Option<&[u8]>) -> bool {
    if let Some(path) = c.target.strip_prefix("body_json:") {
        body_json_matches(path, &c.operator, &c.value, body)
    } else if c.target.starts_with("mcp_tool:") {
        mcp_tool_matches(&c.operator, &c.value, body)
    } else if matches!(c.target.as_str(), "method" | "host" | "path") {
        // Pre-filtered upstream: `method`/`path` are matched by
        // `policy::matches_request` and `host` by the gateway's host routing,
        // so a condition targeting them is always satisfied here.
        true
    } else {
        // Unrecognized target: OSS does not block on unknown predicates
        // (fail-open for forward compatibility with cloud-only conditions).
        true
    }
}

/// Evaluate a `mcp_tool:` condition.
///
/// `operator` compares the invoked tool name with `value`:
/// - `eq` (default): tool name equals `value`.
/// - `ne`: tool name does not equal `value`.
///
/// A non-`tools/call` MCP request passes (no tool to gate). A missing body or a
/// non-MCP body fails closed for `eq` (cannot confirm the tool) and passes for
/// `ne` (cannot disprove inequality).
fn mcp_tool_matches(operator: &str, value: &str, body: Option<&[u8]>) -> bool {
    let body = match body {
        Some(b) => b,
        None => return operator == "ne",
    };
    // Non-tools/call MCP requests pass any per-tool condition.
    if !crate::mcp::is_tools_call(body) {
        return true;
    }
    let Some(name) = crate::mcp::tool_name(body) else {
        // tools/call but no params.name: fail closed for eq, pass for ne.
        return operator == "ne";
    };
    match operator {
        "eq" => name == value,
        "ne" => name != value,
        _ => name == value, // default to eq for unknown operators
    }
}

/// Evaluate a `body_json:<path>` condition.
///
/// The request body is parsed as JSON, the field at `<path>` (simple dot
/// notation, e.g. `$.action` → `body["action"]`, `$.a.b` → `body["a"]["b"]`)
/// is extracted, and `operator` is applied against `value`.
///
/// Operators (case-sensitive string comparison):
/// - `eq`    : extracted field equals `value`.
/// - `neq`   : extracted field does not equal `value`.
/// - `contains`: field string contains `value`, or field array contains `value`.
/// - `exists`: field is present and non-null.
/// - `regex` : field string matches the regex `value` (via the `regex` crate).
///
/// A missing/unparseable body: `exists` is false; `neq` passes (cannot confirm
/// equality); all other operators fail.
fn body_json_matches(path: &str, operator: &str, value: &str, body: Option<&[u8]>) -> bool {
    let parsed = body.and_then(|b| serde_json::from_slice::<serde_json::Value>(b).ok());
    let field = match parsed.as_ref() {
        Some(v) => extract_field(v, path),
        None => {
            // No body / unparseable: decide per-operator.
            return match operator {
                "neq" => true,
                "exists" => false,
                _ => false,
            };
        }
    };
    apply_operator(operator, &field, value)
}

/// Extract a field from a JSON value using simple dot notation.
///
/// A leading `$` and/or `.` is optional: `$.action`, `$action`, and `action`
/// all mean `body["action"]`; `$.a.b` → `body["a"]["b"]`. A missing key yields
/// `Value::Null`.
fn extract_field(body: &serde_json::Value, path: &str) -> serde_json::Value {
    let stripped = path.strip_prefix('$').unwrap_or(path);
    let stripped = stripped.strip_prefix('.').unwrap_or(stripped);
    if stripped.is_empty() {
        return body.clone();
    }
    let mut current = body;
    for key in stripped.split('.') {
        if key.is_empty() {
            continue;
        }
        match current {
            serde_json::Value::Object(map) => match map.get(key) {
                Some(v) => current = v,
                None => return serde_json::Value::Null,
            },
            _ => return serde_json::Value::Null,
        }
    }
    current.clone()
}

/// Apply a comparison operator to an extracted JSON `field` against `expected`.
fn apply_operator(op: &str, field: &serde_json::Value, expected: &str) -> bool {
    match op {
        "eq" => json_str_eq(field, expected),
        "neq" => !json_str_eq(field, expected),
        "contains" => {
            if let Some(s) = field.as_str() {
                s.contains(expected)
            } else if let Some(arr) = field.as_array() {
                arr.iter().any(|v| json_str_eq(v, expected))
            } else {
                false
            }
        }
        "exists" => !field.is_null(),
        "regex" => field.as_str().is_some_and(|s| {
            regex::Regex::new(expected)
                .map(|re| re.is_match(s))
                .unwrap_or(false)
        }),
        // Unknown operator: fail-open (do not block on unknown predicates).
        _ => true,
    }
}

/// True iff `field` equals the string `expected`. Compares both as a JSON
/// string and via `as_str()` so numeric/bool fields stringified in `value`
/// match sensibly.
fn json_str_eq(field: &serde_json::Value, expected: &str) -> bool {
    field == &serde_json::Value::String(expected.to_string())
        || field.as_str().is_some_and(|s| s == expected)
}

/// Maximum request body we will buffer for condition matching (256 KB).
const MAX_BODY_BUFFER: usize = 256 * 1024;

/// Prepare the request body for condition matching.
///
/// When [`needs_body_buffer`] is true for `rules` (a `body_json:` or
/// `mcp_tool:` condition is present), the body is collected (up to
/// [`MAX_BODY_BUFFER`] bytes) and returned alongside a `reqwest::Body` rebuilt
/// from the buffered bytes — so the bytes are available both for condition
/// evaluation and for forwarding.
///
/// Otherwise the incoming body is wrapped directly for zero-copy streaming,
/// returning `None` for the buffer.
pub(crate) async fn prepare_body(
    body: hyper::body::Incoming,
    _method: &str,
    _url: &str,
    rules: &[PolicyRule],
) -> anyhow::Result<(Option<Vec<u8>>, reqwest::Body)> {
    use anyhow::Context;
    use http_body_util::BodyExt;

    if needs_body_buffer(rules) {
        let bytes = body
            .collect()
            .await
            .context("buffering request body for condition matching")?
            .to_bytes();
        if bytes.len() > MAX_BODY_BUFFER {
            anyhow::bail!(
                "request body exceeds {MAX_BODY_BUFFER} byte limit for condition matching"
            );
        }
        let buf = bytes.to_vec();
        let fwd = reqwest::Body::from(buf.clone());
        Ok((Some(buf), fwd))
    } else {
        // No body-dependent condition: stream the body through unchanged.
        Ok((None, reqwest::Body::wrap(body)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{PolicyAction, PolicyScope};
    use serde_json::json;

    fn rule_with_conditions(conditions: serde_json::Value) -> PolicyRule {
        PolicyRule {
            name: "test".to_string(),
            path_pattern: "*".to_string(),
            method: None,
            action: PolicyAction::Block,
            conditions_raw: Some(conditions),
            scope: PolicyScope::Project,
        }
    }

    fn mcp_tool_eq(value: &str) -> serde_json::Value {
        json!([{ "target": format!("mcp_tool:{value}"), "operator": "eq", "value": value }])
    }

    fn tools_call_body(tool: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": tool, "arguments": {} }
        }))
        .unwrap()
    }

    fn tools_list_body() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }))
        .unwrap()
    }

    // ── needs_body_buffer ───────────────────────────────────────────────

    #[test]
    fn needs_body_buffer_true_when_mcp_tool_condition() {
        let rule = rule_with_conditions(mcp_tool_eq("bash"));
        assert!(needs_body_buffer(&[rule]));
    }

    #[test]
    fn needs_body_buffer_false_without_conditions() {
        let rule = PolicyRule {
            name: "test".to_string(),
            path_pattern: "*".to_string(),
            method: None,
            action: PolicyAction::Block,
            conditions_raw: None,
            scope: PolicyScope::Project,
        };
        assert!(!needs_body_buffer(&[rule]));
    }

    #[test]
    fn needs_body_buffer_false_for_unrecognized_target() {
        let rule = rule_with_conditions(
            json!([{ "target": "unknown:foo", "operator": "eq", "value": "x" }]),
        );
        assert!(!needs_body_buffer(&[rule]));
    }

    // ── matches: mcp_tool eq ────────────────────────────────────────────

    #[test]
    fn matches_mcp_tool_eq_allows_matching_tool() {
        let rule = rule_with_conditions(mcp_tool_eq("bash"));
        let body = tools_call_body("bash");
        assert!(matches(&rule, Some(&body)), "bash eq bash -> match");
    }

    #[test]
    fn matches_mcp_tool_eq_blocks_non_matching_tool() {
        let rule = rule_with_conditions(mcp_tool_eq("bash"));
        let body = tools_call_body("send_email");
        assert!(
            !matches(&rule, Some(&body)),
            "send_email eq bash -> no match"
        );
    }

    // ── matches: non-tools/call passes ─────────────────────────────────

    #[test]
    fn matches_mcp_tool_passes_non_tools_call() {
        let rule = rule_with_conditions(mcp_tool_eq("bash"));
        let body = tools_list_body();
        assert!(
            matches(&rule, Some(&body)),
            "tools/list passes any mcp_tool condition"
        );
    }

    // ── matches: missing body fails closed for eq ───────────────────────

    #[test]
    fn matches_mcp_tool_eq_missing_body_fails_closed() {
        let rule = rule_with_conditions(mcp_tool_eq("bash"));
        assert!(!matches(&rule, None), "missing body + eq -> fail closed");
    }

    // ── matches: ne operator ────────────────────────────────────────────

    #[test]
    fn matches_mcp_tool_ne_passes_different_tool() {
        let rule = rule_with_conditions(
            json!([{ "target": "mcp_tool:bash", "operator": "ne", "value": "bash" }]),
        );
        let body = tools_call_body("send_email");
        assert!(matches(&rule, Some(&body)), "send_email ne bash -> match");
    }

    #[test]
    fn matches_mcp_tool_ne_blocks_same_tool() {
        let rule = rule_with_conditions(
            json!([{ "target": "mcp_tool:bash", "operator": "ne", "value": "bash" }]),
        );
        let body = tools_call_body("bash");
        assert!(!matches(&rule, Some(&body)), "bash ne bash -> no match");
    }

    #[test]
    fn matches_mcp_tool_ne_missing_body_passes() {
        let rule = rule_with_conditions(
            json!([{ "target": "mcp_tool:bash", "operator": "ne", "value": "bash" }]),
        );
        assert!(
            matches(&rule, None),
            "missing body + ne -> pass (cannot disprove)"
        );
    }

    // ── matches: no conditions always matches ───────────────────────────

    #[test]
    fn matches_no_conditions_always_true() {
        let rule = PolicyRule {
            name: "test".to_string(),
            path_pattern: "*".to_string(),
            method: None,
            action: PolicyAction::Block,
            conditions_raw: None,
            scope: PolicyScope::Project,
        };
        assert!(matches(&rule, None));
        assert!(matches(&rule, Some(b"anything")));
    }

    // ── conditions decoding is robust ───────────────────────────────────

    #[test]
    fn conditions_malformed_entries_skipped() {
        // Not an array -> no conditions.
        let rule = rule_with_conditions(json!({"target": "mcp_tool:bash"}));
        assert!(matches(&rule, None), "non-array conditions ignored");

        // Array with a missing field -> skipped, remaining valid entry governs.
        let rule = rule_with_conditions(json!([
            { "target": "mcp_tool:bash" }, // missing value
            { "target": "mcp_tool:bash", "operator": "eq", "value": "bash" }
        ]));
        let body = tools_call_body("bash");
        assert!(matches(&rule, Some(&body)));
    }

    // ── G1: body_json: conditions ──────────────────────────────────────

    fn body_json_rule(target: &str, operator: &str, value: &str) -> PolicyRule {
        rule_with_conditions(json!([{ "target": target, "operator": operator, "value": value }]))
    }

    #[test]
    fn no_conditions_returns_true() {
        let rule = PolicyRule {
            name: "test".to_string(),
            path_pattern: "*".to_string(),
            method: None,
            action: PolicyAction::Block,
            conditions_raw: None,
            scope: PolicyScope::Project,
        };
        assert!(matches(&rule, None));
        assert!(matches(&rule, Some(br#"{"x":1}"#)));
    }

    #[test]
    fn body_json_eq_match() {
        let rule = body_json_rule("body_json:$.action", "eq", "send");
        let body = br#"{"action":"send"}"#;
        assert!(matches(&rule, Some(body)), "action=send eq send -> match");
    }

    #[test]
    fn body_json_eq_no_match() {
        let rule = body_json_rule("body_json:$.action", "eq", "send");
        let body = br#"{"action":"read"}"#;
        assert!(
            !matches(&rule, Some(body)),
            "action=read eq send -> no match"
        );
    }

    #[test]
    fn body_json_exists() {
        let rule = body_json_rule("body_json:$.secret", "exists", "");
        let body = br#"{"secret":"x"}"#;
        assert!(matches(&rule, Some(body)), "secret present -> exists true");
    }

    #[test]
    fn body_json_exists_missing_is_false() {
        let rule = body_json_rule("body_json:$.secret", "exists", "");
        let body = br#"{"other":"x"}"#;
        assert!(!matches(&rule, Some(body)), "secret absent -> exists false");
    }

    #[test]
    fn body_json_nested_path_match() {
        let rule = body_json_rule("body_json:$.a.b", "eq", "yes");
        let body = br#"{"a":{"b":"yes"}}"#;
        assert!(matches(&rule, Some(body)), "$.a.b=yes -> match");
    }

    #[test]
    fn body_json_neq_match() {
        let rule = body_json_rule("body_json:$.action", "neq", "send");
        let body = br#"{"action":"read"}"#;
        assert!(matches(&rule, Some(body)), "action=read neq send -> match");
    }

    #[test]
    fn body_json_neq_no_match() {
        let rule = body_json_rule("body_json:$.action", "neq", "send");
        let body = br#"{"action":"send"}"#;
        assert!(
            !matches(&rule, Some(body)),
            "action=send neq send -> no match"
        );
    }

    #[test]
    fn body_json_contains_string() {
        let rule = body_json_rule("body_json:$.msg", "contains", "hello");
        let body = br#"{"msg":"say hello world"}"#;
        assert!(matches(&rule, Some(body)));
    }

    #[test]
    fn body_json_contains_array_element() {
        let rule = body_json_rule("body_json:$.tags", "contains", "urgent");
        let body = br#"{"tags":["a","urgent","b"]}"#;
        assert!(matches(&rule, Some(body)));
    }

    #[test]
    fn body_json_regex_match() {
        let rule = body_json_rule("body_json:$.action", "regex", "^se.d$");
        let body = br#"{"action":"send"}"#;
        assert!(matches(&rule, Some(body)));
    }

    #[test]
    fn body_json_regex_no_match() {
        let rule = body_json_rule("body_json:$.action", "regex", "^read$");
        let body = br#"{"action":"send"}"#;
        assert!(!matches(&rule, Some(body)));
    }

    #[test]
    fn body_json_missing_body_eq_fails() {
        let rule = body_json_rule("body_json:$.action", "eq", "send");
        assert!(!matches(&rule, None), "missing body + eq -> no match");
    }

    #[test]
    fn body_json_missing_body_neq_passes() {
        let rule = body_json_rule("body_json:$.action", "neq", "send");
        assert!(matches(&rule, None), "missing body + neq -> pass");
    }

    #[test]
    fn body_json_invalid_json_eq_fails() {
        let rule = body_json_rule("body_json:$.action", "eq", "send");
        assert!(
            !matches(&rule, Some(b"not json")),
            "invalid body + eq -> no match"
        );
    }

    #[test]
    fn body_json_and_logic_all_pass() {
        let rule = rule_with_conditions(json!([
            { "target": "body_json:$.action", "operator": "eq", "value": "send" },
            { "target": "body_json:$.count", "operator": "eq", "value": "3" }
        ]));
        let body = br#"{"action":"send","count":"3"}"#;
        assert!(matches(&rule, Some(body)));
    }

    #[test]
    fn body_json_and_logic_one_fails() {
        let rule = rule_with_conditions(json!([
            { "target": "body_json:$.action", "operator": "eq", "value": "send" },
            { "target": "body_json:$.count", "operator": "eq", "value": "3" }
        ]));
        let body = br#"{"action":"send","count":"5"}"#;
        assert!(!matches(&rule, Some(body)));
    }

    // ── G1: method/host/path pre-filtered ───────────────────────────────

    #[test]
    fn method_target_pre_filtered_returns_true() {
        let rule = rule_with_conditions(
            json!([{ "target": "method", "operator": "eq", "value": "POST" }]),
        );
        assert!(matches(&rule, None));
    }

    #[test]
    fn host_target_pre_filtered_returns_true() {
        let rule = rule_with_conditions(
            json!([{ "target": "host", "operator": "eq", "value": "api.example.com" }]),
        );
        assert!(matches(&rule, None));
    }

    #[test]
    fn path_target_pre_filtered_returns_true() {
        let rule =
            rule_with_conditions(json!([{ "target": "path", "operator": "eq", "value": "/x" }]));
        assert!(matches(&rule, None));
    }

    // ── G1: unknown target fail-open ─────────────────────────────────────

    #[test]
    fn unknown_target_fail_open() {
        let rule =
            rule_with_conditions(json!([{ "target": "jwt:iss", "operator": "eq", "value": "x" }]));
        assert!(matches(&rule, None), "unknown target -> fail-open");
    }

    // ── G1: needs_body_buffer for body_json: ─────────────────────────────

    #[test]
    fn needs_buffer_true_for_body_condition() {
        let rule = body_json_rule("body_json:$.x", "eq", "y");
        assert!(needs_body_buffer(&[rule]));
    }

    #[test]
    fn needs_buffer_false_otherwise() {
        let rule = rule_with_conditions(
            json!([{ "target": "method", "operator": "eq", "value": "POST" }]),
        );
        assert!(!needs_body_buffer(&[rule]));
    }

    #[test]
    fn needs_buffer_true_if_any_rule_has_body_condition() {
        let rule_a = rule_with_conditions(
            json!([{ "target": "method", "operator": "eq", "value": "POST" }]),
        );
        let rule_b = body_json_rule("body_json:$.x", "eq", "y");
        assert!(needs_body_buffer(&[rule_a, rule_b]));
    }

    // ── G1: extract_field dot notation ───────────────────────────────────

    #[test]
    fn extract_field_leading_dollar_optional() {
        let body: serde_json::Value = json!({"action": "send"});
        assert_eq!(extract_field(&body, "$.action"), json!("send"));
        assert_eq!(extract_field(&body, "action"), json!("send"));
    }

    #[test]
    fn extract_field_nested() {
        let body: serde_json::Value = json!({"a": {"b": {"c": 7}}});
        assert_eq!(extract_field(&body, "$.a.b.c"), json!(7));
    }

    #[test]
    fn extract_field_missing_is_null() {
        let body: serde_json::Value = json!({"action": "send"});
        assert_eq!(extract_field(&body, "$.missing"), serde_json::Value::Null);
    }
}
