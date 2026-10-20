import { describe, it, expect } from 'bun:test';
import { pickCore, pickArc, pointSegDist, projectedRadius, CORE_MIN_PX, ARC_PICK_PX } from '../pick';
import { buildIntraSegments, buildIntraPulses, VECTOR_DOTS } from '../arcs';
import { encodeForWorker } from '../encode';
import { intraEdges, neighboursOf } from '../intra';
import { BUDGETS } from '../budget';
import { synthDocs } from './fixtures/synth';
import { TIME_PERIOD } from '../motes';

describe('pickCore', () => {
  const xs = [100, 300, 310, NaN], ys = [100, 300, 305, 0], depth = [0.5, 0.4, 0.6, 0], rpx = [5, 120, 18, 50];
  it('hits inside the projected disc, never below the 22 px minimum', () => {
    expect(CORE_MIN_PX).toBe(22);
    expect(pickCore(xs, ys, depth, rpx, 118, 100)).toBe(0);   // 18 px from a 5 px cluster → still hit (22 px min)
    expect(pickCore(xs, ys, depth, rpx, 130, 100)).toBe(-1);
    expect(pickCore(xs, ys, depth, rpx, 0, 0)).toBe(-1);       // NaN projection skipped
  });
  it('a small cluster on top of a big one stays tappable at its centre', () => {
    expect(pickCore(xs, ys, depth, rpx, 310, 305)).toBe(2);
    expect(pickCore(xs, ys, depth, rpx, 250, 250)).toBe(1);
  });
  it('respects include', () => {
    expect(pickCore(xs, ys, depth, rpx, 310, 305, 22, c => c !== 2)).toBe(1);
  });
  it('projectedRadius', () => {
    expect(projectedRadius(2, 10, 500)).toBe(100);
  });
});

describe('pickArc', () => {
  const poly = (pts: number[][]) => ({ xs: Float32Array.from(pts.map(p => p[0])), ys: Float32Array.from(pts.map(p => p[1])) });
  const polys = [poly([[0, 0], [100, 0], [200, 0]]), poly([[0, 30], [200, 30]]), poly([[NaN, NaN], [50, 100]])];
  it('nearest arc within 16 px', () => {
    expect(ARC_PICK_PX).toBe(16);
    expect(pickArc(polys, 50, 10)).toBe(0);
    expect(pickArc(polys, 50, 20)).toBe(1);
    expect(pickArc(polys, 50, 60)).toBe(-1);
    expect(pickArc(polys, 50, 100)).toBe(-1); // segment with a NaN end is skipped
  });
  it('point–segment distance clamps to the ends', () => {
    expect(pointSegDist(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(pointSegDist(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(pointSegDist(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('buildIntraSegments', () => {
  const t = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i}`);
  const docs = synthDocs([{ project: 'github.com/tordash/big', size: 600, theme: [...t('a', 30), ...t('b', 80)] }], { seed: 9, perFile: [3, 9] });
  const e = encodeForWorker(docs);
  const r = intraEdges(e, 0);

  it('strongest K = 2 per file, de-duplicated, strongest first', () => {
    const s = buildIntraSegments(r, { cap: 1e9 });
    const keys = new Set<string>();
    for (let q = 0; q < s.count; q++) {
      const k = `${s.i[q]}:${s.j[q]}`;
      expect(keys.has(k)).toBe(false);
      keys.add(k);
      expect(s.i[q]).toBeLessThan(s.j[q]);
      if (q) expect(s.s[q - 1]).toBeGreaterThanOrEqual(s.s[q]);
      expect(s.dots[q]).toBe(0);
    }
    // every file's top-2 is present
    for (const f of r.members) for (const x of neighboursOf(r, f).slice(0, 2)) {
      expect(keys.has(`${Math.min(f, x.file)}:${Math.max(f, x.file)}`)).toBe(true);
    }
  });

  it('tier caps keep the strongest (≤ 4k / 1.5k / 800)', () => {
    const all = buildIntraSegments(r, { cap: 1e9 });
    for (const tier of ['high', 'mid', 'low'] as const) {
      const cap = Math.min(BUDGETS[tier].intraSegments, Math.floor(all.count / 2));
      const s = buildIntraSegments(r, { cap });
      expect(s.count).toBe(cap);
      expect([...s.s]).toEqual([...all.s.subarray(0, cap)]);
    }
    expect(BUDGETS.high.intraSegments).toBe(4000);
    expect(BUDGETS.mid.intraSegments).toBe(1500);
    expect(BUDGETS.low.intraSegments).toBe(800);
  });

  it('an armed star reveals ALL its links (flagged) plus dotted vector neighbours', () => {
    const f = r.members[5];
    const own = neighboursOf(r, f);
    expect(own.length).toBeGreaterThan(2);
    const outsider = r.members.find(g => g !== f && !own.some(x => x.file === g))!;
    const s = buildIntraSegments(r, { cap: 10, focusStar: f, vector: [own[0].file, outsider, f] });
    const focus = new Set<string>();
    for (let q = 0; q < s.count; q++) if (s.focus[q]) focus.add(`${s.i[q]}:${s.j[q]}`);
    for (const x of own) expect(focus.has(`${Math.min(f, x.file)}:${Math.max(f, x.file)}`)).toBe(true);
    const vq = [...Array(s.count).keys()].find(q => s.dots[q] > 0)!;
    expect(s.dots[vq]).toBe(VECTOR_DOTS);
    expect([s.i[vq], s.j[vq]].sort((a, b) => a - b)).toEqual([f, outsider].sort((a, b) => a - b));
    expect([...s.dots].filter(d => d > 0).length).toBe(1); // concept link wins; self ignored
  });

  it('intra pulses ride the strongest concept links, within the cap, quantised', () => {
    const s = buildIntraSegments(r, { cap: 500 });
    const p = buildIntraPulses(s, BUDGETS.mid.intraPulses);
    expect(p.count).toBe(150);
    expect([...p.i.subarray(0, 5)]).toEqual([...s.i.subarray(0, 5)]);
    for (let k = 0; k < p.count; k++) {
      const cyc = p.speed[k] * TIME_PERIOD;
      expect(Math.abs(cyc - Math.round(cyc))).toBeLessThan(1e-2);
      expect(p.offset[k]).toBeGreaterThanOrEqual(0);
      expect(p.offset[k]).toBeLessThan(1);
    }
  });
});
