/* eslint-disable no-useless-escape -- embedded shell scripts require literal escaping */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { loadCaCertificate } from "../../lib/gateway-ca";
import type {
  ExecResult,
  SandboxDesktopInfo,
  SandboxInfo,
  SandboxProvider,
  SandboxRuntimeOptions,
} from "./types";

const IMAGE =
  process.env.KASM_DESKTOP_IMAGE ?? "kasmweb/ubuntu-jammy-desktop:1.16.0";
const NAME_PREFIX = process.env.KASM_CONTAINER_PREFIX ?? "onecomputer-kasm";
const START_PORT = Number(process.env.KASM_PORT_START ?? "16901");
const END_PORT = Number(process.env.KASM_PORT_END ?? "16999");
const PASSWORD = process.env.KASM_VNC_PASSWORD ?? "onecomputer";
const LLM_PROXY_MODE = process.env.ONECOMPUTER_LLM_PROXY_MODE ?? "host-pxpipe";
const LLM_PROXY_BASE_URL =
  process.env.ONECOMPUTER_LLM_PROXY_BASE_URL ??
  "http://host.docker.internal:47821";
const LLM_PROXY_MODELS = (
  process.env.ONECOMPUTER_LLM_PROXY_MODELS ??
  "claude-sonnet-5,claude-fable-5,claude-granola-5-2,claude-haiku-4-5"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const LLM_PROXY_LOG_HINT =
  process.env.ONECOMPUTER_LLM_PROXY_LOG_HINT ??
  "Host logs: ~/.litellm-glm-router/run/prompts.jsonl, ~/.litellm-glm-router/run/responses.jsonl, ~/.pxpipe/events.jsonl";
const LLM_PROXY_API_KEY =
  process.env.ONECOMPUTER_LLM_PROXY_API_KEY ?? "onecomputer-local";
const LLM_PROXY_AUTH_SCHEME =
  process.env.ONECOMPUTER_LLM_PROXY_AUTH_SCHEME ?? "bearer";
const CLAUDE_DESKTOP_GATEWAY_BASE_URL =
  process.env.ONECOMPUTER_CLAUDE_DESKTOP_GATEWAY_BASE_URL ??
  "http://127.0.0.1:47821";
const ENABLE_DOCKER_SOCKET =
  process.env.ONECOMPUTER_SANDBOX_ENABLE_DOCKER !== "0";
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;
const GATEWAY_PROXY_HOST =
  process.env.GATEWAY_BASE_URL ?? "host.docker.internal:10255";

type DockerContainer = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  Ports: string;
  Labels?: string;
  CreatedAt?: string;
};

function runDocker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
    child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString();
      const err = Buffer.concat(stderr).toString();
      if (code === 0) resolve(out.trim());
      else
        reject(
          new Error(
            err.trim() ||
              out.trim() ||
              `docker ${args.join(" ")} exited ${code}`,
          ),
        );
    });
  });
}

/**
 * Run a command in the sandbox detached via `docker exec -d`.
 *
 * Necessary for long-lived daemons (loopback proxy, socat): a foreground
 * `docker exec` with captured stdio never returns because the daemon inherits
 * the exec's stdout pipe. `docker exec -d` returns immediately without waiting,
 * and `setsid` detaches the daemon into its own session so it survives the
 * exec's main process exiting. The command must redirect all three stdio
 * streams itself (stdin from /dev/null, stdout/stderr to a log file).
 */
async function execDetachedInSandboxAsRoot(
  id: string,
  command: string,
): Promise<void> {
  const name = containerName(id);
  await runDocker(["exec", "-d", "-u", "root", name, "bash", "-lc", command]);
}

function containerName(name: string): string {
  return `${NAME_PREFIX}-${name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 48)}`;
}

function sandboxIdFromName(name: string): string {
  return name.startsWith(`${NAME_PREFIX}-`)
    ? name.slice(NAME_PREFIX.length + 1)
    : name;
}

async function listContainers(): Promise<DockerContainer[]> {
  const out = await runDocker([
    "ps",
    "-a",
    "--filter",
    "label=onecomputer.sandbox.provider=kasm-local",
    "--format",
    "{{json .}}",
  ]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DockerContainer);
}

function portFromPorts(ports: string): number | undefined {
  const match = ports.match(
    /0\.0\.0\.0:(\d+)->6901\/tcp|127\.0\.0\.1:(\d+)->6901\/tcp|:::(\d+)->6901\/tcp/,
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? Number(value) : undefined;
}

async function usedPorts(): Promise<Set<number>> {
  return new Set(
    (await listContainers())
      .map((c) => portFromPorts(c.Ports))
      .filter((p): p is number => Boolean(p)),
  );
}

async function allocatePort(): Promise<number> {
  const used = await usedPorts();
  for (let port = START_PORT; port <= END_PORT; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No free Kasm desktop ports in ${START_PORT}-${END_PORT}`);
}

function desktopUrl(port: number): string {
  const host = process.env.KASM_PUBLIC_HOST ?? "127.0.0.1";
  const scheme = process.env.KASM_PUBLIC_SCHEME ?? "https";
  return `${scheme}://${host}:${port}/`;
}

function normalize(c: DockerContainer): SandboxInfo {
  const id = sandboxIdFromName(c.Names.replace(/^\//, ""));
  const port = portFromPorts(c.Ports);
  const running = c.State === "running";
  return {
    id,
    name: id,
    provider: "kasm-local",
    state: running ? "started" : c.State,
    bootstrapped: running,
    desktopReady: running && Boolean(port),
    desktopUrl: port ? desktopUrl(port) : undefined,
    desktopHealth: {
      vnc: running,
      noVnc: running && Boolean(port),
      claudeCode: false,
      claudeDesktopInstalled: false,
      claudeDesktopRunning: false,
      claudeDesktop3pConfigured: false,
      llmProxyReachable: false,
      browser: running,
    },
    createdAt: c.CreatedAt,
  };
}

async function inspectContainer(id: string): Promise<DockerContainer> {
  const containers = await listContainers();
  const found = containers.find(
    (c) => sandboxIdFromName(c.Names.replace(/^\//, "")) === id,
  );
  if (!found) throw new Error(`Sandbox ${id} not found`);
  return found;
}

async function execInSandboxAsRoot(
  id: string,
  command: string,
): Promise<ExecResult> {
  const name = containerName(id);
  try {
    const output = await runDocker([
      "exec",
      "-u",
      "root",
      name,
      "bash",
      "-lc",
      command,
    ]);
    return { exitCode: 0, output };
  } catch (e) {
    return { exitCode: 1, output: e instanceof Error ? e.message : String(e) };
  }
}

async function installClaudeDesktopAndCode(id: string): Promise<ExecResult> {
  const install = await execInSandboxAsRoot(
    id,
    "set -e; . /etc/os-release; case ${VERSION_ID%%.*} in 22|23|24) ;; *) echo Claude Desktop Linux requires Ubuntu 22.04+ or Debian 12+; exit 20 ;; esac; apt-get update; apt-get install -y curl ca-certificates xz-utils gpg; curl -fsSLo /usr/share/keyrings/claude-desktop-archive-keyring.asc https://downloads.claude.ai/claude-desktop/key.asc; echo 'deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/claude-desktop-archive-keyring.asc] https://downloads.claude.ai/claude-desktop/apt/stable stable main' > /etc/apt/sources.list.d/claude-desktop.list; apt-get update; apt-get install -y claude-desktop; arch=$(uname -m); case $arch in aarch64|arm64) node_arch=arm64 ;; x86_64|amd64) node_arch=x64 ;; *) echo unsupported arch $arch; exit 1 ;; esac; if ! /opt/node22/bin/node --version >/dev/null 2>&1; then curl -fsSL https://nodejs.org/dist/v22.13.1/node-v22.13.1-linux-${node_arch}.tar.xz -o /tmp/node22.tar.xz; rm -rf /opt/node22; mkdir -p /opt/node22; tar -xJf /tmp/node22.tar.xz -C /opt/node22 --strip-components=1; fi; mkdir -p /home/kasm-user/.npm-global; rm -rf /home/kasm-user/.npm-global/lib/node_modules/@anthropic-ai/claude-code /home/kasm-user/.npm-global/bin/claude; chown -R kasm-user:kasm-user /home/kasm-user/.npm-global",
  );
  if (install.exitCode !== 0) return install;

  return execInSandbox(
    id,
    "set -e; export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:$PATH; npm install -g @anthropic-ai/claude-code --prefix /home/kasm-user/.npm-global; grep -q npm-global /home/kasm-user/.bashrc || echo 'export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:$PATH' >> /home/kasm-user/.bashrc; claude --version",
  );
}

async function configureClaudeDesktop3p(id: string): Promise<ExecResult> {
  const managedSettings = JSON.stringify({
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: `${CLAUDE_DESKTOP_GATEWAY_BASE_URL.replace(/\/$/, "")}/v1`,
    inferenceGatewayApiKey: LLM_PROXY_API_KEY,
    inferenceGatewayAuthScheme: LLM_PROXY_AUTH_SCHEME,
    modelDiscoveryEnabled: true,
    inferenceModels: LLM_PROXY_MODELS.map((name) => ({ name })),
    inferenceCustomHeaders: {
      "X-OneComputer-Sandbox": id,
      "X-OneComputer-Proxy-Mode": LLM_PROXY_MODE,
    },
  });

  return execInSandboxAsRoot(
    id,
    `set -e; install -d -m 755 -o root -g root /etc/claude-desktop; cat > /etc/claude-desktop/managed-settings.json <<'JSON'
${managedSettings}
JSON
chmod 644 /etc/claude-desktop/managed-settings.json; chown root:root /etc/claude-desktop/managed-settings.json`,
  );
}

async function ensureClaudeDesktopGatewayLoopback(
  id: string,
): Promise<ExecResult> {
  // Step 1 (foreground): write the loopback proxy script.
  const write = await execInSandboxAsRoot(
    id,
    `set -e; cat > /usr/local/bin/onecomputer-llm-loopback-proxy <<'PYPROXY'
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client, sys, os
UPSTREAM_HOST=os.environ.get('ONECOMPUTER_LLM_UPSTREAM_HOST','host.docker.internal')
UPSTREAM_PORT=int(os.environ.get('ONECOMPUTER_LLM_UPSTREAM_PORT','47821'))
class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def do_OPTIONS(self): self.forward()
    def do_HEAD(self): self.forward(head=True)
    def forward(self, head=False):
        body=self.rfile.read(int(self.headers.get('content-length','0') or '0'))
        headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','content-length')}
        headers['Host']=f'{UPSTREAM_HOST}:{UPSTREAM_PORT}'
        if body: headers['Content-Length']=str(len(body))
        conn=http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=120)
        try:
            conn.request(self.command, self.path, body=body or None, headers=headers)
            resp=conn.getresponse(); data=resp.read()
            self.send_response(resp.status, resp.reason)
            for k,v in resp.getheaders():
                if k.lower() not in ('connection','transfer-encoding','content-length'):
                    self.send_header(k,v)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if not head: self.wfile.write(data)
        except Exception as e:
            data=str(e).encode()
            self.send_response(502); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        finally:
            conn.close()
    def log_message(self, fmt, *args): print(fmt % args, file=sys.stderr, flush=True)
ThreadingHTTPServer(('127.0.0.1', 47821), Handler).serve_forever()
PYPROXY
chmod 755 /usr/local/bin/onecomputer-llm-loopback-proxy
# Kill any prior loopback proxy by PID file (NOT pkill -f, which would match this very
# bash script's argv — since the heredoc body contains the proxy name — and SIGTERM itself).
if [ -f /tmp/onecomputer-llm-loopback-proxy.pid ]; then
  OLD=$(cat /tmp/onecomputer-llm-loopback-proxy.pid 2>/dev/null || true)
  [ -n "$OLD" ] && kill "$OLD" 2>/dev/null || true
  rm -f /tmp/onecomputer-llm-loopback-proxy.pid
fi
true`,
  );
  if (write.exitCode !== 0) return write;

  // Step 2 (detached): start the proxy so docker exec returns immediately.
  // setsid + full stdio redirect keeps the daemon alive after the exec session exits.
  // Write the daemon PID to a file so a later restart can kill it by exact PID
  // (pkill -f would match and kill this very bash script).
  await execDetachedInSandboxAsRoot(
    id,
    `setsid bash -c 'exec /usr/local/bin/onecomputer-llm-loopback-proxy' </dev/null >/tmp/onecomputer-llm-loopback-proxy.log 2>&1 & echo $! > /tmp/onecomputer-llm-loopback-proxy.pid`,
  );

  // Step 3 (foreground): verify reachability.
  return execInSandboxAsRoot(
    id,
    `sleep 1; python3 - <<'PYCHECK'
import json, urllib.request
url='http://127.0.0.1:47821/v1/models'
try:
    with urllib.request.urlopen(url, timeout=8) as r:
        d=json.loads(r.read().decode('utf-8','replace'))
    print(json.dumps({'reachable': True, 'modelCount': len(d.get('data',[])) if isinstance(d,dict) else 0}))
except Exception as e:
    print(json.dumps({'reachable': False, 'error': str(e)[:300]}))
PYCHECK`,
  );
}

async function configureClaudeCodeProxy(id: string): Promise<ExecResult> {
  if (!LITELLM_MASTER_KEY?.startsWith("sk-")) {
    return {
      exitCode: 1,
      output:
        "LITELLM_MASTER_KEY is required and must be a LiteLLM virtual key",
    };
  }
  const envFile = `export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:$PATH
export ANTHROPIC_BASE_URL=${CLAUDE_DESKTOP_GATEWAY_BASE_URL.replace(/\/$/, "")}
export ANTHROPIC_AUTH_TOKEN=${LITELLM_MASTER_KEY}
export ANTHROPIC_MODEL=${LLM_PROXY_MODELS[0] ?? "claude-fable-5"}
export ANTHROPIC_DEFAULT_SONNET_MODEL=${LLM_PROXY_MODELS[0] ?? "claude-fable-5"}
export ANTHROPIC_DEFAULT_OPUS_MODEL=${LLM_PROXY_MODELS[0] ?? "claude-fable-5"}
export ANTHROPIC_DEFAULT_HAIKU_MODEL=${LLM_PROXY_MODELS[0] ?? "claude-fable-5"}
export ANTHROPIC_DEFAULT_FABLE_MODEL=${LLM_PROXY_MODELS[0] ?? "claude-fable-5"}
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=0
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=2048
export MAX_THINKING_TOKENS=0
export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1
`;
  return execInSandboxAsRoot(
    id,
    `set -e; install -d -m 700 -o kasm-user -g kasm-user /home/kasm-user/.onecomputer; cat > /home/kasm-user/.onecomputer/claude-code-proxy-env <<'ENV'
${envFile}
ENV
chown kasm-user:kasm-user /home/kasm-user/.onecomputer/claude-code-proxy-env; chmod 600 /home/kasm-user/.onecomputer/claude-code-proxy-env; cat > /usr/local/bin/onecomputer-claude <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
source /home/kasm-user/.onecomputer/claude-code-proxy-env
exec claude "$@"
EOS
chmod 755 /usr/local/bin/onecomputer-claude`,
  );
}

/**
 * Put employee outbound traffic behind the policy gateway. The agent token
 * and CA are copied through short-lived mode-0600 host files so the token
 * never appears in a docker exec argument list or API response.
 */
async function configureGovernedGatewayProxy(
  id: string,
  agentToken?: string,
): Promise<ExecResult> {
  if (!agentToken) {
    return {
      exitCode: 1,
      output: "No gateway agent token was resolved for this sandbox",
    };
  }
  const caCertificate = loadCaCertificate();
  if (!caCertificate) {
    return {
      exitCode: 1,
      output: "Gateway CA certificate is unavailable",
    };
  }

  const suffix = randomUUID();
  const hostEnv = `/tmp/onecomputer-sandbox-gateway-${suffix}.env`;
  const hostCa = `/tmp/onecomputer-sandbox-gateway-${suffix}.pem`;
  const containerEnv = "/tmp/onecomputer-sandbox-gateway.env";
  const containerCa = "/tmp/onecli-gateway-ca.pem";
  const proxy = `http://x:${agentToken}@${GATEWAY_PROXY_HOST}`;
  const env = [
    `export HTTPS_PROXY=${proxy}`,
    `export HTTP_PROXY=${proxy}`,
    `export https_proxy=${proxy}`,
    `export http_proxy=${proxy}`,
    `export NODE_EXTRA_CA_CERTS=${containerCa}`,
    "export NO_PROXY=127.0.0.1,localhost",
    "export no_proxy=127.0.0.1,localhost",
    "",
  ].join("\n");

  await writeFile(hostEnv, env, { mode: 0o600 });
  await writeFile(hostCa, `${caCertificate}\n`, { mode: 0o600 });
  try {
    const name = containerName(id);
    await runDocker(["cp", hostEnv, `${name}:${containerEnv}`]);
    await runDocker(["cp", hostCa, `${name}:${containerCa}`]);
    return execInSandboxAsRoot(
      id,
      `set -e; install -d -m 700 -o kasm-user -g kasm-user /home/kasm-user/.onecomputer; cp ${containerEnv} /home/kasm-user/.onecomputer/gateway-proxy-env; chown kasm-user:kasm-user /home/kasm-user/.onecomputer/gateway-proxy-env; chmod 600 /home/kasm-user/.onecomputer/gateway-proxy-env; chmod 644 ${containerCa}; cat > /etc/profile.d/onecomputer-gateway.sh <<'EOF'
. /home/kasm-user/.onecomputer/gateway-proxy-env
EOF
chmod 644 /etc/profile.d/onecomputer-gateway.sh; rm -f ${containerEnv}; echo governed-gateway-proxy-configured`,
    );
  } finally {
    await unlink(hostEnv).catch(() => undefined);
    await unlink(hostCa).catch(() => undefined);
  }
}

async function installDockerCliAndWrapper(id: string): Promise<ExecResult> {
  // Step 1 (foreground): install docker CLI + socat, copy docker.real, write the policy wrapper.
  const install = await execInSandboxAsRoot(
    id,
    `set -e; export DEBIAN_FRONTEND=noninteractive; if ! command -v docker >/dev/null 2>&1; then apt-get update; apt-get install -y --no-install-recommends docker.io; fi; if [ ! -S /var/run/docker.sock ]; then echo 'Docker socket is not mounted at /var/run/docker.sock'; exit 30; fi; cp "$(command -v docker)" /usr/local/bin/docker.real; if ! command -v socat >/dev/null 2>&1; then apt-get update; apt-get install -y --no-install-recommends socat; fi
# Kill prior socat by PID file (pkill -f would match this bash script's argv and SIGTERM itself).
if [ -f /tmp/onecomputer-docker-socket-proxy.pid ]; then
  OLD=$(cat /tmp/onecomputer-docker-socket-proxy.pid 2>/dev/null || true)
  [ -n "$OLD" ] && kill "$OLD" 2>/dev/null || true
  rm -f /tmp/onecomputer-docker-socket-proxy.pid
fi
rm -f /tmp/onecomputer-docker.sock
cat > /usr/local/bin/docker <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
export DOCKER_HOST="\${DOCKER_HOST:-unix:///tmp/onecomputer-docker.sock}"
REAL=/usr/local/bin/docker.real
cmd="\${1:-}"
if [[ \$# -gt 0 ]]; then shift; fi
case "$cmd" in
  run|create)
    has_network=0
    for arg in "\$@"; do [[ "\$arg" == --network || "\$arg" == --network=* ]] && has_network=1; done
    extra=(--label onecomputer.child=true --label onecomputer.network=deny-by-default)
    [[ \$has_network -eq 0 ]] && extra+=(--network none)
    exec "\$REAL" "\$cmd" "\${extra[@]}" "\$@"
    ;;
  build)
    has_network=0
    for arg in "\$@"; do [[ "\$arg" == --network || "\$arg" == --network=* ]] && has_network=1; done
    extra=()
    [[ \$has_network -eq 0 ]] && extra+=(--network none)
    exec "\$REAL" "\$cmd" "\${extra[@]}" "\$@"
    ;;
  *) exec "\$REAL" "\$cmd" "\$@" ;;
esac
EOS
chmod 755 /usr/local/bin/docker
true`,
  );
  if (install.exitCode !== 0) return install;

  // Step 2 (detached): start the socat unix-socket proxy so docker exec returns immediately.
  await execDetachedInSandboxAsRoot(
    id,
    `setsid bash -c 'exec socat UNIX-LISTEN:/tmp/onecomputer-docker.sock,fork,mode=666 UNIX-CONNECT:/var/run/docker.sock' </dev/null >/tmp/onecomputer-docker-socket-proxy.log 2>&1 & echo $! > /tmp/onecomputer-docker-socket-proxy.pid`,
  );

  // Step 3 (foreground): verify the wrapper reaches the host daemon via the proxied socket.
  return execInSandboxAsRoot(
    id,
    `sleep 1; DOCKER_HOST=unix:///tmp/onecomputer-docker.sock docker version --format '{{.Client.Version}}/{{.Server.Version}}'`,
  );
}

async function ensureLaunchers(id: string): Promise<void> {
  await execInSandboxAsRoot(
    id,
    `bash -lc 'mkdir -p /home/kasm-user/Desktop; cat > /home/kasm-user/Desktop/claude-code-terminal.desktop <<"EOS"
[Desktop Entry]
Type=Application
Name=Claude Code Terminal
Comment=Open Claude Code in a terminal
Exec=bash -lc "export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:\\$PATH; xfce4-terminal --working-directory=/home/kasm-user --command=\\"bash -lc \\\"export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:\\\\$PATH; claude --version; exec bash\\\"\\""
Icon=utilities-terminal
Terminal=false
Categories=Development;
EOS
cat > /home/kasm-user/Desktop/claude-desktop.desktop <<"EOS"
[Desktop Entry]
Type=Application
Name=Claude Desktop
Comment=Open the native Claude Desktop Linux app
Exec=claude-desktop --no-sandbox
Icon=claude-desktop
Terminal=false
Categories=Development;
EOS
cat > /home/kasm-user/Desktop/claude-web.desktop <<"EOS"
[Desktop Entry]
Type=Application
Name=Claude Web
Comment=Open Claude web
Exec=bash -lc "google-chrome --no-sandbox https://claude.ai/code || chromium-browser --no-sandbox https://claude.ai/code || firefox https://claude.ai/code"
Icon=web-browser
Terminal=false
Categories=Network;
EOS
cat > /home/kasm-user/Desktop/ONECOMPUTER-README.txt <<"EOS"
OneComputer Kasm sandbox

This is a browser-accessible KasmVNC desktop running inside a sandbox container.
Claude Desktop Linux is installed from Anthropic apt when bootstrap succeeds.
Launch it with the Claude Desktop icon or run: claude-desktop --no-sandbox
Claude Code is also installed on PATH. Run: claude --version
EOS
chmod +x /home/kasm-user/Desktop/*.desktop
chown -R kasm-user:kasm-user /home/kasm-user/Desktop /home/kasm-user/.npm-global 2>/dev/null || true'`,
  );
}

export async function execInSandbox(
  id: string,
  command: string,
): Promise<ExecResult> {
  const name = containerName(id);
  try {
    const output = await runDocker(["exec", name, "bash", "-lc", command]);
    return { exitCode: 0, output };
  } catch (e) {
    return { exitCode: 1, output: e instanceof Error ? e.message : String(e) };
  }
}

export const kasmLocalProvider: SandboxProvider = {
  async createSandbox(
    name: string,
    options?: SandboxRuntimeOptions,
  ): Promise<SandboxInfo> {
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "-")
        .slice(0, 48) || `sandbox-${Date.now()}`;
    const port = await allocatePort();
    await runDocker([
      "run",
      "-d",
      "--shm-size=512m",
      "--cap-add",
      "NET_ADMIN",
      // Linux Docker does not provide this hostname automatically. The Claude
      // loopback proxy uses it to reach LiteLLM on the Azure host.
      "--add-host",
      "host.docker.internal:host-gateway",
      "--name",
      containerName(id),
      "--label",
      "onecomputer.sandbox.provider=kasm-local",
      "--label",
      `onecomputer.sandbox.id=${id}`,
      "-e",
      `VNC_PW=${PASSWORD}`,
      "-e",
      "VNC_RESOLUTION=1440x900",
      "-e",
      "VNCOPTIONS=-DisableBasicAuth=1",
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-p",
      `127.0.0.1:${port}:6901`,
      IMAGE,
    ]);
    await new Promise((r) => setTimeout(r, 4000));
    const install = await installClaudeDesktopAndCode(id);
    await ensureClaudeDesktopGatewayLoopback(id);
    await configureClaudeCodeProxy(id);
    const governedProxy = await configureGovernedGatewayProxy(
      id,
      options?.gatewayAgentToken,
    );
    const desktop3p = await configureClaudeDesktop3p(id);
    if (ENABLE_DOCKER_SOCKET) await installDockerCliAndWrapper(id);
    await ensureLaunchers(id);
    const info = normalize(await inspectContainer(id));
    const version = install.output
      .split("\n")
      .find((l) => l.includes("Claude Code"));
    const desktopInstalled =
      (await execInSandbox(id, "command -v claude-desktop")).exitCode === 0;
    return {
      ...info,
      claudeVersion: version?.split(/\s+/)[0],
      desktopHealth: {
        ...info.desktopHealth!,
        claudeCode: install.exitCode === 0,
        claudeDesktopInstalled: desktopInstalled,
        claudeDesktopRunning: false,
        claudeDesktop3pConfigured: desktop3p.exitCode === 0,
        llmProxyReachable: false,
      },
      bootLogTail: `${info.bootLogTail ?? ""}\nGateway proxy: ${governedProxy.output}`,
    };
  },
  async listSandboxes() {
    return (await listContainers()).map(normalize);
  },
  async getSandbox(id: string) {
    return normalize(await inspectContainer(id));
  },
  execInSandbox,
  async deleteSandbox(id: string) {
    await runDocker(["rm", "-f", containerName(id)]).catch(() => undefined);
  },
  async getSandboxDesktop(id: string): Promise<SandboxDesktopInfo> {
    const info = normalize(await inspectContainer(id));
    const claude = await execInSandbox(
      id,
      "export PATH=/opt/node22/bin:/home/kasm-user/.npm-global/bin:$PATH; claude --version",
    );
    const desktopInstalled = await execInSandbox(
      id,
      "command -v claude-desktop",
    );
    const desktopRunning = await execInSandbox(
      id,
      "pgrep -af '/usr/lib/claude-desktop/claude-desktop|claude-desktop --no-sandbox'",
    );
    const desktop3p = await execInSandbox(
      id,
      'test -f /etc/claude-desktop/managed-settings.json && grep -q \'"inferenceProvider":"gateway"\' /etc/claude-desktop/managed-settings.json',
    );
    const dockerHealth = await execInSandbox(
      id,
      "command -v docker >/dev/null 2>&1 && docker version --format '{{.Client.Version}}' >/dev/null",
    );
    const claudeCodeProxy = await execInSandbox(
      id,
      "test -f /home/kasm-user/.onecomputer/claude-code-proxy-env && source /home/kasm-user/.onecomputer/claude-code-proxy-env && timeout 90 claude --print 'Reply with exactly: sandbox-ok'",
    );
    const proxy = await execInSandbox(
      id,
      `python3 - <<'PY'
import json, urllib.request
url = '${CLAUDE_DESKTOP_GATEWAY_BASE_URL.replace(/\/$/, "")}/v1/models'
try:
    request = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer ${LITELLM_MASTER_KEY ?? ""}"},
    )
    with urllib.request.urlopen(request, timeout=5) as r:
        data = json.loads(r.read().decode('utf-8'))
    models = data.get('data', []) if isinstance(data, dict) else []
    print(json.dumps({'reachable': True, 'modelCount': len(models)}))
except Exception as e:
    print(json.dumps({'reachable': False, 'error': str(e)[:300]}))
    raise SystemExit(1)
PY`,
    );
    let proxyPayload: {
      reachable: boolean;
      modelCount?: number;
      error?: string;
    } = {
      reachable: false,
    };
    try {
      proxyPayload = JSON.parse(proxy.output.trim()) as typeof proxyPayload;
    } catch {
      proxyPayload = { reachable: false, error: proxy.output.slice(-300) };
    }
    return {
      sandboxId: id,
      status: info.state,
      desktopReady: Boolean(info.desktopReady),
      desktopUrl: info.desktopUrl,
      vncPort: 5901,
      noVncPort: 6901,
      authMode: "none",
      health: {
        vnc: info.desktopHealth?.vnc ?? false,
        noVnc: info.desktopHealth?.noVnc ?? false,
        browser: true,
        claudeCode:
          claude.exitCode === 0 &&
          claudeCodeProxy.output.includes("sandbox-ok"),
        claudeDesktopInstalled: desktopInstalled.exitCode === 0,
        claudeDesktopRunning: desktopRunning.exitCode === 0,
        claudeDesktop3pConfigured: desktop3p.exitCode === 0,
        llmProxyReachable: proxyPayload.reachable,
        dockerAvailable: dockerHealth.exitCode === 0,
      },
      llmProxy: {
        mode: LLM_PROXY_MODE === "host-pxpipe" ? "host-pxpipe" : "custom",
        baseUrl: LLM_PROXY_BASE_URL,
        reachable: proxyPayload.reachable,
        modelCount: proxyPayload.modelCount,
        configuredModels: LLM_PROXY_MODELS,
        logHint: LLM_PROXY_LOG_HINT,
        error: proxyPayload.error,
      },
      claudeVersion:
        claude.exitCode === 0 ? claude.output.split(/\s+/)[0] : undefined,
      bootLogTail: `${claude.output}
Claude Code proxy: ${claudeCodeProxy.output}
${desktopInstalled.output}
${desktopRunning.output}
Docker: ${dockerHealth.exitCode === 0 ? "available" : dockerHealth.output}
3P config: ${desktop3p.exitCode === 0 ? "configured" : desktop3p.output}
LLM proxy: ${proxy.output}`.slice(-4000),
    };
  },
  async restartSandboxDesktop(
    id: string,
    options?: SandboxRuntimeOptions,
  ): Promise<SandboxDesktopInfo> {
    await runDocker(["restart", containerName(id)]);
    await new Promise((r) => setTimeout(r, 4000));
    await ensureClaudeDesktopGatewayLoopback(id);
    await configureClaudeCodeProxy(id);
    await configureGovernedGatewayProxy(id, options?.gatewayAgentToken);
    await configureClaudeDesktop3p(id);
    if (ENABLE_DOCKER_SOCKET) await installDockerCliAndWrapper(id);
    await ensureLaunchers(id);
    return this.getSandboxDesktop(id);
  },
};
