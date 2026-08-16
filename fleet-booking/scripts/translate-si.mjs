/**
 * One-time Sinhala translation of `src/i18n/en.js`, written to `src/i18n/si.js`.
 *
 *   node scripts/translate-si.mjs            # translate everything
 *   node scripts/translate-si.mjs --missing  # only keys si.js does not have
 *   node scripts/translate-si.mjs --dry      # show the report, write nothing
 *
 * Run once and commit the result. The site never calls a translation service at
 * runtime: a customer waiting on Google before the page can say "Book" is a
 * worse site, and a translation that changes under you is impossible to review.
 *
 * Three things make the output usable rather than merely present:
 *
 * 1. **Placeholders are protected.** `{total}` handed to a translator comes back
 *    as `{එකතුව}` or with the braces eaten, and the string silently stops
 *    interpolating. Each one is swapped for a numeric token first, which
 *    survives, and restored after.
 *
 * 2. **Known-literal phrasings are rewritten before translating.** "Day rate"
 *    comes back as දිවා අනුපාතය — "daytime ratio" — because the translator has
 *    no idea it is a price. Feeding it "price per day" instead produces Sinhala
 *    a customer actually uses. The English on screen is unchanged; only what the
 *    translator is shown is.
 *
 * 3. **Suspect output is flagged and retried.** Anything coming back with a
 *    known-bad token is translated again from the rephrased source, and if it
 *    still looks wrong it is reported for a human to read. Silence would be
 *    worse than a list.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EN = path.join(HERE, '../src/i18n/en.js');
const SI = path.join(HERE, '../src/i18n/si.js');

const argv = new Set(process.argv.slice(2));
const ONLY_MISSING = argv.has('--missing');
const DRY = argv.has('--dry');

/**
 * English the translator handles badly → English that means the same thing and
 * translates cleanly. Applied to the *source* only.
 */
const REPHRASE = [
  [/\bday rate\b/gi, 'price per day'],
  [/\bhire\b/gi, 'vehicle booking'],
  [/\bhires\b/gi, 'vehicle bookings'],
  [/\ballowance\b/gi, 'included distance'],
  [/\bovernight stay\b/gi, 'staying the night'],
  [/\bexpressway\b/gi, 'highway'],
  [/\bexpressways\b/gi, 'highways'],
  [/\bleg\b/gi, 'part of the journey'],
  [/\bquote\b/gi, 'price estimate'],
  [/\bquoted\b/gi, 'estimated price'],
  // "pick-up" is deliberately NOT rewritten. A rule turning it into "pickup
  // location" put a *place* on a field that asks for a date and time, and the
  // Sinhala was confidently wrong. Where a term is ambiguous in English, leave
  // it and correct the output by hand instead of guessing at translate time.
  [/\bself-drive\b/gi, 'driving it yourself'],
  [/\bboard\b/gi, 'meals'],
  [/\bfleet\b/gi, 'our vehicles'],
];

/**
 * Sinhala fragments that mean the translator took a term literally. Hitting one
 * triggers a retry and, if it survives that, a line in the report.
 */
const SUSPECT = [
  ['අනුපාත', 'rate → ratio'],
  ['කකුල', 'leg → body part'],
  ['උපුටා', 'quote → citation'],
  ['පුවරු', 'board → plank'],
  ['නාවික', 'fleet → naval'],
  ['කුලියට ගැනීම', 'hire → labour hire'],
];

/**
 * Keys a human has corrected. Never re-translated, even on a full run.
 *
 * Without this the next `node scripts/translate-si.mjs` would quietly undo every
 * review — and the damage would be invisible, because the file would still be
 * full of plausible Sinhala. Add a key here when you edit si.js by hand.
 */
const HAND_EDITED = new Set([
  // "Plan a route" — ගමන (the journey), not මාර්ගය (the road surface).
  'mode.route',
  // Field labels need nouns. The machine returned verb phrases: "starts from",
  // "goes to", "begins", which read as instructions rather than labels.
  'route.from',
  'route.to',
  'daily.starting',
  // "ending at" — ගමන අවසානය, the end of the journey, rather than the bare
  // verb අවසන් වේ ("it ends").
  'route.finishHeading',
  // Everything below was corrected after a back-translation review
  // (scripts/review-si.mjs) showed the machine had changed the meaning.
  'nav.book',
  'nav.signIn',
  'footer.where',
  'route.stop',
  'route.addStop',
  'trips.allowance',
  'error.couldNotPrice',
  'line.overnightStay.detail',
  'line.stops_one',
  'finish.request',
  'route.oneWayNote',
  'route.finishPlaceholder',
  'route.waiting',
  'daily.collect',
  'daily.intro',
  'trips.collectedHere',
  'trips.finishingHere',
  'routes.label.alternative',
  'trips.sentNote',
  'when.suggestion',
  'hosting.saves',
  'hosting.savingPartial',
  'hosting.savingAll',
  'rates.perKm',
  'rates.overtime',
  'rates.overnight',
  'rates.heading',
  'error.too_soon',
  'error.origin_required',
  'error.destination_required',
  'when.dayNote',
  'trips.estimatedDistance',
  'duration.2',
  'duration.3',
  'duration.4',
  'duration.14',
  'line.days_one',
  'line.days_other',
  'trips.hireLength',
  'mode.daily',
  'status.declined',
  'status.cancelled',
  'status.completed',
  'finish.signInToBook',
  'trips.signInPrompt',
  'finish.kept',
  'finish.sessionExpired',
  'nav.trips',
  'nav.trips.short',
  'trips.title',
  'trips.all',
  'trips.none',
  'trips.bookOne',
  'book.subtitle',
  'quote.stretched',
  'quote.nightsAway',
  'quote.nightsAway_other',
  'line.overnightStay_one',
  'line.overnightStay_other',
  'line.overtime_other',
  'line.stops_other',
  'trips.nightsAway',
  'rates.day',
  'daily.allowanceNote',
  'when.howLong',
  'footer.note',
  'mode.driverNote',
  'map.alt',
  'line.distance',
  'route.toPlaceholder',
  'route.finishPlaceholder',
  'route.stopPlaceholder',
  'when.pickup',
  'trips.pickupAt',
  'route.finishDefault',
  'book.subtitle',
  'mode.daily',
  'daily.collect',
  'daily.intro',
  'rates.heading',
  'rates.day',
  'rates.perKm',
  'rates.overtime',
  'rates.overnight',
  'rates.included',
  'routes.tollNote',
  'quote.measured',
  'route.heading',
  'route.from',
  'vehicle.baw-e7-pro',
  'vehicle.baw-e7-pro.note',
]);

/** Terms worth forcing, whatever the translator returns. */
const GLOSSARY = [
  [/රියදුරු රහිත/g, 'රියදුරු නොමැතිව'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(text) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=' +
    encodeURIComponent(text);
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const body = await res.json();
  return (body?.[0] || []).map((chunk) => chunk[0]).join('');
}

/** `{total}` → `__7__`, so the translator leaves it alone. */
function protect(text) {
  const names = [];
  const masked = text.replace(/\{(\w+)\}/g, (_, name) => {
    names.push(name);
    return ` __${names.length - 1}__ `;
  });
  return { masked, names };
}

function restore(text, names) {
  let out = text;
  names.forEach((name, i) => {
    // The translator sometimes moves the spaces around or drops one side of the
    // underscores, so the pattern is deliberately loose.
    const re = new RegExp(`_\\s*_?\\s*${i}\\s*_?\\s*_`, 'g');
    out = out.replace(re, `{${name}}`);
  });
  return out;
}

function rephrase(text) {
  return REPHRASE.reduce((acc, [from, to]) => acc.replace(from, to), text);
}

function applyGlossary(text) {
  return GLOSSARY.reduce((acc, [from, to]) => acc.replace(from, to), text);
}

function suspicion(si) {
  return SUSPECT.find(([fragment]) => si.includes(fragment));
}

async function translateOne(english) {
  // Mask first, rephrase second. The other order lets a rewrite rule reach
  // inside a placeholder — `{leg}` became `{part of the journey}` and then a
  // Sinhala phrase, and the string silently stopped interpolating.
  const { masked, names } = protect(english);
  const source = rephrase(masked);

  let si = restore(await translate(source), names);
  let flag = suspicion(si);
  let retried = false;

  if (flag) {
    // Try again from a plainer sentence: strip the punctuation the translator
    // sometimes anchors a wrong sense on, and translate the clause alone.
    retried = true;
    const plain = source.replace(/[—·…]/g, ',');
    const alt = restore(await translate(plain), names);
    if (!suspicion(alt)) {
      si = alt;
      flag = null;
    } else {
      si = alt;
    }
  }

  return { si: applyGlossary(si), flag, retried };
}

async function loadDict(file) {
  const mod = await import(`${file}?v=${Date.now()}`);
  return mod.default;
}

async function main() {
  const en = await loadDict(EN);
  let existing = {};
  try {
    existing = await loadDict(SI);
  } catch {
    /* first run */
  }

  const kept = Object.keys(en).filter((k) => HAND_EDITED.has(k) && existing[k]);
  const keys = Object.keys(en).filter(
    (k) => !(HAND_EDITED.has(k) && existing[k]) && (!ONLY_MISSING || !existing[k]),
  );
  if (kept.length) console.log(`Keeping ${kept.length} hand-edited: ${kept.join(', ')}\n`);
  console.log(`Translating ${keys.length} of ${Object.keys(en).length} keys…\n`);

  const out = { ...existing };
  const flagged = [];
  let done = 0;

  for (const key of keys) {
    const english = en[key];
    try {
      const { si, flag, retried } = await translateOne(english);
      out[key] = si;
      if (flag) flagged.push({ key, english, si, why: flag[1] });
      else if (retried) console.log(`  retried ok  ${key}`);
    } catch (err) {
      console.warn(`  FAILED      ${key}: ${err.message}`);
      out[key] = existing[key] || en[key];
    }
    done += 1;
    if (done % 20 === 0) console.log(`  … ${done}/${keys.length}`);
    // The endpoint is the one the web widget uses; keep the pace civil.
    await sleep(220);
  }

  console.log(`\nTranslated ${done}. Flagged ${flagged.length}.`);
  if (flagged.length) {
    console.log('\nRead these — the translator took a term literally:\n');
    for (const f of flagged) {
      console.log(`  ${f.key}  (${f.why})`);
      console.log(`    en: ${f.english}`);
      console.log(`    si: ${f.si}\n`);
    }
  }

  if (DRY) {
    console.log('--dry: nothing written.');
    return;
  }

  const body = Object.keys(en)
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k] ?? en[k])},`)
    .join('\n');

  await writeFile(
    SI,
    `/**
 * සිංහල — Sinhala.
 *
 * Generated once by scripts/translate-si.mjs and committed, then edited by hand
 * where the machine was too literal. Not regenerated on every build: this file
 * is reviewed prose now, and overwriting it would throw the review away.
 *
 * Register follows fleet-income-tracker's si.js — spoken, direct, the way a
 * Sri Lankan customer actually talks about hiring a car. Numbers, currency and
 * units stay in Latin script, which is how they are read on a phone here.
 *
 * To add keys later:  node scripts/translate-si.mjs --missing
 */
export default {
${body}
};
`,
    'utf8',
  );
  console.log(`\nWrote ${SI}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
