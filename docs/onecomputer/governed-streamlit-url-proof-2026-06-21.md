# OneComputer Governed Streamlit URL Proof

Date: 2026-06-21  
Region: `ap-southeast-1`  
Status: **real sandbox governed URL achieved**

## Result

OneComputer produced a real AWS-hosted Streamlit URL for the sample Meeting Tracker app:

```text
https://on-b13d1c62c4654e65acb04540a1f6369c.ecs.ap-southeast-1.on.aws
```

This is a sandbox proof URL, not a CISO-ready production/pilot URL.

## Command path

```bash
AWS_DEFAULT_REGION=ap-southeast-1 \
node scripts/onecomputer/deploy-local-app.mjs examples/streamlit/meeting-tracker \
  --owner "Terence Tan" \
  --data-classification Internal \
  --users "terencetan@temasek.com.sg" \
  --ttl-hours 8 \
  --out .onecomputer/aws-real-url \
  --execute-aws
```

## What worked

| Layer                | Result                                          |
| -------------------- | ----------------------------------------------- |
| App detection        | Streamlit detected                              |
| Evidence             | Passport + evidence pack generated              |
| Container            | Nginx-gated Streamlit Dockerfile generated      |
| Build                | AWS CodeBuild succeeded                         |
| Registry             | Image pushed to ECR                             |
| Runtime              | ECS Express service reached steady state        |
| Health               | `/_stcore/health` returns `200`                 |
| Anonymous access     | app root returns `401`                          |
| Authenticated access | app root returns `200` and Streamlit HTML loads |

## Verification detail

Because this NanoClaw container's system DNS resolver hung on the fresh ECS Express hostname, verification used public DNS-over-HTTPS to resolve the hostname and `curl --resolve` to preserve the correct TLS/SNI host.

Verified statuses:

```text
health=200
noauth=401
auth=200
```

Public DNS answers returned AWS IPs:

```text
3.0.63.65
18.139.237.51
13.250.193.124
```

## Generated local artifacts

```text
.onecomputer/aws-real-url/meeting-tracker-20260621073610/
  app-passport.json
  evidence-pack.json
  onecomputer-app-manifest.json
  Dockerfile.onecomputer
  RUNBOOK.md
  access-instructions.local.json   # sandbox secret; do not commit/share
  aws-build-source.zip
```

## CISO caveat

Current access is **sandbox basic auth**, not final enterprise governance.

Known P0 gaps before a bank/government pilot:

1. Replace sandbox basic auth with IAM/VTI brokered access grants.
2. Move app secrets out of ECS environment variables into a managed secrets path.
3. Persist app passport/evidence into backend registry.
4. Add admin review queue and access grants.
5. Add real revoke/kill switch and prove revoked access fails.
6. Export evidence to SIEM/GRC/ITSM-friendly JSON.

## Next milestone

Convert this proof into a CISO-grade control plane:

```text
real URL → registry → IAM/VTI grant → admin revoke → evidence export
```
