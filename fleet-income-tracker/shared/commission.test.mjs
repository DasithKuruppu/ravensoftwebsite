import { describe, it, expect } from 'vitest';
import {
  calculatePay,
  ownerShare,
  projectRevenue,
  prorate,
  monthFactor,
  operatingDays,
  round2,
  DEFAULT_SETTINGS,
} from './commission.mjs';

const S = DEFAULT_SETTINGS;

describe('calculatePay', () => {
  it('matches the reference figure at R = 406,789.20', () => {
    const { total, tiers } = calculatePay(406789.2, S);
    expect(total).toBe(121394.6);
    expect(tiers.map((t) => t.amount)).toEqual([50000, 18000, 53394.6]);
  });

  it('pays base only below the band', () => {
    expect(calculatePay(0, S).total).toBe(50000);
    expect(calculatePay(120000, S).total).toBe(50000);
    expect(calculatePay(239999.99, S).total).toBe(50000);
  });

  it('prorates inside the band', () => {
    // 30% of (270,000 - 240,000) = 9,000
    expect(calculatePay(270000, S).total).toBe(59000);
    expect(calculatePay(250000, S).total).toBe(53000);
  });

  it('handles the band boundaries exactly', () => {
    expect(calculatePay(240000, S).total).toBe(50000); // band contributes nothing yet
    expect(calculatePay(300000, S).total).toBe(68000); // full band, no top tier
  });

  it('adds the top rate above the band end', () => {
    expect(calculatePay(400000, S).total).toBe(118000); // 50k + 18k + 50% of 100k
  });

  it('reads every parameter from settings rather than hardcoding', () => {
    const custom = {
      base: 60000,
      bandStart: 200000,
      bandEnd: 250000,
      bandRate: 0.25,
      topRate: 0.4,
    };
    // 60,000 + 25% of 50,000 + 40% of 50,000 = 60,000 + 12,500 + 20,000
    expect(calculatePay(300000, custom).total).toBe(92500);
  });

  it('treats missing or negative revenue as zero', () => {
    expect(calculatePay(undefined, S).total).toBe(50000);
    expect(calculatePay(-5000, S).total).toBe(50000);
  });
});

describe('ownerShare', () => {
  it('is revenue minus driver pay', () => {
    expect(ownerShare(406789.2, S)).toBe(285394.6);
  });

  it('goes negative when revenue does not cover the base', () => {
    expect(ownerShare(10000, S)).toBe(-40000);
  });
});

describe('projectRevenue', () => {
  it('extrapolates month-to-date over the full month', () => {
    expect(projectRevenue(100000, 10, 30)).toBe(300000);
  });

  it('returns zero before any day has elapsed', () => {
    expect(projectRevenue(0, 0, 31)).toBe(0);
  });
});

describe('partial months', () => {
  const START = '2026-07-20'; // driver started mid-July

  it('leaves the reference figure untouched for a full month', () => {
    expect(calculatePay(406789.2, S, 1).total).toBe(121394.6);
  });

  it('scales base and both band edges, but not the percentages', () => {
    const factor = monthFactor('2026-07', START, 31); // 12 of 31 days
    const p = prorate(S, factor);
    expect(p.base).toBe(19354.84);
    expect(p.bandStart).toBe(92903.23);
    expect(p.bandEnd).toBe(116129.03);
    expect(p.bandRate).toBe(0.3); // rates never prorate
    expect(p.topRate).toBe(0.5);
  });

  it('runs the plan at full value from the next month onwards', () => {
    for (const month of ['2026-08', '2026-09', '2027-01']) {
      expect(monthFactor(month, START, 31)).toBe(1);
      expect(calculatePay(406789.2, S, monthFactor(month, START, 31)).total).toBe(121394.6);
    }
  });

  it('lets a partial month reach the upper tiers on a full-month run rate', () => {
    const factor = monthFactor('2026-07', START, 31);
    // 406,789.20 x 12/31 is the same daily rate as the reference month...
    const proRataRevenue = round2(406789.2 * factor);
    // ...so pay comes out at the same fraction of the reference figure.
    expect(calculatePay(proRataRevenue, S, factor).total).toBe(round2(121394.6 * factor));
  });

  it('counts operating days from the start date, not the 1st', () => {
    expect(operatingDays('2026-07', START, 31, '2026-07-25')).toEqual({ elapsed: 6, total: 12 });
    // a later month is unaffected
    expect(operatingDays('2026-08', START, 31, '2026-08-10')).toEqual({ elapsed: 10, total: 31 });
  });

  it('treats a month before the driver started as having no operating days', () => {
    expect(monthFactor('2026-06', START, 30)).toBe(0);
    expect(operatingDays('2026-06', START, 30, '2026-07-25')).toEqual({ elapsed: 0, total: 0 });
  });

  it('is a no-op when no start date is set', () => {
    expect(monthFactor('2026-07', null, 31)).toBe(1);
    expect(operatingDays('2026-07', null, 31, '2026-07-25')).toEqual({ elapsed: 25, total: 31 });
  });
});
