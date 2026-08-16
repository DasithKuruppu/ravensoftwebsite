/**
 * Translation, in about eighty lines and no dependency.
 *
 * The app has two languages and one of them is the source of truth, so what
 * i18next would buy us here is a bundle. What it has to do is small: look a key
 * up, put numbers into it, and pick between a singular and a plural — the last
 * of which `Intl.PluralRules` already knows how to do in both languages.
 *
 * The active locale is module state rather than a prop threaded through every
 * call. `money()` and `dayLabel()` are plain functions called from the middle of
 * JSX in thirty places, and the alternative is passing a locale into all of them
 * to serve an app that has exactly one active language at a time. The React side
 * (`I18nProvider`) subscribes to changes here so a switch still re-renders.
 *
 * A missing Sinhala key falls back to English rather than printing the key: a
 * screen with one English line on it is usable, and a screen with
 * `driver.hero.goal` on it is not.
 */
import en from './en.js';
import si from './si.js';

export const DICTS = { en, si };

/** What the language switch offers, in the order it offers them. */
export const LOCALES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'si', label: 'සිං', name: 'සිංහල' },
];

const STORAGE_KEY = 'fleet-booking:lang';
const DEFAULT = 'en';

let current = readStored();
const listeners = new Set();

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return DICTS[saved] ? saved : DEFAULT;
  } catch {
    // Private mode, or a test running in Node with no DOM.
    return DEFAULT;
  }
}

export function getLocale() {
  return current;
}

/**
 * Switch language. Writes through to storage and to `<html lang>` — the second
 * matters for Sinhala, where the browser picks a fallback font and breaks lines
 * on the strength of that attribute.
 */
export function setLocale(next) {
  if (!DICTS[next] || next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* nothing to do — the choice just will not survive a reload */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn(next);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: put the module back to a known locale between cases. */
export function resetLocale(to = DEFAULT) {
  current = DICTS[to] ? to : DEFAULT;
  for (const fn of listeners) fn(current);
}

const pluralRules = {};
function category(n, locale) {
  pluralRules[locale] ||= new Intl.PluralRules(locale === 'si' ? 'si-LK' : 'en-GB');
  return pluralRules[locale].select(n);
}

/**
 * Look up `key`, falling back through the plural form, the bare key, and
 * English, in that order.
 *
 * `{count}` triggers the plural lookup: `days_one` / `days_other`, keyed off
 * `Intl.PluralRules` rather than `n === 1`, because "one" is not the same set of
 * numbers in every language.
 */
export function lookup(key, vars, locale = current) {
  const dicts = locale === DEFAULT ? [DICTS[DEFAULT]] : [DICTS[locale], DICTS[DEFAULT]];
  const keys =
    vars && vars.count !== undefined && vars.count !== null
      ? [`${key}_${category(Number(vars.count), locale)}`, key]
      : [key];

  for (const dict of dicts) {
    for (const k of keys) {
      if (typeof dict[k] === 'string') return dict[k];
    }
  }
  return null;
}

/**
 * The string for `key`, with `{name}` placeholders filled in.
 *
 * An unknown key returns the key itself. That is deliberately ugly: it shows up
 * in the render test as an untranslated string rather than silently rendering
 * nothing, which is how a blank card ships.
 */
export function translate(key, vars, locale = current) {
  const template = lookup(key, vars, locale);
  if (template === null) return key;
  return fill(template, vars);
}

function fill(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    vars[name] === undefined || vars[name] === null ? whole : String(vars[name]),
  );
}

/**
 * The same lookup, split around its placeholders so a caller can drop React
 * nodes into the gaps.
 *
 * Sentences like "Past 116k — that is 3,742 a day — every rupee…" carry styled
 * spans on their figures. Returning one flat string would either lose the
 * styling or force the sentence to be assembled from fragments in JSX, which is
 * exactly the shape that cannot be reordered into another language's grammar.
 * Here the whole sentence stays one entry in the dictionary and the translator
 * can put `{rate}` wherever Sinhala wants it.
 *
 * Returns an array of strings and whatever the caller passed as values.
 */
export function parts(key, vars, locale = current) {
  const template = lookup(key, vars, locale);
  if (template === null) return [key];

  const out = [];
  let last = 0;
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push(template.slice(last, m.index));
    const value = vars?.[m[1]];
    out.push(value === undefined || value === null ? m[0] : value);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}
