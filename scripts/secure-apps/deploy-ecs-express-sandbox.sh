#!/usr/bin/env bash
set -euo pipefail

: "${AWS_DEFAULT_REGION:=ap-southeast-1}"
: "${AWS_CLI_BIN:=aws}"
: "${SERVICE_PREFIX:=onecomputer-secure-apps-sandbox}"
: "${PRIMARY_IMAGE:=public.ecr.aws/nginx/nginx:latest}"
: "${PRIMARY_PORT:=80}"
: "${HEALTH_CHECK_PATH:=/}"
: "${TTL_HOURS:=24}"

AWS=("$AWS_CLI_BIN")
if [ -n "${AWS_CLI_EXTRA_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=($AWS_CLI_EXTRA_ARGS)
  AWS+=("${EXTRA_ARGS[@]}")
fi

TASK_ROLE_NAME="${TASK_ROLE_NAME:-onecomputerSecureAppsEcsTaskExecutionRole}"
INFRA_ROLE_NAME="${INFRA_ROLE_NAME:-onecomputerSecureAppsEcsExpressInfrastructureRole}"
SERVICE_NAME="${SERVICE_NAME:-${SERVICE_PREFIX}-$(date -u +%Y%m%d%H%M%S)}"

require_aws_identity() {
  "${AWS[@]}" sts get-caller-identity --output json >/dev/null
}

create_role_if_missing() {
  local role_name="$1"
  local trust_file="$2"
  local description="$3"

  if "${AWS[@]}" iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    echo "role_exists=$role_name"
    return
  fi

  "${AWS[@]}" iam create-role \
    --role-name "$role_name" \
    --assume-role-policy-document "file://${trust_file}" \
    --description "$description" \
    --tags Key=Project,Value=OneComputer-Secure-Apps Key=Owner,Value=NanoClaw >/dev/null
  echo "role_created=$role_name"
}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

cat > "$WORKDIR/ecs-task-trust-policy.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat > "$WORKDIR/ecs-express-infra-trust-policy.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccessInfrastructureForECSExpressServices",
      "Effect": "Allow",
      "Principal": { "Service": "ecs.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

export AWS_DEFAULT_REGION
require_aws_identity
ACCOUNT_ID=$("${AWS[@]}" sts get-caller-identity --query Account --output text)

create_role_if_missing \
  "$TASK_ROLE_NAME" \
  "$WORKDIR/ecs-task-trust-policy.json" \
  "OneComputer Secure Apps sandbox ECS task execution role"

create_role_if_missing \
  "$INFRA_ROLE_NAME" \
  "$WORKDIR/ecs-express-infra-trust-policy.json" \
  "OneComputer Secure Apps sandbox ECS Express infrastructure role"

"${AWS[@]}" iam attach-role-policy \
  --role-name "$TASK_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null

"${AWS[@]}" iam attach-role-policy \
  --role-name "$INFRA_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices >/dev/null

if ! "${AWS[@]}" iam get-role --role-name AWSServiceRoleForECS >/dev/null 2>&1; then
  "${AWS[@]}" iam create-service-linked-role \
    --aws-service-name ecs.amazonaws.com \
    --description "Service-linked role for Amazon ECS in OneComputer Secure Apps sandbox" >/dev/null
fi

# Allow newly-created IAM roles/policies to propagate before ECS assumes them.
sleep "${IAM_PROPAGATION_SECONDS:-12}"

TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${TASK_ROLE_NAME}"
INFRA_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${INFRA_ROLE_NAME}"

LOG_GROUP="/aws/ecs/default/${SERVICE_NAME}-onecomputer"
"${AWS[@]}" logs create-log-group --log-group-name "$LOG_GROUP" >/dev/null 2>&1 || true
export SERVICE_NAME TASK_ROLE_ARN INFRA_ROLE_ARN APP_TASK_ROLE_ARN HEALTH_CHECK_PATH PRIMARY_IMAGE PRIMARY_PORT LOG_GROUP PRIMARY_ENV_JSON

CREATE_INPUT="$WORKDIR/create-express-gateway-service.json"
node - "$CREATE_INPUT" <<'NODE'
const fs = require('node:fs');
const env = process.env;
let environment = [];
try {
  environment = env.PRIMARY_ENV_JSON ? JSON.parse(env.PRIMARY_ENV_JSON) : [];
} catch (error) {
  console.error(`Invalid PRIMARY_ENV_JSON: ${error.message}`);
  process.exit(2);
}
const input = {
  serviceName: env.SERVICE_NAME,
  executionRoleArn: env.TASK_ROLE_ARN,
  infrastructureRoleArn: env.INFRA_ROLE_ARN,
  ...(env.APP_TASK_ROLE_ARN ? { taskRoleArn: env.APP_TASK_ROLE_ARN } : {}),
  healthCheckPath: env.HEALTH_CHECK_PATH || '/',
  primaryContainer: {
    image: env.PRIMARY_IMAGE,
    containerPort: Number(env.PRIMARY_PORT || 80),
    awsLogsConfiguration: {
      logGroup: env.LOG_GROUP,
      logStreamPrefix: 'ecs',
    },
    environment,
  },
  tags: [
    { key: 'Project', value: 'OneComputer-Secure-Apps' },
    { key: 'Owner', value: 'NanoClaw' },
    { key: 'Purpose', value: 'Sandbox-Poc' },
  ],
};
fs.writeFileSync(process.argv[2], `${JSON.stringify(input, null, 2)}\n`);
NODE

CREATE_OUTPUT=$("${AWS[@]}" ecs create-express-gateway-service \
  --cli-input-json "file://${CREATE_INPUT}" \
  --output json)

SERVICE_ARN=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.service.serviceArn)" "$CREATE_OUTPUT")
ENDPOINT=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.service.activeConfigurations?.[0]?.ingressPaths?.[0]?.endpoint ?? '')" "$CREATE_OUTPUT")
EXPIRES_AT=$(date -u -d "+${TTL_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)

"${AWS[@]}" ecs tag-resource \
  --resource-arn "$SERVICE_ARN" \
  --tags key=ExpiresAt,value="$EXPIRES_AT" key=ManagedBy,value=GiniClaw key=Runtime,value=ECS-Express >/dev/null

node -e "const j=JSON.parse(process.argv[1]); const s=j.service; console.log(JSON.stringify({ serviceName: s.serviceName, serviceArn: s.serviceArn, cluster: s.cluster, status: s.status, endpoint: '${ENDPOINT}', expiresAt: '${EXPIRES_AT}', healthCheckPath: '${HEALTH_CHECK_PATH}', primaryPort: Number(process.env.PRIMARY_PORT || 80), logGroup: process.env.LOG_GROUP }, null, 2));" "$CREATE_OUTPUT"
