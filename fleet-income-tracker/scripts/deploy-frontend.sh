#!/usr/bin/env bash
#
# Build the SPA, sync it to S3, invalidate CloudFront.
#
#   npm run deploy:frontend
#
# Reads the bucket, distribution and API URL from infra/cdk-outputs.json, so
# the stack must have been deployed at least once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS="$ROOT/infra/cdk-outputs.json"

if [[ ! -f "$OUTPUTS" ]]; then
  echo "✗ $OUTPUTS not found — run 'npm run deploy' first." >&2
  exit 1
fi

get() { node -e "console.log(require('$OUTPUTS').FleetTrackerStack.$1 || '')"; }

BUCKET="$(get SiteBucketName)"
DIST_ID="$(get DistributionId)"
API_URL="$(get ApiUrl)"

[[ -n "$BUCKET" && -n "$DIST_ID" && -n "$API_URL" ]] || {
  echo "✗ Stack outputs are incomplete. Re-run 'npm run deploy'." >&2
  exit 1
}

printf '\033[1m▸ Building SPA\033[0m\n'
echo "  api: $API_URL"
( cd "$ROOT" && VITE_API_URL="$API_URL" npm run build )

printf '\033[1m▸ Syncing to s3://%s\033[0m\n' "$BUCKET"
# Hashed assets are immutable and cached hard; index.html must never be cached
# or a deploy would not be visible until the TTL expired.
aws s3 sync "$ROOT/dist/" "s3://$BUCKET/" \
  --delete \
  --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$ROOT/dist/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

printf '\033[1m▸ Invalidating CloudFront %s\033[0m\n' "$DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text

printf '\033[1m✓ Frontend published\033[0m\n'
