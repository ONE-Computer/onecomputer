//! Channel routing abstraction.
//!
//! A [`Channel`] maps an inbound path prefix (e.g. `/agents/sharepoint`) to a
//! named connector with a protocol (MCP, A2A, REST). This lets policy rules
//! reference channel names and enables per-channel auth (Phase 3 VP injection).
//!
//! The registry is loaded once at startup from the `ONECLI_CHANNELS` env var
//! (a JSON array of [`Channel`] objects) and shared across the request pipeline
//! as `Arc<ChannelRegistry>`. Inside [`forward::forward_request`] the registry
//! is consulted via [`ChannelRegistry::match_path`] to stamp the response with
//! `x-onecli-channel-id` / `x-onecli-channel-name` headers and to flag MCP
//! channels for body buffering (consumed by G2).

use serde::Deserialize;

/// Protocol spoken by the upstream connector a channel points at.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChannelProtocol {
    Mcp,
    A2a,
    Rest,
}

/// A named route from an inbound path prefix to an upstream connector.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub(crate) struct Channel {
    pub id: String,
    pub name: String,
    /// Inbound path prefix, e.g. `/agents/sharepoint`.
    pub route_prefix: String,
    /// Upstream endpoint the channel forwards to.
    pub target_endpoint: String,
    /// Protocol of the upstream connector.
    pub protocol: ChannelProtocol,
}

/// In-memory table of channels, consulted on every proxied request.
#[derive(Debug, Default)]
pub(crate) struct ChannelRegistry {
    pub channels: Vec<Channel>,
}

impl ChannelRegistry {
    /// Load from the `ONECLI_CHANNELS` env var (JSON array). Empty registry if unset.
    pub fn from_env() -> Self {
        match std::env::var("ONECLI_CHANNELS") {
            Ok(raw) if !raw.trim().is_empty() => match serde_json::from_str::<Vec<Channel>>(&raw) {
                Ok(channels) => Self { channels },
                Err(e) => {
                    tracing::warn!(error = %e, "ONECLI_CHANNELS parse failed — starting with empty channel registry");
                    Self::default()
                }
            },
            _ => Self::default(),
        }
    }

    /// Return the first channel whose `route_prefix` is a path-segment prefix
    /// of `path`. A prefix matches when `path` equals the prefix or continues
    /// with a `/` boundary, so `/agents/sharepoint` does NOT match
    /// `/agents/sharepointother`.
    pub fn match_path(&self, path: &str) -> Option<&Channel> {
        let path = path.split('?').next().unwrap_or(path);
        self.channels
            .iter()
            .find(|ch| is_prefix_match(path, &ch.route_prefix))
    }
}

/// True when `prefix` is a path-segment prefix of `path`.
///
/// `/agents/sharepoint` matches `/agents/sharepoint` and `/agents/sharepoint/list`
/// but not `/agents/sharepointother`.
fn is_prefix_match(path: &str, prefix: &str) -> bool {
    if path == prefix {
        return true;
    }
    if !path.starts_with(prefix) {
        return false;
    }
    // The byte immediately after the prefix must be a path separator so that
    // `/agents/sharepoint` doesn't match `/agents/sharepointother`.
    path.as_bytes().get(prefix.len()) == Some(&b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sp_channel() -> Channel {
        Channel {
            id: "sp-1".to_string(),
            name: "sharepoint".to_string(),
            route_prefix: "/agents/sharepoint".to_string(),
            target_endpoint: "https://sharepoint.temasek.internal/mcp".to_string(),
            protocol: ChannelProtocol::Mcp,
        }
    }

    #[test]
    fn match_prefix() {
        let reg = ChannelRegistry {
            channels: vec![sp_channel()],
        };
        let ch = reg
            .match_path("/agents/sharepoint/list")
            .expect("prefix should match");
        assert_eq!(ch.id, "sp-1");
        assert_eq!(ch.name, "sharepoint");
    }

    #[test]
    fn no_match() {
        let reg = ChannelRegistry {
            channels: vec![sp_channel()],
        };
        assert!(reg.match_path("/other/path").is_none());
    }

    #[test]
    fn empty_registry_no_match() {
        let reg = ChannelRegistry::default();
        assert!(reg.match_path("/agents/sharepoint/list").is_none());
    }

    #[test]
    fn from_env_empty_when_unset() {
        // Ensure the env var is unset for this test's process. `cargo test` runs
        // each process serially in the same crate, but env mutation is process-
        // global; we remove then restore a saved value if present.
        let saved = std::env::var("ONECLI_CHANNELS").ok();
        std::env::remove_var("ONECLI_CHANNELS");
        let reg = ChannelRegistry::from_env();
        assert!(reg.channels.is_empty());
        // Restore so other tests are unaffected.
        if let Some(v) = saved {
            std::env::set_var("ONECLI_CHANNELS", v);
        }
    }

    #[test]
    fn protocol_deserializes() {
        let json = r#"[
            {"id":"a","name":"a","route_prefix":"/a","target_endpoint":"https://a","protocol":"mcp"},
            {"id":"b","name":"b","route_prefix":"/b","target_endpoint":"https://b","protocol":"a2a"},
            {"id":"c","name":"c","route_prefix":"/c","target_endpoint":"https://c","protocol":"rest"}
        ]"#;
        let channels: Vec<Channel> = serde_json::from_str(json).expect("valid JSON");
        assert_eq!(channels.len(), 3);
        assert_eq!(channels[0].protocol, ChannelProtocol::Mcp);
        assert_eq!(channels[1].protocol, ChannelProtocol::A2a);
        assert_eq!(channels[2].protocol, ChannelProtocol::Rest);
    }

    // ── extra edge cases guarding against false prefix matches ───────────

    #[test]
    fn exact_prefix_matches() {
        let reg = ChannelRegistry {
            channels: vec![sp_channel()],
        };
        assert!(reg.match_path("/agents/sharepoint").is_some());
    }

    #[test]
    fn prefix_does_not_match_neighbor() {
        let reg = ChannelRegistry {
            channels: vec![sp_channel()],
        };
        // `/agents/sharepointother` shares a raw string prefix but is a
        // distinct path segment — must NOT match.
        assert!(reg.match_path("/agents/sharepointother").is_none());
    }

    #[test]
    fn match_ignores_query_string() {
        let reg = ChannelRegistry {
            channels: vec![sp_channel()],
        };
        assert!(reg
            .match_path("/agents/sharepoint/list?tool=search")
            .is_some());
    }

    #[test]
    fn first_matching_channel_wins() {
        let reg = ChannelRegistry {
            channels: vec![
                Channel {
                    id: "first".to_string(),
                    name: "first".to_string(),
                    route_prefix: "/agents".to_string(),
                    target_endpoint: "https://first".to_string(),
                    protocol: ChannelProtocol::Rest,
                },
                sp_channel(),
            ],
        };
        let ch = reg.match_path("/agents/sharepoint/list").expect("match");
        assert_eq!(ch.id, "first", "first matching channel in order wins");
    }
}
