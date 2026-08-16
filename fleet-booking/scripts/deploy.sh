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
# Touches only the `fleet.` subdomain. FleetTrackerStack and the apex site are
# separate stacks and are not read or modified here.
set -euo pipefail

DOMAIN="${DOMAIN:-fleet.ravensoft.click}"
# The account that serves ravensoft.click and holds its Route 53 zone. Kept in
# step with the pin in infra/bin/fleet-booking.ts.
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-191331702653}"
PARENT_DOMAIN="${DOMAIN#*.}"
REGION="us-east-1"   # CloudFront certificates must live in us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

bold "▸ fleet-booking deploy"
info "domain: $DOMAIN   region: $REGION"

# ── 0. Prerequisites ────────────────────────────────────────────────────────
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "✗ AWS credentials are not working." >&2
  echo "  Run 'aws configure', or select a working profile:" >&2
  echo "      AWS_PROFILE=<profile> npm run deploy" >&2
  echo "  Note: a key beginning ASIA is a temporary STS credential and expires." >&2
  exit 1
fi
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
info "account: $ACCOUNT${AWS_PROFILE:+  (profile: $AWS_PROFILE)}"

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

# The owner's email decides who can see every customer's phone number, so a
# deploy that forgot it would ship an admin page nobody can reach. Say so now
# rather than after CloudFront has propagated.
if [[ -z "${OWNER_EMAILS:-}" ]]; then
  echo >&2
  echo "✗ OWNER_EMAILS is not set — nobody would be able to confirm a booking." >&2
  echo "  Set it to the Clerk sign-in address you will use:" >&2
  echo "      OWNER_EMAILS=you@example.com npm run deploy" >&2
  exit 1
fi
info "owner: $OWNER_EMAILS"

# ── 1. Is the parent zone hosted in this account? ───────────────────────────
bold "▸ Looking for a Route 53 hosted zone for $PARENT_DOMAIN"
ZONE_ID="$(aws route53 list-hosted-zones-by-name \
  --dns-name "$PARENT_DOMAIN." \
  --query "HostedZones[?Name=='${PARENT_DOMAIN}.'].Id | [0]" \
  --output text 2>/dev/null | sed 's|/hostedzone/||')"

CTX=(-c "domainName=$DOMAIN" -c "zoneName=$PARENT_DOMAIN" -c "ownerEmails=$OWNER_EMAILS")

if [[ -n "$ZONE_ID" && "$ZONE_ID" != "None" ]]; then
  info "found zone $ZONE_ID — CDK will create the validation and alias records"
  CTX+=(-c "hostedZoneId=$ZONE_ID")
else
  info "no hosted zone in this account — certificate will be validated manually"

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
bold "▸ Deploying FleetBookingStack"
( cd "$ROOT/infra" && npx cdk deploy --require-approval never --outputs-file cdk-outputs.json -c "account=$ACCOUNT" "${CTX[@]}" )

OUTPUTS="$ROOT/infra/cdk-outputs.json"
get() { node -e "console.log(require('$OUTPUTS').FleetBookingStack.$1 || '')"; }

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
echo "  If you have not set the Clerk SSM parameters yet, sign-in will fail."
echo "  See deploy.md section 4."
