# OneComputer React Static Governed URL Proof

Date: 2026-06-21 18:00 SGT
Branch: `feature/onecomputer-phase1-rebrand`

## Result

OneComputer can now deploy a React/Vite static app as a governed AWS-hosted URL.

- Runtime: React static build served by nginx behind OneComputer auth gate
- Build: AWS CodeBuild
- Image registry: ECR `onecomputer/app-images`
- Runtime: ECS Express
- Governed URL: `https://on-ca5cf2e7eca7460eba0614e73904b275.ecs.ap-southeast-1.on.aws`
- Sandbox access: basic auth only; password is stored only in local `access-instructions.local.json`

## AWS artifacts

- App ID: `decision-dashboard-20260621095651`
- ECR image: `365225441296.dkr.ecr.ap-southeast-1.amazonaws.com/onecomputer/app-images:decision-dashboard-20260621095651`
- ECS service: `onecomputer-react-static-decision-dashboard-20260621095651-20260621095809`
- Artifact dir: `.onecomputer/aws-react/decision-dashboard-20260621095651`

## Verification

| Check                                  | Result                                     |
| -------------------------------------- | ------------------------------------------ |
| Health endpoint `/_onecomputer/health` | `200 OK` after ECS task became healthy     |
| Root without auth                      | `401 blocked`                              |
| Root with auth                         | `200 OK`, returned built React/Vite assets |

## Product meaning

This proves OneComputer is not Streamlit-only. It now covers the two most common vibe-coded app shapes Terence highlighted:

1. Python/Streamlit apps.
2. React dashboards.
3. Node.js apps with simple DynamoDB persistence.

## Remaining CISO gaps

- Sandbox basic auth must become IAM/VTI brokered grants.
- Static React apps need a clear policy for API backends: either deploy a paired Node service or connect to approved internal APIs through a gateway.
- Admin fleet dashboard must expose owner, data class, expiry, runtime, and revoke state.
