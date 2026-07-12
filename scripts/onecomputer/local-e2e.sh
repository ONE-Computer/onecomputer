#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT/.local-e2e"
WEB_PORT="${ONECOMPUTER_LOCAL_WEB_PORT:-11254}"
GATEWAY_PORT="${ONECOMPUTER_LOCAL_GATEWAY_PORT:-11255}"
mkdir -p "$STATE_DIR"

cd "$ROOT"

dotenv() {
  pnpm exec dotenv -e .env -- "$@"
}

cargo_bin() {
  if command -v cargo >/dev/null 2>&1; then
    command -v cargo
  elif command -v rustup >/dev/null 2>&1; then
    rustup which cargo
  else
    echo "cargo/rustup is required" >&2
    return 1
  fi
}

rustc_bin() {
  if command -v rustc >/dev/null 2>&1; then
    command -v rustc
  else
    rustup which rustc
  fi
}

alive() {
  local file="$1"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" 2>/dev/null
}

start() {
  docker compose --env-file .env -p onecomputer-e2e -f docker/docker-compose.yml up -d postgres
  dotenv pnpm db:generate
  dotenv pnpm --filter @onecli/db prisma migrate deploy
  dotenv pnpm --filter @onecli/api seed:demo

  local cargo rustc
  cargo="$(cargo_bin)"
  rustc="$(rustc_bin)"
  RUSTC="$rustc" "$cargo" build --manifest-path apps/gateway/Cargo.toml

  if ! alive "$STATE_DIR/gateway.pid"; then
    dotenv nohup apps/gateway/target/debug/onecli-gateway \
      --port "$GATEWAY_PORT" --data-dir "$STATE_DIR/gateway-data" \
      >"$STATE_DIR/gateway.log" 2>&1 &
    echo $! >"$STATE_DIR/gateway.pid"
  fi

  if ! alive "$STATE_DIR/web.pid"; then
    dotenv nohup pnpm --filter @onecli/web exec next dev --port "$WEB_PORT" \
      >"$STATE_DIR/web.log" 2>&1 &
    echo $! >"$STATE_DIR/web.pid"
  fi

  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$WEB_PORT/v1/health" >/dev/null && \
       curl -fsS "http://127.0.0.1:$GATEWAY_PORT/healthz" >/dev/null; then
      status
      return 0
    fi
    sleep 1
  done

  echo "Local services did not become healthy; inspect $STATE_DIR/*.log" >&2
  status
  return 1
}

stop() {
  for service in web gateway; do
    local file="$STATE_DIR/$service.pid"
    if alive "$file"; then kill "$(cat "$file")"; fi
    rm -f "$file"
  done
  docker compose --env-file .env -p onecomputer-e2e -f docker/docker-compose.yml down
}

status() {
  echo "portal=http://127.0.0.1:$WEB_PORT"
  echo "gateway=http://127.0.0.1:$GATEWAY_PORT"
  curl -sS -o /dev/null -w 'portal_status=%{http_code}\n' "http://127.0.0.1:$WEB_PORT" || true
  curl -sS -o /dev/null -w 'api_status=%{http_code}\n' "http://127.0.0.1:$WEB_PORT/v1/health" || true
  curl -sS -o /dev/null -w 'gateway_status=%{http_code}\n' "http://127.0.0.1:$GATEWAY_PORT/healthz" || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
