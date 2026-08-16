/**
 * Checks the Sinhala by translating it back.
 *
 *   node scripts/review-si.mjs            # report every suspect string
 *   node scripts/review-si.mjs --all      # print all pairs, not just suspects
 *
 * Machine translation fails silently: `nav.book` came back as පොත, which is a
 * book you read, and nothing about the file looked wrong. Reading the Sinhala
 * needs Sinhala. Translating it *back* to English needs only a comparison, and
 * catches exactly this class of error — a round trip through "Book" → පොත →
 * "book" looks fine, but "Book" → පොත → "book" against an original of "Book"
 * (a verb, in a navigation bar) is the sort of thing a human then spots.
 *
 * Similarity is deliberately crude. The point is not to score a translation but
 * to sort 186 strings so a person reads the twenty that need reading.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALL = process.argv.includes('--all');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function toEnglish(sinhala) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=si&tl=en&dt=t&q=' +
    encodeURIComponent(sinhala);
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const body = await res.json();
  return (body?.[0] || []).map((c) => c[0]).join('');
}

/** Bag-of-words overlap, ignoring case, punctuation and placeholders. */
function similarity(a, b) {
  const words = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/\{\w+\}/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = words(a);
  const B = words(b);
  if (A.size === 0) return 1;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit += 1;
  return hit / A.size;
}

async function main() {
  const en = (await import(path.join(HERE, '../src/i18n/en.js'))).default;
  const si = (await import(path.join(HERE, '../src/i18n/si.js'))).default;

  const rows = [];
  const keys = Object.keys(en);
  for (const [i, key] of keys.entries()) {
    try {
      const back = await toEnglish(si[key]);
      rows.push({ key, en: en[key], si: si[key], back, score: similarity(en[key], back) });
    } catch (err) {
      rows.push({ key, en: en[key], si: si[key], back: `(failed: ${err.message})`, score: 0 });
    }
    if ((i + 1) % 25 === 0) console.error(`  … ${i + 1}/${keys.length}`);
    await sleep(200);
  }

  rows.sort((a, b) => a.score - b.score);
  const suspect = ALL ? rows : rows.filter((r) => r.score < 0.6);

  console.log(`\n${suspect.length} of ${rows.length} strings came back meaning something else.\n`);
  for (const r of suspect) {
    console.log(`${r.key}   [${r.score.toFixed(2)}]`);
    console.log(`  meant : ${r.en}`);
    console.log(`  si    : ${r.si}`);
    console.log(`  back  : ${r.back}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
