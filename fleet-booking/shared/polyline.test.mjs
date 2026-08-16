import { describe, it, expect } from 'vitest';
import { decodePolyline, boundsOf } from './polyline.mjs';

describe('decodePolyline', () => {
  it('decodes the reference example from the format spec', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0][0]).toBeCloseTo(38.5, 5);
    expect(points[0][1]).toBeCloseTo(-120.2, 5);
    expect(points[2][0]).toBeCloseTo(43.252, 5);
    expect(points[2][1]).toBeCloseTo(-126.453, 5);
  });

  it('round-trips a real Sri Lankan route shape', () => {
    // Colombo → Kandy, encoded at precision 5.
    const points = decodePolyline('_o_i@_}_z^');
    expect(points).toHaveLength(1);
    expect(points[0][0]).toBeGreaterThan(5);
    expect(points[0][0]).toBeLessThan(11);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
    expect(() => decodePolyline('!!!!')).not.toThrow();
  });

  it('stops at a truncated value instead of inventing a point', () => {
    const full = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const cut = full.slice(0, full.length - 3);
    const points = decodePolyline(cut);
    expect(points.length).toBeLessThan(3);
    for (const [lat, lon] of points) {
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(lon)).toBe(true);
    }
  });
});

describe('boundsOf', () => {
  it('finds the corners containing every point', () => {
    expect(
      boundsOf([
        [6.9, 79.8],
        [7.3, 80.6],
        [6.8, 81.0],
      ]),
    ).toEqual([
      [6.8, 79.8],
      [7.3, 81.0],
    ]);
  });

  it('is null for nothing to bound', () => {
    expect(boundsOf([])).toBe(null);
    expect(boundsOf(null)).toBe(null);
  });

  it('ignores points that are not numbers', () => {
    expect(boundsOf([[6.9, 79.8], [NaN, 80], [7.1, 80.1]])).toEqual([
      [6.9, 79.8],
      [7.1, 80.1],
    ]);
  });
});
