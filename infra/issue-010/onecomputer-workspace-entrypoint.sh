#!/usr/bin/env bash
set -euo pipefail

: "${ONECOMPUTER_ENABLED_AGENTS:=claude-desktop}"
: "${ONECOMPUTER_CLIPBOARD_ENABLED:=true}"
: "${ONECOMPUTER_CLIPBOARD_LOCAL_TO_WORKSPACE:=true}"
: "${ONECOMPUTER_CLIPBOARD_WORKSPACE_TO_LOCAL:=true}"
: "${ONECOMPUTER_CLIPBOARD_MAX_BYTES:=65536}"

claude_code_version="2.1.215"
claude_code_checksum="7ff9594e53cd89d1af9ceb3c18d3d70be1a5c6d27475e31ee2bed65d748f18c0"
claude_code_source="/opt/onecomputer/claude-code/${claude_code_version}/claude"
claude_code_dir="/home/kasm-user/.config/Claude-3p/claude-code/${claude_code_version}"
claude_code_binary="${claude_code_dir}/claude"
claude_code_marker="${claude_code_dir}/.verified"

agent_enabled() {
  [[ ",${ONECOMPUTER_ENABLED_AGENTS}," == *",$1,"* ]]
}

IFS=',' read -r -a enabled_agents <<< "$ONECOMPUTER_ENABLED_AGENTS"
(( ${#enabled_agents[@]} >= 1 && ${#enabled_agents[@]} <= 2 )) || {
  echo "invalid agent selection" >&2
  exit 78
}
for enabled_agent in "${enabled_agents[@]}"; do
  [[ "$enabled_agent" == "claude-desktop" || "$enabled_agent" == "hermes-claw" ]] || {
    echo "unrecognized agent selection" >&2
    exit 78
  }
done
[[ "$(printf '%s\n' "${enabled_agents[@]}" | sort -u | wc -l)" -eq "${#enabled_agents[@]}" ]] || {
  echo "duplicate agent selection" >&2
  exit 78
}

if agent_enabled claude-desktop; then
  : "${ONECOMPUTER_GATEWAY_UPSTREAM:?Claude gateway upstream is required}"
  : "${ONECOMPUTER_GATEWAY_CREDENTIAL:?Claude gateway credential is required}"
  : "${ONECOMPUTER_MODEL_ALIAS:?Claude model alias is required}"
  : "${ONECOMPUTER_CONTROL_UPSTREAM:?Claude control bridge upstream is required}"
  : "${ONECOMPUTER_AGENT_BRIDGE_TOKEN:?Claude control bridge token is required}"
  : "${ONECOMPUTER_ALLOWED_TOOLS:?Claude Microsoft 365 tools are required}"
fi
if agent_enabled hermes-claw; then
  : "${ONECOMPUTER_HERMES_GATEWAY_UPSTREAM:?Hermes gateway upstream is required}"
  : "${ONECOMPUTER_HERMES_GATEWAY_CREDENTIAL:?Hermes gateway credential is required}"
  : "${ONECOMPUTER_HERMES_MODEL_ALIAS:?Hermes model alias is required}"
  : "${ONECOMPUTER_HERMES_CONTROL_UPSTREAM:?Hermes control bridge upstream is required}"
  : "${ONECOMPUTER_HERMES_AGENT_BRIDGE_TOKEN:?Hermes control bridge token is required}"
  : "${ONECOMPUTER_HERMES_ALLOWED_TOOLS:?Hermes Microsoft 365 tools are required}"
fi

for clipboard_boolean in \
  "$ONECOMPUTER_CLIPBOARD_ENABLED" \
  "$ONECOMPUTER_CLIPBOARD_LOCAL_TO_WORKSPACE" \
  "$ONECOMPUTER_CLIPBOARD_WORKSPACE_TO_LOCAL"; do
  [[ "$clipboard_boolean" == "true" || "$clipboard_boolean" == "false" ]] || {
    echo "invalid clipboard policy boolean" >&2
    exit 78
  }
done
[[ "$ONECOMPUTER_CLIPBOARD_MAX_BYTES" =~ ^[0-9]+$ ]] \
  && ((ONECOMPUTER_CLIPBOARD_MAX_BYTES >= 1 && ONECOMPUTER_CLIPBOARD_MAX_BYTES <= 1048576)) || {
    echo "invalid clipboard size policy" >&2
    exit 78
  }

clipboard_local_to_workspace="$ONECOMPUTER_CLIPBOARD_LOCAL_TO_WORKSPACE"
clipboard_workspace_to_local="$ONECOMPUTER_CLIPBOARD_WORKSPACE_TO_LOCAL"
if [[ "$ONECOMPUTER_CLIPBOARD_ENABLED" != "true" ]]; then
  clipboard_local_to_workspace=false
  clipboard_workspace_to_local=false
fi

if agent_enabled claude-desktop; then
  case "$ONECOMPUTER_MODEL_ALIAS" in
    onecomputer-claude|claude-sonnet-4-6) model_label="Claude — organization route" ;;
    onecomputer-openai|claude-opus-4-6) model_label="OpenAI — organization route" ;;
    onecomputer-glm|claude-sonnet-4-5) model_label="GLM — organization route" ;;
    onecomputer-assistant) model_label="Standard organization route" ;;
    *) echo "unrecognized Claude model assignment" >&2; exit 78 ;;
  esac
fi

install -d -o root -g root -m 0755 /etc/claude-desktop /run/onecomputer
python3 - \
  "$clipboard_local_to_workspace" \
  "$clipboard_workspace_to_local" \
  "$ONECOMPUTER_CLIPBOARD_MAX_BYTES" <<'PY'
import os
import sys

local_to_workspace, workspace_to_local, max_bytes = sys.argv[1:]
document = f"""network:
  ssl:
    pem_certificate: ${{HOME}}/.vnc/self.pem
    pem_key: ${{HOME}}/.vnc/self.pem
  udp:
    public_ip: 127.0.0.1
runtime_configuration:
  allow_override_standard_vnc_server_settings: true
  allow_override_list:
    - pointer.enabled
data_loss_prevention:
  logging:
    level: off
  clipboard:
    delay_between_operations: none
    allow_mimetypes:
      - text/plain
    server_to_client:
      enabled: {workspace_to_local}
      size: {max_bytes}
      primary_clipboard_enabled: false
    client_to_server:
      enabled: {local_to_workspace}
      size: {max_bytes}
"""
path = "/etc/kasmvnc/kasmvnc.yaml"
with open(path, "w", encoding="utf-8") as output:
    output.write(document)
os.chmod(path, 0o644)
os.chown(path, 0, 0)
PY
if agent_enabled claude-desktop; then
python3 - "$ONECOMPUTER_MODEL_ALIAS" "$model_label" "$ONECOMPUTER_ALLOWED_TOOLS" <<'PY'
import json
import os
import sys

model, label, allowed_tools = sys.argv[1:]
tools = [item for item in allowed_tools.split(",") if item]
tool_policy = {tool: "allow" for tool in tools}
tool_policy["wait-for-governed-operation"] = "allow"
document = {
    "inferenceProvider": "gateway",
    "inferenceGatewayBaseUrl": "http://127.0.0.1:4312",
    "inferenceGatewayApiKey": "onecomputer-loopback-broker",
    "inferenceGatewayAuthScheme": "bearer",
    "modelDiscoveryEnabled": False,
    "inferenceModels": [{
        "name": model,
        "labelOverride": label,
        "anthropicFamilyTier": "sonnet",
        "isFamilyDefault": True,
    }],
    "disableDeploymentModeChooser": True,
    "disableDeepLinkRegistration": True,
    "chatTabEnabled": True,
    "chatAdvancedFileAnalysisEnabled": False,
    "isClaudeCodeForDesktopEnabled": False,
    "coworkTabEnabled": False,
    "disableBundledSkills": True,
    "autoModeEnabled": False,
    "toolSearchEnabled": False,
    "managedMcpServers": [{
        "name": "Microsoft 365 through ONEComputer",
        "transport": "stdio",
        "command": "/usr/local/libexec/onecomputer-mcp-stdio",
        "args": [],
        # Desktop's local prompt layer is pre-approved. ONEComputer Control is
        # the authoritative allow / signed-approval / deny policy boundary.
        "toolPolicy": tool_policy,
    }],
    "isLocalDevMcpEnabled": False,
    "isDesktopExtensionEnabled": False,
}
path = "/etc/claude-desktop/managed-settings.json"
with open(path, "w", encoding="utf-8") as output:
    json.dump(document, output, separators=(",", ":"))
    output.write("\n")
os.chmod(path, 0o644)
os.chown(path, 0, 0)
PY
fi

install -d -o 1000 -g 1000 -m 0755 /home/kasm-user/.config/autostart /home/kasm-user/Desktop
rm -f /home/kasm-user/.config/autostart/claude-desktop.desktop \
  /home/kasm-user/Desktop/Claude-Desktop.desktop \
  /home/kasm-user/Desktop/Hermes-Claw.desktop
if agent_enabled claude-desktop; then
  chmod 0755 "$(command -v claude-desktop)"
  install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-claude-desktop.desktop /home/kasm-user/.config/autostart/claude-desktop.desktop
  install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-claude-desktop.desktop /home/kasm-user/Desktop/Claude-Desktop.desktop
else
  chmod 0700 "$(command -v claude-desktop)"
fi
if agent_enabled hermes-claw; then
  chmod 0755 /usr/local/bin/onecomputer-hermes /opt/onecomputer/hermes-venv/bin/hermes
  install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-hermes-claw.desktop /home/kasm-user/Desktop/Hermes-Claw.desktop
  install -d -o 1000 -g 1000 -m 0700 /home/kasm-user/.hermes
  /opt/onecomputer/hermes-venv/bin/python - "$ONECOMPUTER_HERMES_MODEL_ALIAS" "$ONECOMPUTER_HERMES_ALLOWED_TOOLS" <<'PY'
import json
import os
import sys
from toolsets import TOOLSETS

model, allowed_tools = sys.argv[1:]
tools = [item for item in allowed_tools.split(",") if item]
document = {
    "model": {
        "default": model,
        "provider": "custom",
        "base_url": "http://127.0.0.1:4314/v1",
        "api_key": "onecomputer-loopback-broker",
    },
    "platform_toolsets": {"cli": []},
    "agent": {"disabled_toolsets": sorted(TOOLSETS)},
    "mcp_servers": {
        "onecomputer_ms365": {
            "command": "/usr/local/libexec/onecomputer-mcp-stdio",
            "args": [],
            "env": {"ONECOMPUTER_MCP_BROKER": "http://127.0.0.1:4314"},
            "tools": {"include": tools + ["wait-for-governed-operation"]},
        },
    },
    "stt": {"enabled": False},
}
path = "/home/kasm-user/.hermes/config.yaml"
with open(path, "w", encoding="utf-8") as output:
    json.dump(document, output, separators=(",", ":"))
    output.write("\n")
os.chmod(path, 0o600)
os.chown(path, 1000, 1000)
PY
else
  chmod 0700 /usr/local/bin/onecomputer-hermes /opt/onecomputer/hermes-venv/bin/hermes
fi
install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-firefox.desktop /home/kasm-user/Desktop/Firefox.desktop

# Claude Desktop's Chat runtime uses the exact Claude Code engine embedded in
# its signed build manifest. Seed that generated cache from the immutable image
# because the managed workspace has no direct route to Anthropic's CDN.
if agent_enabled claude-desktop && { [[ ! -x "$claude_code_binary" ]] \
  || [[ ! -f "$claude_code_marker" ]] \
  || [[ "$(<"$claude_code_marker")" != "$claude_code_checksum" ]]; }; then
  install -d -o 1000 -g 1000 -m 0755 "$claude_code_dir"
  install -o 1000 -g 1000 -m 0755 "$claude_code_source" "$claude_code_binary"
  printf '%s\n' "$claude_code_checksum" > "$claude_code_marker"
  chown 1000:1000 "$claude_code_marker"
  chmod 0600 "$claude_code_marker"
fi

if agent_enabled hermes-claw; then
  # Hermes creates runtime logs, sessions, and curator state beneath its home.
  # Some imports initialize those paths while this management entrypoint is
  # still root, so reconcile the complete tree before handing it to the user.
  chown -R 1000:1000 /home/kasm-user/.hermes
  find /home/kasm-user/.hermes -type d -exec chmod 0700 {} +
fi
chown -R 1000:1000 /home/kasm-user/.config /home/kasm-user/Desktop

if agent_enabled claude-desktop; then
  env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    ONECOMPUTER_GATEWAY_UPSTREAM="$ONECOMPUTER_GATEWAY_UPSTREAM" \
    ONECOMPUTER_GATEWAY_CREDENTIAL="$ONECOMPUTER_GATEWAY_CREDENTIAL" \
    ONECOMPUTER_CONTROL_UPSTREAM="$ONECOMPUTER_CONTROL_UPSTREAM" \
    ONECOMPUTER_AGENT_BRIDGE_TOKEN="$ONECOMPUTER_AGENT_BRIDGE_TOKEN" \
    ONECOMPUTER_GATEWAY_LISTEN_PORT=4312 \
    /usr/local/libexec/onecomputer-gateway-proxy &
  printf '%s\n' "$!" > /run/onecomputer/gateway-proxy.pid
fi
if agent_enabled hermes-claw; then
  env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    ONECOMPUTER_GATEWAY_UPSTREAM="$ONECOMPUTER_HERMES_GATEWAY_UPSTREAM" \
    ONECOMPUTER_GATEWAY_CREDENTIAL="$ONECOMPUTER_HERMES_GATEWAY_CREDENTIAL" \
    ONECOMPUTER_CONTROL_UPSTREAM="$ONECOMPUTER_HERMES_CONTROL_UPSTREAM" \
    ONECOMPUTER_AGENT_BRIDGE_TOKEN="$ONECOMPUTER_HERMES_AGENT_BRIDGE_TOKEN" \
    ONECOMPUTER_GATEWAY_LISTEN_PORT=4314 \
    /usr/local/libexec/onecomputer-gateway-proxy &
  printf '%s\n' "$!" > /run/onecomputer/hermes-gateway-proxy.pid
fi
unset ONECOMPUTER_GATEWAY_CREDENTIAL ONECOMPUTER_GATEWAY_UPSTREAM \
  ONECOMPUTER_AGENT_BRIDGE_TOKEN ONECOMPUTER_CONTROL_UPSTREAM \
  ONECOMPUTER_HERMES_GATEWAY_CREDENTIAL ONECOMPUTER_HERMES_GATEWAY_UPSTREAM \
  ONECOMPUTER_HERMES_AGENT_BRIDGE_TOKEN ONECOMPUTER_HERMES_CONTROL_UPSTREAM

if [[ -n "${HTTPS_PROXY:-}" ]]; then
  env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    ONECOMPUTER_EGRESS_UPSTREAM="$HTTPS_PROXY" \
    /usr/local/libexec/onecomputer-egress-broker &
  egress_broker_pid=$!
  printf '%s\n' "$egress_broker_pid" > /run/onecomputer/egress-broker.pid
fi

for enabled_agent in "${enabled_agents[@]}"; do
  [[ "$enabled_agent" == "claude-desktop" ]] && broker_port=4312 || broker_port=4314
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:${broker_port}/healthz" >/dev/null; then break; fi
    sleep 0.1
  done
  curl -fsS "http://127.0.0.1:${broker_port}/healthz" >/dev/null
done
touch /run/onecomputer/workspace-ready

exec setpriv --reuid=1000 --regid=1000 --init-groups \
  /dockerstartup/kasm_default_profile.sh \
  /dockerstartup/vnc_startup.sh \
  /dockerstartup/kasm_startup.sh "$@"
