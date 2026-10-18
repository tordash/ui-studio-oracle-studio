import { describe, it, expect } from 'bun:test';
import { fitSphereDistance, frameBounds, frameDistance, minHalfFov } from '../frame';

const FOV = 50;

/** Project a world point for a camera on +z at `dist`, looking at the origin (three's perspective). */
function ndc(p: [number, number, number], dist: number, aspect: number): [number, number] {
  const t = Math.tan((FOV * Math.PI) / 360);
  const depth = dist - p[2];
  return [p[0] / depth / (t * aspect), p[1] / depth / t];
}

/** Points on a sphere of radius r: the 6 axis extremes + 8 diagonals. */
function spherePoints(r: number): [number, number, number][] {
  const out: [number, number, number][] = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
  const s = r / Math.sqrt(3);
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push([a * s, b * s, c * s]);
  return out;
}

describe('minHalfFov', () => {
  it('is the vertical half-FOV on landscape and the narrower horizontal one on portrait', () => {
    const v = (FOV * Math.PI) / 360;
    expect(minHalfFov(FOV, 16 / 9)).toBeCloseTo(v, 9);
    expect(minHalfFov(FOV, 1)).toBeCloseTo(v, 9);
    const portrait = minHalfFov(FOV, 390 / 780);
    expect(portrait).toBeLessThan(v);
    expect(portrait).toBeCloseTo(Math.atan(Math.tan(v) * 0.5), 9);
  });
});

describe('fitSphereDistance', () => {
  for (const [name, aspect] of [['portrait 390×780', 390 / 780], ['landscape 1280×712', 1280 / 712], ['square', 1]] as const) {
    it(`keeps every point of the sphere inside NDC ±1 on both axes (${name})`, () => {
      const r = 5;
      const d = fitSphereDistance(r, FOV, aspect, 1);
      for (const p of spherePoints(r)) {
        const [x, y] = ndc(p, d, aspect);
        expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  }

  it('backs off further on portrait than on landscape for the same matches', () => {
    const portrait = fitSphereDistance(5, FOV, 390 / 780);
    const landscape = fitSphereDistance(5, FOV, 1280 / 712);
    expect(portrait).toBeGreaterThan(landscape * 1.6);
  });

  it('the old aspect^0.6 heuristic under-fits portrait (regression guard)', () => {
    const aspect = 390 / 780, r = 5;
    const old = (r * 1.25) / Math.tan((FOV * Math.PI) / 360) / Math.min(1, aspect) ** 0.6;
    const [x] = ndc([r, 0, 0], old, aspect);
    expect(Math.abs(x)).toBeGreaterThan(1); // matches at the sides fell off-screen
    const [x2] = ndc([r, 0, 0], fitSphereDistance(r, FOV, aspect), aspect);
    expect(Math.abs(x2)).toBeLessThan(1);
  });
});

describe('frameBounds', () => {
  it('returns centroid and a percentile radius that ignores far outliers', () => {
    // 19 stars in a tight ring of radius 1 around (5,0,0) + one far outlier
    const pos: number[] = [];
    for (let i = 0; i < 19; i++) {
      const a = (i / 19) * Math.PI * 2;
      pos.push(5 + Math.cos(a), Math.sin(a), 0);
    }
    pos.push(5, 0, 40);
    const b = frameBounds(new Float32Array(pos), Array.from({ length: 20 }, (_, i) => i))!;
    expect(b.count).toBe(20);
    expect(b.cx).toBeCloseTo(5, 3);
    expect(b.cz).toBeCloseTo(2, 3);
    expect(b.radius).toBeLessThan(3); // p85, not the 38-unit outlier
    const max = frameBounds(new Float32Array(pos), Array.from({ length: 20 }, (_, i) => i), 1)!;
    expect(max.radius).toBeGreaterThan(30);
  });

  it('skips out-of-range indices and returns null for no stars', () => {
    const pos = new Float32Array([1, 2, 3]);
    expect(frameBounds(pos, [])).toBeNull();
    expect(frameBounds(pos, [5, -1])).toBeNull();
    const one = frameBounds(pos, [0, 9])!;
    expect([one.cx, one.cy, one.cz, one.radius, one.count]).toEqual([1, 2, 3, 0, 1]);
  });
});

describe('frameDistance', () => {
  it('clamps between a minimum (single star) and the home distance', () => {
    expect(frameDistance({ radius: 0 }, FOV, 0.5, { minDist: 4, maxDist: 37 })).toBe(4);
    expect(frameDistance({ radius: 100 }, FOV, 0.5, { minDist: 4, maxDist: 37 })).toBe(37);
    const mid = frameDistance({ radius: 3 }, FOV, 1.6, { minDist: 4, maxDist: 37 });
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(37);
  });
});
