//! DLP (Data Loss Prevention) scan via Microsoft Presidio.
//!
//! When the gateway forwards a request to the LLM upstream (LiteLLM), it first
//! scans the request body for PII / sensitive data using the Presidio analyzer
//! service (`PRESIDIO_ANALYZER_URL`). Findings are logged as structured alerts
//! (and surfaced via the audit/timeline pipeline). If `DLP_REDACT=true`, PII is
//! redacted via the Presidio anonymizer before the body reaches the upstream.
//!
//! Inert when `PRESIDIO_ANALYZER_URL` is unset (the dev default) — no behavior
//! change for existing flows.

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

const DEFAULT_DLP_REDACT: bool = false;

/// A single PII finding from the Presidio analyzer.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DlpFinding {
    #[serde(rename = "entity_type")]
    pub entity_type: String,
    pub start: usize,
    pub end: usize,
    pub score: f64,
}

/// The analyzer request body.
#[derive(Serialize)]
struct AnalyzeRequest<'a> {
    text: &'a str,
    language: &'a str,
}

/// Scan text for PII via the Presidio analyzer. Returns the findings (empty if
/// the analyzer is unreachable or not configured).
pub async fn scan(text: &str) -> Vec<DlpFinding> {
    let analyzer_url = match std::env::var("PRESIDIO_ANALYZER_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => return Vec::new(), // not configured — inert
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "DLP: failed to build HTTP client");
            return Vec::new();
        }
    };

    let endpoint = format!("{}/analyze", analyzer_url.trim_end_matches('/'));
    let body = AnalyzeRequest {
        text,
        language: "en",
    };

    match client.post(&endpoint).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<Vec<DlpFinding>>().await {
            Ok(findings) => findings,
            Err(e) => {
                warn!(error = %e, "DLP: failed to parse analyzer response");
                Vec::new()
            }
        },
        Ok(resp) => {
            warn!(status = %resp.status(), "DLP: analyzer returned non-2xx");
            Vec::new()
        }
        Err(e) => {
            warn!(error = %e, "DLP: analyzer unreachable (inert)");
            Vec::new()
        }
    }
}

/// Redact PII from text via the Presidio anonymizer. Falls back to a simple
/// mask (`[REDACTED:<type>]`) if the anonymizer is unreachable.
pub async fn redact(text: &str, findings: &[DlpFinding]) -> String {
    let anonymizer_url = std::env::var("PRESIDIO_ANONYMIZER_URL").ok();
    let redact = std::env::var("DLP_REDACT")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(DEFAULT_DLP_REDACT);

    if !redact || findings.is_empty() {
        return text.to_string();
    }

    // Build a per-entity-type anonymizer config (replace with a typed placeholder).
    let mut anonymizers = serde_json::Map::new();
    let mut types: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for f in findings {
        if types.insert(f.entity_type.as_str()) {
            anonymizers.insert(
                f.entity_type.clone(),
                serde_json::json!({
                    "type": "replace",
                    "new_value": format!("[REDACTED:{}]", f.entity_type)
                }),
            );
        }
    }

    // Try the Presidio anonymizer service first.
    if let Some(url) = anonymizer_url.filter(|u| !u.is_empty()) {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
        {
            Ok(c) => c,
            Err(_) => return fallback_mask(text, findings),
        };
        let endpoint = format!("{}/anonymize", url.trim_end_matches('/'));
        // The anonymizer expects analyzer results inline.
        let results: Vec<serde_json::Value> = findings
            .iter()
            .map(|f| {
                serde_json::json!({
                    "start": f.start,
                    "end": f.end,
                    "score": f.score,
                    "entity_type": f.entity_type,
                })
            })
            .collect();
        let body = serde_json::json!({
            "text": text,
            "anonymizers": anonymizers,
            "analyzer_results": results,
            "language": "en",
        });
        match client.post(&endpoint).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                #[derive(Deserialize)]
                struct AnonResp {
                    text: String,
                }
                if let Ok(AnonResp { text }) = resp.json::<AnonResp>().await {
                    return text;
                }
            }
            _ => {}
        }
    }

    fallback_mask(text, findings)
}

/// Fallback: mask PII spans in-place (no external call).
fn fallback_mask(text: &str, findings: &[DlpFinding]) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    // Convert byte offsets from Presidio to char offsets (best-effort: Presidio
    // returns byte offsets; for ASCII-heavy prompts this is 1:1).
    for f in findings.iter().rev() {
        let start = f.start.min(chars.len());
        let end = f.end.min(chars.len());
        if end > start {
            let mask = format!("[REDACTED:{}]", f.entity_type);
            chars.splice(start..end, mask.chars());
        }
    }
    chars.into_iter().collect()
}

/// Scan + (optionally) redact a request body. Returns the (possibly redacted)
/// body + the findings (for logging/audit). Best-effort: never blocks the
/// request on DLP failure.
pub async fn scan_and_redact(body: &str) -> (String, Vec<DlpFinding>) {
    let findings = scan(body).await;
    if findings.is_empty() {
        return (body.to_string(), Vec::new());
    }
    let entity_types: Vec<&str> = findings.iter().map(|f| f.entity_type.as_str()).collect();
    info!(
        count = findings.len(),
        types = ?entity_types,
        "DLP: PII detected in outbound request"
    );
    let redacted = redact(body, &findings).await;
    (redacted, findings)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlpAlertBody {
    pub organization_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_log_id: Option<String>,
    pub source: String,
    pub direction: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    pub action: String,
    pub risk_level: String,
    pub entity_types: Vec<serde_json::Value>,
    pub finding_count: usize,
    pub redacted: bool,
    pub blocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

pub fn risk_level(findings: &[DlpFinding]) -> String {
    let mut risk = "low";
    for f in findings {
        match f.entity_type.as_str() {
            "AWS_ACCESS_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "PRIVATE_KEY" | "JWT" => {
                return "critical".to_string()
            }
            "US_SSN" | "CREDIT_CARD" | "IBAN_CODE" | "US_BANK_NUMBER" => risk = "high",
            "PHONE_NUMBER" | "EMAIL_ADDRESS" | "URL" if risk == "low" => risk = "medium",
            _ => {}
        }
    }
    risk.to_string()
}

pub fn findings_json(findings: &[DlpFinding]) -> Vec<serde_json::Value> {
    let mut counts: std::collections::BTreeMap<String, (usize, f64)> =
        std::collections::BTreeMap::new();
    for f in findings {
        let e = counts.entry(f.entity_type.clone()).or_insert((0, 0.0));
        e.0 += 1;
        if f.score > e.1 {
            e.1 = f.score;
        }
    }
    counts
        .into_iter()
        .map(|(entity_type, (count, max_score))| {
            serde_json::json!({
                "type": entity_type,
                "count": count,
                "maxScore": max_score
            })
        })
        .collect()
}

pub fn sha256_hex(text: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, text.as_bytes());
    hex::encode(digest.as_ref())
}

pub async fn notify_api(http_client: &reqwest::Client, body: &DlpAlertBody) {
    let base = super::approval_notify::api_base_url();
    let url = format!("{base}/v1/internal/dlp-alerts");
    let secret = super::approval_notify::internal_secret_value();
    match http_client
        .post(&url)
        .header("X-Gateway-Secret", secret)
        .json(body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(
                status = resp.status().as_u16(),
                "DLP alert persisted via internal API"
            );
        }
        Ok(resp) => {
            tracing::warn!(status = resp.status().as_u16(), url = %url, "internal API returned error for DLP alert");
        }
        Err(e) => {
            tracing::warn!(error = %e, url = %url, "failed to POST DLP alert to internal API");
        }
    }
}
