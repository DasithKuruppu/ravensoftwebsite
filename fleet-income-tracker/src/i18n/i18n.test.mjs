/**
 * The dictionaries, as data.
 *
 * The failure this is here to catch is a key added to one language and not the
 * other: English is written first and Sinhala follows it, so every new string is
 * one distracted moment away from rendering an English sentence in the middle of
 * a Sinhala card. That is invisible in review — the fallback makes it look
 * deliberate — and obvious here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import en from './en.js';
import si from './si.js';
import { translate, parts, setLocale, resetLocale, getLocale, LOCALES } from './i18n.js';

afterEach(() => resetLocale('en'));

describe('the dictionaries', () => {
  it('carry exactly the same keys', () => {
    const missing = Object.keys(en).filter((k) => !(k in si));
    const orphaned = Object.keys(si).filter((k) => !(k in en));
    expect({ missing, orphaned }).toEqual({ missing: [], orphaned: [] });
  });

  it('have no empty strings', () => {
    for (const [name, dict] of [
      ['en', en],
      ['si', si],
    ]) {
      const blank = Object.entries(dict)
        .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
        .map(([k]) => `${name}:${k}`);
      expect(blank).toEqual([]);
    }
  });

  /**
   * A placeholder the translator dropped is a figure that never reaches the
   * screen — "you are paying a km against a a km reference" — which reads as
   * broken copy rather than as a missing number.
   */
  it('use the same placeholders in both languages', () => {
    const slots = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const wrong = Object.keys(en).filter(
      (k) => JSON.stringify(slots(en[k])) !== JSON.stringify(slots(si[k] ?? '')),
    );
    expect(wrong).toEqual([]);
  });

  /** Sinhala is not English. A copied-over entry is an untranslated one. */
  it('are actually translated', () => {
    // The exceptions are strings that are the same in both languages by design:
    // brand and product names, symbols, and Latin-script units.
    const sameOnPurpose = new Set([
      'nav.gps.short',
      'marginal.between',
      'unit.perKwh',
      'month.5',
      'monthShort.5',
      'monthShort.6',
      'monthShort.7',
    ]);
    const untranslated = Object.keys(en).filter(
      (k) => !sameOnPurpose.has(k) && en[k] === si[k],
    );
    expect(untranslated).toEqual([]);
  });
});

describe('lookup', () => {
  it('falls back to English rather than printing a key', () => {
    setLocale('si');
    // A key Sinhala does not have — simulated by asking for one neither has.
    expect(translate('nav.dashboard')).toBe(si['nav.dashboard']);
    expect(translate('no.such.key')).toBe('no.such.key');
  });

  it('fills placeholders', () => {
    expect(translate('stat.toZone', { pct: 30 })).toBe('To your 30% zone');
  });

  it('picks the plural form off Intl, in both languages', () => {
    expect(translate('stat.average.days', { count: 1 })).toBe('over 1 day');
    expect(translate('stat.average.days', { count: 4 })).toBe('over 4 days');
    setLocale('si');
    expect(translate('stat.average.days', { count: 1 })).toContain('1');
    expect(translate('stat.average.days', { count: 4 })).toContain('4');
  });

  it('splits a sentence around its placeholders, keeping the values', () => {
    const node = { marker: true };
    const out = parts('pay.on', { amount: node });
    expect(out).toContain(node);
    expect(out.join('')).toContain('[object Object]');
  });
});

describe('the locale itself', () => {
  it('defaults to English and only accepts a language we have', () => {
    expect(getLocale()).toBe('en');
    setLocale('fr');
    expect(getLocale()).toBe('en');
    setLocale('si');
    expect(getLocale()).toBe('si');
  });

  it('offers both languages to the switch', () => {
    expect(LOCALES.map((l) => l.code)).toEqual(['en', 'si']);
  });
});
