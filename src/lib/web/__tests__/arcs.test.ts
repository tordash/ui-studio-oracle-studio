import { describe, it, expect } from 'bun:test';
import { ribbonStrip, buildArcs, buildPulses, arcCtrl, bezierPoint, arcPolyline, RIBBON_SEGMENTS, ARC_BOW } from '../arcs';
import { BUDGETS, pulsesPerEdge } from '../budget';
import { TIME_PERIOD } from '../motes';

const centres = [0, 0, 0, 10, 0, 0, 0, 10, 0, -10, 0, 0, 0, 0, 10];
const colours = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.53, 0.53, 0.53, 1, 1, 0];
const edges = [
  { a: 0, b: 1, w: 0.4 }, { a: 1, b: 2, w: 0.2 }, { a: 0, b: 3, w: 0.1 }, { a: 2, b: 4, w: 0.05 },
];
const centroid = [0, 2, 2];

describe('ribbonStrip', () => {
  it('24 segments → 50 vertices, 48 triangles; t runs 0 → 1, sides ±1', () => {
    const s = ribbonStrip();
    expect(RIBBON_SEGMENTS).toBe(24);
    expect(s.t.length).toBe(50);
    expect(s.index.length).toBe(24 * 6);
    expect(s.t[0]).toBe(0);
    expect(s.t[49]).toBe(1);
    expect(new Set(s.side)).toEqual(new Set([-1, 1]));
    expect(Math.max(...s.index)).toBe(49);
  });
});

describe('buildArcs', () => {
  const arcs = buildArcs(edges, centres, colours, 3, centroid);
  it('one instance per link, endpoints on cluster centres', () => {
    expect(arcs.count).toBe(4);
    expect([...arcs.p0.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...arcs.p2.subarray(0, 3)]).toEqual([10, 0, 0]);
    expect([...arcs.ends]).toEqual([0, 1, 1, 2, 0, 3, 2, 4]);
    expect(arcs.maxW).toBe(0.4);
  });
  it('control point = midpoint pushed away from the centroid by 0.25 · length', () => {
    const c = arcCtrl([0, 0, 0], [10, 0, 0], centroid);
    const mid = [5, 0, 0];
    expect(Math.hypot(c[0] - mid[0], c[1] - mid[1], c[2] - mid[2])).toBeCloseTo(ARC_BOW * 10, 6);
    const away = [mid[0] - centroid[0], mid[1] - centroid[1], mid[2] - centroid[2]];
    expect((c[0] - mid[0]) * away[0] + (c[1] - mid[1]) * away[1] + (c[2] - mid[2]) * away[2]).toBeGreaterThan(0);
    // degenerate: midpoint on the centroid still bows, perpendicular to the link
    const d = arcCtrl([-1, 0, 0], [1, 0, 0], [0, 0, 0]);
    expect(Math.hypot(...d)).toBeCloseTo(0.5, 6);
    expect(d[0]).toBeCloseTo(0, 6);
  });
  it('width 1–4 px and alpha by weight; Unsorted links dashed at half alpha', () => {
    expect(arcs.style[0]).toBeCloseTo(4, 6);         // strongest
    expect(arcs.style[1 * 4]).toBeCloseTo(1 + 3 * 0.5, 6);
    expect(arcs.style[2]).toBe(0);                   // solid
    const un = 2;                                    // 0 ↔ 3 (Unsorted)
    expect(arcs.style[un * 4 + 2]).toBeGreaterThanOrEqual(6);
    const solidAlphaAtW = (w: number) => 0.16 + 0.46 * (w / 0.4);
    expect(arcs.style[un * 4 + 1]).toBeCloseTo(solidAlphaAtW(0.1) * 0.5, 6);
    expect(arcs.style[3]).toBe(0);
    expect(arcs.style[7]).toBe(1);
  });
  it('polyline samples the same Bézier', () => {
    const poly = arcPolyline(arcs, 0);
    expect(poly.length).toBe((RIBBON_SEGMENTS + 1) * 3);
    const mid = bezierPoint(arcs.p0.subarray(0, 3), arcs.ctrl.subarray(0, 3), arcs.p2.subarray(0, 3), 0.5);
    expect(poly[12 * 3]).toBeCloseTo(mid[0], 5);
    expect([...poly.subarray(0, 3)]).toEqual([0, 0, 0]);
  });
});

describe('buildPulses', () => {
  const arcs = buildArcs(edges, centres, colours, 3, centroid);
  it('pulses per edge follow the tier rule', () => {
    for (const tier of ['high', 'mid', 'low'] as const) {
      const p = buildPulses(arcs, edges, tier, 1000);
      const per = new Map<number, number>();
      for (let q = 0; q < p.count; q++) per.set(p.pulse[q * 4 + 2], (per.get(p.pulse[q * 4 + 2]) ?? 0) + 1);
      edges.forEach((e, i) => expect(per.get(i)).toBe(pulsesPerEdge(tier, e.w / 0.4)));
    }
  });
  it('total within the cap, strongest links served first', () => {
    const p = buildPulses(arcs, edges, 'high', 5);
    expect(p.count).toBe(5);
    expect(p.pulse[2]).toBe(0);                       // first pulse rides the strongest edge
    const big = Array.from({ length: 400 }, (_, i) => ({ a: i % 5, b: (i + 1) % 5, w: 1 - i / 400 }));
    const ba = buildArcs(big, centres, colours, -1, centroid);
    expect(buildPulses(ba, big, 'high', BUDGETS.high.interPulses).count).toBeLessThanOrEqual(600);
    expect(buildPulses(ba, big, 'mid', BUDGETS.mid.interPulses).count).toBeLessThanOrEqual(250);
    expect(buildPulses(ba, big, 'low', BUDGETS.low.interPulses).count).toBeLessThanOrEqual(120);
  });
  it('speed 0.15–0.4 cycles/s, quantised to whole cycles per clock period; offsets in [0, 1)', () => {
    const p = buildPulses(arcs, edges, 'high', 1000);
    for (let q = 0; q < p.count; q++) {
      const sp = p.pulse[q * 4];
      expect(sp).toBeGreaterThanOrEqual(0.149);
      expect(sp).toBeLessThanOrEqual(0.401);
      const cyc = sp * TIME_PERIOD;
      expect(Math.abs(cyc - Math.round(cyc))).toBeLessThan(1e-3);
      expect(p.pulse[q * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(p.pulse[q * 4 + 1]).toBeLessThan(1);
    }
    // stronger links flow faster
    const s0 = p.pulse[0], sLast = p.pulse[(p.count - 1) * 4];
    expect(s0).toBeGreaterThan(sLast);
  });
});
