export interface DesktopHealth {
  vnc: boolean;
  noVnc: boolean;
  claudeCode: boolean;
  claudeDesktopInstalled?: boolean;
  claudeDesktopRunning?: boolean;
  llmProxyReachable?: boolean;
  claudeDesktop3pConfigured?: boolean;
  dockerAvailable?: boolean;
  browser: boolean;
}

export interface LlmProxyStatus {
  mode: "disabled" | "host-pxpipe" | "custom";
  baseUrl?: string;
  reachable: boolean;
  modelCount?: number;
  configuredModels?: string[];
  logHint?: string;
  error?: string;
}

export interface DesktopStatus {
  desktopReady: boolean;
  desktopUrl?: string;
  vncPort: number;
  noVncPort: number;
  authMode: "none" | "vnc-password";
  health: DesktopHealth;
  llmProxy?: LlmProxyStatus;
  claudeVersion?: string;
  bootLogTail?: string;
}

export type ExecFn = (
  id: string,
  cmd: string,
) => Promise<{ exitCode: number; output: string }>;

const VNC_PORT = 5901;
const NOVNC_PORT = 6080;

const DESKTOP_BOOTSTRAP_SCRIPT = String.raw`
set -u
mkdir -p /home/daytona/.onecomputer /home/daytona/.config/autostart /home/daytona/Desktop /home/daytona/.npm-global/bin
LOG=/home/daytona/.onecomputer/bootstrap.log
STATUS=/home/daytona/.onecomputer/desktop-status.json
exec >> "$LOG" 2>&1

echo "=== OneComputer desktop bootstrap $(date -Is) ==="
export DEBIAN_FRONTEND=noninteractive
export PATH=/home/daytona/.npm-global/bin:$PATH

write_status() {
  VNC_OK=false
  NOVNC_OK=false
  CLAUDE_OK=false
  BROWSER_OK=false
  CLAUDE_VERSION=""

  if pgrep -af 'Xtigervnc|tigervnc|x11vnc|Xvnc' >/dev/null 2>&1 || ss -ltn 2>/dev/null | grep -q ':5901 '; then VNC_OK=true; fi
  if pgrep -af 'websockify|novnc_proxy' >/dev/null 2>&1 || ss -ltn 2>/dev/null | grep -q ':6080 '; then NOVNC_OK=true; fi
  if command -v claude >/dev/null 2>&1; then CLAUDE_OK=true; CLAUDE_VERSION="$(claude --version 2>/dev/null | head -1 | sed 's/"/\\"/g')"; fi
  if command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1 || command -v firefox >/dev/null 2>&1 || command -v firefox-esr >/dev/null 2>&1; then BROWSER_OK=true; fi
  READY=false
  if [ "$VNC_OK" = true ] && [ "$NOVNC_OK" = true ] && [ "$CLAUDE_OK" = true ]; then READY=true; fi
  cat > "$STATUS" <<JSON
{"desktopReady":$READY,"vncPort":5901,"noVncPort":6080,"authMode":"none","health":{"vnc":$VNC_OK,"noVnc":$NOVNC_OK,"claudeCode":$CLAUDE_OK,"browser":$BROWSER_OK},"claudeVersion":"$CLAUDE_VERSION","updatedAt":"$(date -Is)"}
JSON
}

install_apt() {
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 procps net-tools iproute2 \
    xfce4 xfce4-terminal tigervnc-standalone-server tigervnc-common \
    novnc websockify chromium-browser || \
  apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 procps net-tools iproute2 \
    xfce4 xfce4-terminal tigervnc-standalone-server tigervnc-common \
    novnc websockify chromium || \
  apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 procps net-tools iproute2 \
    xfce4 xfce4-terminal tigervnc-standalone-server tigervnc-common \
    novnc websockify firefox-esr
}

install_apk() {
  apk add --no-cache bash ca-certificates curl dbus-x11 procps iproute2 \
    xfce4 xfce4-terminal tigervnc novnc websockify chromium nodejs npm
}

if ! command -v vncserver >/dev/null 2>&1 && ! command -v x11vnc >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then install_apt; elif command -v apk >/dev/null 2>&1; then install_apk; else echo "Unsupported package manager"; fi
fi

if ! command -v claude >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global || true
fi

cat > /home/daytona/.xsession <<'EOS'
#!/bin/sh
export PATH=/home/daytona/.npm-global/bin:$PATH
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec startxfce4
EOS
chmod +x /home/daytona/.xsession

cat > /home/daytona/Desktop/claude-code-terminal.desktop <<'EOS'
[Desktop Entry]
Type=Application
Name=Claude Code Terminal
Comment=Open a terminal with Claude Code on PATH
Exec=sh -lc 'export PATH=/home/daytona/.npm-global/bin:$PATH; xfce4-terminal --working-directory=/home/daytona --command="bash -lc \"export PATH=/home/daytona/.npm-global/bin:$PATH; claude --version; exec bash\""'
Icon=utilities-terminal
Terminal=false
Categories=Development;
EOS

cat > /home/daytona/Desktop/claude-web.desktop <<'EOS'
[Desktop Entry]
Type=Application
Name=Claude Web
Comment=Open Claude in the sandbox browser
Exec=sh -lc '(chromium --no-sandbox https://claude.ai/code || chromium-browser --no-sandbox https://claude.ai/code || firefox-esr https://claude.ai/code || firefox https://claude.ai/code)'
Icon=web-browser
Terminal=false
Categories=Network;
EOS

cat > /home/daytona/Desktop/ONECOMPUTER-README.txt <<'EOS'
OneComputer remote desktop sandbox

This is a real VNC/noVNC desktop session. Claude Code is installed on PATH when bootstrap succeeds.
Run: claude --version
Open Claude Web via the desktop launcher if browser authentication is available.
Native Claude Desktop is not claimed in this Linux sandbox unless explicitly installed.
EOS
chmod +x /home/daytona/Desktop/*.desktop || true
chown -R daytona:daytona /home/daytona/.onecomputer /home/daytona/.xsession /home/daytona/Desktop /home/daytona/.npm-global 2>/dev/null || true

# Stop stale instances, then start VNC/noVNC idempotently.
vncserver -kill :1 >/dev/null 2>&1 || true
pkill -f 'websockify.*6080' >/dev/null 2>&1 || true
pkill -f 'novnc_proxy.*6080' >/dev/null 2>&1 || true

if command -v runuser >/dev/null 2>&1; then
  runuser -u daytona -- bash -lc 'export PATH=/home/daytona/.npm-global/bin:$PATH; vncserver :1 -localhost no -SecurityTypes None -geometry 1440x900 -depth 24'
else
  su daytona -c 'export PATH=/home/daytona/.npm-global/bin:$PATH; vncserver :1 -localhost no -SecurityTypes None -geometry 1440x900 -depth 24'
fi

NOVNC_WEB=/usr/share/novnc
[ -d /usr/share/novnc ] || NOVNC_WEB=/usr/share/webapps/novnc
[ -d "$NOVNC_WEB" ] || NOVNC_WEB=/usr/share/novnc
nohup websockify --web "$NOVNC_WEB" 0.0.0.0:6080 localhost:5901 >> "$LOG" 2>&1 &
sleep 2
write_status
cat "$STATUS"
echo "=== OneComputer desktop bootstrap done $(date -Is) ==="
`;

const DESKTOP_HEALTH_SCRIPT = String.raw`
set +e
export PATH=/home/daytona/.npm-global/bin:$PATH
STATUS=/home/daytona/.onecomputer/desktop-status.json
LOG=/home/daytona/.onecomputer/bootstrap.log
if [ -f "$STATUS" ]; then cat "$STATUS"; else echo '{"desktopReady":false,"vncPort":5901,"noVncPort":6080,"authMode":"none","health":{"vnc":false,"noVnc":false,"claudeCode":false,"browser":false}}'; fi
echo '\n---BOOT_LOG_TAIL---'
if [ -f "$LOG" ]; then tail -80 "$LOG"; fi
`;

function desktopUrlForSandbox(sandboxId: string): string | undefined {
  const template = process.env.DAYTONA_DESKTOP_URL_TEMPLATE;
  if (template) {
    return template
      .replaceAll("{sandboxId}", encodeURIComponent(sandboxId))
      .replaceAll("{port}", String(NOVNC_PORT));
  }
  const base = process.env.DAYTONA_DESKTOP_BASE_URL;
  if (base)
    return `${base.replace(/\/$/, "")}/${sandboxId}/${NOVNC_PORT}/vnc.html?autoconnect=1&resize=remote`;
  return undefined;
}

function parseStatus(output: string, sandboxId: string): DesktopStatus {
  const parts = output.split("\n---BOOT_LOG_TAIL---\n");
  const jsonPart = parts[0] ?? "";
  const logPart = parts[1] ?? "";
  let parsed: Partial<DesktopStatus> = {};
  const match = jsonPart.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as Partial<DesktopStatus>;
    } catch {
      parsed = {};
    }
  }
  const health = parsed.health ?? {
    vnc: false,
    noVnc: false,
    claudeCode: false,
    browser: false,
  };
  return {
    desktopReady: Boolean(parsed.desktopReady),
    desktopUrl: desktopUrlForSandbox(sandboxId),
    vncPort: parsed.vncPort ?? VNC_PORT,
    noVncPort: parsed.noVncPort ?? NOVNC_PORT,
    authMode: parsed.authMode ?? "none",
    health,
    claudeVersion: parsed.claudeVersion,
    bootLogTail: logPart.trim() || undefined,
  };
}

export async function bootstrapDesktop(
  sandboxId: string,
  exec: ExecFn,
): Promise<DesktopStatus> {
  const result = await exec(sandboxId, DESKTOP_BOOTSTRAP_SCRIPT);
  const status = parseStatus(result.output, sandboxId);
  return {
    ...status,
    desktopReady: result.exitCode === 0 && status.desktopReady,
    bootLogTail: result.output.slice(-8000),
  };
}

export async function checkDesktopHealth(
  sandboxId: string,
  exec: ExecFn,
): Promise<DesktopStatus> {
  const result = await exec(sandboxId, DESKTOP_HEALTH_SCRIPT);
  return parseStatus(result.output, sandboxId);
}
