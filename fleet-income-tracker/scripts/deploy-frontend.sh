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
  --exclude sw.js \
  --exclude manifest.webmanifest \
  --exclude icon-192.png \
  --exclude icon-512.png \
  --exclude icon-maskable-512.png \
  --exclude apple-touch-icon.png \
  --exclude favicon-16.png \
  --exclude favicon-32.png \
  --exclude favicon-48.png \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$ROOT/dist/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

# The service worker decides what every other file's caching means, so it is the
# one file that must never be cached hard. A sw.js pinned for a year is a site
# that can never be updated again: the browser keeps running last year's worker,
# which keeps serving last year's shell, and no deploy can dislodge it.
aws s3 cp "$ROOT/dist/sw.js" "s3://$BUCKET/sw.js" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "application/javascript; charset=utf-8"

# Likewise the manifest: it carries the app's name and icons, and a browser
# holding a stale copy installs a stale name — which the installed app then
# keeps for good, because neither Chrome nor iOS renames an app after install.
aws s3 cp "$ROOT/dist/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" \
  --cache-control "no-cache,must-revalidate" \
  --content-type "application/manifest+json; charset=utf-8"

# Icons keep stable filenames — only /assets/ is fingerprinted — so caching them
# hard means a changed icon can never reach a browser that already has one. They
# are a few KB and 304 when unchanged, so revalidating costs almost nothing and
# removes a whole class of "the icon will not update" bug.
for f in icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png favicon-16.png favicon-32.png favicon-48.png; do
  [ -f "$ROOT/dist/$f" ] && aws s3 cp "$ROOT/dist/$f" "s3://$BUCKET/$f" \
    --cache-control "no-cache,must-revalidate" \
    --content-type "image/png" >/dev/null
done
printf '  icons uploaded with revalidation\n'

printf '\033[1m▸ Invalidating CloudFront %s\033[0m\n' "$DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text

printf '\033[1m✓ Frontend published\033[0m\n'
