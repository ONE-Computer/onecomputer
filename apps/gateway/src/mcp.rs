//! MCP JSON-RPC 2.0 request parsing for per-tool policy enforcement.
//!
//! The gateway forwards bytes upstream by default. When a policy rule carries a
//! `mcp_tool:<name>` condition, the body must be parsed as MCP JSON-RPC so the
//! condition matcher can inspect the `tools/call` method and the invoked tool
//! name (e.g. allow `bash`, block `send_email`).
//!
//! Only `tools/call` requests name a tool; other MCP methods (`tools/list`,
//! `initialize`, `ping`, …) carry no tool name and are treated as non-tool calls
//! that pass any `mcp_tool:` condition.

use serde::Deserialize;

/// A parsed MCP JSON-RPC 2.0 request.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct McpRequest {
    pub method: String,
    #[serde(default)]
    pub params: Option<McpParams>,
}

/// `params` object of an MCP JSON-RPC request.
///
/// For `tools/call` the relevant field is `name` (the tool name). All other
/// fields are captured via `#[serde(flatten)]` so unknown params do not fail
/// parsing.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub(crate) struct McpParams {
    pub name: Option<String>, // tool name for tools/call
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Parse a request body as MCP JSON-RPC 2.0.
///
/// Returns `None` if the body is not valid MCP JSON (not JSON, or missing the
/// required `method` field). A request without `params` is still valid MCP.
pub(crate) fn parse_mcp(body: &[u8]) -> Option<McpRequest> {
    serde_json::from_slice::<McpRequest>(body).ok()
}

/// Returns true iff this is a `tools/call` request.
pub(crate) fn is_tools_call(body: &[u8]) -> bool {
    parse_mcp(body)
        .map(|req| req.method == "tools/call")
        .unwrap_or(false)
}

/// Extracts the tool name from a `tools/call` request.
///
/// Returns `None` if the body is not a `tools/call` request or if the request
/// omits the `params.name` field.
pub(crate) fn tool_name(body: &[u8]) -> Option<String> {
    let req = parse_mcp(body)?;
    if req.method != "tools/call" {
        return None;
    }
    req.params.and_then(|p| p.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tools_call() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bash","arguments":{"cmd":"ls"}}}"#;
        let req = parse_mcp(body).expect("valid tools/call should parse");
        assert_eq!(req.method, "tools/call");
        assert_eq!(
            req.params.and_then(|p| p.name).as_deref(),
            Some("bash"),
            "tool name should be extracted from params.name"
        );
    }

    #[test]
    fn parse_tools_list() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        let req = parse_mcp(body).expect("valid tools/list should parse");
        assert_eq!(req.method, "tools/list");
        assert!(
            req.params.and_then(|p| p.name).is_none(),
            "tools/list has no tool name"
        );
    }

    #[test]
    fn parse_invalid() {
        assert!(parse_mcp(b"not json at all").is_none(), "garbage -> None");
        assert!(parse_mcp(b"{}").is_none(), "missing method -> None");
        assert!(parse_mcp(b"").is_none(), "empty body -> None");
    }

    #[test]
    fn is_tools_call_true() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bash"}}"#;
        assert!(is_tools_call(body));
    }

    #[test]
    fn is_tools_call_false() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        assert!(!is_tools_call(body));
        assert!(
            !is_tools_call(b"garbage"),
            "non-MCP body is not a tools/call"
        );
    }

    #[test]
    fn tool_name_extracted() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{}}}"#;
        assert_eq!(tool_name(body).as_deref(), Some("read_file"));
    }

    #[test]
    fn tool_name_missing_for_non_tools_call() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        assert!(tool_name(body).is_none());
    }

    #[test]
    fn tool_name_missing_when_params_name_absent() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"arguments":{}}}"#;
        assert!(
            tool_name(body).is_none(),
            "tools/call without params.name -> None"
        );
    }

    #[test]
    fn parse_preserves_extra_params() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bash","arguments":{"cmd":"ls"},"meta":{"trace":"abc"}}}"#;
        let req = parse_mcp(body).expect("valid request should parse");
        let params = req.params.expect("params present");
        assert!(
            params.extra.contains_key("arguments"),
            "extra retains arguments"
        );
        assert!(params.extra.contains_key("meta"), "extra retains meta");
    }
}
