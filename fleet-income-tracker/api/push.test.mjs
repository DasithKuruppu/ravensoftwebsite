import { describe, it, expect } from 'vitest';
import { buildPush } from './handler.mjs';
import { DEFAULT_SETTINGS } from '../shared/commission.mjs';

/**
 * A tier is reached when the money is earned, not when a forecast says it will
 * be. The card once announced "top tier reached" on a month sitting at 51,239
 * against a 116,129 threshold, because both the tier test and the marginal rate
 * were read off the projection.
 */
const settings = { ...DEFAULT_SETTINGS, base: 50000, bandStart: 240000, bandEnd: 300000, bandRate: 0.3, topRate: 0.5 };

const push = (revenue, projectedRevenue, over = {}) =>
  buildPush({
    settings,
    factor: 1,
    revenue,
    trips: 100,
    projectedRevenue,
    dailyAverage: revenue / 10,
    elapsedDays: 10,
    operatingTotal: 30,
    remainingWorkDays: 20,
    projectedPay: 50000,
    ...over,
  });

describe('buildPush — reached vs on track', () => {
  it('does not claim the top tier on a projection alone', () => {
    const p = push(51239, 350000);
    expect(p.reached).toBe(false);
    expect(p.onTrack).toBe(true);
    expect(p.target).toBe(300000);
  });

  it('claims the top tier only once the revenue is actually earned', () => {
    const p = push(310000, 400000);
    expect(p.reached).toBe(true);
    expect(p.onTrack).toBe(false);
  });

  it('reports the marginal rate on revenue banked, not revenue forecast', () => {
    // Heading for the top tier, but below the band today: the next rupee
    // earned right now genuinely adds nothing to his pay.
    expect(push(51239, 350000).marginalNow).toBe(0);
    expect(push(250000, 350000).marginalNow).toBe(0.3);
    expect(push(310000, 400000).marginalNow).toBe(0.5);
  });

  it('keeps a real amount left to earn while on track', () => {
    const p = push(51239, 350000);
    // `gap` is measured against the projection and is zero when on track;
    // `remainingToTarget` is what still has to be earned.
    expect(p.gap).toBe(0);
    expect(p.remainingToTarget).toBe(248761);
  });

  it('still reports a shortfall when the pace falls short', () => {
    const p = push(51239, 200000);
    expect(p.onTrack).toBe(false);
    expect(p.tier).toBe('band');
    expect(p.target).toBe(240000);
  });
});
