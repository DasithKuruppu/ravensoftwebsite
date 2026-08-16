# Deploying fleet-booking

Copy-paste steps, in order. Everything lands in **us-east-1** (CloudFront
requires its ACM certificate there).

This stack is called `FleetBookingStack`. It is separate from
`FleetTrackerStack` and from the existing `RavensoftStack`, creates no records
for the apex `ravensoft.click`, and touches nothing that serves it or the
`tracker.` subdomain — only `fleet.`.

---

## 1. Prerequisites

- An AWS account with admin (or equivalent) credentials
- Node 20+ and the AWS CLI v2
- A Clerk account (free tier is enough) — see section 3
- A shell in the `fleet-booking/` directory

```bash
aws sts get-caller-identity     # must print account 191331702653, not an error
```

This stack is **pinned to account `191331702653`** — the account that already
serves ravensoft.click and holds its Route 53 hosted zone. The pin lives in
`infra/bin/fleet-booking.ts`, and `deploy.sh` refuses to run against any other
account rather than silently deploying a second copy of everything somewhere
else.

Pick the profile that belongs to that account:

```bash
AWS_PROFILE=scrawl npm run deploy
```

If `get-caller-identity` fails with `InvalidClientTokenId`, check whether the
key starts with **`ASIA`** — a temporary STS session credential, which expires
within hours. A permanent IAM key starts with `AKIA`.

Install dependencies for both the app and the infrastructure:

```bash
npm install
npm --prefix infra install
```

---

## 2. Bootstrap CDK (once per account/region)

```bash
AWS_PROFILE=scrawl npx --prefix infra cdk bootstrap aws://191331702653/us-east-1
```

The account already has a `CDKToolkit` stack from the ravensoft site and the
tracker, so this is likely a no-op. Running it again is harmless.

---

## 3. Set up Clerk

1. Create an application at <https://dashboard.clerk.com>. Enable whichever
   sign-in methods you want — email code and Google are the least friction for
   a customer booking a car once.
2. From **API keys**, note three values:

   | Value | Looks like | Where it goes |
   |---|---|---|
   | Publishable key | `pk_live_…` | baked into the SPA at build time |
   | Secret key | `sk_live_…` | SSM, server-side only |
   | Frontend API URL | `https://clerk.ravensoft.click` or `https://<app>.clerk.accounts.dev` | SSM, as the token issuer |

   The **Frontend API URL** is the JWT issuer. Copy it without a trailing slash.
3. Optional but recommended: under **Domains**, add `fleet.ravensoft.click` as a
   satellite/production domain so sign-in pages match the site.

Nothing else in Clerk needs configuring. The API reads each signed-in user's
email and phone through the Backend API using the secret key.

---

## 4. Store the secrets in SSM

Three SecureString parameters, all under `/fleet-booking`:

```bash
AWS_PROFILE=scrawl aws ssm put-parameter --region us-east-1 \
  --type SecureString --overwrite \
  --name /fleet-booking/clerk-issuer \
  --value 'https://your-app.clerk.accounts.dev'

AWS_PROFILE=scrawl aws ssm put-parameter --region us-east-1 \
  --type SecureString --overwrite \
  --name /fleet-booking/clerk-secret-key \
  --value 'sk_live_xxxxxxxxxxxxxxxxxxxxx'
```

```bash
AWS_PROFILE=scrawl aws ssm put-parameter --region us-east-1 \
  --type SecureString --overwrite \
  --name /fleet-booking/google-maps-api-key \
  --value 'AIzaSy…your-server-key'
```

The Lambda's IAM policy grants it exactly these three parameters and nothing
else.

If a parameter is missing, the API answers with a message naming it and the
command to create it rather than a generic 500 — so a forgotten step is visible
in the browser, not only in CloudWatch.

---

## 5. Set up Google Maps

Two keys, and they must not be the same one.

At <https://console.cloud.google.com> enable **Places API (New)**, **Routes
API** and **Maps JavaScript API**, then create two keys under *Credentials*:

| Key | Restrict to | Where it goes |
|---|---|---|
| Server | *API restrictions*: Places API (New) + Routes API. No application restriction — a Lambda has no referrer and no fixed IP. | SSM, section 4 |
| Browser | *API restrictions*: Maps JavaScript API. *Application restriction*: HTTP referrers — `https://fleet.ravensoft.click/*` and `http://localhost:5174/*`. | baked into the SPA |

The browser key ships inside the JavaScript bundle — that is unavoidable and by
design. The referrer restriction is the only thing standing between it and
somebody else's bill, so do not skip it, and never put the server key there:
an unrestricted key that can call Routes is one someone can spend at $5 per
thousand requests.

Set a **budget alert** on the project while you are there. Google's free monthly
credit covers a quiet site comfortably, but a loop in a form is a fast way to
find the edge of it.

---

## 6. Deploy

`OWNER_EMAILS` decides who can confirm bookings, see every customer's phone
number, and edit the rate card. Set it to the address you sign in to Clerk with.
The deploy refuses to run without it, because a site whose bookings nobody can
confirm is worse than no site.

```bash
OWNER_EMAILS=you@example.com \
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx \
VITE_GOOGLE_MAPS_BROWSER_KEY=AIzaSy…browser-key \
AWS_PROFILE=scrawl npm run deploy
```

Or put them in `.env` — `deploy-frontend.sh` sources it — and just run
`OWNER_EMAILS=you@example.com AWS_PROFILE=scrawl npm run deploy`.

That one command:

1. checks your credentials and the account pin,
2. looks for a Route 53 hosted zone for `ravensoft.click` **in this account**,
3. deploys `FleetBookingStack`,
4. builds the SPA with the API URL and Clerk key baked in, syncs it to S3, and
   invalidates CloudFront.

### DNS — two paths, handled automatically

**Zone in this account** (the expected case): CDK creates the certificate
validation records and the `fleet` alias record itself. Nothing to do.

**Zone elsewhere**: the script requests the certificate, pauses, and prints the
CNAME to add at your DNS provider. Add it, press Enter, and it waits for ACM.
Afterwards it prints a second CNAME pointing `fleet` at the CloudFront domain.

---

## 7. Check it

```bash
curl https://fleet.ravensoft.click/          # the SPA
curl "$(node -pe "require('./infra/cdk-outputs.json').FleetBookingStack.ApiUrl")/health"
```

Then in a browser:

1. Enter a route and a duration — a price should appear without signing in.
2. Sign in and request the trip. You should land on a page with a reference.
3. Open **Admin** and confirm it. If the Admin tab is missing, the email you
   signed in with is not in `OWNER_EMAILS` — check for a typo, then redeploy.

CloudFront can take a few minutes to serve a fresh deploy the first time.

---

## 8. Changing rates later

Through the **Admin → Rates** page. No deploy. Bookings already taken keep the
price they were quoted; only new quotes follow the change.

---

## Routine operations

```bash
npm run deploy:frontend    # SPA only, no infrastructure change
npm run logs:api           # tail the Lambda
npm --prefix infra run diff   # what a deploy would change
```

## Costs

The AWS side is well inside the free tier at this volume: DynamoDB on-demand,
one Lambda, CloudFront PriceClass 100, and an S3 bucket holding a few hundred
kilobytes. Clerk's free tier covers several thousand monthly active users.

**Google Maps is the only part that meters.** Roughly, at list price: Routes
about $5 per 1,000 quotes, autocomplete about $17 per 1,000 *sessions* (not
keystrokes — see the session-token note in the README), map loads about $7 per
1,000. Google's recurring monthly credit absorbs a quiet site entirely.

Three things keep the bill down, and all three are already in place: every
route and place lookup is cached in DynamoDB, so a repeated Colombo–Kandy quote
costs one DynamoDB read and nothing else; suggestions are grouped into billed
sessions; and place coordinates are fetched only for the suggestion actually
chosen. Watch the Routes line if the site gets busy — the form re-quotes as the
customer edits it, and that is the call that costs.

## Tearing it down

```bash
AWS_PROFILE=scrawl npm --prefix infra run destroy
```

The DynamoDB table and the S3 bucket are `RETAIN` — they survive on purpose, so
a destroyed stack does not take the bookings with it. Delete them by hand if you
really mean to.
