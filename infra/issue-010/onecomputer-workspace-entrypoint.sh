#!/usr/bin/env bash
set -euo pipefail

: "${ONECOMPUTER_GATEWAY_UPSTREAM:?workspace gateway upstream is required}"
: "${ONECOMPUTER_GATEWAY_CREDENTIAL:?workspace gateway credential is required}"
: "${ONECOMPUTER_MODEL_ALIAS:?assigned model alias is required}"

case "$ONECOMPUTER_MODEL_ALIAS" in
  onecomputer-claude) model_label="Claude — organization route" ;;
  onecomputer-openai) model_label="OpenAI — organization route" ;;
  onecomputer-glm) model_label="GLM — organization route" ;;
  onecomputer-assistant) model_label="Standard organization route" ;;
  *) echo "unrecognized model assignment" >&2; exit 78 ;;
esac

install -d -o root -g root -m 0755 /etc/claude-desktop /run/onecomputer
python3 - "$ONECOMPUTER_MODEL_ALIAS" "$model_label" <<'PY'
import json
import os
import sys

model, label = sys.argv[1:]
document = {
    "inferenceProvider": "gateway",
    "inferenceGatewayBaseUrl": "http://127.0.0.1:4312/v1",
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
    "managedMcpServers": [],
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
chown -R 1000:1000 /home/kasm-user/.config /home/kasm-user/Desktop

env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  ONECOMPUTER_GATEWAY_UPSTREAM="$ONECOMPUTER_GATEWAY_UPSTREAM" \
  ONECOMPUTER_GATEWAY_CREDENTIAL="$ONECOMPUTER_GATEWAY_CREDENTIAL" \
  /usr/local/libexec/onecomputer-gateway-proxy &
proxy_pid=$!
printf '%s\n' "$proxy_pid" > /run/onecomputer/gateway-proxy.pid
unset ONECOMPUTER_GATEWAY_CREDENTIAL ONECOMPUTER_GATEWAY_UPSTREAM

for _ in $(seq 1 50); do
  if curl -fsS http://127.0.0.1:4312/healthz >/dev/null; then break; fi
  sleep 0.1
done
curl -fsS http://127.0.0.1:4312/healthz >/dev/null

exec setpriv --reuid=1000 --regid=1000 --init-groups \
  /dockerstartup/kasm_default_profile.sh \
  /dockerstartup/vnc_startup.sh \
  /dockerstartup/kasm_startup.sh "$@"
