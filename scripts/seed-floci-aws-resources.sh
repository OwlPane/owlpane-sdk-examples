#!/usr/bin/env bash
# Create minimal AWS resources + CloudWatch samples in Floci for YACE / library AWS dashboards.
set -euo pipefail

QUEUE_NAME="${OWLPANE_FLOCI_QUEUE:-owlpane-dogfood}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

if ! command -v floci >/dev/null 2>&1; then
  echo "Install Floci: https://floci.io/" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI required (brew install awscli)" >&2
  exit 1
fi

# shellcheck disable=SC1090
eval "$(floci env)"
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

echo "Floci endpoint: $AWS_ENDPOINT_URL region=$REGION"

aws --endpoint-url="$AWS_ENDPOINT_URL" sqs create-queue --queue-name "$QUEUE_NAME" >/dev/null 2>&1 || true
QURL="$(aws --endpoint-url="$AWS_ENDPOINT_URL" sqs get-queue-url --queue-name "$QUEUE_NAME" --query QueueUrl --output text)"
echo "SQS queue: $QUEUE_NAME"
# YACE discovery expects tagged resources (even on Floci).
aws --endpoint-url="$AWS_ENDPOINT_URL" sqs tag-queue --queue-url "$QURL" --tags "owlpane=dogfood,Environment=local" 2>/dev/null || true

# Sample traffic so SQS metrics exist
aws --endpoint-url="$AWS_ENDPOINT_URL" sqs send-message \
  --queue-url "$(aws --endpoint-url="$AWS_ENDPOINT_URL" sqs get-queue-url --queue-name "$QUEUE_NAME" --query QueueUrl --output text)" \
  --message-body "owlpane-dogfood-$(date +%s)" >/dev/null

# CloudWatch custom points (Floci / LocalStack-compatible API)
for i in 1 2 3; do
  aws --endpoint-url="$AWS_ENDPOINT_URL" cloudwatch put-metric-data \
    --namespace "AWS/SQS" \
    --metric-data "MetricName=NumberOfMessagesSent,Dimensions=[{Name=QueueName,Value=$QUEUE_NAME}],Value=$((10 + i)),Unit=Count" \
    2>/dev/null || true
done

echo "Seeded SQS + CloudWatch samples for YACE discovery."
