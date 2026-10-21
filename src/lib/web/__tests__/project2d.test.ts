import { describe, it, expect } from 'bun:test';
import { project2D, ctrl2D, quad2D, renderMode } from '../project2d';
import { ARC_BOW } from '../arcs';

describe('renderMode (the three branches)', () => {
  it('WebGL → 3d; lost / missing → 2d; no Canvas2D either → list', () => {
    expect(renderMode(true, false, true)).toBe('3d');
    expect(renderMode(true, true, true)).toBe('2d');
    expect(renderMode(false, false, true)).toBe('2d');
    expect(renderMode(false, false, false)).toBe('list');
    expect(renderMode(true, true, false)).toBe('list');
  });
});

describe('project2D', () => {
  const centres = [0, 0, 5, 10, 0, -3, 0, 10, 2];
  const radii = [1, 2, 1];
  it('fits every disc inside the canvas with padding, keeps aspect, flips y', () => {
    const p = project2D(centres, radii, 400, 300, 20);
    for (let c = 0; c < 3; c++) {
      expect(p.x[c] - radii[c] * p.scale).toBeGreaterThanOrEqual(20 - 1e-3);
      expect(p.x[c] + radii[c] * p.scale).toBeLessThanOrEqual(380 + 1e-3);
      expect(p.y[c] - radii[c] * p.scale).toBeGreaterThanOrEqual(20 - 1e-3);
      expect(p.y[c] + radii[c] * p.scale).toBeLessThanOrEqual(280 + 1e-3);
    }
    expect(p.y[2]).toBeLessThan(p.y[0]); // higher world y → higher on screen
    expect((p.x[1] - p.x[0]) / (p.y[0] - p.y[2])).toBeCloseTo(1, 5); // same scale on both axes
  });
  it('drops z (same x / y, different z → same point)', () => {
    const a = project2D([0, 0, 0, 5, 5, 0], [1, 1], 200, 200);
    const b = project2D([0, 0, 9, 5, 5, -9], [1, 1], 200, 200);
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
  });
  it('handles empty and single-cluster input', () => {
    expect(project2D([], [], 100, 100).x.length).toBe(0);
    const one = project2D([3, 3, 3], [2], 100, 100, 10);
    expect(one.x[0]).toBeCloseTo(50, 5);
    expect(one.y[0]).toBeCloseTo(50, 5);
  });
});

describe('2D arcs', () => {
  it('bow away from the centroid by ARC_BOW · length, curve passes the ends', () => {
    const [qx, qy] = ctrl2D(0, 0, 100, 0, 50, 50);
    expect(qx).toBeCloseTo(50, 9);
    expect(qy).toBeCloseTo(-ARC_BOW * 100, 9);
    expect(quad2D(0, 0, qx, qy, 100, 0, 0)).toEqual([0, 0]);
    expect(quad2D(0, 0, qx, qy, 100, 0, 1)).toEqual([100, 0]);
    const [dx, dy] = ctrl2D(0, 0, 10, 0, 5, 0); // midpoint on the centroid → perpendicular
    expect(Math.hypot(dx - 5, dy)).toBeCloseTo(ARC_BOW * 10, 9);
  });
});
