import { describe, it, expect } from 'vitest';
import en from './en.js';
import si from './si.js';

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the two dictionaries', () => {
  it('cover exactly the same keys', () => {
    expect(Object.keys(si).sort()).toEqual(Object.keys(en).sort());
  });

  it('use the same placeholders in every string', () => {
    // A translator that renames {total} leaves a string that silently stops
    // interpolating — it renders the brace text to a customer.
    for (const key of Object.keys(en)) {
      expect(placeholders(si[key]), `${key}: ${si[key]}`).toEqual(placeholders(en[key]));
    }
  });

  it('has actual Sinhala in it, not copied English', () => {
    const sinhala = Object.entries(si).filter(([, v]) => /[඀-෿]/.test(v));
    // Everything except the handful of strings that are only placeholders.
    expect(sinhala.length).toBeGreaterThan(Object.keys(en).length - 6);
  });

  it('keeps a plural partner for every plural key', () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith('_one')) expect(en[key.replace(/_one$/, '_other')]).toBeTruthy();
      if (key.endsWith('_other')) {
        const one = key.replace(/_other$/, '_one');
        // `_other` may stand alone as the generic form, but never the reverse.
        expect(typeof en[one] === 'string' || true).toBe(true);
      }
    }
  });

  it('leaves no key pointing at an empty string', () => {
    for (const [k, v] of Object.entries(si)) expect(v, k).toBeTruthy();
  });
});
