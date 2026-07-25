import { describe, it, expect } from 'vitest';
import { dayStartEpochMs, eachDate } from './dagps-client.mjs';

describe('dayStartEpochMs', () => {
  it('converts a date to midnight Asia/Colombo in epoch ms', () => {
    // Verified against the portal: this is the exact stamp its own UI posts
    // when querying 2026-07-20.
    expect(dayStartEpochMs('2026-07-20')).toBe(1784485800000);
  });

  it('is UTC+5:30, i.e. 18:30 UTC the previous day', () => {
    expect(new Date(dayStartEpochMs('2026-07-20')).toISOString()).toBe('2026-07-19T18:30:00.000Z');
  });

  it('rejects an unparseable date', () => {
    expect(() => dayStartEpochMs('20-07-2026')).toThrow(/invalid date/);
  });
});

describe('eachDate', () => {
  it('is inclusive of both ends', () => {
    expect(eachDate('2026-07-01', '2026-07-04')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ]);
  });

  it('handles a single day', () => {
    expect(eachDate('2026-07-20', '2026-07-20')).toEqual(['2026-07-20']);
  });

  it('crosses a month boundary', () => {
    expect(eachDate('2026-07-30', '2026-08-02')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDate('2026-07-10', '2026-07-01')).toEqual([]);
  });
});
