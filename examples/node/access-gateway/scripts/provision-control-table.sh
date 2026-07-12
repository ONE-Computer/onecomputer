#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="${ONECOMPUTER_CONTROL_TABLE:?Set ONECOMPUTER_CONTROL_TABLE}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-1}}"
AWS_BIN="${AWS_BIN:-aws}"

if "$AWS_BIN" dynamodb describe-table --region "$REGION" --table-name "$TABLE_NAME" >/dev/null 2>&1; then
  echo "control_table_exists name=$TABLE_NAME region=$REGION"
  exit 0
fi

"$AWS_BIN" dynamodb create-table \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=OneComputer Key=Component,Value=AccessGateway Key=Environment,Value=Sandbox \
  >/dev/null

"$AWS_BIN" dynamodb wait table-exists --region "$REGION" --table-name "$TABLE_NAME"
echo "control_table_created name=$TABLE_NAME region=$REGION"
