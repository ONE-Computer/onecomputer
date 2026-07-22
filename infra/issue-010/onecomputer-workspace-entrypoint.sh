#!/usr/bin/env bash
set -euo pipefail

: "${ONECOMPUTER_GATEWAY_UPSTREAM:?workspace gateway upstream is required}"
: "${ONECOMPUTER_GATEWAY_CREDENTIAL:?workspace gateway credential is required}"
: "${ONECOMPUTER_MODEL_ALIAS:?assigned model alias is required}"
: "${ONECOMPUTER_CONTROL_UPSTREAM:?control bridge upstream is required}"
: "${ONECOMPUTER_AGENT_BRIDGE_TOKEN:?scoped control bridge token is required}"
: "${ONECOMPUTER_ALLOWED_TOOLS:?assigned Microsoft 365 tools are required}"

claude_code_version="2.1.215"
claude_code_checksum="7ff9594e53cd89d1af9ceb3c18d3d70be1a5c6d27475e31ee2bed65d748f18c0"
claude_code_source="/opt/onecomputer/claude-code/${claude_code_version}/claude"
claude_code_dir="/home/kasm-user/.config/Claude-3p/claude-code/${claude_code_version}"
claude_code_binary="${claude_code_dir}/claude"
claude_code_marker="${claude_code_dir}/.verified"

case "$ONECOMPUTER_MODEL_ALIAS" in
  onecomputer-claude|claude-sonnet-4-6) model_label="Claude — organization route" ;;
  onecomputer-openai|claude-opus-4-6) model_label="OpenAI — organization route" ;;
  onecomputer-glm|claude-sonnet-4-5) model_label="GLM — organization route" ;;
  onecomputer-assistant) model_label="Standard organization route" ;;
  *) echo "unrecognized model assignment" >&2; exit 78 ;;
esac

install -d -o root -g root -m 0755 /etc/claude-desktop /run/onecomputer
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

install -d -o 1000 -g 1000 -m 0755 /home/kasm-user/.config/autostart /home/kasm-user/Desktop
install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-claude-desktop.desktop /home/kasm-user/.config/autostart/claude-desktop.desktop
install -o 1000 -g 1000 -m 0755 /usr/share/applications/onecomputer-claude-desktop.desktop /home/kasm-user/Desktop/Claude-Desktop.desktop

# Claude Desktop's Chat runtime uses the exact Claude Code engine embedded in
# its signed build manifest. Seed that generated cache from the immutable image
# because the managed workspace has no direct route to Anthropic's CDN.
if [[ ! -x "$claude_code_binary" ]] \
  || [[ ! -f "$claude_code_marker" ]] \
  || [[ "$(<"$claude_code_marker")" != "$claude_code_checksum" ]]; then
  install -d -o 1000 -g 1000 -m 0755 "$claude_code_dir"
  install -o 1000 -g 1000 -m 0755 "$claude_code_source" "$claude_code_binary"
  printf '%s\n' "$claude_code_checksum" > "$claude_code_marker"
  chown 1000:1000 "$claude_code_marker"
  chmod 0600 "$claude_code_marker"
fi

chown -R 1000:1000 /home/kasm-user/.config /home/kasm-user/Desktop

env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  ONECOMPUTER_GATEWAY_UPSTREAM="$ONECOMPUTER_GATEWAY_UPSTREAM" \
  ONECOMPUTER_GATEWAY_CREDENTIAL="$ONECOMPUTER_GATEWAY_CREDENTIAL" \
  ONECOMPUTER_CONTROL_UPSTREAM="$ONECOMPUTER_CONTROL_UPSTREAM" \
  ONECOMPUTER_AGENT_BRIDGE_TOKEN="$ONECOMPUTER_AGENT_BRIDGE_TOKEN" \
  /usr/local/libexec/onecomputer-gateway-proxy &
proxy_pid=$!
printf '%s\n' "$proxy_pid" > /run/onecomputer/gateway-proxy.pid
unset ONECOMPUTER_GATEWAY_CREDENTIAL ONECOMPUTER_GATEWAY_UPSTREAM \
  ONECOMPUTER_AGENT_BRIDGE_TOKEN ONECOMPUTER_CONTROL_UPSTREAM

for _ in $(seq 1 50); do
  if curl -fsS http://127.0.0.1:4312/healthz >/dev/null; then break; fi
  sleep 0.1
done
curl -fsS http://127.0.0.1:4312/healthz >/dev/null

exec setpriv --reuid=1000 --regid=1000 --init-groups \
  /dockerstartup/kasm_default_profile.sh \
  /dockerstartup/vnc_startup.sh \
  /dockerstartup/kasm_startup.sh "$@"
