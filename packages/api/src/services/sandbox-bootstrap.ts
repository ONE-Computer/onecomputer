// Runs inside a sandbox after it reaches state=started. Installs the Claude
// Code CLI via npm --prefix (per the verified sandbox layout: uid=1000(daytona),
// node v22, claude installs via --prefix /home/daytona/.npm-global) and
// configures the package gate.
//
// The package gate has two halves (per AUDIT.md ground rules):
//   1. Verdaccio registry — the npm package gate. Verdaccio runs on port 4873
//      and is reached from inside Docker via host.docker.internal. This redirects
//      the sandbox npm registry away from npmjs.org to Verdaccio.
//   2. OneComputer gateway proxy — HTTPS_PROXY/HTTP_PROXY routes all outbound
//      HTTP through the local gateway (cargo binary on port 10255), which is
//      where the registry 403 blocklist actually fires.

// Verdaccio npm registry URL as seen from inside a sandbox container.
// host.docker.internal resolves to the Mac host from inside Docker containers.
const VERDACCIO_URL =
  process.env.VERDACCIO_URL ?? "http://host.docker.internal:4873";

export interface BootstrapResult {
  claudeVersion: string | null;
  success: boolean;
  log: string;
}

export type ExecFn = (
  id: string,
  cmd: string,
) => Promise<{ exitCode: number; output: string }>;

const BOOTSTRAP_SCRIPT = `
set -e
# Claude Code CLI
npm install -g @anthropic-ai/claude-code --prefix /home/daytona/.npm-global 2>&1 | tail -2
export PATH=/home/daytona/.npm-global/bin:$PATH

# Verify
claude --version && echo BOOTSTRAP_OK
`;

/**
 * Build the package-gate configuration script.
 *
 * @param verdaccioUrl - Verdaccio registry URL. Defaults to VERDACCIO_URL env
 *   var or http://host.docker.internal:4873. Always set as the npm registry,
 *   redirecting sandbox npm away from npmjs.org to Verdaccio.
 * @param gatewayUrl - OneComputer gateway proxy URL (env GATEWAY_PROXY_URL).
 *   When set, exports HTTPS_PROXY/HTTP_PROXY so all outbound traffic flows
 *   through the gateway where the 403 blocklist is enforced. When unset, no
 *   proxy is applied (TODO until the gateway runs as a service).
 */
export const PACKAGE_GATE_SCRIPT = (
  verdaccioUrl?: string,
  gatewayUrl?: string,
): string => {
  const registry = verdaccioUrl ?? VERDACCIO_URL;
  const verdaccioBlock =
    verdaccioUrl === undefined
      ? `# Verdaccio not configured explicitly — using default package gate registry\nnpm config set registry ${registry}\necho "NPM_REGISTRY=$(npm config get registry)"`
      : `npm config set registry ${registry}\necho "NPM_REGISTRY=$(npm config get registry)"`;
  return `
# npm → Verdaccio (replaces direct npmjs.org)
${verdaccioBlock}

# Gateway proxy: route all outbound HTTP through OneComputer gateway
${gatewayUrl ? `export HTTPS_PROXY=${gatewayUrl}\nexport HTTP_PROXY=${gatewayUrl}\nexport NODE_EXTRA_CA_CERTS=/tmp/onecli-ca.pem` : "# Gateway not configured — no proxy (TODO: set GATEWAY_PROXY_URL)"}

echo PACKAGE_GATE_CONFIGURED
`;
};

/**
 * Bootstrap a started sandbox: configure the package gate, then install and
 * verify the Claude Code CLI. Returns the parsed claude version on success.
 */
export async function bootstrapSandbox(
  sandboxId: string,
  exec: ExecFn,
): Promise<BootstrapResult> {
  const gatewayUrl = process.env.GATEWAY_PROXY_URL;
  const log: string[] = [];

  // 1. Configure the package gate first so the subsequent npm install routes
  //    through Verdaccio + the gateway when those are configured. The Verdaccio
  //    URL defaults to VERDACCIO_URL env var or host.docker.internal:4873.
  const gateScript = PACKAGE_GATE_SCRIPT(undefined, gatewayUrl);
  const gate = await exec(sandboxId, gateScript);
  log.push(gate.output.trim());
  if (gate.exitCode !== 0) {
    return {
      claudeVersion: null,
      success: false,
      log: log.join("\n"),
    };
  }

  // 2. Install + verify the Claude Code CLI.
  const install = await exec(sandboxId, BOOTSTRAP_SCRIPT);
  log.push(install.output.trim());
  if (install.exitCode !== 0 || !install.output.includes("BOOTSTRAP_OK")) {
    return {
      claudeVersion: null,
      success: false,
      log: log.join("\n"),
    };
  }

  // The `claude --version` line looks like "2.1.195 (Claude Code)".
  const versionLine = install.output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /\(Claude Code\)/.test(l));
  const claudeVersion = versionLine
    ? (versionLine.split(/\s+/)[0] ?? null)
    : null;

  return {
    claudeVersion,
    success: true,
    log: log.join("\n"),
  };
}
