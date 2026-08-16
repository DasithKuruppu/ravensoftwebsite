/**
 * DAGPS portal client — logs in and reads daily mileage.
 *
 * Shared by the CLI (scripts/dagps-sync.mjs) and the scheduled Lambda
 * (jobs/sync.mjs). No dependencies: plain fetch, no scraping library, no
 * headless browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROTOCOL — reverse-engineered from the live portal, verified 2026-07-25
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. LOGIN
 *      POST https://www.dagps.net/LoginByUser.aspx?method=loginSystem
 *      content-type: application/x-www-form-urlencoded
 *      userName=<plate/IMEI>&pwd_=&loginType=USER&loginUrl=<login page>
 *        &pwd=<PASSWORD IN PLAINTEXT>&timeZone=5.5&language=en&x=98&y=18&monitor=0
 *
 *    The password is sent as plaintext — the portal does NOT hash it client
 *    side. `pwd_` is the visible box and is submitted empty; `pwd` is the field
 *    the server reads. `loginType` stays "USER" even when logging in by plate.
 *
 *    The response is HTTP 200 whose body is a one-line script:
 *      <script>window.location.href="/user/indexp.aspx?mds=<TOKEN>";</script>
 *    On failure it points at /loginError.aspx instead. `mds` is the session
 *    token threaded through every subsequent call; the ASP.NET_SessionId cookie
 *    must be carried alongside it.
 *
 * 2. MILEAGE
 *      POST https://www.dagps.net/GetDataService.aspx?method=report
 *             &mds=<TOKEN>&showZeroMil=true
 *      beginTime=<epoch ms>&endTime=<epoch ms>
 *        &enterprise_id=<uuid>&channel=USER&radiobutton=0
 *
 *    beginTime/endTime are midnight Asia/Colombo of the day, in epoch
 *    milliseconds; for a single day both are the same value. The date range is
 *    NOT a query parameter — it is posted, which is why the URL looks static.
 *
 *    Response:
 *      {"records":[{"fullname":"CBZ-8083","macid":"<imei>","mil":97.74,...}],
 *       "sumMil":97.74,...}
 *    `mil` / `sumMil` are kilometres. The report aggregates the range, so one
 *    request per day is required to get a per-day series.
 *
 * Caveats worth knowing:
 *   - There is no API contract here. If the portal changes, this breaks; every
 *     parse below throws rather than silently returning 0, so a broken scrape
 *     never writes a wrong number.
 *   - `mil` is total vehicle distance, including any driving done off-app or by
 *     someone else. That is exactly why it is compared against Uber's figure
 *     rather than trusted as a substitute for it.
 */
import crypto from 'node:crypto';

const BASE = 'https://www.dagps.net';
const LOGIN_URL = `${BASE}/LoginByUser.aspx?method=loginSystem`;
const LOGIN_PAGE = `${BASE}/Skins/DefaultIndex/`;
const DATA_URL = `${BASE}/GetDataService.aspx`;
const TZ = 'Asia/Colombo';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * Portal credentials: SSM SecureString in AWS, .env locally.
 * Both the sync job and the API's location route read them through here.
 */
export async function credentials() {
  if (process.env.DAGPS_USER && process.env.DAGPS_PASS) {
    return { user: process.env.DAGPS_USER, pass: process.env.DAGPS_PASS };
  }
  const prefix = process.env.SSM_PREFIX || '/fleet-tracker';
  const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm');
  const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const res = await client.send(
    new GetParametersCommand({
      Names: [`${prefix}/dagps-user`, `${prefix}/dagps-pass`],
      WithDecryption: true,
    }),
  );
  const byName = Object.fromEntries((res.Parameters || []).map((p) => [p.Name, p.Value]));
  const user = byName[`${prefix}/dagps-user`];
  const pass = byName[`${prefix}/dagps-pass`];
  if (!user || !pass) {
    throw new Error(`dagps: credentials missing from SSM under ${prefix}/ (see deploy.md section 4)`);
  }
  return { user, pass };
}

/**
 * Log in by plate number / IMEI.
 * @param {{ user: string, pass: string }} creds
 * @returns {Promise<{ mds: string, cookie: string, enterpriseId: string }>}
 */
export async function login({ user, pass }) {
  if (!user || !pass) throw new Error('dagps: DAGPS_USER and DAGPS_PASS are required');

  const body = new URLSearchParams({
    userName: user,
    pwd_: '',
    loginType: 'USER',
    loginUrl: LOGIN_PAGE,
    pwd: pass,
    timeZone: '5.5',
    language: 'en',
    x: '98',
    y: '18',
    monitor: '0',
  });

  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
      origin: BASE,
      referer: LOGIN_PAGE,
    },
    body,
    redirect: 'manual',
  });

  const cookie = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');

  const text = await res.text();
  const target = (text.match(/window\.location\.href\s*=\s*"([^"]+)"/) || [])[1];

  if (!target) {
    throw new Error(`dagps: unexpected login response (HTTP ${res.status}) — portal markup may have changed`);
  }
  if (/loginError/i.test(target)) {
    throw new Error('dagps: login rejected — check DAGPS_USER (plate/IMEI) and DAGPS_PASS');
  }

  const mds = new URL(target, BASE).searchParams.get('mds');
  if (!mds) throw new Error(`dagps: no session token in redirect "${target}"`);

  const enterpriseId = await fetchEnterpriseId({ mds, cookie, landingPath: target });
  return { mds, cookie, enterpriseId };
}

/**
 * The report call needs the account's enterprise/user UUID. The landing page
 * embeds it (as `userid=` in the tracking frame URL); the loadUser data service
 * is not a source for it, since callers must already know the id to call it.
 */
async function fetchEnterpriseId({ mds, cookie, landingPath }) {
  const res = await fetch(new URL(landingPath, BASE), {
    headers: { 'user-agent': UA, cookie, referer: LOGIN_PAGE },
  });
  const html = await res.text();

  const uuid = html.match(/userid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!uuid) {
    throw new Error('dagps: could not find enterprise_id on the landing page — portal markup may have changed');
  }
  return uuid[1];
}

/**
 * Last known position of the vehicle.
 *
 * The portal's dashboard calls loadUser on load; the payload carries the live
 * fix alongside the device metadata. Field names are pinyin:
 *   jingdu = 经度 = longitude,  weidu = 纬度 = latitude,  sudu = 速度 = speed.
 *
 * `datetime` is the fix time and `heart_time` the last device heartbeat, both
 * formatted yyyy/MM/dd HH:mm:ss in Asia/Colombo. A tracker that has lost signal
 * keeps reporting its last fix, so always show the timestamp next to the point.
 *
 * @returns {Promise<{lat:number, lng:number, speedKmh:number, fixedAt:string|null,
 *                    plate:string|null, deviceId:string|null}>}
 */
export async function fetchLocation(session) {
  const url =
    `${DATA_URL}?method=loadUser&mds=${encodeURIComponent(session.mds)}` +
    `&callback=cb&user_id=${encodeURIComponent(session.enterpriseId)}`;

  const res = await fetch(url, {
    headers: { 'user-agent': UA, cookie: session.cookie, referer: `${BASE}/user/indexp.aspx` },
  });
  const text = await res.text();

  // JSONP: cb({...}) — unwrap before parsing.
  let payload;
  try {
    payload = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, ''));
  } catch {
    throw new Error('dagps: could not parse loadUser response — session may have expired');
  }

  const d = payload.data?.[0];
  if (!d) throw new Error('dagps: loadUser returned no device');

  const lat = Number(d.weidu);
  const lng = Number(d.jingdu);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new Error('dagps: device has no position fix yet');
  }

  return {
    lat,
    lng,
    // The portal's own speed field. On this GT06 it reads 0 even while the car
    // is plainly moving (verified 2026-07-25: 580 m covered across two minutes
    // of fixes, sudu 0 throughout), so it is reported but never trusted — the
    // API derives speed from consecutive fixes instead.
    deviceSpeedKmh: Number(d.sudu) || 0,
    fixedAt: toIso(d.datetime),
    heartbeatAt: toIso(d.heart_time),
    serverTime: toIso(d.sys_time),
    // Ages measured against the portal's own clock rather than ours, so a
    // wrong assumption about its timezone cannot make a live fix look stale.
    fixAgeSeconds: ageSeconds(d.sys_time, d.datetime),
    heartbeatAgeSeconds: ageSeconds(d.sys_time, d.heart_time),
    plate: d.user_name || null,
    deviceId: d.sim_id || null,
  };
}

/**
 * The portal stamps its times at UTC+05:00, NOT Sri Lanka's +05:30.
 *
 * Measured 2026-07-25: the portal reported sys_time (its own "now") as
 * 14:12:38 when Colombo local time was 14:42:44. Reading those stamps as
 * +05:30 makes every fix look exactly 30 minutes stale, which is what the
 * dashboard was showing.
 *
 * Prefer `ageSeconds()` over this wherever possible — comparing two portal
 * timestamps cancels the offset out entirely and survives them changing it.
 */
const PORTAL_UTC_OFFSET = '+05:00';

/** "2026/07/25 11:09:55" in portal time → ISO 8601 with the right offset. */
function toIso(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${PORTAL_UTC_OFFSET}`;
}

/**
 * Seconds between two portal timestamps. Both carry the same offset, so this is
 * correct no matter what timezone the portal decides it is in.
 */
function ageSeconds(nowValue, thenValue) {
  const a = toIso(nowValue);
  const b = toIso(thenValue);
  if (!a || !b) return null;
  const secs = (Date.parse(a) - Date.parse(b)) / 1000;
  return Number.isFinite(secs) ? Math.round(secs) : null;
}

/** Midnight of `date` (yyyy-mm-dd) in Asia/Colombo, as epoch milliseconds. */
export function dayStartEpochMs(date) {
  // Colombo is UTC+5:30 year-round — no DST to account for.
  const ms = Date.parse(`${date}T00:00:00+05:30`);
  if (Number.isNaN(ms)) throw new Error(`dagps: invalid date "${date}"`);
  return ms;
}

/**
 * Total distance driven on one day, in kilometres.
 * @param {{ mds: string, cookie: string, enterpriseId: string }} session
 * @param {string} date yyyy-mm-dd
 * @returns {Promise<number>}
 */
export async function fetchDayMileage(session, date) {
  const stamp = dayStartEpochMs(date);
  const url = `${DATA_URL}?method=report&mds=${encodeURIComponent(session.mds)}&showZeroMil=true`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
      cookie: session.cookie,
      origin: BASE,
      referer: `${BASE}/Report/run/report.aspx`,
    },
    body: new URLSearchParams({
      beginTime: String(stamp),
      endTime: String(stamp),
      enterprise_id: session.enterpriseId,
      channel: 'USER',
      radiobutton: '0',
    }),
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // A session that has expired returns an HTML login page rather than JSON.
    throw new Error(
      `dagps: report for ${date} returned non-JSON (HTTP ${res.status}) — session may have expired`,
    );
  }

  const km = payload.sumMil ?? payload.records?.[0]?.mil;
  if (typeof km !== 'number') {
    throw new Error(`dagps: no mileage figure in report for ${date}`);
  }
  return Math.round(km * 100) / 100;
}

/**
 * Daily mileage across an inclusive date range, one request per day.
 * Requests are sequential and lightly spaced — this is someone else's server.
 *
 * @returns {Promise<Array<{ date: string, gpsKm: number }>>}
 */
export async function fetchDailyMileage(session, fromDate, toDate) {
  const out = [];
  for (const date of eachDate(fromDate, toDate)) {
    out.push({ date, gpsKm: await fetchDayMileage(session, date) });
    await sleep(400);
  }
  return out;
}

/** Inclusive list of yyyy-mm-dd between two dates. */
export function eachDate(fromDate, toDate) {
  const dates = [];
  const end = Date.parse(`${toDate}T00:00:00Z`);
  for (let t = Date.parse(`${fromDate}T00:00:00Z`); t <= end; t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** Today in Asia/Colombo, as yyyy-mm-dd. */
export function todayInColombo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `n` days before today, as yyyy-mm-dd. */
export function daysAgoInColombo(n) {
  const t = Date.parse(`${todayInColombo()}T00:00:00Z`) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
