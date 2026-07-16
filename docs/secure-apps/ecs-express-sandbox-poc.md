# Secure Apps ECS Express sandbox POC

Date: 2026-06-21
Region: `ap-southeast-1`
Sandbox account: `365225441296`

## What this proves

OneComputer Secure Apps can map a governed app card to a real AWS ECS Express Mode service.
The first proof deploys a public nginx container because this NanoClaw container does not have a working Docker daemon for building custom Claude Code app images yet.

## Live sandbox proof

> Resource names still carry the original `onecli` prefix because this was created before the OneComputer fork. Keep these names only for historical sandbox cleanup; new resources should use `onecomputer-*`.

- Service: `onecli-secure-apps-sandbox-20260621020425`
- Cluster: `arn:aws:ecs:ap-southeast-1:365225441296:cluster/default`
- Service ARN: `arn:aws:ecs:ap-southeast-1:365225441296:service/default/onecli-secure-apps-sandbox-20260621020425`
- Image: `public.ecr.aws/nginx/nginx:latest`
- AWS status: `ACTIVE`
- Endpoint: `https://on-4a5b728dc5b443b69feed90a072f8692.ecs.ap-southeast-1.on.aws`
- TTL tag: `ExpiresAt=2026-06-22T02:06:58Z`

## Caveats

- Endpoint smoke test from inside NanoClaw is blocked by the local OneComputer gateway proxy and direct DNS resolution path. AWS ECS `describe-express-gateway-service` reports the service as `ACTIVE` and returns the endpoint.
- AWS CLI v2 in this container needed `--no-verify-ssl` because the local proxy presented a certificate chain not trusted by the bundled AWS CLI. Production must use a proper corporate CA bundle instead.
- This is not yet a custom Claude Code app deploy. Custom app deploy needs CodeBuild/ECR or a working Docker builder.

## Repeatable command

Set AWS credentials in environment, then run:

```bash
AWS_CLI_BIN=/workspace/agent/tools/awscli/aws/dist/aws \
AWS_CLI_EXTRA_ARGS=--no-verify-ssl \
AWS_DEFAULT_REGION=ap-southeast-1 \
scripts/secure-apps/deploy-ecs-express-sandbox.sh
```

The script creates or reuses legacy-named sandbox roles until Phase 2 renames AWS resources:

- `onecliSecureAppsEcsTaskExecutionRole`
- `onecliSecureAppsEcsExpressInfrastructureRole`
- `AWSServiceRoleForECS`

Then it deploys an ECS Express service from `PRIMARY_IMAGE` and tags it with `ExpiresAt`.

## Cleanup command

```bash
aws ecs delete-express-gateway-service \
  --service-arn arn:aws:ecs:ap-southeast-1:365225441296:service/default/onecli-secure-apps-sandbox-20260621020425 \
  --monitor-resources
```

Use the same AWS CLI/proxy flags as the deploy command if running from NanoClaw.
