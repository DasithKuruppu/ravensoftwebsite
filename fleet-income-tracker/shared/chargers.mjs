/**
 * CCS2 charging stations — seed list.
 *
 * This is only the STARTING list. The working list lives in DynamoDB and is
 * editable from Settings, so stations can be added, corrected or removed
 * without a redeploy. This file is what a fresh install starts with, and what
 * "Reset to defaults" restores.
 *
 * Two SEPARATE kinds of uncertainty, never conflated:
 *
 *   ccs2:     'confirmed' — the operator or a charger database states CCS2 here
 *             'unknown'   — something is charging here, but nobody has confirmed
 *                           a CCS2 DC gun. Do not drive to one of these on the
 *                           assumption it will fit.
 *
 *   position: 'exact'  — the pin is the actual site
 *             'approx' — the pin is the town/branch locality and can be ~1 km
 *                        out. Fine for ranking, not for steering by.
 *
 * Most OpenStreetMap entries only carry `amenity=charging_station` with no
 * socket tags at all, which says nothing about CCS2 — those are 'unknown', and
 * the UI labels them so rather than quietly implying they will work.
 *
 * Tariffs are LKR/kWh and move around — PUCSL reset the EV charging station
 * category on 2026-04-01. Rates here were checked 2026-07-25; the app shows
 * them as guidance, not gospel. Sri Lanka time-of-use bands:
 *   day 05:30–18:30 · peak 18:30–22:30 · off-peak 22:30–05:30
 *
 * The cheapest charge is almost always at home overnight on a D-TOU meter
 * (~LKR 18/kWh off-peak) — roughly a third of the cheapest public DC rate.
 * Public DC is for topping up mid-shift, ideally after 22:30.
 */

/** Time-of-use bands, shared by every operator that prices this way. */
export const TOU_BANDS = {
  day: { label: 'Day', from: '05:30', to: '18:30' },
  peak: { label: 'Peak', from: '18:30', to: '22:30' },
  offPeak: { label: 'Off-peak', from: '22:30', to: '05:30' },
};

/** Home charging reference, for comparison against any public rate. */
export const HOME_TOU = { day: 36, peak: 58, offPeak: 18, note: 'CEB D-TOU domestic, needs a TOU meter (LKR 2,000/month standing charge)' };

export const DEFAULT_CHARGERS = [
  /* ── CCS2 confirmed by the operator, position exact ── */
  {
    id: 'leco-nugegoda', name: 'LECO Nugegoda', address: '61 Mirihana Rd, Nugegoda',
    lat: 6.87503, lng: 79.90077, network: 'LECO', app: 'LECO Charging App',
    connectors: ['CCS2', 'CHAdeMO'], hours: '24/7',
    tou: { day: 89.23, peak: 113.85, offPeak: 54.36 },
    ccs2: 'confirmed', position: 'exact', source: 'leco.lk',
  },
  {
    id: 'leco-kandana', name: 'LECO Kandana', address: '30 Circular Rd, Kandana',
    lat: 7.06195, lng: 79.89026, network: 'LECO', app: 'LECO Charging App',
    connectors: ['CCS2', 'CHAdeMO'], hours: '24/7',
    tou: { day: 89.23, peak: 113.85, offPeak: 54.36 },
    ccs2: 'confirmed', position: 'exact', source: 'leco.lk',
  },
  {
    id: 'leco-ambalangoda', name: 'LECO Ambalangoda', address: '48 Maha Ambalangoda Rd, Ambalangoda',
    lat: 6.23267, lng: 80.06219, network: 'LECO', app: 'LECO Charging App',
    connectors: ['CCS2', 'CHAdeMO'], hours: '24/7',
    tou: { day: 89.23, peak: 113.85, offPeak: 54.36 },
    ccs2: 'confirmed', position: 'exact', source: 'leco.lk',
  },
  {
    id: 'vedrive-one-galle-face', name: 'VEDRIVE · One Galle Face', address: 'One Galle Face Mall, Colombo 02',
    lat: 6.92763, lng: 79.84493, network: 'VEDRIVE', app: 'on-site payment',
    connectors: ['CCS2', 'CHAdeMO'], powerKw: 60, hours: 'Mall hours',
    ccs2: 'confirmed', position: 'exact', source: 'operator announcement',
  },
  {
    id: 'chargenet-koswatta', name: 'chargeNET · Koswatta', address: 'Koswatta, Battaramulla',
    lat: 6.90412, lng: 79.90042, network: 'chargeNET', app: 'chargeNET Plus',
    connectors: ['CCS2'], flatRate: 70,
    ccs2: 'confirmed', position: 'exact', source: 'PlugShare',
  },

  /* ── Keells / John Keells CG Auto network: CCS2 + CHAdeMO stated per site on
     their public locator (200+ stations). Positions matched to the Keells
     outlet in OpenStreetMap, so a branch with two nearby stores is 'approx'.
     Hours 07:00–19:00 unless noted — these are not 24/7. ── */
  {
    id: 'keells-darley-road', name: 'Keells · Darley Road', address: 'T.B. Jaya Mw, Colombo 10',
    lat: 6.92310, lng: 79.86430, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'approx', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-rajagiriya', name: 'Keells · Rajagiriya', address: 'Rajagiriya',
    lat: 6.90687, lng: 79.9023, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'exact', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-kohuwala', name: 'Keells · Kohuwala', address: 'Sunethradevi Rd, Kohuwala',
    lat: 6.86958, lng: 79.88074, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'exact', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-nugegoda', name: 'Keells · Nugegoda', address: 'Nawala Rd, Nugegoda',
    lat: 6.87139, lng: 79.88506, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'approx', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-maharagama', name: 'Keells · Maharagama', address: 'High Level Rd, Maharagama',
    lat: 6.84278, lng: 79.92085, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'exact', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-kottawa', name: 'Keells · Kottawa', address: 'Athurugiriya Rd, Kottawa',
    lat: 6.83663, lng: 79.96524, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'exact', source: 'johnkeellscgauto.com',
  },
  {
    id: 'keells-werahera', name: 'Keells · Werahera / Boralesgamuwa', address: 'Boralesgamuwa',
    lat: 6.83314, lng: 79.90729, network: 'Keells / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'exact', source: 'johnkeellscgauto.com',
  },
  {
    id: 'arpico-nawinna', name: 'Arpico Super Centre · Nawinna', address: 'High Level Rd, Nawinna',
    lat: 6.84860, lng: 79.91170, network: 'Arpico / JKCG', app: 'VOLT Charge',
    connectors: ['CCS2'], hours: '07:00–19:00',
    ccs2: 'confirmed', position: 'approx', source: 'johnkeellscgauto.com',
  },

  /* ── VOLT Charge (JAT Holdings) at Keells, ~20 sites Jaffna→Tangalle ── */
  {
    id: 'volt-keells-karapitiya', name: 'VOLT · Keells Karapitiya', address: 'Hirimbura Cross Rd, Galle',
    lat: 6.06388, lng: 80.22207, network: 'VOLT Charge', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], hours: '24/7', flatRate: 142,
    ccs2: 'confirmed', position: 'exact', source: 'PlugShare',
  },
  {
    id: 'volt-keells-matara', name: 'VOLT · Keells Matara', address: 'Welewatta, Matara',
    lat: 5.94779, lng: 80.53604, network: 'VOLT Charge', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], flatRate: 142,
    ccs2: 'confirmed', position: 'exact', source: 'PlugShare',
  },
  {
    id: 'volt-keells-miriswatta', name: 'VOLT · Keells Miriswatta', address: 'Gampaha',
    lat: 7.19742, lng: 79.935, network: 'VOLT Charge', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], flatRate: 142,
    ccs2: 'confirmed', position: 'approx', source: 'PlugShare',
  },
  {
    id: 'volt-keells-jaffna', name: 'VOLT · Keells Jaffna', address: 'Clock Tower Rd, Jaffna',
    lat: 9.66509, lng: 80.0093, network: 'VOLT Charge', app: 'VOLT Charge',
    connectors: ['CCS2', 'CHAdeMO'], flatRate: 142,
    ccs2: 'confirmed', position: 'approx', source: 'johnkeellscgauto.com',
  },

  /* ── Something charges here, but NOBODY has confirmed a CCS2 gun. These show
     a "CCS2 not confirmed" badge — do not drive to one assuming it will fit. ── */
  {
    id: 'chargenet-maradana', name: 'chargeNET · Maradana', address: 'Trace Lane, Maradana, Colombo 10',
    lat: 6.93009, lng: 79.86067, network: 'chargeNET', app: 'chargeNET Plus',
    connectors: null, flatRate: 70,
    ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
  {
    id: 'electro-borella', name: 'Electro Automotives · Borella', address: 'Kotta Rd, Borella',
    lat: 6.91406, lng: 79.87985, network: 'Electro Automotives',
    connectors: null, ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
  {
    id: 'sparkev-dehiwala', name: 'Spark EV · Dehiwala', address: 'Dhammalankara Mw, Dehiwala',
    lat: 6.85029, lng: 79.86877, network: 'Spark EV',
    connectors: null, ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
  {
    id: 'fast-battaramulla', name: 'Fast Charging · Battaramulla', address: 'Udumulla Rd, Battaramulla',
    lat: 6.90677, lng: 79.92218, network: 'Independent',
    connectors: null, ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
  {
    id: 'laugfs-colombo', name: 'Laugfs EV · Colombo', address: 'Colombo',
    lat: 6.8856, lng: 79.86587, network: 'Laugfs',
    connectors: null, ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
  {
    id: 'fast-kottawa-hl', name: 'Fast Charging · Kottawa (High Level Rd)', address: 'High Level Rd, Kottawa',
    lat: 6.8387, lng: 79.97886, network: 'Independent',
    connectors: null, ccs2: 'unknown', position: 'exact', source: 'OpenStreetMap',
  },
];

/**
 * Great-circle distance in km. Straight-line, not driving distance — good
 * enough for ranking what is nearby, and it never over-promises.
 */
export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 100) / 100;
}

/** The `limit` closest stations to a point, nearest first. */
export function nearest(chargers, lat, lng, limit = 3) {
  return chargers
    .map((c) => ({ ...c, distanceKm: distanceKm(lat, lng, c.lat, c.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, limit));
}

/** Which time-of-use band a given Colombo time falls in. */
export function bandAt(date = new Date()) {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const mins = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const at = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  if (mins >= at('05:30') && mins < at('18:30')) return 'day';
  if (mins >= at('18:30') && mins < at('22:30')) return 'peak';
  return 'offPeak';
}

/** What this station charges right now, or null if the rate is unknown. */
export function rateNow(charger, date = new Date()) {
  if (typeof charger.flatRate === 'number') return charger.flatRate;
  if (charger.tou) return charger.tou[bandAt(date)] ?? null;
  return null;
}
