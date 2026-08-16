#!/usr/bin/env bash
#
# Build the SPA, sync it to S3, invalidate CloudFront.
#
#   npm run deploy:frontend
#
# Reads the bucket, distribution and API URL from infra/cdk-outputs.json, so
# the stack must have been deployed at least once.
#
# The Clerk publishable key and the owner email list are baked in at build time
# — Vite has no runtime config. Both are public values by design: the key is
# meant to ship to browsers, and the email list only decides whether an Admin
# tab is drawn. The API is what actually enforces who may use it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS="$ROOT/infra/cdk-outputs.json"

if [[ ! -f "$OUTPUTS" ]]; then
  echo "✗ $OUTPUTS not found — run 'npm run deploy' first." >&2
  exit 1
fi

get() { node -e "console.log(require('$OUTPUTS').FleetBookingStack.$1 || '')"; }

BUCKET="$(get SiteBucketName)"
DIST_ID="$(get DistributionId)"
API_URL="$(get ApiUrl)"

[[ -n "$BUCKET" && -n "$DIST_ID" && -n "$API_URL" ]] || {
  echo "✗ Stack outputs are incomplete. Re-run 'npm run deploy'." >&2
  exit 1
}

# Fall back to .env so `npm run deploy:frontend` on its own picks up the same
# values the last full deploy used.
if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" && -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT/.env"; set +a
fi

if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  echo "⚠ VITE_CLERK_PUBLISHABLE_KEY is not set — the site will quote but not book." >&2
fi

if [[ -z "${VITE_GOOGLE_MAPS_BROWSER_KEY:-}" ]]; then
  echo "⚠ VITE_GOOGLE_MAPS_BROWSER_KEY is not set — the route map will not render." >&2
fi

printf '\033[1m▸ Building SPA\033[0m\n'
echo "  api: $API_URL"
(
  cd "$ROOT" &&
  VITE_API_URL="$API_URL" \
  VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:-}" \
  VITE_GOOGLE_MAPS_BROWSER_KEY="${VITE_GOOGLE_MAPS_BROWSER_KEY:-}" \
  VITE_OWNER_EMAILS="${OWNER_EMAILS:-}" \
  npm run build
)

printf '\033[1m▸ Syncing to s3://%s\033[0m\n' "$BUCKET"
# Hashed assets are immutable and cached hard; index.html must never be cached
# or a deploy would not be visible until the TTL expired.
aws s3 sync "$ROOT/dist/" "s3://$BUCKET/" \
  --delete \
  --exclude index.html \
  --exclude sw.js \
  --exclude manifest.webmanifest \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$ROOT/dist/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

# The service worker decides what every other file's caching means, so it is the
# one file that must never be cached hard. A sw.js pinned for a year is a site
# that can never be updated again — the browser keeps running last year's
# worker, which keeps serving last year's shell.
aws s3 cp "$ROOT/dist/sw.js" "s3://$BUCKET/sw.js" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "application/javascript; charset=utf-8"

# Revalidated, not cached for an hour. The manifest carries the app's name and
# icons, and a browser holding an hour-old copy installs an hour-old name — then
# keeps that name for good, because neither Chrome nor iOS renames an app that
# is already installed. It is a few hundred bytes and 304s when unchanged.
aws s3 cp "$ROOT/dist/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" \
  --cache-control "no-cache,must-revalidate" \
  --content-type "application/manifest+json; charset=utf-8"

printf '\033[1m▸ Invalidating CloudFront %s\033[0m\n' "$DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text

printf '\033[1m✓ Frontend published\033[0m\n'
