# OneComputer Node.js + DynamoDB Governed URL Proof

Date: 2026-06-21 17:56 SGT
Branch: `feature/onecomputer-phase1-rebrand`

## Result

OneComputer can now deploy a small Node.js service with a simple managed database.

- Runtime: Node.js Express service behind OneComputer nginx auth gate
- Database: DynamoDB PAY_PER_REQUEST table
- Build: AWS CodeBuild
- Image registry: ECR `onecomputer/app-images`
- Runtime: ECS Express
- Governed URL: `https://on-a1553bbd0c64408b841d946a146a0c21.ecs.ap-southeast-1.on.aws`
- Sandbox access: basic auth only; password is stored only in local `access-instructions.local.json`

## AWS artifacts

- App ID: `task-tracker-20260621094537`
- DynamoDB table: `task-tracker-20260621094537-tasks`
- DynamoDB ARN: `arn:aws:dynamodb:ap-southeast-1:365225441296:table/task-tracker-20260621094537-tasks`
- ECR image: `365225441296.dkr.ecr.ap-southeast-1.amazonaws.com/onecomputer/app-images:task-tracker-20260621094537`
- ECS service: `onecomputer-node-task-tracker-20260621094537-20260621094720`
- Artifact dir: `.onecomputer/aws-node-dynamodb/task-tracker-20260621094537`

## Verification

| Check                                  | Result                               |
| -------------------------------------- | ------------------------------------ |
| Health endpoint `/_onecomputer/health` | `200 OK`                             |
| Root without auth                      | `401 blocked`                        |
| Root with auth                         | `200 OK`                             |
| `POST /api/tasks`                      | `201 Created`                        |
| `GET /api/tasks`                       | `200 OK`, returned row from DynamoDB |

Proof row written during E2E:

```json
{
  "title": "E2E DynamoDB proof from GiniClaw",
  "status": "Verified"
}
```

## Product meaning

This proves the second OneComputer wedge after Streamlit: small shadow-IT Node.js apps with simple persistence can be governed without making the user become an AWS expert.

## Remaining CISO gaps

- Sandbox basic auth must become IAM/VTI brokered grants.
- App registry must persist deployed endpoints, owners, data class, expiry, evidence, and current state.
- Admin revoke/pause must actually block runtime access and produce evidence.
- Evidence export should be one-click for CISO review.
