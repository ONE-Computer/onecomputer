#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="${ONECOMPUTER_CONTROL_TABLE:?Set ONECOMPUTER_CONTROL_TABLE}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-1}}"
APP_ID="${ONECOMPUTER_APP_ID:?Set ONECOMPUTER_APP_ID}"
ORIGIN_URL="${ONECOMPUTER_ORIGIN_URL:?Set ONECOMPUTER_ORIGIN_URL}"
ORIGIN_TOKEN="${ONECOMPUTER_ORIGIN_TOKEN:?Set ONECOMPUTER_ORIGIN_TOKEN}"
ALLOWED_USERS_CSV="${ONECOMPUTER_ALLOWED_USERS:-}"
STATUS="${ONECOMPUTER_APP_STATUS:-active}"
POLICY_HASH="${ONECOMPUTER_POLICY_HASH:-}"
OWNER_DID="${ONECOMPUTER_OWNER_DID:-}"
APP_DID="${ONECOMPUTER_APP_DID:-}"
VTA_DID="${ONECOMPUTER_VTA_DID:-}"
VTC_ID="${ONECOMPUTER_VTC_ID:-}"
DATA_CLASSIFICATION="${ONECOMPUTER_DATA_CLASSIFICATION:-internal}"
RISK_TIER="${ONECOMPUTER_RISK_TIER:-medium}"
RUNTIME_KIND="${ONECOMPUTER_RUNTIME_KIND:-app}"
AWS_RESOURCE_ARNS_CSV="${ONECOMPUTER_AWS_RESOURCE_ARNS:-}"
AWS_BIN="${AWS_BIN:-aws}"

python3 - "$TABLE_NAME" "$APP_ID" "$ORIGIN_URL" "$ORIGIN_TOKEN" "$ALLOWED_USERS_CSV" "$STATUS" "$POLICY_HASH" "$OWNER_DID" "$APP_DID" "$VTA_DID" "$VTC_ID" "$DATA_CLASSIFICATION" "$RISK_TIER" "$RUNTIME_KIND" "$AWS_RESOURCE_ARNS_CSV" > /tmp/onecomputer-control-seed-item.json <<'PY'
import json, sys

(table, app_id, origin_url, origin_token, allowed_csv, status, policy_hash, owner_did, app_did, vta_did, vtc_id, data_classification, risk_tier, runtime_kind, resource_arns_csv) = sys.argv[1:]
allowed = [x.strip() for x in allowed_csv.split(',') if x.strip()]
resource_arns = [x.strip() for x in resource_arns_csv.split(',') if x.strip()]
item = {
    'pk': {'S': f'APP#{app_id}'},
    'sk': {'S': 'METADATA'},
    'appId': {'S': app_id},
    'id': {'S': app_id},
    'originUrl': {'S': origin_url.rstrip('/')},
    'originToken': {'S': origin_token},
    'status': {'S': status},
    'allowedUsers': {'L': [{'S': x} for x in allowed]},
    'revokedUsers': {'L': []},
    'dataClassification': {'S': data_classification},
    'riskTier': {'S': risk_tier},
    'runtimeKind': {'S': runtime_kind},
    'awsResourceArns': {'L': [{'S': x} for x in resource_arns]},
    'updatedAt': {'S': 'seeded'}
}
for key, value in {
    'policyHash': policy_hash,
    'ownerDid': owner_did,
    'appDid': app_did,
    'vtaDid': vta_did,
    'vtcId': vtc_id,
}.items():
    if value:
        item[key] = {'S': value}
print(json.dumps(item))
PY

"$AWS_BIN" dynamodb put-item \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --item file:///tmp/onecomputer-control-seed-item.json \
  >/dev/null
rm -f /tmp/onecomputer-control-seed-item.json

echo "control_table_seeded name=$TABLE_NAME appId=$APP_ID region=$REGION"
