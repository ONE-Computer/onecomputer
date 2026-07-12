//! Prometheus metrics for the Agent Trust Gateway.
//!
//! Emits `agent_trust_gateway_*` series (matching the TGW reference naming):
//! - `agent_trust_gateway_requests_total{method,status_class}` — every proxied
//!   request, classified by response status family ("2xx".."5xx") or gateway
//!   outcome ("blocked" for policy denials, "error" for forwarding failures).
//! - `agent_trust_gateway_requests_blocked_total{rule_name}` — policy-blocked
//!   requests, labeled with the offending rule name.
//! - `agent_trust_gateway_request_duration_seconds{method}` — upstream round-trip
//!   latency histogram (default buckets).
//! - `agent_trust_gateway_active_connections` — gauge of live MITM/tunnel
//!   sessions, incremented at CONNECT accept and decremented at drop.
//! - `agent_trust_gateway_injections_total{provider}` — credential injections
//!   applied to forwarded requests, labeled by upstream provider.
//!
//! All metrics are registered with the process-default Prometheus registry so
//! that the `process` collector series (`process_cpu_seconds_total`, etc.) are
//! gathered alongside them on the `/metrics` scrape.

use once_cell::sync::Lazy;
use prometheus::{
    default_registry, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};

/// Prefix applied to every metric name emitted by this gateway.
const METRIC_PREFIX: &str = "agent_trust_gateway_";

// ── Metric definitions (registered with the default registry) ────────────

/// Total proxied requests, labeled by HTTP method and status class.
///
/// `status_class` is one of `2xx`, `3xx`, `4xx`, `5xx` (from the upstream
/// response), `blocked` (policy denial served by the gateway), or `error`
/// (upstream forwarding failure).
static REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            format!("{METRIC_PREFIX}requests_total"),
            "Total proxied requests by method and status class.",
        ),
        &["method", "status_class"],
    )
    .expect("requests_total metric opts are valid");
    default_registry()
        .register(Box::new(counter.clone()))
        .expect("registering requests_total");
    counter
});

/// Policy-blocked requests, labeled by the rule name that denied them.
static REQUESTS_BLOCKED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            format!("{METRIC_PREFIX}requests_blocked_total"),
            "Requests blocked by policy rules, by rule name.",
        ),
        &["rule_name"],
    )
    .expect("requests_blocked_total metric opts are valid");
    default_registry()
        .register(Box::new(counter.clone()))
        .expect("registering requests_blocked_total");
    counter
});

/// Upstream round-trip latency histogram, labeled by HTTP method.
static REQUEST_DURATION_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    let hist = HistogramVec::new(
        prometheus::HistogramOpts::new(
            format!("{METRIC_PREFIX}request_duration_seconds"),
            "Upstream request duration in seconds, by method.",
        ),
        &["method"],
    )
    .expect("request_duration_seconds metric opts are valid");
    default_registry()
        .register(Box::new(hist.clone()))
        .expect("registering request_duration_seconds");
    hist
});

/// Live MITM/tunnel sessions (incremented at CONNECT accept, decremented at drop).
#[allow(dead_code)]
static ACTIVE_CONNECTIONS: Lazy<IntGauge> = Lazy::new(|| {
    let gauge = IntGauge::with_opts(Opts::new(
        format!("{METRIC_PREFIX}active_connections"),
        "Active gateway proxy connections (MITM + tunnel).",
    ))
    .expect("active_connections metric opts are valid");
    default_registry()
        .register(Box::new(gauge.clone()))
        .expect("registering active_connections");
    gauge
});

/// Credential injections applied to forwarded requests, labeled by provider.
static INJECTIONS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            format!("{METRIC_PREFIX}injections_total"),
            "Credential injections applied to proxied requests, by provider.",
        ),
        &["provider"],
    )
    .expect("injections_total metric opts are valid");
    default_registry()
        .register(Box::new(counter.clone()))
        .expect("registering injections_total");
    counter
});

// ── Recording helpers ────────────────────────────────────────────────────

/// Map a numeric HTTP status code to a coarse status-class label.
fn status_class(status: u16) -> &'static str {
    match status {
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        500..=599 => "5xx",
        // Gateway-served policy denials use 403, but callers that pass a
        // synthetic sentinel (e.g. 0) map to "blocked"/"error" directly.
        _ => "error",
    }
}

/// Record a completed proxied request.
///
/// `status` is the HTTP status returned to the client (upstream status or a
/// gateway-served denial). `duration_secs` is the wall-clock round-trip.
pub(crate) fn record_request(method: &str, status: u16, duration_secs: f64) {
    let class = status_class(status);
    REQUESTS_TOTAL.with_label_values(&[method, class]).inc();
    REQUEST_DURATION_SECONDS
        .with_label_values(&[method])
        .observe(duration_secs);
}

/// Record a request blocked by a policy rule (counts separately from
/// `record_request`'s status-class counter).
pub(crate) fn record_blocked(rule_name: &str) {
    REQUESTS_BLOCKED_TOTAL.with_label_values(&[rule_name]).inc();
}

/// Record that a credential injection was applied for the given provider.
pub(crate) fn record_injection(provider: &str) {
    INJECTIONS_TOTAL.with_label_values(&[provider]).inc();
}

/// Increment the active-connections gauge (call at CONNECT accept).
#[allow(dead_code)]
pub(crate) fn connection_opened() {
    ACTIVE_CONNECTIONS.inc();
}

/// Decrement the active-connections gauge (call at connection drop).
#[allow(dead_code)]
pub(crate) fn connection_closed() {
    ACTIVE_CONNECTIONS.dec();
}

/// Render all registered metrics in Prometheus text exposition format.
///
/// Gathers from the process-default registry so the bundled `process`
/// collector series are included alongside the `agent_trust_gateway_*` ones.
pub(crate) fn render_metrics() -> String {
    let encoder = TextEncoder::new();
    encoder
        .encode_to_string(&default_registry().gather())
        .unwrap_or_else(|e| format!("# encode error: {e}"))
}

// Re-export `Registry` so callers (or tests) can reference the default
// registry type without importing `prometheus` directly.
#[allow(dead_code)]
fn _registry_type_anchor() -> Registry {
    Registry::new()
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh provider label per test run keeps the `injections_total` counter
    /// for this test isolated from other tests sharing the default registry.
    fn unique_provider() -> String {
        format!("test_provider_{}", std::process::id())
    }

    #[test]
    fn record_increments_counter() {
        let before = REQUESTS_TOTAL
            .with_label_values(&["GET_TEST_REC", "2xx"])
            .get();
        record_request("GET_TEST_REC", 200, 0.0123);
        let after = REQUESTS_TOTAL
            .with_label_values(&["GET_TEST_REC", "2xx"])
            .get();
        assert!(
            after > before,
            "record_request must increment the requests_total counter (before={before}, after={after})"
        );
    }

    #[test]
    fn blocked_counter() {
        // Unique rule name so this test is independent of execution order
        // against the shared default registry.
        let rule = format!("test_rule_{}", std::process::id());
        let before = REQUESTS_BLOCKED_TOTAL.with_label_values(&[&rule]).get();
        record_blocked(&rule);
        let after = REQUESTS_BLOCKED_TOTAL.with_label_values(&[&rule]).get();
        assert_eq!(
            after,
            before + 1,
            "record_blocked must increment the blocked counter by exactly 1"
        );
    }

    #[test]
    fn render_contains_prefix() {
        // Touch a metric so the Lazy statics initialize and register with the
        // default registry before gathering; otherwise nothing is gathered.
        record_request("GET_TEST_RENDER", 200, 0.0);
        let rendered = render_metrics();
        assert!(
            rendered.contains(METRIC_PREFIX),
            "rendered metrics must contain the agent_trust_gateway_ prefix; got:\n{rendered}"
        );
    }

    #[test]
    fn connection_gauge() {
        // Snapshot the gauge, open a connection, close it, and assert it
        // returns to the snapshot value (net zero change).
        let before = ACTIVE_CONNECTIONS.get();
        connection_opened();
        let opened = ACTIVE_CONNECTIONS.get();
        assert_eq!(
            opened,
            before + 1,
            "connection_opened must increment the active_connections gauge"
        );
        connection_closed();
        let closed = ACTIVE_CONNECTIONS.get();
        assert_eq!(
            closed, before,
            "connection_closed must decrement the gauge back to its pre-open value"
        );
    }

    #[test]
    fn record_injection_increments_counter() {
        let provider = unique_provider();
        let before = INJECTIONS_TOTAL.with_label_values(&[&provider]).get();
        record_injection(&provider);
        let after = INJECTIONS_TOTAL.with_label_values(&[&provider]).get();
        assert_eq!(
            after,
            before + 1,
            "record_injection must increment the injections_total counter"
        );
    }
}
