#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="${ONECOMPUTER_CONTROL_TABLE:?Set ONECOMPUTER_CONTROL_TABLE}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-1}}"
AWS_BIN="${AWS_BIN:-aws}"
NODE_BIN="${NODE_BIN:-node}"
PORT="${PORT:-45992}"
ORIGIN_PORT="${ORIGIN_PORT:-45991}"
APP_ID="${ONECOMPUTER_APP_ID:-p1-durable-registry-smoke}"
USER_ID="${ONECOMPUTER_SMOKE_USER:-terence}"
GRANT_SECRET="${ONECOMPUTER_GATEWAY_GRANT_SECRET:-p1-smoke-grant-secret}"
ADMIN_TOKEN="${ONECOMPUTER_GATEWAY_ADMIN_TOKEN:-p1-smoke-admin-token}"
ORIGIN_TOKEN="${ONECOMPUTER_ORIGIN_TOKEN:-p1-smoke-origin-token}"
TMPDIR="$(mktemp -d)"
ORIGIN_LOG="$TMPDIR/origin.log"
GATEWAY_LOG="$TMPDIR/gateway.log"

cleanup() {
  kill "${ORIGIN_PID:-}" "${GATEWAY_PID:-}" "${GATEWAY_PID2:-}" 2>/dev/null || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

cat > "$TMPDIR/origin.mjs" <<'EOF'
import http from 'node:http';
const token = process.env.ONECOMPUTER_ORIGIN_TOKEN;
const port = Number(process.env.ORIGIN_PORT || 45991);
const server = http.createServer((req, res) => {
  if (req.headers['x-onecomputer-origin-token'] !== token) {
    res.writeHead(403, {'content-type':'application/json'}).end(JSON.stringify({error:'bad_origin_token'}));
    return;
  }
  res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ok:true,user:req.headers['x-onecomputer-user']||null,path:req.url}));
});
server.listen(port, '127.0.0.1', () => console.log('origin ready'));
EOF

ONECOMPUTER_ORIGIN_TOKEN="$ORIGIN_TOKEN" ORIGIN_PORT="$ORIGIN_PORT" "$NODE_BIN" "$TMPDIR/origin.mjs" >"$ORIGIN_LOG" 2>&1 & ORIGIN_PID=$!
for _ in $(seq 1 80); do grep -q 'origin ready' "$ORIGIN_LOG" && break || sleep 0.1; done

wait_gateway() {
  local port="$1"
  for _ in $(seq 1 100); do
    if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "gateway_failed_to_start port=$port" >&2
  cat "$GATEWAY_LOG" >&2 || true
  return 1
}

ONECOMPUTER_APP_ID="$APP_ID" \
ONECOMPUTER_ORIGIN_URL="http://127.0.0.1:$ORIGIN_PORT" \
ONECOMPUTER_ORIGIN_TOKEN="$ORIGIN_TOKEN" \
ONECOMPUTER_ALLOWED_USERS="$USER_ID" \
ONECOMPUTER_APP_STATUS=active \
AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
"$(dirname "$0")/seed-control-table.sh" >/dev/null

ONECOMPUTER_REGISTRY_BACKEND=dynamodb \
ONECOMPUTER_CONTROL_TABLE="$TABLE_NAME" \
ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_GATEWAY_ADMIN_TOKEN="$ADMIN_TOKEN" \
AWS_REGION="$REGION" PORT="$PORT" \
"$NODE_BIN" src/server.mjs >"$GATEWAY_LOG" 2>&1 & GATEWAY_PID=$!
wait_gateway "$PORT"

GRANT=$(ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" "$NODE_BIN" ../../../scripts/onecomputer/generate-gateway-grant.mjs "$USER_ID" "$APP_ID" 3600)
CURL=(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o /dev/null -w '%{http_code}')

NO_GRANT=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/")
WITH_GRANT=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GRANT")
PAUSE=$("${CURL[@]}" -X POST -H "x-onecomputer-admin-token: $ADMIN_TOKEN" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/pause")
PAUSED_ACCESS=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GRANT")
kill "$GATEWAY_PID" 2>/dev/null || true
wait "$GATEWAY_PID" 2>/dev/null || true

ONECOMPUTER_REGISTRY_BACKEND=dynamodb \
ONECOMPUTER_CONTROL_TABLE="$TABLE_NAME" \
ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_GATEWAY_ADMIN_TOKEN="$ADMIN_TOKEN" \
AWS_REGION="$REGION" PORT="$PORT" \
"$NODE_BIN" src/server.mjs >>"$GATEWAY_LOG" 2>&1 & GATEWAY_PID2=$!
wait_gateway "$PORT"
PAUSED_AFTER_RESTART=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GRANT")
RESUME=$("${CURL[@]}" -X POST -H "x-onecomputer-admin-token: $ADMIN_TOKEN" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/resume")
RESUMED_ACCESS=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GRANT")
REVOKE=$(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o /dev/null -w '%{http_code}' -X POST -H "content-type: application/json" -H "x-onecomputer-admin-token: $ADMIN_TOKEN" -d "{\"user\":\"$USER_ID\"}" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/revoke-user")
REVOKED_ACCESS=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GRANT")

test "$NO_GRANT" = 403
test "$WITH_GRANT" = 200
test "$PAUSE" = 200
test "$PAUSED_ACCESS" = 403
test "$PAUSED_AFTER_RESTART" = 403
test "$RESUME" = 200
test "$RESUMED_ACCESS" = 200
test "$REVOKE" = 200
test "$REVOKED_ACCESS" = 403

echo "dynamodb_smoke_passed appId=$APP_ID table=$TABLE_NAME no_grant=$NO_GRANT with_grant=$WITH_GRANT pause=$PAUSE paused_after_restart=$PAUSED_AFTER_RESTART resume=$RESUME revoke=$REVOKE revoked_access=$REVOKED_ACCESS"
