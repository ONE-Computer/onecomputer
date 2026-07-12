#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);

const help = `
OneComputer deploy, governed app hosting

Usage:
  pnpm onecomputer:deploy <app-path> [options]

Options:
  --owner <name>                 Business owner. Default: current user / unknown.
  --purpose <text>               Business purpose. Default: Governed app pilot.
  --data-classification <level>  Public | Internal | Confidential | Restricted. Default: Internal.
  --users <csv>                  Allowed users/groups. Default: owner.
  --ttl-hours <n>                Grant/runtime TTL. Default: 24.
  --out <dir>                    Artifact output root. Default: .onecomputer/deployments.
  --runtime <mode>               auto | streamlit | node | react-static. Default: auto.
  --db <mode>                    none | dynamodb | postgres-later. Default: none.
  --access-mode <mode>           basic | origin-token | none. Default: basic.
  --env KEY=VALUE                Runtime env var to inject during --execute-aws. Repeatable.
  --execute-aws                  Build/push with AWS CodeBuild if needed, then deploy to ECS Express.
  --skip-aws-build               With --execute-aws, require ONECOMPUTER_APP_IMAGE (or legacy ONECOMPUTER_STREAMLIT_IMAGE) instead of CodeBuild.
  --help                         Show this help.

Dry run is the default. It creates an app passport, evidence pack, Dockerfile, and runbook.
`;

function parseArgs(argv) {
  const args = {
    appPath: undefined,
    owner: process.env.ONECOMPUTER_OWNER ?? process.env.USER ?? "unknown-owner",
    purpose: "Governed app pilot",
    dataClassification: "Internal",
    users: undefined,
    ttlHours: 24,
    out: ".onecomputer/deployments",
    executeAws: false,
    skipAwsBuild: false,
    runtime: "auto",
    db: "none",
    accessMode: "basic",
    env: [],
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(help.trim());
      process.exit(0);
    }
    if (arg === "--execute-aws") {
      args.executeAws = true;
      continue;
    }
    if (arg === "--skip-aws-build") {
      args.skipAwsBuild = true;
      continue;
    }
    const readValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--owner":
        args.owner = readValue();
        break;
      case "--purpose":
        args.purpose = readValue();
        break;
      case "--data-classification":
      case "--data-class":
        args.dataClassification = readValue();
        break;
      case "--users":
        args.users = readValue();
        break;
      case "--ttl-hours":
        args.ttlHours = Number(readValue());
        if (!Number.isFinite(args.ttlHours) || args.ttlHours <= 0) {
          throw new Error("--ttl-hours must be a positive number");
        }
        break;
      case "--out":
        args.out = readValue();
        break;
      case "--runtime":
        args.runtime = readValue();
        if (
          !["auto", "streamlit", "node", "react-static"].includes(args.runtime)
        ) {
          throw new Error(
            "--runtime must be auto, streamlit, node, or react-static",
          );
        }
        break;
      case "--db":
        args.db = readValue();
        if (!["none", "dynamodb", "postgres-later"].includes(args.db)) {
          throw new Error("--db must be none, dynamodb, or postgres-later");
        }
        break;
      case "--access-mode":
        args.accessMode = readValue();
        if (!["basic", "origin-token", "none"].includes(args.accessMode)) {
          throw new Error("--access-mode must be basic, origin-token, or none");
        }
        break;
      case "--env": {
        const pair = readValue();
        const eq = pair.indexOf("=");
        if (eq <= 0) throw new Error("--env must be KEY=VALUE");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
          throw new Error(`Invalid env var name for --env: ${name}`);
        }
        args.env.push({ name, value });
        break;
      }
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        if (args.appPath) throw new Error(`Unexpected extra app path: ${arg}`);
        args.appPath = arg;
    }
  }

  args.appPath ??= "examples/streamlit/meeting-tracker";
  args.users ??= args.owner;
  return args;
}

function listFiles(dir) {
  const ignored = new Set([
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".onecomputer",
  ]);
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  return files;
}

function copyAppSource(srcDir, destDir) {
  const ignored = new Set([
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".onecomputer",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
  ]);
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    filter(source) {
      const base = path.basename(source);
      return !ignored.has(base);
    },
  });
}

function rel(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function detectStreamlit(appDir) {
  const files = listFiles(appDir);
  const pyFiles = files.filter((file) => file.endsWith(".py"));
  const requirements = path.join(appDir, "requirements.txt");
  const requirementsText = fs.existsSync(requirements)
    ? fs.readFileSync(requirements, "utf8")
    : "";
  const candidates = ["streamlit_app.py", "app.py", "Home.py"]
    .map((name) => path.join(appDir, name))
    .filter((file) => fs.existsSync(file));

  const streamlitPy = pyFiles.filter((file) => {
    const text = fs.readFileSync(file, "utf8");
    return /import\s+streamlit|from\s+streamlit\s+import|\bst\./.test(text);
  });

  const mainFile =
    candidates.find((file) => streamlitPy.includes(file)) ??
    streamlitPy[0] ??
    candidates[0];
  const hasStreamlitDependency = /(^|\n)\s*streamlit([=<>~!]|\s|$)/i.test(
    requirementsText,
  );

  return {
    kind:
      mainFile && (hasStreamlitDependency || streamlitPy.length > 0)
        ? "streamlit"
        : "unknown",
    mainFile: mainFile ? rel(appDir, mainFile) : null,
    requirementsFile: fs.existsSync(requirements) ? "requirements.txt" : null,
    pyFiles: pyFiles.map((file) => rel(appDir, file)),
    hasStreamlitDependency,
  };
}

function readPackageJson(appDir) {
  const packageFile = path.join(appDir, "package.json");
  if (!fs.existsSync(packageFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (error) {
    throw new Error(`Invalid package.json: ${error.message}`);
  }
}

function detectPackageManager(appDir) {
  if (fs.existsSync(path.join(appDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(appDir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(appDir, "package-lock.json"))) return "npm";
  return "npm";
}

function packageCommand(packageManager, command) {
  if (packageManager === "pnpm") return `pnpm ${command}`;
  if (packageManager === "yarn") return `yarn ${command}`;
  return `npm run ${command}`;
}

function dependencyNames(pkg) {
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
}

function detectNodeApp(appDir) {
  const pkg = readPackageJson(appDir);
  if (!pkg) return { kind: "unknown" };
  const deps = dependencyNames(pkg);
  const scripts = pkg.scripts ?? {};
  const packageManager = detectPackageManager(appDir);
  const framework = deps.has("express")
    ? "express"
    : deps.has("fastify")
      ? "fastify"
      : deps.has("hono")
        ? "hono"
        : deps.has("next")
          ? "next"
          : "node";
  const startScript = scripts.start ? "start" : scripts.dev ? "dev" : null;
  const isServer =
    startScript &&
    (deps.has("express") ||
      deps.has("fastify") ||
      deps.has("hono") ||
      deps.has("next") ||
      /node\s+|tsx\s+|bun\s+|vite\s+--host/.test(String(scripts[startScript])));
  if (!isServer) return { kind: "unknown" };
  return {
    kind: "node",
    packageManager,
    framework,
    startScript,
    startCommand: packageCommand(packageManager, startScript),
    buildScript: scripts.build ? "build" : null,
    installCommand:
      packageManager === "pnpm"
        ? "pnpm install --frozen-lockfile || pnpm install"
        : packageManager === "yarn"
          ? "yarn install --frozen-lockfile || yarn install"
          : "npm ci || npm install",
    port: Number(process.env.ONECOMPUTER_NODE_PORT ?? 3000),
    packageJson: "package.json",
  };
}

function detectReactStatic(appDir) {
  const pkg = readPackageJson(appDir);
  if (!pkg) return { kind: "unknown" };
  const deps = dependencyNames(pkg);
  const scripts = pkg.scripts ?? {};
  const packageManager = detectPackageManager(appDir);
  const isReact = deps.has("react") || deps.has("@vitejs/plugin-react");
  const hasBuild = Boolean(scripts.build);
  if (!isReact || !hasBuild) return { kind: "unknown" };
  const buildDir =
    fs.existsSync(path.join(appDir, "vite.config.js")) || deps.has("vite")
      ? "dist"
      : "build";
  return {
    kind: "react-static",
    packageManager,
    framework: deps.has("vite") ? "vite-react" : "react-static",
    buildScript: "build",
    buildCommand: packageCommand(packageManager, "build"),
    installCommand:
      packageManager === "pnpm"
        ? "pnpm install --frozen-lockfile || pnpm install"
        : packageManager === "yarn"
          ? "yarn install --frozen-lockfile || yarn install"
          : "npm ci || npm install",
    buildDir,
    packageJson: "package.json",
  };
}

function detectApp(appDir, runtime) {
  const streamlit = detectStreamlit(appDir);
  const node = detectNodeApp(appDir);
  const react = detectReactStatic(appDir);
  if (runtime === "streamlit") return streamlit;
  if (runtime === "node") return node;
  if (runtime === "react-static") return react;
  if (streamlit.kind === "streamlit") return streamlit;
  if (node.kind === "node") return node;
  if (react.kind === "react-static") return react;
  return { kind: "unknown", streamlit, node, react };
}

function scanSecurity(appDir, files) {
  const secretFilePatterns = [
    /^\.env(\.|$)?/,
    /^\.streamlit\/secrets\.toml$/,
    /secrets?\.(json|ya?ml|toml|env)$/i,
    /credentials?\.(json|ya?ml|toml|env)$/i,
  ];
  const secretValuePatterns = [
    { id: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
    {
      id: "private-key",
      regex: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
    },
    {
      id: "generic-api-key",
      regex:
        /(api[_-]?key|secret|token|password)\s*[=:]\s*['\"][A-Za-z0-9_\-./+=]{16,}['\"]/i,
    },
  ];

  const findings = [];
  for (const file of files) {
    const relative = rel(appDir, file);
    if (secretFilePatterns.some((pattern) => pattern.test(relative))) {
      findings.push({
        severity: "medium",
        type: "secret-file",
        file: relative,
      });
    }
    const stat = fs.statSync(file);
    if (stat.size > 512_000) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of secretValuePatterns) {
      if (pattern.regex.test(text)) {
        findings.push({ severity: "high", type: pattern.id, file: relative });
      }
    }
  }
  return findings;
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "streamlit-app"
  );
}

function sha256Dir(appDir, files) {
  const hash = crypto.createHash("sha256");
  for (const file of files.map((f) => rel(appDir, f)).sort()) {
    const full = path.join(appDir, file);
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function streamlitDockerfile(mainFile, requirementsFile) {
  const req = requirementsFile ?? "requirements.onecomputer.txt";
  return [
    "FROM python:3.12-slim",
    "",
    "RUN apt-get update \\",
    "    && apt-get install -y --no-install-recommends nginx apache2-utils curl \\",
    "    && rm -rf /var/lib/apt/lists/*",
    "",
    "ENV PYTHONDONTWRITEBYTECODE=1 \\",
    "    PYTHONUNBUFFERED=1 \\",
    "    STREAMLIT_SERVER_ADDRESS=127.0.0.1 \\",
    "    STREAMLIT_SERVER_PORT=8501 \\",
    "    STREAMLIT_BROWSER_GATHER_USAGE_STATS=false \\",
    "    ONECOMPUTER_AUTH_MODE=basic \\",
    "    ONECOMPUTER_BASIC_AUTH_USER=onecomputer",
    "",
    "WORKDIR /app",
    `COPY ${req} /app/requirements.txt`,
    "RUN pip install --no-cache-dir -r /app/requirements.txt",
    "COPY . /app",
    "",
    "RUN cat > /etc/nginx/conf.d/onecomputer.conf <<'NGINX'",
    "server {",
    "  listen 8080;",
    "  server_name _;",
    "  client_max_body_size 32m;",
    "  location = /_stcore/health {",
    "    auth_basic off;",
    "    proxy_pass http://127.0.0.1:8501/_stcore/health;",
    "    proxy_set_header Host $host;",
    "  }",
    "  location / {",
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_START",
    '    if ($http_x_onecomputer_origin_token != "__ONECOMPUTER_ORIGIN_TOKEN__") { return 403; }',
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_END",
    "    proxy_pass http://127.0.0.1:8501;",
    "    proxy_http_version 1.1;",
    "    proxy_set_header Upgrade $http_upgrade;",
    '    proxy_set_header Connection "upgrade";',
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Real-IP $remote_addr;",
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    "    proxy_read_timeout 86400;",
    '    auth_basic "OneComputer governed app";',
    "    auth_basic_user_file /etc/nginx/.htpasswd;",
    "  }",
    "}",
    "NGINX",
    "",
    "RUN cat > /usr/local/bin/onecomputer-entrypoint <<'SH' && chmod +x /usr/local/bin/onecomputer-entrypoint",
    "#!/usr/bin/env sh",
    "set -eu",
    'if [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "origin-token" ]; then',
    '  if [ -z "${ONECOMPUTER_ORIGIN_TOKEN:-}" ]; then',
    '    echo "ONECOMPUTER_ORIGIN_TOKEN is required when auth mode is origin-token" >&2',
    "    exit 64",
    "  fi",
    '  sed -i "s|__ONECOMPUTER_ORIGIN_TOKEN__|$ONECOMPUTER_ORIGIN_TOKEN|g" /etc/nginx/conf.d/onecomputer.conf',
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/onecomputer.conf",
    'elif [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "basic" ]; then',
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/onecomputer.conf",
    '  if [ -z "${ONECOMPUTER_BASIC_AUTH_PASSWORD:-}" ]; then',
    '    echo "ONECOMPUTER_BASIC_AUTH_PASSWORD is required when auth mode is basic" >&2',
    "    exit 64",
    "  fi",
    '  htpasswd -bc /etc/nginx/.htpasswd "${ONECOMPUTER_BASIC_AUTH_USER:-onecomputer}" "$ONECOMPUTER_BASIC_AUTH_PASSWORD" >/dev/null',
    "else",
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/onecomputer.conf",
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/onecomputer.conf",
    "fi",
    `streamlit run "${mainFile}" --server.address 127.0.0.1 --server.port 8501 &`,
    "exec nginx -g 'daemon off;'",
    "SH",
    "",
    "EXPOSE 8080",
    "HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8080/_stcore/health >/dev/null",
    'CMD ["/usr/local/bin/onecomputer-entrypoint"]',
    "",
  ].join("\n");
}

function nodeDockerfile(detection) {
  const appPort = detection.port ?? 3000;
  return [
    "FROM node:22-slim",
    "",
    "RUN apt-get update \\",
    "    && apt-get install -y --no-install-recommends nginx apache2-utils curl \\",
    "    && rm -rf /var/lib/apt/lists/*",
    "",
    "WORKDIR /app",
    "COPY package*.json pnpm-lock.yaml* yarn.lock* ./",
    "RUN corepack enable || true",
    `RUN ${detection.installCommand}`,
    "COPY . /app",
    detection.buildScript
      ? `RUN ${packageCommand(detection.packageManager, detection.buildScript)}`
      : "RUN true",
    "",
    "RUN cat > /etc/nginx/conf.d/onecomputer.conf <<'NGINX'",
    "server {",
    "  listen 8080;",
    "  server_name _;",
    "  client_max_body_size 32m;",
    "  location = /_onecomputer/health {",
    "    auth_basic off;",
    "    return 200 'ok';",
    "    add_header Content-Type text/plain;",
    "  }",
    "  location / {",
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_START",
    '    if ($http_x_onecomputer_origin_token != "__ONECOMPUTER_ORIGIN_TOKEN__") { return 403; }',
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_END",
    `    proxy_pass http://127.0.0.1:${appPort};`,
    "    proxy_http_version 1.1;",
    "    proxy_set_header Upgrade $http_upgrade;",
    '    proxy_set_header Connection "upgrade";',
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Real-IP $remote_addr;",
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    "    proxy_read_timeout 86400;",
    '    auth_basic "OneComputer governed app";',
    "    auth_basic_user_file /etc/nginx/.htpasswd;",
    "  }",
    "}",
    "NGINX",
    "",
    "RUN cat > /usr/local/bin/onecomputer-entrypoint <<'SH' && chmod +x /usr/local/bin/onecomputer-entrypoint",
    "#!/usr/bin/env sh",
    "set -eu",
    'if [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "origin-token" ]; then',
    '  if [ -z "${ONECOMPUTER_ORIGIN_TOKEN:-}" ]; then',
    '    echo "ONECOMPUTER_ORIGIN_TOKEN is required when auth mode is origin-token" >&2',
    "    exit 64",
    "  fi",
    '  sed -i "s|__ONECOMPUTER_ORIGIN_TOKEN__|$ONECOMPUTER_ORIGIN_TOKEN|g" /etc/nginx/conf.d/onecomputer.conf',
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/onecomputer.conf",
    'elif [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "basic" ]; then',
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/onecomputer.conf",
    '  if [ -z "${ONECOMPUTER_BASIC_AUTH_PASSWORD:-}" ]; then',
    '    echo "ONECOMPUTER_BASIC_AUTH_PASSWORD is required when auth mode is basic" >&2',
    "    exit 64",
    "  fi",
    '  htpasswd -bc /etc/nginx/.htpasswd "${ONECOMPUTER_BASIC_AUTH_USER:-onecomputer}" "$ONECOMPUTER_BASIC_AUTH_PASSWORD" >/dev/null',
    "else",
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/onecomputer.conf",
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/onecomputer.conf",
    "fi",
    `PORT=${appPort} ${detection.startCommand} &`,
    "exec nginx -g 'daemon off;'",
    "SH",
    "",
    "EXPOSE 8080",
    "HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8080/_onecomputer/health >/dev/null",
    'CMD ["/usr/local/bin/onecomputer-entrypoint"]',
    "",
  ].join("\n");
}

function reactStaticDockerfile(detection) {
  return [
    "FROM node:22-slim AS builder",
    "WORKDIR /app",
    "COPY package*.json pnpm-lock.yaml* yarn.lock* ./",
    "RUN corepack enable || true",
    `RUN ${detection.installCommand}`,
    "COPY . /app",
    `RUN ${detection.buildCommand}`,
    "",
    "FROM nginx:1.27-alpine",
    "RUN apk add --no-cache apache2-utils curl",
    "COPY --from=builder /app/" + detection.buildDir + " /usr/share/nginx/html",
    "RUN cat > /etc/nginx/conf.d/default.conf <<'NGINX'",
    "server {",
    "  listen 8080;",
    "  server_name _;",
    "  location = /_onecomputer/health {",
    "    auth_basic off;",
    "    return 200 'ok';",
    "    add_header Content-Type text/plain;",
    "  }",
    "  location / {",
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_START",
    '    if ($http_x_onecomputer_origin_token != "__ONECOMPUTER_ORIGIN_TOKEN__") { return 403; }',
    "    # ONECOMPUTER_ORIGIN_TOKEN_GUARD_END",
    '    auth_basic "OneComputer governed app";',
    "    auth_basic_user_file /etc/nginx/.htpasswd;",
    "    root /usr/share/nginx/html;",
    "    try_files $uri $uri/ /index.html;",
    "  }",
    "}",
    "NGINX",
    "RUN cat > /docker-entrypoint.d/01-onecomputer-auth.sh <<'SH' && chmod +x /docker-entrypoint.d/01-onecomputer-auth.sh",
    "#!/usr/bin/env sh",
    "set -eu",
    'if [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "origin-token" ]; then',
    '  if [ -z "${ONECOMPUTER_ORIGIN_TOKEN:-}" ]; then',
    '    echo "ONECOMPUTER_ORIGIN_TOKEN is required when auth mode is origin-token" >&2',
    "    exit 64",
    "  fi",
    '  sed -i "s|__ONECOMPUTER_ORIGIN_TOKEN__|$ONECOMPUTER_ORIGIN_TOKEN|g" /etc/nginx/conf.d/default.conf',
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/default.conf",
    'elif [ "${ONECOMPUTER_AUTH_MODE:-basic}" = "basic" ]; then',
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/default.conf",
    '  if [ -z "${ONECOMPUTER_BASIC_AUTH_PASSWORD:-}" ]; then',
    '    echo "ONECOMPUTER_BASIC_AUTH_PASSWORD is required when auth mode is basic" >&2',
    "    exit 64",
    "  fi",
    '  htpasswd -bc /etc/nginx/.htpasswd "${ONECOMPUTER_BASIC_AUTH_USER:-onecomputer}" "$ONECOMPUTER_BASIC_AUTH_PASSWORD" >/dev/null',
    "else",
    "  sed -i '/ONECOMPUTER_ORIGIN_TOKEN_GUARD_START/,/ONECOMPUTER_ORIGIN_TOKEN_GUARD_END/d' /etc/nginx/conf.d/default.conf",
    "  sed -i '/auth_basic/d' /etc/nginx/conf.d/default.conf",
    "fi",
    "SH",
    "EXPOSE 8080",
    "HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8080/_onecomputer/health >/dev/null",
    "",
  ].join("\n");
}

function dockerfileForDetection(detection) {
  if (detection.kind === "streamlit") {
    return streamlitDockerfile(detection.mainFile, detection.requirementsFile);
  }
  if (detection.kind === "node") return nodeDockerfile(detection);
  if (detection.kind === "react-static")
    return reactStaticDockerfile(detection);
  throw new Error(`No Dockerfile generator for ${detection.kind}`);
}

function runtimeForDetection({ detection, appName }) {
  if (detection.kind === "streamlit") {
    return {
      kind: "streamlit",
      port: 8080,
      upstreamPort: 8501,
      mainFile: detection.mainFile,
      healthPath: "/_stcore/health",
      command: `streamlit run ${detection.mainFile} --server.address 127.0.0.1 --server.port 8501 behind nginx basic-auth gate on 8080`,
      imageName: `onecomputer/${appName}`,
    };
  }
  if (detection.kind === "node") {
    return {
      kind: "node",
      framework: detection.framework,
      port: 8080,
      upstreamPort: detection.port,
      healthPath: "/_onecomputer/health",
      command: `${detection.startCommand} behind nginx basic-auth gate on 8080`,
      imageName: `onecomputer/${appName}`,
    };
  }
  if (detection.kind === "react-static") {
    return {
      kind: "react-static",
      framework: detection.framework,
      port: 8080,
      healthPath: "/_onecomputer/health",
      command: "nginx serves static React build behind basic-auth gate on 8080",
      imageName: `onecomputer/${appName}`,
    };
  }
  throw new Error(`Unsupported runtime ${detection.kind}`);
}

function markdownRunbook({ passport, detection, executeAws }) {
  return `# OneComputer Streamlit Deploy Runbook

## App

- Name: ${passport.name}
- ID: ${passport.id}
- Owner: ${passport.owner}
- Data classification: ${passport.dataClassification}
- Runtime: ${passport.runtime.kind}
- Main file: ${detection.mainFile}

## Local validation

\`\`\`bash
cd ${passport.source.path}
pip install -r ${detection.requirementsFile ?? "requirements.onecomputer.txt"}
streamlit run ${detection.mainFile}
\`\`\`

## Container build

\`\`\`bash
# From the app directory after copying Dockerfile.onecomputer into Dockerfile
docker build -t ${passport.runtime.imageName}:latest .
docker run --rm -p 8501:8501 ${passport.runtime.imageName}:latest
\`\`\`

## Governed AWS deploy

Dry run is complete. To execute via ECS Express, push an image first and rerun:

\`\`\`bash
ONECOMPUTER_STREAMLIT_IMAGE=<account>.dkr.ecr.<region>.amazonaws.com/${passport.runtime.imageName}:latest \\
AWS_DEFAULT_REGION=ap-southeast-1 \\
pnpm onecomputer:deploy ${passport.source.path} --execute-aws
\`\`\`

Execution attempted in this run: **${executeAws ? "yes" : "no"}**

## CISO proof checklist

- [x] Owner captured
- [x] Purpose captured
- [x] Data classification captured
- [x] Allowed users/groups captured
- [x] Streamlit runtime detected
- [x] Secret scan performed
- [x] Evidence pack generated
- [ ] IAM/VTI access gate live
- [ ] Dashboard passport persisted
- [ ] Revoke/kill switch tested
`;
}

function awsCliBin() {
  const wrapper = path.join(repoRoot, "..", "..", "scripts", "aws-sandbox.sh");
  return process.env.AWS_CLI_BIN ?? (fs.existsSync(wrapper) ? wrapper : "aws");
}

function runAws(args, { input, timeout = 120_000, okStatuses = [0] } = {}) {
  const result = spawnSync(awsCliBin(), args, {
    cwd: repoRoot,
    env: { ...process.env, AWS_PAGER: "" },
    input,
    encoding: "utf8",
    timeout,
  });
  if (!okStatuses.includes(result.status ?? 1)) {
    const message = [
      `aws ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    const error = new Error(message);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.status = result.status;
    throw error;
  }
  return result.stdout;
}

function runAwsJson(args, options) {
  const stdout = runAws([...args, "--output", "json"], options);
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function writeTempJson(name, data) {
  const tmpRoot = path.join(repoRoot, ".onecomputer", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const file = path.join(
    tmpRoot,
    `${name}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`,
  );
  writeJson(file, data);
  return file;
}

function ensureBucket({ bucket, region }) {
  const exists = spawnSync(
    awsCliBin(),
    ["s3api", "head-bucket", "--bucket", bucket],
    { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } },
  );
  if (exists.status === 0) return { bucket, created: false };

  const args = [
    "s3api",
    "create-bucket",
    "--bucket",
    bucket,
    "--region",
    region,
  ];
  if (region !== "us-east-1") {
    args.push("--create-bucket-configuration", `LocationConstraint=${region}`);
  }
  runAws(args);
  runAws([
    "s3api",
    "put-public-access-block",
    "--bucket",
    bucket,
    "--public-access-block-configuration",
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
  ]);
  return { bucket, created: true };
}

function ensureEcrRepository({ repoName, region }) {
  const describe = spawnSync(
    awsCliBin(),
    [
      "ecr",
      "describe-repositories",
      "--repository-names",
      repoName,
      "--region",
      region,
      "--output",
      "json",
    ],
    { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } },
  );
  if (describe.status === 0) {
    return JSON.parse(describe.stdout).repositories[0];
  }
  const created = runAwsJson([
    "ecr",
    "create-repository",
    "--repository-name",
    repoName,
    "--region",
    region,
    "--image-scanning-configuration",
    "scanOnPush=true",
    "--encryption-configuration",
    "encryptionType=AES256",
  ]);
  return created.repository;
}

function ensureCodeBuildRole({ roleName, bucket, repositoryArn, region }) {
  const trust = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "codebuild.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  };
  const trustFile = writeTempJson("codebuild-trust", trust);
  const role = spawnSync(
    awsCliBin(),
    ["iam", "get-role", "--role-name", roleName, "--output", "json"],
    { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } },
  );
  let roleArn;
  if (role.status === 0) {
    roleArn = JSON.parse(role.stdout).Role.Arn;
  } else {
    const created = runAwsJson([
      "iam",
      "create-role",
      "--role-name",
      roleName,
      "--assume-role-policy-document",
      `file://${trustFile}`,
      "--description",
      "OneComputer sandbox CodeBuild role for building governed app images",
      "--tags",
      "Key=Project,Value=OneComputer-Secure-Apps",
      "Key=Owner,Value=NanoClaw",
    ]);
    roleArn = created.Role.Arn;
  }

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: [
          `arn:aws:logs:${region}:*:log-group:/aws/codebuild/onecomputer-*`,
          `arn:aws:logs:${region}:*:log-group:/aws/codebuild/onecomputer-*:log-stream:*`,
        ],
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
      {
        Effect: "Allow",
        Action: ["s3:GetBucketLocation"],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: "Allow",
        Action: ["ecr:GetAuthorizationToken"],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        Resource: repositoryArn,
      },
    ],
  };
  const policyFile = writeTempJson("codebuild-policy", policy);
  runAws([
    "iam",
    "put-role-policy",
    "--role-name",
    roleName,
    "--policy-name",
    "OneComputerAppImageBuildPolicy",
    "--policy-document",
    `file://${policyFile}`,
  ]);
  return roleArn;
}

function prepareCodeBuildSource({ appDir, outDir, imageUri, imageTag }) {
  const stageRoot = path.join(outDir, "aws-build-source");
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });
  copyAppSource(appDir, stageRoot);
  fs.copyFileSync(
    path.join(outDir, "Dockerfile.onecomputer"),
    path.join(stageRoot, "Dockerfile"),
  );
  if (
    !fs.existsSync(path.join(stageRoot, "requirements.txt")) &&
    fs.existsSync(path.join(outDir, "requirements.onecomputer.txt"))
  ) {
    fs.copyFileSync(
      path.join(outDir, "requirements.onecomputer.txt"),
      path.join(stageRoot, "requirements.onecomputer.txt"),
    );
  }
  const buildspec = [
    "version: 0.2",
    "phases:",
    "  pre_build:",
    "    commands:",
    "      - aws --version",
    "      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
    "  build:",
    "    commands:",
    "      - docker build -t $IMAGE_URI:$IMAGE_TAG .",
    "  post_build:",
    "    commands:",
    "      - docker push $IMAGE_URI:$IMAGE_TAG",
    '      - printf \'{"imageUri":"%s:%s"}\' "$IMAGE_URI" "$IMAGE_TAG" > image-detail.json',
    "artifacts:",
    "  files:",
    "    - image-detail.json",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(stageRoot, "buildspec.yml"), buildspec);

  const sourceArchive = path.join(outDir, "aws-build-source.zip");
  const zip = spawnSync(
    "python3",
    [
      "-c",
      [
        "import os, sys, zipfile",
        "root, out = sys.argv[1], sys.argv[2]",
        "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    for base, _, files in os.walk(root):",
        "        for name in files:",
        "            full = os.path.join(base, name)",
        "            z.write(full, os.path.relpath(full, root))",
      ].join("\n"),
      stageRoot,
      sourceArchive,
    ],
    {
      encoding: "utf8",
    },
  );
  if (zip.status !== 0) {
    throw new Error(`source zip failed: ${zip.stderr || zip.stdout}`);
  }
  return { stageRoot, sourceArchive, imageUri, imageTag };
}

function upsertCodeBuildProject({
  projectName,
  sourceLocation,
  roleArn,
  region,
}) {
  const project = {
    name: projectName,
    source: {
      type: "S3",
      location: sourceLocation,
      buildspec: "buildspec.yml",
    },
    artifacts: { type: "NO_ARTIFACTS" },
    environment: {
      type: "LINUX_CONTAINER",
      image: "aws/codebuild/standard:7.0",
      computeType: "BUILD_GENERAL1_SMALL",
      privilegedMode: true,
    },
    serviceRole: roleArn,
    timeoutInMinutes: 30,
    queuedTimeoutInMinutes: 30,
    logsConfig: {
      cloudWatchLogs: {
        status: "ENABLED",
        groupName: `/aws/codebuild/${projectName}`,
      },
    },
  };
  const file = writeTempJson("codebuild-project", project);
  const exists = runAwsJson([
    "codebuild",
    "batch-get-projects",
    "--names",
    projectName,
    "--region",
    region,
  ]);
  const command = exists.projects?.length ? "update-project" : "create-project";
  runAws([
    "codebuild",
    command,
    "--cli-input-json",
    `file://${file}`,
    "--region",
    region,
  ]);
}

function waitForCodeBuild({ buildId, region }) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 30 * 60 * 1000) {
    const data = runAwsJson([
      "codebuild",
      "batch-get-builds",
      "--ids",
      buildId,
      "--region",
      region,
    ]);
    const build = data.builds?.[0];
    last = build;
    const status = build?.buildStatus;
    if (
      ["SUCCEEDED", "FAILED", "FAULT", "STOPPED", "TIMED_OUT"].includes(status)
    ) {
      return build;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
  }
  return last ?? { buildStatus: "UNKNOWN_TIMEOUT", id: buildId };
}

function ensureEcsTaskAppRole({ roleName, region, db }) {
  const trust = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  };
  const trustFile = writeTempJson("ecs-app-task-trust", trust);
  const role = spawnSync(
    awsCliBin(),
    ["iam", "get-role", "--role-name", roleName, "--output", "json"],
    { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } },
  );
  let roleArn;
  if (role.status === 0) {
    roleArn = JSON.parse(role.stdout).Role.Arn;
  } else {
    const created = runAwsJson([
      "iam",
      "create-role",
      "--role-name",
      roleName,
      "--assume-role-policy-document",
      `file://${trustFile}`,
      "--description",
      "OneComputer sandbox ECS app task role",
      "--tags",
      "Key=Project,Value=OneComputer-Secure-Apps",
      "Key=Owner,Value=NanoClaw",
    ]);
    roleArn = created.Role.Arn;
  }
  const statements = [
    {
      Effect: "Allow",
      Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
      Resource: [
        `arn:aws:logs:${region}:*:log-group:/aws/ecs/default/onecomputer-*`,
      ],
    },
  ];
  if (db?.kind === "dynamodb") {
    statements.push({
      Effect: "Allow",
      Action: [
        "dynamodb:BatchGetItem",
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem",
      ],
      Resource: db.tableArn,
    });
  }
  const policyFile = writeTempJson("ecs-app-task-policy", {
    Version: "2012-10-17",
    Statement: statements,
  });
  runAws([
    "iam",
    "put-role-policy",
    "--role-name",
    roleName,
    "--policy-name",
    "OneComputerAppRuntimePolicy",
    "--policy-document",
    `file://${policyFile}`,
  ]);
  return roleArn;
}

function ensureDynamoDbTable({ appId, owner, dataClassification }) {
  const region = process.env.AWS_DEFAULT_REGION ?? "ap-southeast-1";
  const tableName = `${appId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 180)}-tasks`;
  const describe = spawnSync(
    awsCliBin(),
    [
      "dynamodb",
      "describe-table",
      "--table-name",
      tableName,
      "--region",
      region,
      "--output",
      "json",
    ],
    { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } },
  );
  let table;
  let created = false;
  if (describe.status === 0) {
    table = JSON.parse(describe.stdout).Table;
  } else {
    const result = runAwsJson([
      "dynamodb",
      "create-table",
      "--table-name",
      tableName,
      "--billing-mode",
      "PAY_PER_REQUEST",
      "--attribute-definitions",
      "AttributeName=id,AttributeType=S",
      "--key-schema",
      "AttributeName=id,KeyType=HASH",
      "--tags",
      `Key=Project,Value=OneComputer-Secure-Apps`,
      `Key=Owner,Value=${String(owner).replaceAll(",", " ")}`,
      `Key=DataClassification,Value=${String(dataClassification).replaceAll(",", " ")}`,
      "--region",
      region,
    ]);
    table = result.TableDescription;
    created = true;
  }
  for (let i = 0; i < 60; i += 1) {
    const current = runAwsJson([
      "dynamodb",
      "describe-table",
      "--table-name",
      tableName,
      "--region",
      region,
    ]).Table;
    table = current;
    if (current.TableStatus === "ACTIVE") break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  return {
    kind: "dynamodb",
    tableName,
    tableArn: table.TableArn,
    region,
    billingMode: "PAY_PER_REQUEST",
    keySchema: table.KeySchema,
    status: table.TableStatus,
    created,
  };
}

function provisionDatabase({ args, passport, executeAws }) {
  if (args.db === "none") return { requested: false, kind: "none" };
  if (!executeAws) {
    return {
      requested: true,
      ok: null,
      planned: true,
      kind: args.db,
      reason:
        "Dry run only; database will be provisioned during --execute-aws.",
    };
  }
  if (args.db === "postgres-later") {
    return {
      requested: true,
      ok: false,
      kind: "postgres-later",
      reason:
        "Postgres/RDS path is intentionally deferred until DynamoDB v1 is proven.",
    };
  }
  if (args.db === "dynamodb") {
    const table = ensureDynamoDbTable({
      appId: passport.id,
      owner: passport.owner,
      dataClassification: passport.dataClassification,
    });
    return { requested: true, ok: true, ...table };
  }
  throw new Error(`Unsupported db mode ${args.db}`);
}

function buildImageWithCodeBuild({ appDir, outDir, passport }) {
  const region = process.env.AWS_DEFAULT_REGION ?? "ap-southeast-1";
  const account = runAwsJson(["sts", "get-caller-identity"]).Account;
  const bucket =
    process.env.ONECOMPUTER_ARTIFACT_BUCKET ??
    `onecomputer-secure-apps-${account}-${region}`;
  ensureBucket({ bucket, region });
  const repoName =
    process.env.ONECOMPUTER_ECR_REPOSITORY ?? "onecomputer/app-images";
  const repo = ensureEcrRepository({ repoName, region });
  const imageTag = passport.id.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 128);
  const imageUri = repo.repositoryUri;
  const source = prepareCodeBuildSource({ appDir, outDir, imageUri, imageTag });
  const s3Key = `${passport.runtime.kind}-build-sources/${passport.id}.zip`;
  runAws([
    "s3",
    "cp",
    source.sourceArchive,
    `s3://${bucket}/${s3Key}`,
    "--region",
    region,
  ]);
  const roleName =
    process.env.ONECOMPUTER_CODEBUILD_ROLE ??
    "onecomputerAppImageCodeBuildRole";
  const roleArn = ensureCodeBuildRole({
    roleName,
    bucket,
    repositoryArn: repo.repositoryArn,
    region,
  });
  // CodeBuild validates sts:AssumeRole at project create/update time, so wait
  // after both the trust policy and inline policy are written.
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Number(process.env.IAM_PROPAGATION_MS ?? 12_000),
  );
  const projectName =
    process.env.ONECOMPUTER_CODEBUILD_PROJECT ?? "onecomputer-app-image-build";
  upsertCodeBuildProject({
    projectName,
    sourceLocation: `${bucket}/${s3Key}`,
    roleArn,
    region,
  });
  const started = runAwsJson([
    "codebuild",
    "start-build",
    "--project-name",
    projectName,
    "--region",
    region,
    "--environment-variables-override",
    `name=AWS_ACCOUNT_ID,value=${account},type=PLAINTEXT`,
    `name=IMAGE_URI,value=${imageUri},type=PLAINTEXT`,
    `name=IMAGE_TAG,value=${imageTag},type=PLAINTEXT`,
  ]);
  const buildId = started.build.id;
  const build = waitForCodeBuild({ buildId, region });
  const ok = build?.buildStatus === "SUCCEEDED";
  return {
    attempted: true,
    ok,
    region,
    account,
    bucket,
    s3Key,
    repository: repo.repositoryName,
    imageUri: `${imageUri}:${imageTag}`,
    buildId,
    buildStatus: build?.buildStatus,
    logsDeepLink: build?.logs?.deepLink,
    phaseSummary: build?.phases?.map((phase) => ({
      phaseType: phase.phaseType,
      phaseStatus: phase.phaseStatus,
    })),
  };
}

function parseAwsDeployStdout(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf("\n{");
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runAwsDeploy({
  appId,
  image,
  access,
  runtime,
  extraEnv = [],
  appTaskRoleArn,
}) {
  const accessEnv =
    access.mode === "sandbox-basic-auth"
      ? [
          { name: "ONECOMPUTER_AUTH_MODE", value: "basic" },
          { name: "ONECOMPUTER_BASIC_AUTH_USER", value: access.username },
          { name: "ONECOMPUTER_BASIC_AUTH_PASSWORD", value: access.password },
          {
            name: "ONECOMPUTER_ACCESS_POLICY",
            value: "sandbox-basic-auth-v0",
          },
        ]
      : access.mode === "origin-token"
        ? [
            { name: "ONECOMPUTER_AUTH_MODE", value: "origin-token" },
            { name: "ONECOMPUTER_ORIGIN_TOKEN", value: access.originToken },
            {
              name: "ONECOMPUTER_ACCESS_POLICY",
              value: "gateway-origin-token-v0",
            },
          ]
        : [
            { name: "ONECOMPUTER_AUTH_MODE", value: "none" },
            {
              name: "ONECOMPUTER_ACCESS_POLICY",
              value: "app-managed-auth-v0",
            },
          ];
  const env = {
    ...process.env,
    SERVICE_PREFIX: `onecomputer-${runtime.kind}-${appId}`,
    PRIMARY_IMAGE: image,
    PRIMARY_PORT: "8080",
    HEALTH_CHECK_PATH: runtime.healthPath ?? "/_onecomputer/health",
    TTL_HOURS: process.env.ONECOMPUTER_TTL_HOURS ?? "24",
    AWS_CLI_BIN: awsCliBin(),
    APP_TASK_ROLE_ARN: appTaskRoleArn ?? "",
    PRIMARY_ENV_JSON: JSON.stringify([
      ...accessEnv,
      { name: "ONECOMPUTER_APP_ID", value: appId },
      ...extraEnv,
    ]),
    TASK_ROLE_NAME:
      process.env.TASK_ROLE_NAME ?? "onecomputerSecureAppsEcsTaskExecutionRole",
    INFRA_ROLE_NAME:
      process.env.INFRA_ROLE_NAME ??
      "onecomputerSecureAppsEcsExpressInfrastructureRole",
  };
  const result = spawnSync(
    "bash",
    ["scripts/secure-apps/deploy-ecs-express-sandbox.sh"],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    },
  );
  return {
    attempted: true,
    ok: result.status === 0,
    status: result.status,
    result: parseAwsDeployStdout(result.stdout),
    stdoutTail: result.stdout?.slice(-2000),
    stderrTail: result.stderr?.slice(-2000),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const appDir = path.resolve(args.appPath);
  if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    throw new Error(`App path is not a directory: ${appDir}`);
  }

  const detection = detectApp(appDir, args.runtime);
  if (!["streamlit", "node", "react-static"].includes(detection.kind)) {
    throw new Error(
      `Supported runtimes are Streamlit, Node.js service, and React static app. Could not detect a supported runtime in ${appDir}`,
    );
  }
  if (args.db !== "none" && detection.kind === "react-static") {
    throw new Error(
      "React static deploys cannot attach a database in v1. Deploy a Node.js backend with --db dynamodb instead.",
    );
  }

  const files = listFiles(appDir);
  const findings = scanSecurity(appDir, files);
  const sourceHash = sha256Dir(appDir, files);
  const appName = slugify(path.basename(appDir));
  const appId = `${appName}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const outRoot = path.resolve(args.out);
  const outDir = path.join(outRoot, appId);
  fs.mkdirSync(outDir, { recursive: true });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + args.ttlHours * 60 * 60 * 1000);
  const passport = {
    schema: "onecomputer.app-passport.v0",
    id: appId,
    name: path.basename(appDir),
    owner: args.owner,
    purpose: args.purpose,
    dataClassification: args.dataClassification,
    users: args.users
      .split(",")
      .map((user) => user.trim())
      .filter(Boolean),
    source: {
      path: path.relative(repoRoot, appDir).replaceAll(path.sep, "/"),
      hash: `sha256:${sourceHash}`,
      fileCount: files.length,
    },
    runtime: runtimeForDetection({ detection, appName }),
    controls: {
      auth: args.executeAws
        ? args.accessMode === "origin-token"
          ? "gateway-origin-token"
          : args.accessMode === "none"
            ? "app-managed-auth"
            : "sandbox-basic-auth"
        : "required-before-production",
      accessClaim: "onecomputer-vti-style-claim-required",
      approval: findings.some((finding) => finding.severity === "high")
        ? "security-review-required"
        : "owner-approval-required",
      expiry: expiresAt.toISOString(),
      revoke: "kill-switch-required-before-production",
      evidence: "generated",
    },
    createdAt: now.toISOString(),
  };

  const dockerfile = dockerfileForDetection(detection);
  fs.writeFileSync(path.join(outDir, "Dockerfile.onecomputer"), dockerfile);
  if (detection.kind === "streamlit" && !detection.requirementsFile) {
    fs.writeFileSync(
      path.join(outDir, "requirements.onecomputer.txt"),
      "streamlit==1.41.1\n",
    );
  }

  const database = provisionDatabase({
    args,
    passport,
    executeAws: args.executeAws,
  });
  let appTaskRoleArn = null;
  let runtimeEnv = [...args.env];
  if (database.ok && database.kind === "dynamodb") {
    appTaskRoleArn = ensureEcsTaskAppRole({
      roleName: `onecomputerAppTaskRole-${passport.id}`.slice(0, 64),
      region: database.region,
      db: database,
    });
    runtimeEnv = [
      { name: "ONECOMPUTER_DB_MODE", value: "dynamodb" },
      { name: "ONECOMPUTER_DYNAMODB_TABLE", value: database.tableName },
      { name: "AWS_REGION", value: database.region },
      { name: "AWS_DEFAULT_REGION", value: database.region },
    ];
  }
  passport.database = database;

  let awsBuild = { attempted: false };
  let access = null;
  let awsDeploy = { attempted: false };
  if (args.executeAws) {
    const suppliedImage =
      process.env.ONECOMPUTER_APP_IMAGE ??
      process.env.ONECOMPUTER_STREAMLIT_IMAGE;
    if (suppliedImage) {
      awsBuild = {
        attempted: false,
        ok: true,
        reason:
          "Using supplied ONECOMPUTER_APP_IMAGE / ONECOMPUTER_STREAMLIT_IMAGE.",
        imageUri: suppliedImage,
      };
    } else if (args.skipAwsBuild) {
      awsBuild = {
        attempted: false,
        ok: false,
        reason:
          "Missing ONECOMPUTER_APP_IMAGE (or legacy ONECOMPUTER_STREAMLIT_IMAGE) and --skip-aws-build was set.",
      };
    } else {
      awsBuild = buildImageWithCodeBuild({ appDir, outDir, passport });
    }
    if (awsBuild.ok) {
      access =
        args.accessMode === "origin-token"
          ? {
              originToken:
                process.env.ONECOMPUTER_ORIGIN_TOKEN ??
                crypto.randomBytes(32).toString("base64url"),
              mode: "origin-token",
            }
          : args.accessMode === "none"
            ? { mode: "none" }
            : {
                username:
                  process.env.ONECOMPUTER_BASIC_AUTH_USER ?? "onecomputer",
                password:
                  process.env.ONECOMPUTER_BASIC_AUTH_PASSWORD ??
                  crypto.randomBytes(18).toString("base64url"),
                mode: "sandbox-basic-auth",
              };
      awsDeploy = runAwsDeploy({
        appId,
        image: awsBuild.imageUri,
        access,
        runtime: passport.runtime,
        extraEnv: runtimeEnv,
        appTaskRoleArn,
      });
    } else {
      awsDeploy = {
        attempted: false,
        ok: false,
        reason: awsBuild.reason ?? "AWS image build failed.",
      };
    }
  }
  const hasHighFindings = findings.some(
    (finding) => finding.severity === "high",
  );
  const awsFailed =
    (awsBuild.attempted || args.executeAws) && (!awsBuild.ok || !awsDeploy.ok);
  const evidence = {
    schema: "onecomputer.evidence-pack.v0",
    appId,
    generatedAt: now.toISOString(),
    status: hasHighFindings
      ? "blocked-for-review"
      : awsFailed
        ? "aws-execution-blocked"
        : args.executeAws
          ? "aws-executed"
          : "dry-run-ready",
    events: [
      { at: now.toISOString(), type: "app.detected", detail: detection },
      {
        at: now.toISOString(),
        type: "source.hashed",
        detail: { hash: passport.source.hash, fileCount: files.length },
      },
      {
        at: now.toISOString(),
        type: "security.scan.completed",
        detail: { findingCount: findings.length, findings },
      },
      {
        at: now.toISOString(),
        type: "passport.created",
        detail: { passportId: appId },
      },
      {
        at: now.toISOString(),
        type: "runtime.dockerfile.generated",
        detail: { file: "Dockerfile.onecomputer", runtime: detection.kind },
      },
      { at: now.toISOString(), type: "database.provisioned", detail: database },
      { at: now.toISOString(), type: "image.aws-build", detail: awsBuild },
      { at: now.toISOString(), type: "deploy.aws", detail: awsDeploy },
    ],
    runtimeAccess: access
      ? {
          mode: access.mode,
          username: access.username ?? null,
          passwordStoredIn: access.password
            ? "access-instructions.local.json"
            : null,
          originTokenStoredIn: access.originToken
            ? "access-instructions.local.json"
            : null,
          endpoint: awsDeploy.result?.endpoint ?? null,
          note:
            access.mode === "origin-token"
              ? "Direct origin requires X-OneComputer-Origin-Token; user access must go through OneComputer Access Gateway."
              : access.mode === "none"
                ? "App is responsible for its own access control; use only for gateway/control-plane services."
                : "Sandbox basic auth is a temporary proof gate; IAM/VTI broker remains P0 for CISO pilot.",
        }
      : null,
    controlMapping: {
      cisoReview: [
        "owner",
        "dataClassification",
        "runtime",
        "evidence",
        "expiry",
        "revoke",
      ],
      nhiCredentialReview: [
        "no-raw-aws-credentials-issued-to-user",
        "image-deploy-requires-brokered-aws-role",
      ],
      cyberEvidenceReview: [
        "source-hash",
        "passport",
        "secret-scan",
        "deploy-event",
      ],
    },
  };

  writeJson(path.join(outDir, "app-passport.json"), passport);
  writeJson(path.join(outDir, "evidence-pack.json"), evidence);
  writeJson(path.join(outDir, "onecomputer-app-manifest.json"), {
    appId,
    kind: detection.kind,
    mainFile: detection.mainFile,
    deployCommand: `pnpm onecomputer:deploy ${passport.source.path}`,
    artifacts: [
      "app-passport.json",
      "evidence-pack.json",
      "Dockerfile.onecomputer",
      "RUNBOOK.md",
    ],
  });
  fs.writeFileSync(
    path.join(outDir, "RUNBOOK.md"),
    markdownRunbook({ passport, detection, executeAws: args.executeAws }),
  );
  if (access) {
    writeJson(path.join(outDir, "access-instructions.local.json"), {
      schema: "onecomputer.access-instructions.local.v0",
      appId,
      endpoint: awsDeploy.result?.endpoint
        ? `https://${String(awsDeploy.result.endpoint).replace(/^https?:\/\//, "")}`
        : null,
      authMode: access.mode,
      username: access.username ?? null,
      password: access.password ?? null,
      originToken: access.originToken ?? null,
      warning:
        access.mode === "origin-token"
          ? "Origin-only token. Do not expose to users. Store in Secrets Manager and route users through OneComputer Access Gateway."
          : access.mode === "none"
            ? "No outer nginx auth configured. Only use for apps with app-managed auth."
            : "Sandbox-only credential. Do not commit/share. Replace with IAM/VTI broker before pilot.",
    });
  }

  const summary = {
    ok: !hasHighFindings && !awsFailed,
    mode: args.executeAws ? "execute-aws" : "dry-run",
    appId,
    app: passport.name,
    kind: detection.kind,
    owner: passport.owner,
    dataClassification: passport.dataClassification,
    artifactDir: path.relative(repoRoot, outDir).replaceAll(path.sep, "/"),
    findings,
    database,
    awsBuild: {
      attempted: awsBuild.attempted,
      ok: awsBuild.ok,
      imageUri: awsBuild.imageUri,
      buildStatus: awsBuild.buildStatus,
      logsDeepLink: awsBuild.logsDeepLink,
    },
    awsDeploy: {
      attempted: awsDeploy.attempted,
      ok: awsDeploy.ok,
      endpoint: awsDeploy.result?.endpoint
        ? `https://${String(awsDeploy.result.endpoint).replace(/^https?:\/\//, "")}`
        : null,
      serviceName: awsDeploy.result?.serviceName,
      serviceArn: awsDeploy.result?.serviceArn,
      accessMode: access?.mode ?? null,
      credentialsFile: access ? "access-instructions.local.json" : null,
    },
    next: awsFailed
      ? awsDeploy.reason ||
        awsBuild.reason ||
        "Review AWS build/deploy failure in evidence-pack.json."
      : args.executeAws
        ? "Open the endpoint with the local sandbox credential, then replace sandbox basic auth with IAM/VTI gate."
        : "Review the generated passport/evidence, then rerun with --execute-aws to build and deploy the governed app image.",
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
