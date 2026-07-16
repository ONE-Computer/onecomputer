#!/bin/sh
# Configure an existing ONEComputer OSS checkout for local development.
#
# This script is separate from install.sh so contributors can rerun setup
# against a checkout without cloning, changing Git remotes, or deleting data.
# It starts only PostgreSQL; the web app and Rust gateway run from source.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
START=0
SKIP_DEPS=0
DRY_RUN=0
POSTGRES_PORT_EXPLICIT=0
if [ -n "${ONECOMPUTER_POSTGRES_PORT:-}" ] || [ -n "${POSTGRES_PORT:-}" ]; then
  POSTGRES_PORT_EXPLICIT=1
fi
POSTGRES_PORT="${ONECOMPUTER_POSTGRES_PORT:-${POSTGRES_PORT:-5432}}"
APP_PORT="${ONECOMPUTER_APP_PORT:-10254}"
GATEWAY_PORT="${ONECOMPUTER_GATEWAY_PORT:-10255}"

die() {
  echo "onecomputer: error: $*" >&2
  exit 1
}

say() {
  echo "  $*"
}

usage() {
  cat <<'EOF'
Usage: scripts/onecomputer/setup.sh [options]

Prepare an existing ONEComputer checkout for local development.

Options:
  --start                    Start the web and gateway dev processes.
  --no-start                 Prepare dependencies and database only.
  --skip-deps                Skip pnpm install and Prisma generation.
  --dry-run                  Print the plan without changing files or services.
  --postgres-port PORT       Host port for PostgreSQL (default 5432).
  --app-port PORT            Web dashboard port (default 10254).
  --gateway-port PORT        Gateway port (default 10255).
  --help                     Show this help.
EOF
}

env_value() {
  key=$1
  file=$2
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

set_env_value() {
  key=$1
  value=$2
  file=$3
  temp="$file.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" { print key "=" value; updated = 1; next }
    { print }
    END { if (!updated) print key "=" value }
  ' "$file" > "$temp" || { rm -f "$temp"; die "could not update $file"; }
  mv "$temp" "$file"
}

random_base64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\r\n'
  elif command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))'
  else
    die "openssl or node is required to generate local secrets"
  fi
}

port_in_use() {
  port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" { found = 1 } END { exit !found }'
    return $?
  fi
  return 1
}

check_node() {
  command -v node >/dev/null 2>&1 || die "Node.js 18+ is required; install it from https://nodejs.org/"
  node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  case "$node_major" in
    ''|*[!0-9]*) die "could not read the Node.js version" ;;
  esac
  [ "$node_major" -ge 18 ] || die "Node.js 18+ is required (found $(node --version))"
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    say "Enabling the repository's pnpm package manager..."
    corepack enable >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || die "pnpm 9+ is required. Run: corepack enable && corepack prepare pnpm@9.0.0 --activate"
}

check_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is required; install Docker Desktop or Docker Engine from https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and retry."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required. Update Docker Desktop or install the Compose plugin."
}

ensure_env() {
  env_file="$ROOT/.env"
  example="$ROOT/.env.example"
  [ -f "$example" ] || die "$example is missing"

  if [ ! -f "$env_file" ]; then
    cp "$example" "$env_file"
    chmod 600 "$env_file"
    say "Created .env from .env.example (mode 600)."
  fi

  encryption_key=$(env_value SECRET_ENCRYPTION_KEY "$env_file" || true)
  case "${encryption_key:-}" in
    ''|change-me-to-secure-key)
      set_env_value SECRET_ENCRYPTION_KEY "$(random_base64)" "$env_file"
      say "Generated a local encryption key without printing it."
      ;;
  esac

  internal_secret=$(env_value GATEWAY_INTERNAL_SECRET "$env_file" || true)
  if [ -z "${internal_secret:-}" ]; then
    set_env_value GATEWAY_INTERNAL_SECRET "$(random_base64)" "$env_file"
    say "Generated a local gateway secret without printing it."
  fi

  set_env_value POSTGRES_PORT "$POSTGRES_PORT" "$env_file"
  set_env_value ONECOMPUTER_APP_PORT "$APP_PORT" "$env_file"
  set_env_value ONECOMPUTER_GATEWAY_PORT "$GATEWAY_PORT" "$env_file"

  database_url=$(env_value DATABASE_URL "$env_file" || true)
  case "$database_url" in
    postgresql://*@localhost:*/*|postgresql://*@127.0.0.1:*/*)
      local_database_url=$(printf '%s\n' "$database_url" | sed -E "s/@(localhost|127\\.0\\.0\\.1):[0-9]+\\//@\\1:$POSTGRES_PORT\\//")
      if [ "$local_database_url" != "$database_url" ]; then
        set_env_value DATABASE_URL "$local_database_url" "$env_file"
      fi
      ;;
  esac

  chmod 600 "$env_file"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --start) START=1; shift ;;
    --no-start) START=0; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --postgres-port)
      [ "$#" -ge 2 ] || die "--postgres-port requires a port"
      POSTGRES_PORT=$2
      POSTGRES_PORT_EXPLICIT=1
      shift 2
      ;;
    --app-port)
      [ "$#" -ge 2 ] || die "--app-port requires a port"
      APP_PORT=$2
      shift 2
      ;;
    --gateway-port)
      [ "$#" -ge 2 ] || die "--gateway-port requires a port"
      GATEWAY_PORT=$2
      shift 2
      ;;
    --source-dir)
      [ "$#" -ge 2 ] || die "--source-dir requires a path"
      ROOT=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option '$1' (use --help)" ;;
  esac
done

ROOT=$(CDPATH= cd -- "$ROOT" && pwd)
[ -f "$ROOT/package.json" ] || die "$ROOT is not a ONEComputer checkout"
[ -f "$ROOT/docker/docker-compose.yml" ] || die "$ROOT/docker/docker-compose.yml is missing"

if [ "$POSTGRES_PORT_EXPLICIT" -eq 0 ] && [ -f "$ROOT/.env" ]; then
  configured_postgres_port=$(env_value POSTGRES_PORT "$ROOT/.env" || true)
  if [ -n "${configured_postgres_port:-}" ]; then
    POSTGRES_PORT=$configured_postgres_port
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "ONEComputer local setup plan"
  echo "  checkout:  $ROOT"
  echo "  postgres:  $POSTGRES_PORT"
  echo "  dashboard: $APP_PORT"
  echo "  gateway:   $GATEWAY_PORT"
  echo "  start:     $([ "$START" -eq 1 ] && echo yes || echo no)"
  echo "  deps:      $([ "$SKIP_DEPS" -eq 1 ] && echo skip || echo install)"
  echo ""
  echo "No files or services will be changed."
  exit 0
fi

check_node
check_pnpm
check_docker

postgres_service_running() {
  docker compose -f "$ROOT/docker/docker-compose.yml" ps --status running --services 2>/dev/null \
    | grep -qx 'postgres'
}

if port_in_use "$POSTGRES_PORT" && ! postgres_service_running; then
  if [ "$POSTGRES_PORT_EXPLICIT" -eq 1 ]; then
    die "PostgreSQL port $POSTGRES_PORT is already in use; choose --postgres-port 5433"
  fi
  if ! port_in_use 5433; then
    POSTGRES_PORT=5433
    say "Port 5432 is busy; using PostgreSQL port 5433."
  else
    die "PostgreSQL ports 5432 and 5433 are busy; choose --postgres-port PORT"
  fi
fi

cd "$ROOT"
ensure_env

if [ "$SKIP_DEPS" -eq 0 ]; then
  say "Installing JavaScript dependencies from pnpm-lock.yaml..."
  pnpm install --frozen-lockfile
  say "Generating Prisma client..."
  pnpm db:generate
fi

export POSTGRES_PORT
say "Starting PostgreSQL with Docker Compose..."
docker compose -f "$ROOT/docker/docker-compose.yml" up -d --wait postgres

if [ "$SKIP_DEPS" -eq 0 ]; then
  say "Applying database migrations..."
  pnpm db:migrate
fi

echo ""
echo "ONEComputer is prepared."
echo "  Checkout:   $ROOT"
echo "  Dashboard:  http://127.0.0.1:$APP_PORT"
echo "  Gateway:    http://127.0.0.1:$GATEWAY_PORT"
echo "  PostgreSQL: 127.0.0.1:$POSTGRES_PORT"
echo ""
echo "  Stop database: docker compose -f $ROOT/docker/docker-compose.yml stop postgres"
echo "  Re-run setup:  sh $ROOT/scripts/onecomputer/setup.sh"

if [ "$START" -eq 1 ]; then
  echo ""
  echo "Starting the web and gateway development processes..."
  exec pnpm dev
fi

echo "  Start app:     cd $ROOT && pnpm dev"
