# fleet-booking

**fleet.ravensoft.click** — advance booking for long hires. A customer enters a
route, sees a price immediately, and requests the trip; the owner confirms it.

Separate from `fleet-income-tracker/` in every way that matters: its own folder,
its own CDK stack, its own DynamoDB table, its own subdomain. The tracker is a
private tool holding the owner's margins. This is a page strangers land on.

---

## What it does

- **Route** — start, destination, and up to eight stops, each with an optional
  wait. Places come from Google, restricted to Sri Lanka.
- **Price, instantly** — the quote updates as the form changes, itemised so a
  customer can see which input to change. No sign-in needed to see a price.
- **Book** — signing in with Clerk turns a quote into a pending request. The
  owner confirms, declines, assigns a driver, or agrees a different price.

## How the price is built

Rates live in DynamoDB and are edited from the admin page — no deploy needed to
change one. The shipped defaults, in LKR:

| | |
|---|---|
| Day rate | 14,000 per 8-hour day, including 100 km |
| Beyond the allowance | 90 / km |
| Overtime | 2,200 / hour, capped at the cost of another day |
| Night away | 2,500, the driver's board at cost |
| Vehicle | One hatchback EV, up to 3 passengers. Extra vehicles are added from Admin → Rates and carry a multiplier on time and distance, never on allowances. |

Two rules are worth knowing, both in [`shared/pricing.mjs`](shared/pricing.mjs):

**A day means two different things.** Inside a single day the customer buys
hours — eight included, more charged hourly. Across days they buy days, because
a driver on a touring day is on duty for part of it and asleep for the rest.
Billing a 24-hour hire as three eight-hour days would charge his night as work
and land at three times the market price.

**Overtime never costs more than the day it nearly is.** Otherwise the price
curve spikes just before each boundary, and a customer who noticed could
*extend* the trip to pay less.

The routed duration also sets a floor: if the roads say eleven hours, an
eight-hour hire is quoted at eleven, and the card says so rather than appearing
to have invented a number. That duration is traffic-aware — the trip's start
time is sent to Google, so a dawn run to Kandy is not priced at the same speed
as a rush-hour one.

## Running it

```bash
npm install
cp .env.example .env      # then fill in the Clerk and Google Maps values
npm run dev               # API on :3002, web on :5174
```

Both ports differ from the tracker's, so the two apps can run side by side.

The store defaults to memory — no AWS, no Docker — so bookings vanish on
restart. To walk the booking flow before a Clerk account exists, set
`DEV_FAKE_USER=1` (and `DEV_FAKE_OWNER=1` for the admin page) in `.env`. That
switch is ignored on a deployed Lambda; see [`api/auth.mjs`](api/auth.mjs).

```bash
npm test          # 75 tests, no network
```

## Layout

```
shared/     pricing and trip validation — pure, shared by API and tests
api/        one Lambda: handler, store, Clerk verification, Google routing
src/        the SPA — Book, Bookings, Admin
infra/      CDK: S3 + CloudFront, HTTP API, DynamoDB
scripts/    deploy.sh, deploy-frontend.sh
```

The API is one Lambda behind an HTTP API, same shape as the tracker.
`api/local-server.mjs` wraps the *same handler* in Express for development, so
there is no second copy of the routing to drift.

## Deploying

See [deploy.md](deploy.md). Short version:

```bash
OWNER_EMAILS=you@example.com AWS_PROFILE=scrawl npm run deploy
```

## Notes and limits

- **Places and routing are Google Maps Platform**, called only from the server
  so the billed key never reaches a browser. Answers are cached in DynamoDB with
  a TTL. If Google is unreachable or the key is missing, the quote falls back to
  great-circle distance with a detour factor and is labelled approximate rather
  than failing. All of that lives in [`api/routing.mjs`](api/routing.mjs).
- **Autocomplete is billed per session, not per keystroke.** Every request made
  while somebody types one place, plus the single details lookup when they pick
  it, share a session token and count once. Suggestions therefore carry a
  `placeId` and no coordinates — resolving all six would cost six times what
  resolving the chosen one does.
- **The map must be Google's.** Their terms require their basemap under a route
  their Routes API produced, so the map and the routing stand or fall together.
- **Routes are a choice, and the choice is about money.** On this island the
  expressway is usually the *longer* road — Colombo to Ella is 314 km via the
  E01 and 196 km on the A4 — so with distance billed past an allowance the fast
  route can cost LKR 10,000 more. Every quote offers up to three roads, each
  priced, one of them explicitly computed with expressways and tolls refused.
  That costs two Routes calls per uncached quote instead of one; they are issued
  in parallel and both are cached.
- **No payment.** A booking is a request; money is settled off-platform.
- **No availability check.** Two customers can request the same day; the owner
  sees both and confirms one. A driver calendar is the obvious next step.
- **No email or SMS.** The owner learns of a request by opening the admin page.
  SES or a WhatsApp webhook would fix that.
- **English only.** The tracker is bilingual; this is not, yet.
