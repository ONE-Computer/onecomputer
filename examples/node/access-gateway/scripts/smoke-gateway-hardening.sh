#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${NODE_BIN:-node}"
PORT="${PORT:-45996}"
ORIGIN_PORT="${ORIGIN_PORT:-45995}"
APP_ID="${ONECOMPUTER_APP_ID:-p4-hardening-smoke}"
USER_ID="${ONECOMPUTER_SMOKE_USER:-terence}"
GRANT_SECRET="${ONECOMPUTER_GATEWAY_GRANT_SECRET:-p4-smoke-grant-secret}"
ADMIN_TOKEN="${ONECOMPUTER_GATEWAY_ADMIN_TOKEN:-p4-smoke-admin-token}"
ORIGIN_TOKEN="${ONECOMPUTER_ORIGIN_TOKEN:-p4-smoke-origin-token}"
TMPDIR="$(mktemp -d)"
ORIGIN_LOG="$TMPDIR/origin.log"
GATEWAY_LOG="$TMPDIR/gateway.log"

cleanup() {
  kill "${ORIGIN_PID:-}" "${GATEWAY_PID:-}" 2>/dev/null || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

cat > "$TMPDIR/origin.mjs" <<'EOF'
import http from 'node:http';
const token = process.env.ONECOMPUTER_ORIGIN_TOKEN;
const port = Number(process.env.ORIGIN_PORT || 45995);
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

REGISTRY_JSON=$(python3 - "$APP_ID" "$ORIGIN_PORT" "$ORIGIN_TOKEN" "$USER_ID" <<'PY'
import json, sys
app_id, origin_port, origin_token, user_id = sys.argv[1:]
print(json.dumps([{
  'appId': app_id,
  'originUrl': f'http://127.0.0.1:{origin_port}',
  'originToken': origin_token,
  'allowedUsers': [user_id],
  'status': 'active'
}]))
PY
)

ONECOMPUTER_REGISTRY_JSON="$REGISTRY_JSON" \
ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_GATEWAY_ADMIN_TOKEN="$ADMIN_TOKEN" \
ONECOMPUTER_BODY_LIMIT=64b \
ONECOMPUTER_RATE_LIMIT_MAX=2 \
ONECOMPUTER_ADMIN_RATE_LIMIT_MAX=10 \
ONECOMPUTER_RATE_LIMIT_WINDOW_MS=60000 \
PORT="$PORT" \
"$NODE_BIN" src/server.mjs >"$GATEWAY_LOG" 2>&1 & GATEWAY_PID=$!
for _ in $(seq 1 100); do
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

CURL=(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s)
HEADER_FILE="$TMPDIR/headers.txt"
BODY_FILE="$TMPDIR/body.txt"
STATUS=$("${CURL[@]}" -D "$HEADER_FILE" -o "$BODY_FILE" -w '%{http_code}' -H 'x-onecomputer-request-id: p4-smoke-request' "http://127.0.0.1:$PORT/")
test "$STATUS" = 200
grep -qi '^x-onecomputer-request-id: p4-smoke-request' "$HEADER_FILE"
grep -qi '^x-content-type-options: nosniff' "$HEADER_FILE"
grep -qi '^x-frame-options: DENY' "$HEADER_FILE"
grep -qi '^content-security-policy:' "$HEADER_FILE"
if grep -qi '^x-powered-by:' "$HEADER_FILE"; then
  echo "x_powered_by_header_present"
  exit 1
fi

# Third non-health request should exceed the max=2 gateway bucket.
"${CURL[@]}" -o /dev/null "http://127.0.0.1:$PORT/" >/dev/null
RATE_LIMIT=$("${CURL[@]}" -o "$TMPDIR/rate.json" -w '%{http_code}' "http://127.0.0.1:$PORT/")
test "$RATE_LIMIT" = 429

BIG_BODY=$(python3 - <<'PY'
print('{"user":"' + 'x'*200 + '"}')
PY
)
BODY_LIMIT=$("${CURL[@]}" -o "$TMPDIR/body-limit.json" -w '%{http_code}' -X POST -H 'content-type: application/json' -H "x-onecomputer-admin-token: $ADMIN_TOKEN" --data "$BIG_BODY" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/revoke-user")
test "$BODY_LIMIT" = 413

echo "gateway_hardening_smoke_passed headers=ok rate_limit=$RATE_LIMIT body_limit=$BODY_LIMIT request_id=ok"
