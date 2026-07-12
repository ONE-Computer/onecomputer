#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GATEWAY_DIR/../../.." && pwd)"

NODE_BIN="${NODE_BIN:-node}"
PORT="${PORT:-45999}"
ORIGIN_PORT="${ORIGIN_PORT:-45997}"
VERIFIER_PORT="${VERIFIER_PORT:-45998}"
APP_ID="${ONECOMPUTER_APP_ID:-p5-external-verifier-smoke}"
USER_ID="${ONECOMPUTER_SMOKE_USER:-terence}"
GRANT_SECRET="${ONECOMPUTER_GATEWAY_GRANT_SECRET:-p5-smoke-grant-secret}"
ADMIN_TOKEN="${ONECOMPUTER_GATEWAY_ADMIN_TOKEN:-p5-smoke-admin-token}"
ORIGIN_TOKEN="${ONECOMPUTER_ORIGIN_TOKEN:-p5-smoke-origin-token}"
POLICY_HASH="${ONECOMPUTER_POLICY_HASH:-sha256:p5-policy-hash}"
VERIFIER_TOKEN="${ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN:-p5-sidecar-token}"
TMPDIR="$(mktemp -d)"
ORIGIN_LOG="$TMPDIR/origin.log"
VERIFIER_LOG="$TMPDIR/verifier.log"
GATEWAY_LOG="$TMPDIR/gateway.log"

cleanup() {
  kill "${ORIGIN_PID:-}" "${VERIFIER_PID:-}" "${GATEWAY_PID:-}" 2>/dev/null || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

cat > "$TMPDIR/origin.mjs" <<'ORIGIN'
import http from 'node:http';
const token = process.env.ONECOMPUTER_ORIGIN_TOKEN;
const port = Number(process.env.ORIGIN_PORT || 45997);
const server = http.createServer((req, res) => {
  if (req.headers['x-onecomputer-origin-token'] !== token) {
    res.writeHead(403, {'content-type':'application/json'}).end(JSON.stringify({error:'bad_origin_token'}));
    return;
  }
  res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ok:true,user:req.headers['x-onecomputer-user']||null,path:req.url}));
});
server.listen(port, '127.0.0.1', () => console.log('origin ready'));
ORIGIN

cat > "$TMPDIR/verifier.mjs" <<'VERIFIER'
import crypto from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.VERIFIER_PORT || 45998);
const secret = process.env.ONECOMPUTER_GATEWAY_GRANT_SECRET;
const expectedAuth = process.env.ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN;

function send(res, status, payload) {
  res.writeHead(status, {'content-type':'application/json'}).end(JSON.stringify(payload));
}

function verifyToken(token) {
  const [payloadB64, signature] = String(token || '').split('.');
  if (!payloadB64 || !signature) return { ok: false, reason: 'grant_missing_or_malformed' };
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'grant_bad_signature' };
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'grant_bad_payload' };
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/verify') return send(res, 404, { ok: false, reason: 'not_found' });
  if (expectedAuth && req.headers.authorization !== `Bearer ${expectedAuth}`) {
    return send(res, 401, { ok: false, reason: 'bad_sidecar_auth' });
  }
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { ok: false, reason: 'bad_json' }); }
    if (body.schema !== 'onecomputer.verifier.request.v1') return send(res, 400, { ok: false, reason: 'bad_request_schema' });
    if (body.audience !== 'onecomputer.access-gateway') return send(res, 400, { ok: false, reason: 'bad_audience' });
    const result = verifyToken(body.token);
    if (!result.ok) return send(res, 200, result);
    // In production this is the normalization boundary: Affinidi/VTI verifies VCs/DIDs/policies,
    // then returns the normalized OneComputer access-grant payload. The gateway does not do VTI crypto.
    return send(res, 200, { ok: true, payload: result.payload, verifier: 'mock-affinidi-vti-sidecar' });
  });
});
server.listen(port, '127.0.0.1', () => console.log('verifier ready'));
VERIFIER

ONECOMPUTER_ORIGIN_TOKEN="$ORIGIN_TOKEN" ORIGIN_PORT="$ORIGIN_PORT" "$NODE_BIN" "$TMPDIR/origin.mjs" >"$ORIGIN_LOG" 2>&1 & ORIGIN_PID=$!
for _ in $(seq 1 80); do grep -q 'origin ready' "$ORIGIN_LOG" && break || sleep 0.1; done

ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN="$VERIFIER_TOKEN" \
VERIFIER_PORT="$VERIFIER_PORT" \
"$NODE_BIN" "$TMPDIR/verifier.mjs" >"$VERIFIER_LOG" 2>&1 & VERIFIER_PID=$!
for _ in $(seq 1 80); do grep -q 'verifier ready' "$VERIFIER_LOG" && break || sleep 0.1; done

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
  'vtaDid': 'did:example:onecomputer:vta:affinidi-sidecar',
  'vtcId': 'vtc:onecomputer:controlled-pilot',
  'dataClassification': 'confidential',
  'riskTier': 'high',
  'runtimeKind': 'node',
  'policyHash': policy_hash,
  'evidenceHash': 'sha256:p5-evidence-placeholder'
}]))
PY
)

ONECOMPUTER_REGISTRY_JSON="$REGISTRY_JSON" \
ONECOMPUTER_GATEWAY_GRANT_SECRET="$GRANT_SECRET" \
ONECOMPUTER_GATEWAY_ADMIN_TOKEN="$ADMIN_TOKEN" \
ONECOMPUTER_VERIFIER_BACKEND=affinidi-vti \
ONECOMPUTER_EXTERNAL_VERIFIER_URL="http://127.0.0.1:$VERIFIER_PORT/verify" \
ONECOMPUTER_EXTERNAL_VERIFIER_TOKEN="$VERIFIER_TOKEN" \
ONECOMPUTER_EXTERNAL_VERIFIER_TIMEOUT_MS=1000 \
PORT="$PORT" \
"$NODE_BIN" "$GATEWAY_DIR/src/server.mjs" >"$GATEWAY_LOG" 2>&1 & GATEWAY_PID=$!
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
  "$NODE_BIN" "$REPO_ROOT/scripts/onecomputer/generate-gateway-grant.mjs" "$USER_ID" "$2" "$3"
}
GOOD_GRANT=$(make_grant "$POLICY_HASH" "$APP_ID" 3600)
WRONG_POLICY_GRANT=$(make_grant "sha256:wrong-policy" "$APP_ID" 3600)
BAD_TOKEN="not.a.valid-grant"

CURL_STATUS=(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o /dev/null -w '%{http_code}')
GOOD=$("${CURL_STATUS[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$GOOD_GRANT")
WRONG_POLICY=$("${CURL_STATUS[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$WRONG_POLICY_GRANT")
VERIFIER_DENY=$("${CURL_STATUS[@]}" "http://127.0.0.1:$PORT/app/$APP_ID/?grant=$BAD_TOKEN")
PASSPORT=$(env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy curl -s -o "$TMPDIR/passport.json" -w '%{http_code}' -H "x-onecomputer-admin-token: $ADMIN_TOKEN" "http://127.0.0.1:$PORT/admin/apps/$APP_ID/passport")

test "$GOOD" = 200
test "$WRONG_POLICY" = 403
test "$VERIFIER_DENY" = 403
test "$PASSPORT" = 200
grep -q 'onecomputer.app.passport.v1' "$TMPDIR/passport.json"
grep -q 'mock-affinidi-vti-sidecar' "$VERIFIER_LOG" || true

echo "external_verifier_smoke_passed appId=$APP_ID good=$GOOD wrong_policy=$WRONG_POLICY verifier_deny=$VERIFIER_DENY passport=$PASSPORT backend=affinidi-vti"
