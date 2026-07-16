# OneComputer Deploy Command Spec

## Decision

OneComputer now supports the three small-app shapes that appeared in the shadow-IT discovery work:

1. Streamlit apps.
2. Node.js services.
3. React/Vite static apps.

The command stays intentionally narrow: it is not a generic Heroku/Vercel clone. The first database path is DynamoDB because it is low-ops, on-demand, and adequate for small 5-10 user apps.

## Command shape

```bash
pnpm onecomputer:deploy <app-path> [--runtime auto|streamlit|node|react-static] [--db none|dynamodb] [--execute-aws]
```

Examples:

```bash
# Streamlit
pnpm onecomputer:deploy examples/streamlit/meeting-tracker --runtime streamlit --execute-aws

# Node.js service with simple DB
pnpm onecomputer:deploy examples/node/task-tracker --runtime node --db dynamodb --execute-aws

# React static dashboard
pnpm onecomputer:deploy examples/react/decision-dashboard --runtime react-static --execute-aws
```

## Behavior

The command:

1. detects Streamlit, Node.js service, or React static runtime;
2. captures owner, purpose, data classification, allowed users, and TTL;
3. scans for obvious secret files and hardcoded secrets;
4. generates an app passport;
5. generates an evidence pack;
6. generates `Dockerfile.onecomputer` with nginx sandbox auth gate;
7. with `--db dynamodb`, provisions a DynamoDB table and an ECS app task role scoped to that table;
8. with `--execute-aws`, builds/pushes an image through CodeBuild/ECR and deploys to ECS Express.

Dry run is default. Dry-run with `--db dynamodb` plans the database but does not mutate AWS.

## Generated artifacts

Each run creates:

```text
.onecomputer/<target>/<app-id>/
  app-passport.json
  evidence-pack.json
  onecomputer-app-manifest.json
  Dockerfile.onecomputer
  RUNBOOK.md
  access-instructions.local.json   # only for AWS execution; do not commit/share
```

## Live proof as of 2026-06-21

- Streamlit governed URL: `https://on-b13d1c62c4654e65acb04540a1f6369c.ecs.ap-southeast-1.on.aws`
- Node.js + DynamoDB governed URL: `https://on-a1553bbd0c64408b841d946a146a0c21.ecs.ap-southeast-1.on.aws`
- React static governed URL: `https://on-ca5cf2e7eca7460eba0614e73904b275.ecs.ap-southeast-1.on.aws`

## CISO proof

The current proof is valuable because it shows:

- owner;
- data classification;
- allowed users/groups;
- source hash;
- runtime command;
- secret scan findings;
- database provisioning evidence where applicable;
- build/deploy evidence timeline;
- no-auth blocked and auth allowed.

Pilot-readiness still needs:

- IAM/VTI access gate live;
- dashboard persistence/app registry;
- revoke/kill switch wired to runtime;
- SIEM/GRC evidence export;
- policy for React apps calling approved backends.
