# Ravensoft Fleet

`fleet-income-tracker` — tracks an Uber fleet driver's daily revenue against a tiered commission plan.
Serverless, single repo: React SPA on S3/CloudFront, one Lambda behind an API
Gateway HTTP API, DynamoDB for storage, EventBridge for nightly syncs.

Nothing in the stack has an hourly charge — no servers, no VPC, no NAT gateway,
no load balancer. See [deploy.md](./deploy.md) for the cost breakdown.

## The commission plan

Driver monthly pay from gross monthly revenue **R** (LKR):

| Tier | Rule | At R = 406,789.20 |
|---|---|---|
| 1 | flat base | 50,000.00 |
| 2 | 30% of the portion of R between 240,000 and 300,000 | 18,000.00 |
| 3 | 50% of the portion above 300,000 | 53,394.60 |
| | **total** | **121,394.60** |

All five parameters (`base`, `bandStart`, `bandEnd`, `bandRate`, `topRate`) live
in the settings row in DynamoDB and are editable under **Settings** — none of
them is hardcoded in the calculation.

### Partial first month

A driver who starts mid-month has not had a full month to reach the bands, so
the month containing the **start date** (also a setting) is prorated: the flat
base and both band edges scale by operating days ÷ days in month, while the
percentages stay put. Starting 20 July gives a factor of 12/31 — base 19,354.84,
band 92,903.23–116,129.03 — so a partial month can still reach tiers 2 and 3 on a
full-month daily run rate.

Only the starting month is affected. **Every later month runs the plan at full
value**, and the projection extrapolates over operating days rather than the
calendar, so days before the driver started never dilute the daily average. The single source of truth is
[`shared/commission.mjs`](./shared/commission.mjs), imported by the SPA, the
Lambda and the tests alike.

## Local setup

```bash
npm install
cp .env.example .env      # fill in the Uber secret; the client ID is prefilled
npm run seed              # ~10 sample days so the dashboard has data
npm run dev               # API on :3001, SPA on :5173
```

Open http://localhost:5173 and sign in with the dev defaults:

| user | password | can see |
|---|---|---|
| `owner` | set in `.env` | everything, including owner share, GPS check and settings |
| `driver` | `driver123` | dashboard and daily log only |

A dev default applies **only** when the matching `JWT_SECRET` /
`OWNER_PASSWORD_HASH` / `DRIVER_PASSWORD_HASH` is absent from `.env`. Generate a
real hash with `npm run hash-password -- 'the-password'` and put it in `.env`
locally; in AWS all three come from SSM SecureString. Never commit a hash — this
repo is public.

`npm run seed -- --full` fills every elapsed day of the current month instead of
10 days, which pushes revenue into tiers 2 and 3 so the ladder and the per-tier
breakdown have something to show.

### Storage in development

Two options, switched by one env var:

| `DDB_ENDPOINT` | store |
|---|---|
| unset | JSON file at `.local/store.json` — no Docker needed |
| `http://localhost:8000` | DynamoDB Local via `npm run ddb:up` |

```bash
npm run ddb:up            # docker compose up -d
npm run ddb:create-table  # creates fleet-tracker locally
```

Both go through the same interface in [`api/store.mjs`](./api/store.mjs), so the
handler code is identical locally and in Lambda. DynamoDB Local needs Docker and
a JVM; the file store exists so `npm run dev` works without either.

## Tests

```bash
npm test
```

Vitest covers the commission calculation — the 406,789.20 → 121,394.60 reference
figure, revenue below the band, inside the band, the exact 240k and 300k
boundaries, custom tier parameters, and the owner-share and projection helpers —
plus the DAGPS date handling, including the epoch-ms stamp the portal expects
for a given Colombo day.

## Pages

- **`/`** — month-to-date revenue, trips, days logged, driver take-home with the
  per-tier breakdown, month-end projection, owner share (owner only), and a tier
  ladder showing the zones, the MTD fill and a dashed projection marker.
- **`/log`** — add/edit/delete a day, plus CSV import.
- **`/validate`** — days with both Uber and GPS kilometres, flagged when GPS
  exceeds Uber by more than 150%. Owner only. Uber reports *on-trip* distance
  only — it excludes driving to pickups, repositioning and the trip home — so
  total odometer distance normally runs 1.6–2.8x higher (this fleet averages
  1.9x). The threshold is set above that band, so a flag means the car covered
  ground its fares do not account for. A 15% threshold, the intuitive guess,
  flags every single day and is useless.
- **`/settings`** — the five tier parameters, with a live check that recomputes
  pay at 406,789.20 and confirms it still returns 121,394.60. Owner only.

Role enforcement is server-side. A `driver` token is refused by the API on
settings, GPS comparison and owner-share figures — hiding the tabs is cosmetic,
the API is the control.

## CSV import

Uber Fleet Portal exports have unknown column names, so the import is two-step:
papaparse reads the headers client-side, dropdowns map them to date / revenue /
trips / distance, and the mapping is saved in settings so it is pre-filled next
time. Normalised rows are POSTed to the API in batches of 200.

Per-trip exports (several rows per date) are summed into one entry per date.
Dates are accepted as `yyyy-mm-dd`, `dd/mm/yyyy` or `mm/dd/yyyy`, and amounts
tolerate thousands separators and currency prefixes. GPS mileage is never
overwritten by an import.

### Which report to export

No single Uber report has everything, so the import **merges**: a column a file
does not contain keeps whatever is already stored. Import both and each day ends
up complete.

| Report | Gives | Map revenue to |
|---|---|---|
| **Payments / order** | date + earnings per transaction | `Paid to you : Your earnings` |
| **Trip activity** | date + distance + trip status | — (no fare column) |
| Driver summary | earnings only, no date, no distance | `Total Earnings` |

Three traps, all handled automatically but worth understanding:

- **Do not map revenue to `Paid to you`.** That is the net bank settlement after
  Uber deducts cash the driver already collected, and it goes *negative* on
  cash-heavy days (−9,132.43 on 2026-07-24 in the sample data). The commission
  plan needs `Paid to you : Your earnings`, which is fare-based and stays
  positive. Non-trip rows (Drive Pass, disbursements) carry zero earnings, so
  they contribute nothing and need no filtering.
- **Cancelled trips are excluded.** The trip activity export lists them
  alongside completed ones — 34 of 76 rows in the sample. Map the status column
  and only `completed` rows are imported.
- **Identifier columns are never auto-mapped to a measure.** `Trip UUID` would
  otherwise be parsed into a nonsense trip count, and `…Transferred To Bank
  Ac*count*` into a trip count via a loose keyword match. Candidate columns are
  checked against a real value from the file first.

## Uber API check

```bash
npm run uber:check
```

Requests a `client_credentials` token for the
`vehicle_suppliers.organizations.read` scope and, on success, lists the supplier
organisations. On failure it prints the exact error body and what it means. The
secret is never printed.

**Current status:** the credentials are accepted but the call returns
`invalid_scope` — Uber has not granted this app Supplier API access yet. Request
it through the developer dashboard; until then the Uber sync stays a placeholder
and revenue comes from CSV import or manual entry.

This is the one remaining gap in the data: GPS kilometres are real, but until an
Uber CSV is imported the `uberKm` figures are seeded samples, so the `/validate`
comparison is not yet meaningful.

## GPS mileage sync (DAGPS)

Implemented and live. [`jobs/dagps-client.mjs`](./jobs/dagps-client.mjs) logs
into the tracker portal and reads real daily mileage — plain `fetch`, no
headless browser, no scraping library.

```bash
npm run dagps:sync                            # last 7 days
npm run dagps:sync -- 2026-07-01 2026-07-25   # explicit range
npm run dagps:sync -- --dry-run               # fetch and print, write nothing
```

The same code runs nightly in the sync Lambda. Protocol notes (verified against
the live portal, and documented in full in the client's header):

- log in by **plate number / IMEI**, POSTing to `/LoginByUser.aspx?method=loginSystem`
- the password is sent **in plaintext** — the portal does not hash it client-side
- the response is a `window.location.href` script carrying an `mds` session token
- mileage comes from `POST /GetDataService.aspx?method=report`, with the date
  range in the **body** (epoch-ms midnights, Asia/Colombo), not the query string
- the report aggregates its range, so one request per day gives the daily series

Accuracy was checked two ways: a single day matched the portal UI exactly
(97.74 km), and summing 25 individual days matched the portal's own month-range
total to 0.06 km. Days under 1 km are treated as the vehicle being idle and are
not written. A failed night self-heals because each run re-pulls the last 7 days.

**Caveat:** `mil` is total vehicle distance — it includes off-app driving and
anyone else using the car. That is precisely why it is compared against Uber's
figure on `/validate` rather than trusted as a substitute for it.

## Deployment

See [deploy.md](./deploy.md) — AWS prerequisites, CDK bootstrap, the single
deploy command, SSM secrets, publishing the frontend, tailing logs, and costs.

## Layout

```
shared/commission.mjs    tier calculation — used by SPA, Lambda and tests
api/handler.mjs          the entire API (one Lambda, all routes)
api/store.mjs            DynamoDB single-table access (+ local file store)
api/auth.mjs             JWT signing/verification, bcrypt, roles
api/local-server.mjs     express wrapper running the same handler locally
jobs/sync.mjs            scheduled Lambda (dagps + uber)
jobs/dagps-client.mjs    tracker-portal login + daily mileage scraper
src/                     React SPA
scripts/                 seed, table creation, uber check, dagps sync, deploy
infra/                   AWS CDK stack
```
