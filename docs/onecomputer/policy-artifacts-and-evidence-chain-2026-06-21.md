# OneComputer Policy Artifacts and Evidence Hash Chain

Date: 2026-06-21
Phase: P3

## Why this exists

P1 made gateway state durable. P2 made access grants app/policy scoped. P3 makes the control path tamper-evident: policy, deployment, admin action, and access decisions can be linked into an evidence chain.

This is still a controlled-pilot implementation. It is not legal-hold/WORM storage and it is not a real Affinidi/VTI signature. The design is deliberately shaped so VTA-signed policy artifacts and VTI Trust Tasks can replace the local mock pieces later.

## Policy artifact

Create a signed-policy-shaped artifact:

```bash
node scripts/onecomputer/create-policy-artifact.mjs \
  --app-id=task-tracker \
  --owner-did=did:example:onecomputer:user:terence \
  --issuer-did=did:example:onecomputer:vta:local \
  --data-classification=confidential \
  --risk-tier=medium \
  --allowed-users=terence \
  --out=.onecomputer/policies/task-tracker.policy.json
```

The artifact includes:

- `schema=onecomputer.policy.artifact.v1`
- app id
- issuer DID placeholder
- owner DID placeholder
- purpose
- classification/risk
- constraints
- `policyHash`
- mock signature block

The mock signature block is explicitly not production cryptographic trust. It marks where the Affinidi/VTI VTA signature should land later.

## Evidence chain

Append evidence events:

```bash
node scripts/onecomputer/append-evidence-event.mjs \
  --chain .onecomputer/evidence/task-tracker.jsonl \
  --event-json '{"type":"policy_created","appId":"task-tracker","policyHash":"sha256:..."}'
```

Verify chain:

```bash
node scripts/onecomputer/verify-evidence-chain.mjs .onecomputer/evidence/task-tracker.jsonl
```

Each record contains:

- `schema=onecomputer.evidence.event.v1`
- timestamp
- `previousHash`
- event payload
- `eventHash`

If a middle event is changed, verification fails.

## Gateway audit chain

The Access Gateway now appends evidence fields to gateway audit events:

- `evidenceSchema`
- `previousHash`
- `eventHash`

For DynamoDB mode, the gateway queries the latest audit row for `AUDIT#<appId>` and chains the next row to it. For env/local mode, it keeps an in-process chain head.

## Current limitations

- Local policy signatures are mock only.
- DynamoDB audit chain is append-only by application behavior, not WORM/legal-hold.
- The gateway chains per app, but no cross-app/global notarization exists yet.
- No external timestamp authority.
- No real VTI Trust Task yet.

These are acceptable for the 55/100 controlled-pilot milestone, but not for production.
