//! Env-driven LLM upstream rewrite.
//!
//! When an operator points the gateway at a local LLM gateway (LiteLLM,
//! OpenRouter-compatible sidecar, etc.) instead of the real Anthropic API,
//! the gateway must rewrite `https://api.anthropic.com/<path>` requests to
//! the local upstream and inject the upstream's own API key. This lets Claude
//! Code keep its stock `ANTHROPIC_BASE_URL=https://api.anthropic.com` config
//! (and the gateway's MITM + policy path) while the actual call lands on
//! LiteLLM with a real key — instead of 401 `credential_not_found` because no
//! Anthropic credential is configured in the vault.
//!
//! Activation (all three required, evaluated per request):
//! - `LLM_UPSTREAM_URL`: base URL of the upstream, e.g. `http://127.0.0.1:47821`
//! - `LLM_UPSTREAM_KEY`: API key the upstream expects
//! - `LLM_UPSTREAM_HOST`: hostname the client connects to that should be
//!   rewritten. Defaults to `api.anthropic.com`.
//!
//! When active and the request host matches, [`LlmUpstream::rewrite`]
//! returns the new scheme + authority + a header injection set. The caller
//! in [`super::forward`] applies them before sending the request upstream,
//! bypassing the "no credential injected → 401 → credential_not_found" path.
//!
//! The upstream key is injected as `x-api-key` (the header LiteLLM and the
//! Anthropic API both accept) and the client's `authorization` header is
//! removed so a stale/dummy token never reaches the upstream.

use hyper::header::HeaderName;
use tracing::info;

use crate::inject::{Injection, InjectionRule};

/// Default client-side host that gets rewritten to the local LLM upstream.
const DEFAULT_LLM_UPSTREAM_HOST: &str = "api.anthropic.com";

/// Resolved LLM-upstream rewrite config, read once per request from env.
///
/// `None` fields mean "not configured"; [`LlmUpstream::disabled`] is the
/// sentinel for "feature off".
#[derive(Debug, Clone)]
pub(crate) struct LlmUpstream {
    /// The client-facing host that triggers a rewrite (e.g. `api.anthropic.com`).
    pub trigger_host: String,
    /// Upstream base URL, parsed into scheme + authority (e.g. `http://127.0.0.1:47821`).
    pub upstream_scheme: String,
    pub upstream_authority: String,
    /// API key injected as `x-api-key` for the rewritten request.
    pub upstream_key: String,
}

/// Result of consulting the LLM-upstream config for a particular request.
#[derive(Debug)]
pub(crate) struct LlmRewrite {
    /// Scheme to use when building the upstream URL (`http` or `https`).
    pub scheme: String,
    /// Authority (host[:port]) to use when building the upstream URL.
    pub authority: String,
    /// Header injections to apply: sets `x-api-key`, removes `authorization`.
    pub injections: Vec<Injection>,
}

impl LlmUpstream {
    /// Read the LLM-upstream config from the environment. Returns `None` when
    /// the feature is not configured (`LLM_UPSTREAM_URL`/`LLM_UPSTREAM_KEY`
    /// unset) so the call site can fall through to normal forwarding.
    pub(crate) fn from_env() -> Option<Self> {
        let upstream_url = std::env::var("LLM_UPSTREAM_URL")
            .ok()
            .filter(|s| !s.is_empty())?;
        let upstream_key = std::env::var("LLM_UPSTREAM_KEY")
            .ok()
            .filter(|s| !s.is_empty())?;
        let trigger_host = std::env::var("LLM_UPSTREAM_HOST")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_LLM_UPSTREAM_HOST.to_string());

        // Parse `<scheme>://<authority>` from the configured URL. We only need
        // scheme + authority here — the request path is supplied per-request.
        let (upstream_scheme, upstream_authority) = parse_scheme_and_authority(&upstream_url)?;

        Some(Self {
            trigger_host,
            upstream_scheme,
            upstream_authority,
            upstream_key,
        })
    }

    /// Returns a rewrite for this request when the host matches the trigger,
    /// otherwise `None` (normal forwarding applies).
    pub(crate) fn rewrite(&self, host: &str) -> Option<LlmRewrite> {
        let request_host = host.split(':').next().unwrap_or(host);
        if request_host != self.trigger_host {
            return None;
        }

        Some(LlmRewrite {
            scheme: self.upstream_scheme.clone(),
            authority: self.upstream_authority.clone(),
            injections: vec![
                Injection::SetHeader {
                    name: "x-api-key".to_string(),
                    value: self.upstream_key.clone(),
                },
                Injection::RemoveHeader {
                    name: "authorization".to_string(),
                },
            ],
        })
    }
}

/// Split `http://127.0.0.1:47821` (or `https://host/path`, with or without a
/// trailing path) into `("http", "127.0.0.1:47821")`. Returns `None` on a URL
/// that doesn't parse as `scheme://authority`.
fn parse_scheme_and_authority(url: &str) -> Option<(String, String)> {
    let scheme_end = url.find("://")?;
    let scheme = url[..scheme_end].to_string();
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+')
    {
        return None;
    }
    let rest = &url[scheme_end + 3..];
    // Authority ends at the first `/`, `?`, or `#`.
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = rest[..authority_end].to_string();
    if authority.is_empty() {
        return None;
    }
    Some((scheme, authority))
}

/// Build the `InjectionRule` wrapper for the rewrite's header injections.
/// The forward path applies rules through `apply_injections`, which expects
/// the `InjectionRule` envelope with a path pattern. `*` matches every path.
pub(crate) fn rewrite_rule(rewrite: &LlmRewrite) -> InjectionRule {
    InjectionRule {
        path_pattern: "*".to_string(),
        injections: rewrite.injections.clone(),
    }
}

/// Log one rewrite activation per request — cheap, and invaluable for proving
/// the gateway actually forwarded to LiteLLM (vs. the real Anthropic host).
pub(crate) fn log_rewrite(host: &str, scheme: &str, authority: &str) {
    info!(
        original_host = %host,
        upstream = %format!("{scheme}://{authority}"),
        "LLM upstream rewrite active — forwarding to local LLM upstream",
    );
}

// Suppress unused-import warning when the inline header-building path uses
// `HeaderName` only under `cfg(test)`. Kept here because future call sites
// that build headers directly (rather than via `InjectionRule`) will need it.
#[allow(dead_code)]
fn _ensure_header_name_linked() -> Option<HeaderName> {
    HeaderName::from_bytes(b"x-api-key").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_scheme_and_authority ─────────────────────────────────────

    #[test]
    fn parses_http_loopback_with_port() {
        let (s, a) = parse_scheme_and_authority("http://127.0.0.1:47821").unwrap();
        assert_eq!(s, "http");
        assert_eq!(a, "127.0.0.1:47821");
    }

    #[test]
    fn parses_https_with_trailing_path() {
        let (s, a) =
            parse_scheme_and_authority("https://litellm.example.internal:8443/v1/").unwrap();
        assert_eq!(s, "https");
        assert_eq!(a, "litellm.example.internal:8443");
    }

    #[test]
    fn parses_url_with_query_and_fragment() {
        let (s, a) = parse_scheme_and_authority("http://127.0.0.1:47821?x=1#/frag").unwrap();
        assert_eq!(s, "http");
        assert_eq!(a, "127.0.0.1:47821");
    }

    #[test]
    fn rejects_missing_scheme() {
        assert!(parse_scheme_and_authority("127.0.0.1:47821").is_none());
    }

    #[test]
    fn rejects_empty_authority() {
        assert!(parse_scheme_and_authority("http:///path").is_none());
    }

    // ── LlmUpstream::rewrite ──────────────────────────────────────────

    fn upstream(trigger: &str, url: &str, key: &str) -> LlmUpstream {
        let (scheme, authority) = parse_scheme_and_authority(url).unwrap();
        LlmUpstream {
            trigger_host: trigger.to_string(),
            upstream_scheme: scheme,
            upstream_authority: authority,
            upstream_key: key.to_string(),
        }
    }

    #[test]
    fn rewrite_matches_trigger_host() {
        let u = upstream("api.anthropic.com", "http://127.0.0.1:47821", "sk-lit");
        let r = u.rewrite("api.anthropic.com").expect("matches");
        assert_eq!(r.scheme, "http");
        assert_eq!(r.authority, "127.0.0.1:47821");
        assert_eq!(r.injections.len(), 2);
    }

    #[test]
    fn rewrite_matches_trigger_host_with_port() {
        let u = upstream("api.anthropic.com", "http://127.0.0.1:47821", "sk-lit");
        assert!(u.rewrite("api.anthropic.com:443").is_some());
    }

    #[test]
    fn rewrite_skips_non_trigger_host() {
        let u = upstream("api.anthropic.com", "http://127.0.0.1:47821", "sk-lit");
        // graph.microsoft.com must NOT be rewritten — the manual_approval demo depends on it.
        assert!(u.rewrite("graph.microsoft.com").is_none());
        assert!(u.rewrite("api.openai.com").is_none());
    }

    #[test]
    fn rewrite_injects_x_api_key_and_removes_authorization() {
        let u = upstream("api.anthropic.com", "http://127.0.0.1:47821", "sk-lit-xyz");
        let r = u.rewrite("api.anthropic.com").unwrap();
        assert_eq!(
            r.injections[0],
            Injection::SetHeader {
                name: "x-api-key".to_string(),
                value: "sk-lit-xyz".to_string(),
            }
        );
        assert_eq!(
            r.injections[1],
            Injection::RemoveHeader {
                name: "authorization".to_string(),
            }
        );
    }

    #[test]
    fn rewrite_rule_envelope_matches_any_path() {
        let u = upstream("api.anthropic.com", "http://127.0.0.1:47821", "sk-lit");
        let r = u.rewrite("api.anthropic.com").unwrap();
        let rule = rewrite_rule(&r);
        assert_eq!(rule.path_pattern, "*");
        assert_eq!(rule.injections.len(), 2);
        // The * pattern must match a real /v1/messages path.
        assert!(crate::inject::path_matches(
            "/v1/messages",
            &rule.path_pattern
        ));
    }

    // ── from_env (feature-flag semantics) ─────────────────────────────

    // NOTE: env-var reads are process-global, so we don't assert the positive
    // path here (tests run in parallel and would race on LLM_UPSTREAM_URL).
    // We only assert the safe default: with the vars unset in this process,
    // from_env() returns None.

    #[test]
    fn from_env_returns_none_when_unset() {
        // Only safe to assert when the operator hasn't configured the feature
        // in this test process.
        if std::env::var("LLM_UPSTREAM_URL").is_ok() && std::env::var("LLM_UPSTREAM_KEY").is_ok() {
            return; // configured in this process — can't assert None
        }
        assert!(LlmUpstream::from_env().is_none());
    }
}
