# Deploying fleet-income-tracker

Copy-paste steps, in order. Everything lands in **us-east-1** (CloudFront
requires its ACM certificate there).

This stack is called `FleetTrackerStack` and is completely separate from the
existing `RavensoftStack`. It creates no records for the apex `ravensoft.click`
and touches nothing that serves it — only the `tracker.` subdomain.

---

## 1. Prerequisites

- An AWS account with admin (or equivalent) credentials
- Node 20+ and the AWS CLI v2
- A shell in the `fleet-income-tracker/` directory

```bash
aws configure
# AWS Access Key ID:     …
# AWS Secret Access Key: …
# Default region name:   us-east-1
# Default output format: json

aws sts get-caller-identity     # must print your account, not an error
```

Install dependencies for both the app and the infrastructure:

```bash
npm install
npm --prefix infra install
```

---

## 2. Bootstrap CDK (once per account/region)

```bash
npx --prefix infra cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

`<ACCOUNT_ID>` is the `Account` field printed by `get-caller-identity`.

---

## 3. Deploy

```bash
npm run deploy
```

That one command:

1. checks your credentials,
2. looks for a Route 53 hosted zone for `ravensoft.click` **in this account**,
3. deploys `FleetTrackerStack`,
4. builds the SPA with the API URL baked in, syncs it to S3, and invalidates
   CloudFront.

### DNS — two paths, handled automatically

**If the hosted zone is in this account**, CDK creates the certificate
validation records and the `tracker.ravensoft.click` alias record itself.
Nothing manual.

**If it is not**, the script requests the certificate, then **pauses** and
prints the exact CNAME to add, for example:

```
════════ ACTION REQUIRED — add this DNS record ════════
-----------------------------------------------------------
|                  DescribeCertificate                    |
+--------+------------------------------------------------+
|  Name  |  _a79865eb4cd1a6ab990c22008ae6c151.tracker...  |
|  Type  |  CNAME                                          |
|  Value |  _424c463f9b4e2d3f7e1a....acm-validations.aws.  |
+--------+------------------------------------------------+

  Add that as a CNAME record at your DNS provider, then press Enter.
```

Add it, press Enter, and the script waits for ACM to validate before
continuing. After the stack deploys it prints the second record you need:

```
════════ ACTION REQUIRED — point the subdomain at CloudFront ════════
  Type:      CNAME
  Name:      tracker   (i.e. tracker.ravensoft.click)
  Value:     d1234abcd.cloudfront.net
  TTL:       300
```

Until that record exists the app is reachable at the CloudFront domain directly.

To deploy under a different hostname: `DOMAIN=foo.example.com npm run deploy`.

---

## 4. Set the secrets (required — logins fail without them)

Secrets live in SSM Parameter Store as SecureString. They are never in the repo,
the code, or the frontend bundle. CloudFormation cannot create SecureStrings, so
set them once by hand:

```bash
# Generate the password hashes first — plaintext is never stored anywhere
npm run hash-password -- 'the-owner-password'     # prints $2a$10$…
npm run hash-password -- 'the-driver-password'

aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/jwt-secret \
  --value "$(openssl rand -base64 48)"

aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/owner-password-hash \
  --value '<paste the owner hash>'

aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/driver-password-hash \
  --value '<paste the driver hash>'
```

For the nightly GPS sync (required — the dagps job fails without these):

```bash
aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/dagps-user  --value '<plate number / IMEI>'
aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/dagps-pass  --value '<password>'
aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/uber-client-id     --value 'nqqC6Vjo8cQ0pPhv9BNnmNSkyOcKsu93'
aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fleet-tracker/uber-client-secret --value '<the secret>'
```

Quote values in single quotes — bcrypt hashes contain `$`, which the shell would
otherwise expand.

The API Lambda can read only the three auth parameters; the sync Lambda can read
only the four job parameters. Neither can read the other's, and neither has any
other SSM access.

---

## 5. Publish the frontend again (after a UI change)

```bash
npm run deploy:frontend
```

Builds, syncs to S3 and invalidates CloudFront. Hashed assets are cached for a
year; `index.html` is sent with `no-cache` so a deploy is visible immediately.

---

## 6. Tail the logs

```bash
# API
aws logs tail /aws/lambda/fleet-tracker-api --follow --region us-east-1

# Nightly sync
aws logs tail /aws/lambda/fleet-tracker-sync --follow --region us-east-1

# Last hour only
aws logs tail /aws/lambda/fleet-tracker-api --since 1h --region us-east-1
```

Fire the sync by hand without waiting for the schedule:

```bash
aws lambda invoke --region us-east-1 \
  --function-name fleet-tracker-sync \
  --payload '{"job":"dagps"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

---

## 7. What runs on a schedule

| Rule | UTC | Asia/Colombo | Job |
|---|---|---|---|
| `fleet-tracker-dagps-nightly` | 18:00 | 23:30 | GPS mileage |
| `fleet-tracker-uber-daily` | 20:30 | 02:00 | Uber earnings (placeholder) |

Colombo is UTC+5:30 year-round, so no DST adjustment is needed.

`dagps` is implemented: each run logs into the tracker portal and writes the
last 7 days of real mileage into `entries.gpsKm`. It needs
`/fleet-tracker/dagps-user` (plate number / IMEI) and `/fleet-tracker/dagps-pass`
in SSM — without them the job throws rather than writing anything.

`uber` is still a placeholder that logs and exits, because Uber has not granted
the app Supplier API access yet.

---

## 8. Cost

At one driver and roughly 30 writes plus a few hundred reads a month, every
component sits inside the perpetual free tier or costs cents.

| Service | Usage here | Cost |
|---|---|---|
| DynamoDB on-demand | ~30 writes, <1k reads/month, <1 MB | free tier (25 GB, 25 WCU/RCU equivalent) |
| Lambda | a few thousand invocations/month | free tier (1M requests, 400k GB-s) |
| API Gateway HTTP API | same | free tier for 12 months, then ~$1.00 per million requests |
| S3 | <5 MB of static assets | ~$0.01/month |
| CloudFront | <1 GB transfer | free tier (1 TB/month, perpetual) |
| EventBridge | 60 scheduled events/month | free (scheduled rules are not billed) |
| SSM Parameter Store | 7 standard parameters | free (standard tier) |
| Sync Lambda egress to the tracker portal | ~7 small HTTPS calls/night | free (Lambda egress to the internet is not billed) |
| CloudWatch Logs | a few MB | free tier (5 GB ingest) |
| Route 53 | only if the zone is in this account | $0.50/month per hosted zone |
| ACM certificate | 1 | free |

**Realistic total: $0.00–0.10/month**, or $0.50 if this account also hosts the
Route 53 zone — and that charge is for the existing `ravensoft.click` zone, not
something this stack adds.

### What could ever exceed ~$1/month

- **CloudFront egress** if the SPA were shared widely — 1 TB/month is free, so
  this needs real traffic to matter.
- **API Gateway after the 12-month free tier** — $1.00 per million requests. A
  single user cannot approach that.
- **A runaway sync loop.** The sync Lambda has a 2-minute timeout and runs twice
  a day; if phase 2 ever adds retries, cap them.
- **Point-in-time recovery** is enabled on the table (this is the backup story).
  PITR is billed per GB of backup storage; at well under 1 GB it rounds to
  cents, but it is the one always-on charge in the stack.
- **CloudWatch Logs retention is unlimited by default.** Not a concern at this
  volume, but if the sync ever logs verbosely, set a retention policy.

Nothing here is billed per hour. There is no VPC, NAT gateway, load balancer,
or provisioned capacity anywhere in the stack.

---

## 9. Tearing down

```bash
npm --prefix infra run destroy
```

The DynamoDB table and the S3 bucket have `RemovalPolicy.RETAIN`, so **your data
survives** a destroy and must be deleted by hand if you really want it gone.
