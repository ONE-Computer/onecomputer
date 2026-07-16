# Secure vibe app: Lambda Function URL with AWS_IAM + OneComputer VTI claim

Date: 2026-06-21
Region: `ap-southeast-1`
Sandbox account: `365225441296`

## Outcome

A real vibe-coded app was deployed in the AWS sandbox with two security gates:

1. **AWS IAM gate**: Lambda Function URL uses `AuthType=AWS_IAM`, so anonymous browser/curl access is rejected.
2. **OneComputer/VTI gate**: the app requires a short-lived `x-onecomputer-vti-claim` header containing a trust-task style claim.

This proves the intended product pattern:

> User clicks app in OneComputer → OneComputer validates user/policy/consent → OneComputer signs/invokes AWS using IAM → app sees a VTI-style access claim → user never receives raw AWS credentials.

## Deployed resources

> The Lambda function name has been rebranded in this doc. Some supporting IAM roles and screenshot folders still use legacy `onecli` names from the pre-fork proof.

- Function: `onecomputer-secure-vibe-app`
- Function URL: `https://fxpwlx5kveo6euo32tsfroh4yq0hymaw.lambda-url.ap-southeast-1.on.aws/`
- Auth type: `AWS_IAM`
- Execution role: `onecliSecureAppsLambdaExecutionRole`
- Runtime: `nodejs22.x`, `arm64`
- TTL tag: `ExpiresAt=2026-06-22T02:22:13Z`
- VTI claim trust task: `tt-onecomputer-secure-apps-20260621-001`

## Evidence

Anonymous direct request:

```text
HTTP 403
{"Message":"Forbidden"}
```

IAM-signed Function URL request with `x-onecomputer-vti-claim`:

```json
{
  "statusCode": 200,
  "contentType": "text/html; charset=utf-8",
  "trustTask": "tt-onecomputer-secure-apps-20260621-001",
  "bytes": 2561
}
```

Direct Lambda API invocation with the same VTI claim also returns `statusCode=200` and the HTML app body.

## Screenshot artifacts

- OneComputer dashboard: `/workspace/agent/reports/screenshots/onecli-secure-apps/secure-apps-vti-iam-proof-2026-06-21.png`
- App HTML: `/workspace/agent/reports/screenshots/onecli-secure-apps/secure-vibe-app-lambda-iam-2026-06-21.png`

## Caveats

- The ECS Express proof is a runtime proof, but it is public by default; secure access must be layered in front or inside the app.
- The Lambda Function URL proof is the secure auth proof. It demonstrates the OneComputer broker pattern with AWS IAM and VTI-style access claims.
- Production must not use `--no-verify-ssl`; NanoClaw needed it only because the local proxy certificate chain is not trusted by the bundled AWS CLI.
- Production should store signing material and AWS credentials in OneComputer-managed vaults, not plaintext files.

## Cleanup

```bash
aws lambda delete-function-url-config --function-name onecomputer-secure-vibe-app
aws lambda delete-function --function-name onecomputer-secure-vibe-app
```

Use the same AWS CLI proxy/CA flags as the deploy attempt if running from NanoClaw.
