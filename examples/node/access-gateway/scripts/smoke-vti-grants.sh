#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${NODE_BIN:-node}"
PORT="${PORT:-45994}"
ORIGIN_PORT="${ORIGIN_PORT:-45993}"
APP_ID="${ONECOMPUTER_APP_ID:-p2-passport-smoke}"
USER_ID="${ONECOMPUTER_SMOKE_USER:-terence}"
GRANT_SECRET="${ONECOMPUTER_GATEWAY_GRANT_SECRET:-p2-smoke-grant-secret}"
ADMIN_TOKEN="${ONECOMPUTER_GATEWAY_ADMIN_TOKEN:-p2-smoke-admin-token}"
ORIGIN_TOKEN="${ONECOMPUTER_ORIGIN_TOKEN:-p2-smoke-origin-token}"
POLICY_HASH="${ONECOMPUTER_POLICY_HASH:-sha256:p2-policy-hash}"
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
const port = Number(process.env.ORIGIN_PORT || 45993);
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

REGISTRY_JSON=$(python3 - "$APP_ID" "$ORIGIN_PORT" "$ORIGIN_TOKEN" "$USER_ID" "$POLICY_HASH" <<'PY'
import json, sys
app_id, origin_port, origin_token, user_id, policy_hash = sys.argv[1:]
print(json.dumps([{
  'appId': app_id,
  'originUrl': f'http://127.0.0.1:{origin_port}',
  'originToken': origin_token,
  'allowedUsers': [user_id],
  'status': 'active',
  'ownerDid': 'did:example:onecomputer:user:terence',
  'appDid': f'did:example:onecomputer:app:{app_id}',
  'vtaDid': 'did:example:onecomputer:vta:local',
  'vtcId': 'vtc:onecomputer:sandbox',
  'dataClassification': 'confidential',
  'riskTier': 'medium',
  'runtimeKind': 'node',
  'policyHash': policy_hash,
  'evidenceHash': 'sha256:p2-evidence-placeholder'
}]))
PY
)

ONECOMPUTER_REGISTRY_JSON="$REGISTRY_JSON" \
ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_GATEWAY_ADMIN_TOKEN="$ADMIN_TOKEN" \
PORT="$PORT" \
"$NODE_BIN" src/server.mjs >"$GATEWAY_LOG" 2>&1 & GATEWAY_PID=$!
for _ in $(seq 1 100); do
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

make_grant() {
  ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
  ONECOMPUTER_GRANT_SCHEMA=vti \
  ONECOMPUTER_POLICY_HASH="$1" \
  ONECOMPUTER_GRANT_PURPOSE=governed-app-access \
  "$NODE_BIN" ../../../scripts/onecomputer/generate-gateway-grant.mjs "$USER_ID" "$2" "$3"
}
GOOD_GRANT=$(make_grant "$POLICY_HASH" "$APP_ID" 3600)
WRONG_APP_GRANT=$(make_grant "$POLICY_HASH" "wrong-app" 3600)
WRONG_POLICY_GRANT=$(make_grant "sha256:wrong-policy" "$APP_ID" 3600)
EXPIRED_GRANT=$(make_grant "$POLICY_HASH" "$APP_ID" -10)

CURL=(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o /dev/null -w '%{http_code}')
GOOD=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GOOD_GRANT")
WRONG_APP=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$WRONG_APP_GRANT")
WRONG_POLICY=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$WRONG_POLICY_GRANT")
EXPIRED=$("${CURL[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$EXPIRED_GRANT")
PASSPORT=$(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o "$TMPDIR/passport.json" -w '%{http_code}' -H "x-onecomputer-admin-token: $ADMIN_TOKEN" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/passport")

test "$GOOD" = 200
test "$WRONG_APP" = 403
test "$WRONG_POLICY" = 403
test "$EXPIRED" = 403
test "$PASSPORT" = 200
grep -q 'onecomputer.app.passport.v1' "$TMPDIR/passport.json"

echo "vti_grant_smoke_passed appId=$APP_ID good=$GOOD wrong_app=$WRONG_APP wrong_policy=$WRONG_POLICY expired=$EXPIRED passport=$PASSPORT"
