#!/usr/bin/env bash
#
# One-command deploy: infrastructure, then the frontend.
#
#   npm run deploy
#
# Handles DNS both ways. If a Route 53 hosted zone for the parent domain exists
# in this AWS account, CDK owns the certificate validation and the alias record.
# If not, the script requests the certificate itself, PAUSES and prints the
# exact CNAME records to add wherever DNS is managed, waits for validation, and
# then continues.
#
# Nothing here touches the apex domain or any other stack.
set -euo pipefail

DOMAIN="${DOMAIN:-tracker.ravensoft.click}"
# The account that serves ravensoft.click and holds its Route 53 zone. Kept in
# step with the pin in infra/bin/fleet-tracker.ts.
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-191331702653}"
PARENT_DOMAIN="${DOMAIN#*.}"
REGION="us-east-1"   # CloudFront certificates must live in us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

bold "▸ fleet-income-tracker deploy"
info "domain: $DOMAIN   region: $REGION"

# ── 0. Prerequisites ────────────────────────────────────────────────────────
# Honour AWS_PROFILE if the caller set one (e.g. AWS_PROFILE=scrawl npm run deploy).
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "✗ AWS credentials are not working." >&2
  echo "  Run 'aws configure', or select a working profile:" >&2
  echo "      AWS_PROFILE=<profile> npm run deploy" >&2
  echo "  Note: a key beginning ASIA is a temporary STS credential and expires." >&2
  exit 1
fi
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
info "account: $ACCOUNT${AWS_PROFILE:+  (profile: $AWS_PROFILE)}"

# The stack pins its account, so a mismatch would fail deep inside CDK with a
# confusing error. Catch it here instead.
if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo >&2
  echo "✗ Wrong AWS account." >&2
  echo "  These credentials are for $ACCOUNT, but this stack is pinned to $EXPECTED_ACCOUNT" >&2
  echo "  (the account serving ravensoft.click)." >&2
  echo >&2
  echo "  Either select the right profile:   AWS_PROFILE=<profile> npm run deploy" >&2
  echo "  or, to deploy elsewhere on purpose: EXPECTED_ACCOUNT=$ACCOUNT npm run deploy" >&2
  exit 1
fi

# ── 1. Is the parent zone hosted in this account? ───────────────────────────
bold "▸ Looking for a Route 53 hosted zone for $PARENT_DOMAIN"
ZONE_ID="$(aws route53 list-hosted-zones-by-name \
  --dns-name "$PARENT_DOMAIN." \
  --query "HostedZones[?Name=='${PARENT_DOMAIN}.'].Id | [0]" \
  --output text 2>/dev/null | sed 's|/hostedzone/||')"

CTX=(-c "domainName=$DOMAIN" -c "zoneName=$PARENT_DOMAIN")

if [[ -n "$ZONE_ID" && "$ZONE_ID" != "None" ]]; then
  info "found zone $ZONE_ID — CDK will create the validation and alias records"
  CTX+=(-c "hostedZoneId=$ZONE_ID")
else
  info "no hosted zone in this account — certificate will be validated manually"

  # Reuse an existing certificate for this domain if there is one.
  CERT_ARN="$(aws acm list-certificates --region "$REGION" \
    --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn | [0]" \
    --output text 2>/dev/null)"

  if [[ -z "$CERT_ARN" || "$CERT_ARN" == "None" ]]; then
    bold "▸ Requesting an ACM certificate for $DOMAIN"
    CERT_ARN="$(aws acm request-certificate \
      --region "$REGION" \
      --domain-name "$DOMAIN" \
      --validation-method DNS \
      --query CertificateArn --output text)"
    info "$CERT_ARN"
    sleep 8   # ACM needs a moment to publish the validation record
  else
    info "reusing existing certificate $CERT_ARN"
  fi

  STATUS="$(aws acm describe-certificate --region "$REGION" --certificate-arn "$CERT_ARN" \
    --query Certificate.Status --output text)"

  if [[ "$STATUS" != "ISSUED" ]]; then
    echo
    bold "════════════════ ACTION REQUIRED — add this DNS record ════════════════"
    aws acm describe-certificate --region "$REGION" --certificate-arn "$CERT_ARN" \
      --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
      --output table
    echo
    echo "  Add that as a CNAME record at your DNS provider, then press Enter."
    echo "  (Name and Value exactly as shown; some providers strip the trailing dot.)"
    echo
    read -r -p "  Press Enter once the record is saved… "

    bold "▸ Waiting for ACM to validate (this can take a few minutes)…"
    aws acm wait certificate-validated --region "$REGION" --certificate-arn "$CERT_ARN"
    info "certificate issued"
  else
    info "certificate already issued"
  fi

  CTX+=(-c "certificateArn=$CERT_ARN")
fi

# ── 2. Deploy the stack ─────────────────────────────────────────────────────
bold "▸ Deploying FleetTrackerStack"
( cd "$ROOT/infra" && npx cdk deploy --require-approval never --outputs-file cdk-outputs.json -c "account=$ACCOUNT" "${CTX[@]}" )

OUTPUTS="$ROOT/infra/cdk-outputs.json"
get() { node -e "console.log(require('$OUTPUTS').FleetTrackerStack.$1 || '')"; }

CF_DOMAIN="$(get DistributionDomainName)"

# ── 3. If DNS is external, print the record that points the subdomain at CloudFront
if [[ -z "$ZONE_ID" || "$ZONE_ID" == "None" ]]; then
  echo
  bold "════════════════ ACTION REQUIRED — point the subdomain at CloudFront ════════════════"
  printf '  %-10s %s\n' "Type:"  "CNAME"
  printf '  %-10s %s\n' "Name:"  "${DOMAIN%%.*}   (i.e. $DOMAIN)"
  printf '  %-10s %s\n' "Value:" "$CF_DOMAIN"
  printf '  %-10s %s\n' "TTL:"   "300"
  echo
  echo "  Until that record exists, use https://$CF_DOMAIN directly."
  echo
fi

# ── 4. Build and publish the frontend ───────────────────────────────────────
bash "$ROOT/scripts/deploy-frontend.sh"

echo
bold "✓ Done"
info "app: $(get AppUrl)"
info "api: $(get ApiUrl)"
echo
echo "  If you have not set the SSM secrets yet, logins will fail. See deploy.md §4."
