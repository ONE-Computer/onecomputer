#!/usr/bin/env bash
set -euo pipefail

TMPDIR="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

POLICY="$TMPDIR/policy.json"
CHAIN="$TMPDIR/evidence.jsonl"
TAMPERED="$TMPDIR/evidence-tampered.jsonl"

POLICY_RESULT=$(node scripts/onecomputer/create-policy-artifact.mjs \
  --app-id=p3-evidence-smoke \
  --owner-did=did:example:onecomputer:user:terence \
  --issuer-did=did:example:onecomputer:vta:local \
  --data-classification=confidential \
  --risk-tier=medium \
  --allowed-users=terence \
  --out="$POLICY")
POLICY_HASH=$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.policyHash)" "$POLICY")

node scripts/onecomputer/append-evidence-event.mjs --chain "$CHAIN" --event-json "{\"type\":\"policy_created\",\"appId\":\"p3-evidence-smoke\",\"policyHash\":\"$POLICY_HASH\"}" >/dev/null
node scripts/onecomputer/append-evidence-event.mjs --chain "$CHAIN" --event-json "{\"type\":\"deploy_completed\",\"appId\":\"p3-evidence-smoke\",\"runtime\":\"node\"}" >/dev/null
node scripts/onecomputer/append-evidence-event.mjs --chain "$CHAIN" --event-json "{\"type\":\"access_allowed\",\"appId\":\"p3-evidence-smoke\",\"user\":\"terence\"}" >/dev/null
VERIFY=$(node scripts/onecomputer/verify-evidence-chain.mjs "$CHAIN")
cp "$CHAIN" "$TAMPERED"
python3 - "$TAMPERED" <<'PY'
import json, sys
path=sys.argv[1]
lines=open(path).read().splitlines()
record=json.loads(lines[1])
record['event']['runtime']='tampered'
lines[1]=json.dumps(record)
open(path,'w').write('\n'.join(lines)+'\n')
PY
if node scripts/onecomputer/verify-evidence-chain.mjs "$TAMPERED" >/dev/null 2>&1; then
  echo "tamper_check_failed"
  exit 1
fi
RECORDS=$(node -e "const fs=require('fs'); console.log(fs.readFileSync(process.argv[1],'utf8').trim().split('\\n').length)" "$CHAIN")
HEAD=$(node -e "const fs=require('fs'); const lines=fs.readFileSync(process.argv[1],'utf8').trim().split('\\n').map(JSON.parse); console.log(lines.at(-1).eventHash)" "$CHAIN")
echo "evidence_chain_smoke_passed records=$RECORDS head=$HEAD policyHash=$POLICY_HASH"
