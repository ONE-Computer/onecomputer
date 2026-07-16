//! Policy rule evaluation for the gateway.
//!
//! Policy rules control access to upstream endpoints:
//! - **Block**: returns 403 Forbidden
//! - **Rate limit**: allows up to N requests per time window, then 429
//! - **Allow**: explicitly permits a request (used in deny-by-default mode)
//!
//! ## Strictest-wins doctrine
//!
//! When rules from multiple scopes apply to a request, the strictest action
//! wins regardless of scope origin:
//!
//! - `organization` scope sets the minimum floor — an org-level Block cannot
//!   be overridden by a project- or agent-level Allow.
//! - `project` scope may raise controls above the org floor but never weaken them.
//! - `agent` scope (a rule with a specific `agent_id`) may further raise controls
//!   but never weaken org or project controls.
//!
//! Priority order (highest to lowest): Block > ManualApproval > RateLimit > Allow.
//! The [`evaluate`] function implements this by scanning all applicable rules in
//! priority order, so the strictest matching action always wins.

use tracing::{debug, warn};

use crate::cache::CacheStore;
use crate::inject::path_matches;

// ── Data types ──────────────────────────────────────────────────────────

/// Scope from which a policy rule originates.
///
/// Used for traceability in logs and tests; does not change the strictest-wins
/// evaluation logic (Block wins regardless of scope).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PolicyScope {
    /// Rule applies to all projects/agents within an organization.
    Organization,
    /// Rule applies to all agents within a specific project.
    #[default]
    Project,
    /// Rule applies to one specific agent only.
    Agent,
}

/// What action to take when a request matches a policy rule.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum PolicyAction {
    Block,
    RateLimit {
        rule_id: String,
        max_requests: u64,
        window_secs: u64,
    },
    ManualApproval {
        rule_id: String,
    },
    Allow,
}

/// A resolved policy rule ready for evaluation.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct PolicyRule {
    pub name: String,
    pub path_pattern: String,
    pub method: Option<String>,
    pub action: PolicyAction,
    #[serde(default)]
    pub conditions_raw: Option<serde_json::Value>,
    /// Scope from which this rule originates (for traceability).
    #[serde(default)]
    pub scope: PolicyScope,
}

/// Result of policy evaluation for a single request.
#[derive(Debug)]
pub(crate) enum PolicyDecision {
    /// Request is allowed.
    Allow,
    /// Request is blocked by a block rule.
    Blocked { rule_name: String },
    /// Request exceeds a rate limit.
    RateLimited {
        rule_name: String,
        limit: u64,
        window: &'static str,
        retry_after_secs: u64,
    },
    /// Request requires manual approval before proceeding.
    ManualApproval { rule_id: String },
    /// Request blocked because no allow rule matched in deny-by-default mode.
    BlockedByDefaultPolicy,
}

// ── Evaluation ──────────────────────────────────────────────────────────

/// Evaluate all applicable policy rules against a request using strictest-wins.
///
/// The caller is responsible for passing the correct union of rules:
/// org-scope rules + project-scope rules + agent-specific rules.
/// See [`crate::connect::PolicyEngine::resolve_policy_rules`] for how this
/// union is assembled from the database.
///
/// Priority (highest to lowest): Block > ManualApproval > RateLimit > Allow.
/// Each pass checks only one action type to enforce strict ordering.
/// An org-level Block therefore always beats any project/agent Allow because
/// the Block pass runs unconditionally across all rules in the slice.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn evaluate(
    org_id: &str,
    project_id: &str,
    request_method: &str,
    request_path: &str,
    request_body: Option<&[u8]>,
    rules: &[PolicyRule],
    agent_token: &str,
    cache: &dyn CacheStore,
    policy_mode: &str,
    enforce_deny: bool,
) -> PolicyDecision {
    // Pass 1: block rules (absolute deny, highest priority)
    for rule in rules {
        if !matches_request(rule, request_method, request_path, request_body) {
            continue;
        }
        if matches!(rule.action, PolicyAction::Block) {
            debug!(rule = %rule.name, method = request_method, path = request_path, "policy: block rule matched");
            return PolicyDecision::Blocked {
                rule_name: rule.name.clone(),
            };
        }
    }

    // Pass 2: manual approval rules
    for rule in rules {
        if !matches_request(rule, request_method, request_path, request_body) {
            continue;
        }
        if let PolicyAction::ManualApproval { rule_id } = &rule.action {
            debug!(rule = %rule.name, rule_id = %rule_id, method = request_method, path = request_path, "policy: manual approval rule matched");
            return PolicyDecision::ManualApproval {
                rule_id: rule_id.clone(),
            };
        }
    }

    // Pass 3: rate limit rules
    for rule in rules {
        if !matches_request(rule, request_method, request_path, request_body) {
            continue;
        }
        if let PolicyAction::RateLimit {
            rule_id,
            max_requests,
            window_secs,
        } = &rule.action
        {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let window_id = now / (*window_secs).max(1);
            let key = format!("rate:{org_id}:{project_id}:{rule_id}:{agent_token}:{window_id}");

            if let Some(count) = cache.incr(&key, *window_secs).await {
                if count > *max_requests {
                    let window_end = (window_id + 1) * window_secs;
                    let retry_after = window_end.saturating_sub(now);
                    let window_name = match *window_secs {
                        60 => "minute",
                        3600 => "hour",
                        86400 => "day",
                        _ => "window",
                    };
                    return PolicyDecision::RateLimited {
                        rule_name: rule.name.clone(),
                        limit: *max_requests,
                        window: window_name,
                        retry_after_secs: retry_after,
                    };
                }
            } else {
                warn!(rule = %rule.name, "policy: rate limit cache unavailable, allowing through");
            }
        }
    }

    // Pass 4: in deny mode, require an explicit allow rule when enforced.
    if policy_mode == "deny" && enforce_deny {
        let has_allow = rules.iter().any(|rule| {
            matches_request(rule, request_method, request_path, request_body)
                && matches!(
                    rule.action,
                    PolicyAction::Allow | PolicyAction::RateLimit { .. }
                )
        });
        if !has_allow {
            debug!(
                method = request_method,
                path = request_path,
                "policy: no allow rule matched in deny-by-default mode"
            );
            return PolicyDecision::BlockedByDefaultPolicy;
        }
    }

    PolicyDecision::Allow
}

/// Check if a rule matches the request method, path, and conditions.
fn matches_request(rule: &PolicyRule, method: &str, path: &str, body: Option<&[u8]>) -> bool {
    let direct = path_matches(path, &rule.path_pattern)
        && rule
            .method
            .as_ref()
            .is_none_or(|m| m.eq_ignore_ascii_case(method))
        && crate::condition_match::matches(rule, body);
    if direct {
        return true;
    }
    // Git push is two-phase: a GET info/refs?service=git-receive-pack discovery
    // followed by POST git-receive-pack. A rule blocking the POST should also
    // block the discovery so the push fails with a clear policy error.
    if rule.path_pattern.ends_with("/git-receive-pack")
        && method.eq_ignore_ascii_case("GET")
        && is_git_push_discovery(path)
    {
        return crate::condition_match::matches(rule, body);
    }
    false
}

/// Returns true if the request path is a git push discovery request
/// (`/info/refs?service=git-receive-pack`).
fn is_git_push_discovery(path: &str) -> bool {
    let (base, query) = path.split_once('?').unwrap_or((path, ""));
    base.ends_with("/info/refs") && query.split('&').any(|p| p == "service=git-receive-pack")
}

/// Returns true if the host belongs to a known LLM provider.
/// LLM traffic bypasses deny-by-default policy and is always logged.
pub(crate) fn is_llm_host(host: &str) -> bool {
    let h = host.split(':').next().unwrap_or(host);
    h.contains("anthropic.com")
        || h.contains("openai.com")
        || h.contains("chatgpt.com")
        || h.contains("deepseek.com")
        || h.contains("groq.com")
        || h.contains("openrouter.ai")
        || h.contains("moonshot.cn")
        || h.contains("generativelanguage.googleapis.com")
}

/// Check if a request should be blocked by any policy rule (sync, block-only).
/// Used in tests; production code uses `evaluate()`.
#[allow(dead_code)]
pub(crate) fn is_blocked(
    request_method: &str,
    request_path: &str,
    request_body: Option<&[u8]>,
    rules: &[PolicyRule],
) -> bool {
    rules.iter().any(|rule| {
        matches!(rule.action, PolicyAction::Block)
            && matches_request(rule, request_method, request_path, request_body)
    })
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn block_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Test block rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::Block,
            conditions_raw: None,
            scope: PolicyScope::Project,
        }
    }

    fn rate_rule(path: &str, method: Option<&str>, max: u64, window: u64) -> PolicyRule {
        PolicyRule {
            name: "Test rate rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::RateLimit {
                rule_id: "test-rule".to_string(),
                max_requests: max,
                window_secs: window,
            },
            conditions_raw: None,
            scope: PolicyScope::Project,
        }
    }

    // ── Scoped rule helpers ──────────────────────────────────────────────

    fn org_block_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Org block rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::Block,
            conditions_raw: None,
            scope: PolicyScope::Organization,
        }
    }

    fn org_allow_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Org allow rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::Allow,
            conditions_raw: None,
            scope: PolicyScope::Organization,
        }
    }

    fn project_approval_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Project approval rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::ManualApproval {
                rule_id: "proj-approval".to_string(),
            },
            conditions_raw: None,
            scope: PolicyScope::Project,
        }
    }

    fn agent_allow_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Agent allow rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::Allow,
            conditions_raw: None,
            scope: PolicyScope::Agent,
        }
    }

    fn agent_rate_rule(path: &str, method: Option<&str>, max: u64, window: u64) -> PolicyRule {
        PolicyRule {
            name: "Agent rate rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::RateLimit {
                rule_id: "agent-rate".to_string(),
                max_requests: max,
                window_secs: window,
            },
            conditions_raw: None,
            scope: PolicyScope::Agent,
        }
    }

    // ── Block tests (existing behavior) ──────────────────────────────────

    #[test]
    fn blocks_exact_path_and_method() {
        let rules = vec![block_rule("/gmail/v1/users/me/messages/send", Some("POST"))];
        assert!(is_blocked(
            "POST",
            "/gmail/v1/users/me/messages/send",
            None,
            &rules
        ));
    }

    #[test]
    fn allows_different_method() {
        let rules = vec![block_rule("/gmail/v1/users/me/messages/send", Some("POST"))];
        assert!(!is_blocked(
            "GET",
            "/gmail/v1/users/me/messages/send",
            None,
            &rules
        ));
    }

    #[test]
    fn allows_different_path() {
        let rules = vec![block_rule("/gmail/v1/users/me/messages/send", Some("POST"))];
        assert!(!is_blocked(
            "POST",
            "/gmail/v1/users/me/messages",
            None,
            &rules
        ));
    }

    #[test]
    fn blocks_all_methods_when_none() {
        let rules = vec![block_rule("/admin/*", None)];
        assert!(is_blocked("GET", "/admin/users", None, &rules));
        assert!(is_blocked("POST", "/admin/users", None, &rules));
        assert!(is_blocked("DELETE", "/admin/settings", None, &rules));
    }

    #[test]
    fn blocks_wildcard_path() {
        let rules = vec![block_rule("/gmail/*", Some("POST"))];
        assert!(is_blocked(
            "POST",
            "/gmail/v1/users/me/messages/send",
            None,
            &rules
        ));
        assert!(!is_blocked("POST", "/calendar/v1/events", None, &rules));
    }

    #[test]
    fn blocks_all_paths() {
        let rules = vec![block_rule("*", Some("DELETE"))];
        assert!(is_blocked("DELETE", "/anything", None, &rules));
        assert!(!is_blocked("GET", "/anything", None, &rules));
    }

    #[test]
    fn method_matching_is_case_insensitive() {
        let rules = vec![block_rule("*", Some("POST"))];
        assert!(is_blocked("post", "/path", None, &rules));
        assert!(is_blocked("Post", "/path", None, &rules));
    }

    #[test]
    fn no_rules_allows_everything() {
        assert!(!is_blocked("POST", "/anything", None, &[]));
    }

    #[test]
    fn blocks_with_default_wildcard_path() {
        let rules = vec![block_rule("*", Some("POST"))];
        assert!(is_blocked("POST", "/any/path/here", None, &rules));
        assert!(is_blocked("POST", "/", None, &rules));
    }

    #[test]
    fn multiple_rules_any_match_blocks() {
        let rules = vec![
            block_rule("/safe/*", Some("GET")),
            block_rule("/danger/*", Some("POST")),
        ];
        assert!(!is_blocked("POST", "/safe/path", None, &rules));
        assert!(is_blocked("POST", "/danger/path", None, &rules));
    }

    // ── Rate limit tests ─────────────────────────────────────────────────

    #[tokio::test]
    async fn rate_limit_allows_under_limit() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![rate_rule("*", Some("POST"), 5, 3600)];
        let decision = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(decision, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn rate_limit_blocks_over_limit() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![rate_rule("*", Some("POST"), 2, 3600)];

        // First 2 requests allowed
        let d1 = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d1, PolicyDecision::Allow));
        let d2 = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d2, PolicyDecision::Allow));

        // Third request rate limited
        let d3 = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d3, PolicyDecision::RateLimited { .. }));
    }

    #[tokio::test]
    async fn rate_limit_per_agent_isolation() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![rate_rule("*", Some("POST"), 1, 3600)];

        // Agent1 hits limit
        evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        let d = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::RateLimited { .. }));

        // Agent2 is unaffected
        let d = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent2", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn block_takes_precedence_over_rate_limit() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![
            block_rule("/danger/*", Some("POST")),
            rate_rule("/danger/*", Some("POST"), 100, 3600),
        ];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/danger/path",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Blocked { .. }));
    }

    #[tokio::test]
    async fn evaluate_allows_non_matching_rules() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![block_rule("/blocked/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "GET",
            "/safe/path",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    // ── Manual approval tests ────────────────────────────────────────

    fn approval_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Test approval rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::ManualApproval {
                rule_id: "test-approval".to_string(),
            },
            conditions_raw: None,
            scope: PolicyScope::Project,
        }
    }

    #[tokio::test]
    async fn manual_approval_matches_path_and_method() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![approval_rule("/send/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/send/email",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::ManualApproval { .. }));
    }

    #[tokio::test]
    async fn manual_approval_no_match_different_method() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![approval_rule("/send/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "GET",
            "/send/email",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn block_takes_precedence_over_manual_approval() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![
            approval_rule("/danger/*", Some("POST")),
            block_rule("/danger/*", Some("POST")),
        ];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/danger/path",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Blocked { .. }));
    }

    #[tokio::test]
    async fn manual_approval_takes_precedence_over_rate_limit() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![
            rate_rule("/v1/*", Some("POST"), 100, 3600),
            approval_rule("/v1/*", Some("POST")),
        ];
        let d = evaluate(
            "org1", "proj1", "POST", "/v1/send", None, &rules, "agent1", &*store, "allow", false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::ManualApproval { .. }));
    }

    // ── Git push discovery tests ────────────────────────────────────

    #[test]
    fn git_push_block_also_blocks_discovery() {
        let rules = vec![block_rule("/*/*/git-receive-pack", Some("POST"))];
        assert!(is_blocked(
            "GET",
            "/owner/repo.git/info/refs?service=git-receive-pack",
            None,
            &rules
        ));
    }

    #[test]
    fn git_push_block_does_not_block_clone_discovery() {
        let rules = vec![block_rule("/*/*/git-receive-pack", Some("POST"))];
        assert!(!is_blocked(
            "GET",
            "/owner/repo.git/info/refs?service=git-upload-pack",
            None,
            &rules
        ));
    }

    #[test]
    fn git_push_block_still_blocks_receive_pack_post() {
        let rules = vec![block_rule("/*/*/git-receive-pack", Some("POST"))];
        assert!(is_blocked(
            "POST",
            "/owner/repo.git/git-receive-pack",
            None,
            &rules
        ));
    }

    // ── Deny-by-default mode tests ──────────────────────────────────

    fn allow_rule(path: &str, method: Option<&str>) -> PolicyRule {
        PolicyRule {
            name: "Test allow rule".to_string(),
            path_pattern: path.to_string(),
            method: method.map(|m| m.to_string()),
            action: PolicyAction::Allow,
            conditions_raw: None,
            scope: PolicyScope::Project,
        }
    }

    #[tokio::test]
    async fn deny_mode_blocks_when_no_allow_rule() {
        let store = crate::cache::create_store().await.unwrap();
        let rules: Vec<PolicyRule> = vec![];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/messages",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::BlockedByDefaultPolicy));
    }

    #[tokio::test]
    async fn deny_mode_allows_with_explicit_allow_rule() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![allow_rule("/api/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/messages",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn deny_mode_block_overrides_allow() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![
            allow_rule("/api/*", Some("POST")),
            block_rule("/api/v1/danger", Some("POST")),
        ];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/danger",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Blocked { .. }));
    }

    #[tokio::test]
    async fn deny_mode_rate_limit_implicit_allow() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![rate_rule("/api/*", Some("POST"), 100, 3600)];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/send",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn deny_mode_manual_approval_implicit_allow() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![approval_rule("/send/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/send/email",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::ManualApproval { .. }));
    }

    #[tokio::test]
    async fn deny_mode_non_matching_allow_still_blocks() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![allow_rule("/api/*", Some("GET"))];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/send",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            true,
        )
        .await;
        assert!(matches!(d, PolicyDecision::BlockedByDefaultPolicy));
    }

    #[tokio::test]
    async fn allow_mode_ignores_allow_rules() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![allow_rule("/api/*", Some("POST"))];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/other/path",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn deny_mode_allows_without_injections() {
        let store = crate::cache::create_store().await.unwrap();
        let rules: Vec<PolicyRule> = vec![];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/v1/messages",
            None,
            &rules,
            "agent1",
            &*store,
            "deny",
            false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    #[tokio::test]
    async fn allow_mode_empty_string_same_as_allow() {
        let store = crate::cache::create_store().await.unwrap();
        let rules: Vec<PolicyRule> = vec![];
        let d = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent1", &*store, "", false,
        )
        .await;
        assert!(matches!(d, PolicyDecision::Allow));
    }

    // ── Strictest-wins cross-scope tests ────────────────────────────
    //
    // These tests verify the strictest-wins doctrine:
    //   global/org sets the FLOOR; project/agent may RAISE controls, never weaken.
    //
    // The applicable rule set is the union of:
    //   (scope=organization AND same org) OR (scope=project AND same project)
    //   OR (agentId = request agent)
    // — assembled by resolve_policy_rules in connect.rs before calling evaluate().
    // Here we pass the pre-merged slice directly to evaluate() to exercise the
    // priority logic in isolation.

    /// org=block, agent=allow -> BLOCK (org floor holds)
    #[tokio::test]
    async fn strictest_wins_org_block_overrides_agent_allow() {
        let store = crate::cache::create_store().await.unwrap();
        // Simulate the merged slice: org-level block + agent-level allow, same path
        let rules = vec![
            org_block_rule("*", Some("POST")),
            agent_allow_rule("*", Some("POST")),
        ];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/send",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::Blocked { .. }),
            "org-level Block must override agent-level Allow"
        );
    }

    /// org=allow(none), project=manual_approval -> MANUAL_APPROVAL
    #[tokio::test]
    async fn strictest_wins_project_raises_floor_above_org_allow() {
        let store = crate::cache::create_store().await.unwrap();
        // Org has an explicit Allow (or no block), project adds ManualApproval — stricter
        let rules = vec![
            org_allow_rule("*", Some("POST")),
            project_approval_rule("*", Some("POST")),
        ];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/send",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::ManualApproval { .. }),
            "project ManualApproval must win over org Allow"
        );
    }

    /// agent-specific rate_limit + project allow -> RATE_LIMIT
    #[tokio::test]
    async fn strictest_wins_agent_rate_limit_over_project_allow() {
        let store = crate::cache::create_store().await.unwrap();
        // Project allows the path, but agent has a (very restrictive) rate-limit of 0
        // so the first hit is allowed but subsequent ones would be rate-limited.
        // Use max=1 so the second call is rate-limited.
        let rules = vec![
            allow_rule("*", Some("POST")),               // project-scope allow
            agent_rate_rule("*", Some("POST"), 1, 3600), // agent-scope rate limit
        ];
        // First call — allowed (under the rate limit)
        let d1 = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/send",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(matches!(d1, PolicyDecision::Allow));
        // Second call — hits rate limit raised by agent scope
        let d2 = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/send",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d2, PolicyDecision::RateLimited { .. }),
            "agent-scope RateLimit must override project-scope Allow"
        );
    }

    /// no applicable rules -> ALLOW (unchanged default)
    #[tokio::test]
    async fn strictest_wins_no_rules_defaults_to_allow() {
        let store = crate::cache::create_store().await.unwrap();
        let rules: Vec<PolicyRule> = vec![];
        let d = evaluate(
            "org1",
            "proj1",
            "POST",
            "/api/send",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::Allow),
            "no applicable rules must default to Allow"
        );
    }

    /// single-scope org-only block still fires (regression guard)
    #[tokio::test]
    async fn strictest_wins_org_only_block_regression() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![org_block_rule("/admin/*", None)];
        let d = evaluate(
            "org1",
            "proj1",
            "DELETE",
            "/admin/settings",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::Blocked { .. }),
            "single-scope org block regression: must still block"
        );
    }

    /// single-scope project-only rate-limit still fires (regression guard)
    #[tokio::test]
    async fn strictest_wins_project_only_rate_limit_regression() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![rate_rule("*", Some("POST"), 1, 3600)];
        evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent-x", &*store, "allow", false,
        )
        .await; // first call, allowed
        let d = evaluate(
            "org1", "proj1", "POST", "/path", None, &rules, "agent-x", &*store, "allow", false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::RateLimited { .. }),
            "single-scope project rate-limit regression: must still rate-limit"
        );
    }

    /// org=block on one path does NOT block a different path (scope boundary)
    #[tokio::test]
    async fn strictest_wins_org_block_does_not_bleed_to_other_paths() {
        let store = crate::cache::create_store().await.unwrap();
        let rules = vec![org_block_rule("/admin/*", None)];
        let d = evaluate(
            "org1",
            "proj1",
            "GET",
            "/api/v1/users",
            None,
            &rules,
            "agent1",
            &*store,
            "allow",
            false,
        )
        .await;
        assert!(
            matches!(d, PolicyDecision::Allow),
            "org block on /admin/* must not affect /api/v1/users"
        );
    }

    // ── LLM host detection tests ────────────────────────────────────

    #[test]
    fn is_llm_host_matches_known_providers() {
        assert!(is_llm_host("api.anthropic.com"));
        assert!(is_llm_host("api.openai.com"));
        assert!(is_llm_host("chatgpt.com"));
        assert!(is_llm_host("api.deepseek.com"));
        assert!(is_llm_host("api.groq.com"));
        assert!(is_llm_host("openrouter.ai"));
        assert!(is_llm_host("api.moonshot.cn"));
        assert!(is_llm_host("generativelanguage.googleapis.com"));
    }

    #[test]
    fn is_llm_host_strips_port() {
        assert!(is_llm_host("api.anthropic.com:443"));
    }

    #[test]
    fn is_llm_host_rejects_non_llm() {
        assert!(!is_llm_host("api.github.com"));
        assert!(!is_llm_host("gmail.googleapis.com"));
        assert!(!is_llm_host("example.com"));
    }
}
