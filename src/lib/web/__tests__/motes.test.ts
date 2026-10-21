import { describe, it, expect } from 'bun:test';
import { xxhash, hashOnSphere, hashInSphere, fnv1a } from '../hash';
import { moteCounts, buildMotes, moteIndices, overviewDrawCount, drillDrawRange, moteLabel, REAL_COUNT_SHARE, quantizeRate, quantizeCycles, TIME_PERIOD } from '../motes';
import { BUDGETS, Governor, GOVERNOR_DEFAULTS, pulsesPerEdge, pulseSpeed, effectiveDpr } from '../budget';
import { classifyTier } from '../../three/gpu-tier';
import { hashTilt } from '../../planets/orbits';
import { SNAPSHOT_N_VECTORS, SNAPSHOT_TOTAL_FILES } from './fixtures/projects';

describe('hash (golden values from pages/Graph3D.tsx:31-62)', () => {
  it('xxhash', () => {
    const golden: [number, number, number][] = [
      [0, 0, 0.10177886812016368], [1, 2, 0.8182459454983473], [42, 7, 0.46011935407295823],
      [268435456, 3, 0.6818689736537635], [12345, 536870912, 0.1323300525546074], [7, 999999, 0.733617055695504],
    ];
    for (const [s, d, v] of golden) expect(xxhash(s, d)).toBe(v);
  });
  it('hashOnSphere / hashInSphere', () => {
    const on: [number, number, number, number, number][] = [
      [0, 0, 0.39151757839431217, 0.29119508741336, -0.8728799498640001],
      [1, 2, 0.10926092938276126, -0.23899318024973934, 0.9648545533418655],
      [42, 7, -0.2968847660063934, 0.07598977932784086, -0.9518849663436413],
    ];
    for (const [s, d, x, y, z] of on) expect(hashOnSphere(s, d)).toEqual([x, y, z]);
    const inside: [number, number, number, number, number][] = [
      [0, 0, 0.08214393577090916, 0.06109536806849748, -0.18313812327764561],
      [1, 2, 0.04867994062710617, -0.10648064125542929, 0.42987976247148457],
      [42, 7, -0.160150228075805, 0.04099159635062491, -0.5134806898733942],
    ];
    for (const [s, d, x, y, z] of inside) {
      const v = hashInSphere(s, d);
      expect(v[0]).toBeCloseTo(x, 15); expect(v[1]).toBeCloseTo(y, 15); expect(v[2]).toBeCloseTo(z, 15);
    }
  });
  it('fnv1a matches hashTilt’s mix', () => {
    expect(fnv1a('abc') / 0xffffffff * 0.3).toBeCloseTo(hashTilt('abc'), 12);
  });
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `learning_ψ/memory/${i}.md_0` }));

describe('moteCounts', () => {
  it('estimate sums exactly to n_vectors (77,970 over 13,089 → 12,525 × 6 + 564 × 5)', () => {
    const m = moteCounts(ids(SNAPSHOT_TOTAL_FILES), SNAPSHOT_N_VECTORS);
    expect(m.source).toBe('estimate');
    let sum = 0, six = 0, five = 0;
    for (const c of m.counts) { sum += c; if (c === 6) six++; else if (c === 5) five++; else throw new Error(`count ${c}`); }
    expect(sum).toBe(77970);
    expect(m.total).toBe(77970);
    expect([six, five]).toEqual([12525, 564]);
    expect(moteLabel(m)).toBe('≈6 per file · estimated from 77,970 indexed chunks · exact counts pending arra');
  });
  it('the +1 files are picked by id, not by input order', () => {
    const docs = ids(50);
    const a = moteCounts(docs, 120);
    const rev = docs.slice().reverse();
    const b = moteCounts(rev, 120);
    docs.forEach((d, i) => expect(b.counts[rev.indexOf(d)]).toBe(a.counts[i]));
  });
  it('real counts win at ≥ 95 % coverage and sum to Σ chunks', () => {
    expect(REAL_COUNT_SHARE).toBe(0.95);
    const docs = ids(100).map((d, i) => ({ ...d, chunks: (i % 7) + 1 }));
    const m = moteCounts(docs, 999);
    expect(m.source).toBe('real');
    expect(m.total).toBe(docs.reduce((s, d) => s + d.chunks, 0));
    expect(moteLabel(m)).toBe(`${m.total} chunks · exact counts`);
    const partial = docs.map((d, i) => (i < 4 ? { id: d.id } : d)); // 96 % carry a count
    const p = moteCounts(partial, 999);
    expect(p.source).toBe('real');
    expect(p.withReal).toBe(96);
    const few = docs.map((d, i) => (i < 6 ? { id: d.id } : d)); // 94 % → estimate
    expect(moteCounts(few, 300).source).toBe('estimate');
  });
  it('no counts and no total → none (never invented)', () => {
    const m = moteCounts(ids(10), undefined);
    expect(m.source).toBe('none');
    expect([...m.counts]).toEqual(new Array(10).fill(0));
  });
});

describe('buildMotes', () => {
  // 3 clusters, 30 stars
  const n = 30;
  const clusterOf = Array.from({ length: n }, (_, i) => i % 3);
  const centres = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const offsets = Array.from({ length: n * 3 }, (_, i) => (i % 5) * 0.1);
  const idsArr = Array.from({ length: n }, (_, i) => `doc-${i}`);
  const rank = Array.from({ length: n }, (_, i) => i);
  const counts = Array.from({ length: n }, (_, i) => (i % 4) + 3);
  const phases = Array.from({ length: n }, (_, i) => (i * 0.618) % 1);
  const radii = [1, 2, 3];
  const stars = { clusterOf, phases, radii, centres, offsets, ids: idsArr, createdAt: idsArr.map(() => null), rank };
  const m = buildMotes(counts, stars, 3, Date.UTC(2026, 9, 21));

  it('one mote per chunk, attributes sized per mote', () => {
    const total = counts.reduce((a, b) => a + b, 0);
    expect(m.count).toBe(total);
    expect(m.centre.length).toBe(total * 3);
    expect(m.offset.length).toBe(total * 3);
    expect(m.star.length).toBe(total * 4);
    expect(m.orbit.length).toBe(total * 4);
    const per = new Array(n).fill(0);
    for (const s of m.starOf) per[s]++;
    expect(per).toEqual(counts);
  });

  it('each mote carries its star’s centre/offset/phase/R; orbit radius 1.6–3.5; phase in [0, 1)', () => {
    for (let q = 0; q < m.count; q++) {
      const s = m.starOf[q], c = clusterOf[s];
      expect(m.star[q * 4 + 2]).toBe(c);
      expect(m.star[q * 4]).toBeCloseTo(phases[s], 6);
      expect(m.star[q * 4 + 1]).toBe(radii[c]);
      expect([...m.centre.subarray(q * 3, q * 3 + 3)]).toEqual(centres.slice(c * 3, c * 3 + 3));
      expect(m.offset[q * 3]).toBeCloseTo(offsets[s * 3], 6);
      expect(m.star[q * 4 + 3]).toBeGreaterThanOrEqual(1.6);
      expect(m.star[q * 4 + 3]).toBeLessThanOrEqual(3.5);
      expect(m.orbit[q * 4 + 2]).toBeGreaterThanOrEqual(0);
      expect(m.orbit[q * 4 + 2]).toBeLessThan(1);
      // angular speed is a whole number of turns per clock period (seamless wrap)
      const turns = (m.orbit[q * 4 + 3] * TIME_PERIOD) / (2 * Math.PI);
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-3);
      expect(turns).toBeGreaterThanOrEqual(1);
    }
  });

  it('cluster slices are contiguous and cover every mote', () => {
    let covered = 0;
    for (let c = 0; c < 3; c++) {
      const start = m.slices[c * 2], len = m.slices[c * 2 + 1];
      for (let q = start; q < start + len; q++) expect(m.star[q * 4 + 2]).toBe(c);
      covered += len;
    }
    expect(covered).toBe(m.count);
  });

  it('is deterministic (stable shuffle)', () => {
    const m2 = buildMotes(counts, stars, 3, Date.UTC(2026, 9, 21));
    expect([...m2.starOf]).toEqual([...m.starOf]);
    expect([...m2.overviewIndex]).toEqual([...m.overviewIndex]);
    expect([...m2.orbit]).toEqual([...m.orbit]);
  });

  it('overview index is a permutation; draw counts respect tier caps', () => {
    const idx = moteIndices(1000);
    expect([...idx].sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    expect(overviewDrawCount(77970, BUDGETS.high.motes)).toBe(77970);
    expect(overviewDrawCount(77970, BUDGETS.mid.motes)).toBe(24000);
    expect(overviewDrawCount(77970, BUDGETS.low.motes)).toBe(8000);
    expect(overviewDrawCount(77970, BUDGETS.mid.motes, 0.5)).toBe(12000);
    const r = drillDrawRange(m.slices, 1, 5);
    expect(r).toEqual({ start: m.slices[2], count: 5 });
  });

  it('newer files’ motes orbit faster (recency channel)', () => {
    const now = Date.UTC(2026, 9, 21);
    const one = { ...stars, clusterOf: [0], phases: [0], offsets: [0, 0, 0], ids: ['x'], rank: [0] };
    const fresh = buildMotes([4], { ...one, createdAt: [new Date(now - 86400000).toISOString()] }, 1, now);
    const old = buildMotes([4], { ...one, createdAt: ['2025-01-01T00:00:00Z'] }, 1, now);
    for (let q = 0; q < 4; q++) expect(fresh.orbit[q * 4 + 3] / old.orbit[q * 4 + 3]).toBeGreaterThan(2.5);
  });
});

describe('clock-wrap quantisation', () => {
  it('rates become whole turns / cycles per period', () => {
    expect(TIME_PERIOD).toBe(600);
    expect(quantizeRate(0.31) * 600 / (2 * Math.PI)).toBeCloseTo(30, 9);
    expect(quantizeRate(0)).toBeCloseTo((2 * Math.PI) / 600, 12);
    expect(quantizeCycles(0.15) * 600).toBeCloseTo(90, 9);
    expect(quantizeCycles(0.4012) * 600).toBeCloseTo(241, 9);
  });
});

describe('budgets (design §3.6)', () => {
  it('every cap in the table', () => {
    expect(BUDGETS.high).toMatchObject({ dprMax: 2, motes: Infinity, interPulses: 600, intraSegments: 4000, intraPulses: 400, idleFps: 60, starClampPx: 46 });
    expect(BUDGETS.mid).toMatchObject({ dprMax: 1.5, motes: 24000, interPulses: 250, intraSegments: 1500, intraPulses: 150, idleFps: 30, activeFps: 60, starClampPx: 28 });
    expect(BUDGETS.low).toMatchObject({ dprMax: 1, motes: 8000, interPulses: 120, intraSegments: 800, intraPulses: 60, idleFps: 30, activeFps: 30, starClampPx: 28 });
  });
  it('pulses per edge and speed scale with weight', () => {
    expect(pulsesPerEdge('high', 0)).toBe(1);
    expect(pulsesPerEdge('high', 1)).toBe(4);
    expect(pulsesPerEdge('mid', 1)).toBe(2);
    expect(pulsesPerEdge('low', 0.4)).toBe(1);
    expect(pulseSpeed(0)).toBeCloseTo(0.15, 12);
    expect(pulseSpeed(1)).toBeCloseTo(0.4, 12);
  });
  it('effective DPR: capped by tier, minus governor steps, never below 1', () => {
    expect(effectiveDpr(3, BUDGETS.high, { dprDelta: 0 })).toBe(2);
    expect(effectiveDpr(3, BUDGETS.mid, { dprDelta: -0.25 })).toBe(1.25);
    expect(effectiveDpr(1, BUDGETS.low, { dprDelta: -0.25 })).toBe(1);
  });
});

describe('gpu tier', () => {
  it('classifies low / mid / high', () => {
    expect(classifyTier({ webgl2: false, phone: false })).toBe('low');
    expect(classifyTier({ webgl2: true, phone: false, deviceMemory: 2 })).toBe('low');
    expect(classifyTier({ webgl2: true, phone: true, hardwareConcurrency: 4 })).toBe('low');
    expect(classifyTier({ webgl2: true, phone: true, hardwareConcurrency: 6 })).toBe('mid');
    expect(classifyTier({ webgl2: true, phone: true })).toBe('mid');
    expect(classifyTier({ webgl2: true, phone: false, hardwareConcurrency: 4, deviceMemory: 8 })).toBe('high');
  });
});

describe('Governor', () => {
  const slow = (g: Governor, frames = GOVERNOR_DEFAULTS.windowFrames, ms = 33) => {
    let stepped = 0;
    for (let i = 0; i < frames; i++) if (g.sample(ms)) stepped++;
    return stepped;
  };
  it('steps down motes → pulses → DPR, at most 3 times, never up', () => {
    const g = new Governor();
    expect(slow(g, 89)).toBe(0);
    expect(slow(g, 1)).toBe(1);
    expect(g.state).toMatchObject({ steps: 1, moteScale: 0.5, pulseScale: 1, dprDelta: 0 });
    slow(g);
    expect(g.state).toMatchObject({ steps: 2, pulseScale: 0.5 });
    slow(g);
    expect(g.state).toMatchObject({ steps: 3, dprDelta: -0.25 });
    expect(slow(g, 900)).toBe(0);
    expect(slow(g, 900, 8)).toBe(0); // fast frames never step back up
    expect(g.state).toMatchObject({ steps: 3, moteScale: 0.5, pulseScale: 0.5, dprDelta: -0.25 });
  });
  it('a 30 fps-capped loop running on time is not slow; one missing its 33 ms budget is', () => {
    const g = new Governor();
    for (let i = 0; i < 900; i++) g.sample(34, 1000 / 30);
    expect(g.state.steps).toBe(0);
    for (let i = 0; i < 90; i++) g.sample(60, 1000 / 30);
    expect(g.state.steps).toBe(1);
  });
  it('fast frames and pauses do not step', () => {
    const g = new Governor();
    expect(slow(g, 900, 16)).toBe(0);
    expect(slow(g, 900, 5000)).toBe(0); // tab-switch gaps are ignored
    expect(g.state.steps).toBe(0);
    expect(g.state.lastP75).toBe(16);
  });
});
