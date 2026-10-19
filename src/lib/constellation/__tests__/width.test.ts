import { describe, it, expect } from 'bun:test';
import { edgeWidthPx, EDGE_WIDTH_MIN, EDGE_WIDTH_MAX } from '../width';

describe('edgeWidthPx', () => {
  it('follows clamp(1 + 2.4·log2(1+n), 1, 10)', () => {
    for (const n of [1, 2, 3, 5, 9]) expect(edgeWidthPx(n)).toBeCloseTo(1 + 2.4 * Math.log2(1 + n), 10);
  });

  it('clamps at 1 and 10', () => {
    expect(EDGE_WIDTH_MIN).toBe(1);
    expect(EDGE_WIDTH_MAX).toBe(10);
    expect(edgeWidthPx(0)).toBe(1);
    expect(edgeWidthPx(-3)).toBe(1);
    expect(edgeWidthPx(37)).toBe(10);
    expect(edgeWidthPx(1e6)).toBe(10);
    expect(edgeWidthPx(Number.NaN)).toBe(1);
  });

  it('is monotonic non-decreasing', () => {
    let prev = 0;
    for (let n = 0; n <= 200; n++) {
      const w = edgeWidthPx(n);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });
});
