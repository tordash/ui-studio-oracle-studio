import { describe, it, expect } from 'bun:test';
import {
  slotCount, fibonacciSlots, assignSticky, arcControl, rankScore, slerpUnit, easeInOut,
  RERANK_MS, SHELL_R,
} from '../layout';
import type { Vec3, Ranked } from '../layout';

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ranked = (...pairs: [string, number][]): Ranked[] => pairs.map(([key, score]) => ({ key, score }));

describe('fibonacciSlots', () => {
  it('slotCount = clamp(2N, 16, 64)', () => {
    expect(slotCount(0)).toBe(16);
    expect(slotCount(5)).toBe(16);
    expect(slotCount(12)).toBe(24);
    expect(slotCount(40)).toBe(64);
  });

  it('points are unit length, front-sorted on +z', () => {
    for (const M of [16, 24, 64]) {
      const s = fibonacciSlots(M);
      expect(s).toHaveLength(M);
      for (const p of s) expect(len(p)).toBeCloseTo(1, 9);
      for (let i = 1; i < M; i++) expect(s[i][2]).toBeLessThanOrEqual(s[i - 1][2] + 1e-12);
    }
    expect(fibonacciSlots(16)[0][2]).toBeGreaterThan(0.9);
  });

  it('is deterministic', () => {
    expect(fibonacciSlots(24)).toEqual(fibonacciSlots(24));
  });
});

describe('assignSticky', () => {
  it('top rank gets slot 0, then in rank order', () => {
    const st = assignSticky(null, ranked(['helm', 40], ['somtor', 20], ['ez', 5]), 0);
    expect(st.assign.get('helm')).toBe(0);
    expect(st.assign.get('somtor')).toBe(1);
    expect(st.assign.get('ez')).toBe(2);
    expect(st.slots).toHaveLength(16);
  });

  it('re-ranks at most every 60 s', () => {
    expect(RERANK_MS).toBe(60_000);
    const a = assignSticky(null, ranked(['helm', 40], ['somtor', 30], ['ez', 20], ['forge', 10]), 0);
    // forge becomes the busiest by far, 30 s later: no re-rank yet
    const b = assignSticky(a, ranked(['forge', 400], ['helm', 40], ['somtor', 30], ['ez', 20]), 30_000);
    expect(b.assign.get('forge')).toBe(3);
    expect(b.assign.get('helm')).toBe(0);
    expect(b.lastRank).toBe(0);
    // at 60 s it moves to the front
    const c = assignSticky(b, ranked(['forge', 400], ['helm', 40], ['somtor', 30], ['ez', 20]), 60_000);
    expect(c.assign.get('forge')).toBe(0);
    expect(c.lastRank).toBe(60_000);
    expect(c.moved.has('forge')).toBe(true);
  });

  it('hysteresis: a 1-place rank swap does not move', () => {
    const a = assignSticky(null, ranked(['helm', 40], ['somtor', 30], ['ez', 20]), 0);
    const b = assignSticky(a, ranked(['somtor', 41], ['helm', 40], ['ez', 20]), RERANK_MS);
    expect(b.assign.get('helm')).toBe(0);
    expect(b.assign.get('somtor')).toBe(1);
    expect(b.moved.size).toBe(0);
  });

  it('hysteresis: a ≥ 2-place jump within 25 % of the occupant does not move', () => {
    const a = assignSticky(null, ranked(['helm', 40], ['somtor', 38], ['ez', 36], ['forge', 34]), 0);
    // forge (slot 3) now ranks 1st, but 42 vs helm 40 is only 5 % apart
    const b = assignSticky(a, ranked(['forge', 42], ['helm', 40], ['somtor', 38], ['ez', 36]), RERANK_MS);
    expect(b.assign.get('forge')).toBe(3);
    expect(b.assign.get('helm')).toBe(0);
    expect(b.moved.size).toBe(0);
  });

  it('a real change (≥ 2 places and > 25 %) moves, swapping with the occupant', () => {
    const a = assignSticky(null, ranked(['helm', 40], ['somtor', 30], ['ez', 20], ['forge', 10]), 0);
    const b = assignSticky(a, ranked(['forge', 90], ['helm', 40], ['somtor', 30], ['ez', 20]), RERANK_MS);
    expect(b.assign.get('forge')).toBe(0);
    expect(b.assign.get('helm')).toBe(3);
    expect([...b.moved].sort()).toEqual(['forge', 'helm']);
    // one node per slot
    expect(new Set(b.assign.values()).size).toBe(b.assign.size);
  });

  it('a new node takes the best free slot, even between re-ranks', () => {
    const a = assignSticky(null, ranked(['helm', 40], ['somtor', 30], ['ez', 20]), 0);
    // somtor leaves the window at the next re-rank → slot 1 frees
    const b = assignSticky(a, ranked(['helm', 40], ['ez', 20]), RERANK_MS);
    expect(b.assign.has('somtor')).toBe(false);
    const c = assignSticky(b, ranked(['helm', 40], ['ez', 20], ['reelsmith', 1]), RERANK_MS + 1000);
    expect(c.assign.get('reelsmith')).toBe(1);
    expect(c.assign.get('ez')).toBe(2);
  });

  it('grows the slot set when 2N passes M and keeps nodes near their old place', () => {
    const many = (n: number) => ranked(...Array.from({ length: n }, (_, i): [string, number] => [`n${String(i).padStart(2, '0')}`, 100 - i]));
    const a = assignSticky(null, many(8), 0);
    expect(a.slots).toHaveLength(16);
    const b = assignSticky(a, many(12), 1000);
    expect(b.slots).toHaveLength(24);
    expect(b.assign.size).toBe(12);
    expect(new Set(b.assign.values()).size).toBe(12);
    // n00 was dead-centre front; it stays near the front
    expect(dot(b.slots[b.assign.get('n00')!], [0, 0, 1])).toBeGreaterThan(0.85);
  });

  it('rankScore = activity × (0.5 + 0.5·heat)', () => {
    expect(rankScore(10, 1)).toBe(10);
    expect(rankScore(10, 0)).toBe(5);
  });
});

describe('arcControl', () => {
  it('bows outward above the shell, between the endpoints', () => {
    const a: Vec3 = [SHELL_R, 0, 0], b: Vec3 = [0, SHELL_R, 0];
    const c = arcControl(a, b, SHELL_R);
    expect(len(c)).toBeGreaterThan(SHELL_R);
    expect(dot(c, [1, 1, 0])).toBeGreaterThan(0);
    // ctrl = normalize(a+b)·R·(1 + 0.35·|b−a|/(2R))
    expect(len(c)).toBeCloseTo(SHELL_R * (1 + 0.35 * Math.hypot(SHELL_R, SHELL_R) / (2 * SHELL_R)), 9);
  });

  it('an antipodal pair uses a stable perpendicular, never NaN', () => {
    const a: Vec3 = [0, 0, SHELL_R], b: Vec3 = [0, 0, -SHELL_R];
    const c1 = arcControl(a, b, SHELL_R);
    const c2 = arcControl(a, b, SHELL_R);
    for (const v of c1) expect(Number.isFinite(v)).toBe(true);
    expect(c1).toEqual(c2);
    expect(Math.abs(dot(c1, a))).toBeLessThan(1e-9);
    expect(len(c1)).toBeCloseTo(SHELL_R * 1.35, 9);
    // antipodal along the up axis too
    const c3 = arcControl([0, SHELL_R, 0], [0, -SHELL_R, 0], SHELL_R);
    for (const v of c3) expect(Number.isFinite(v)).toBe(true);
    expect(len(c3)).toBeCloseTo(SHELL_R * 1.35, 9);
  });
});

describe('slot moves', () => {
  it('slerpUnit stays on the unit sphere and hits both ends', () => {
    const a: Vec3 = [1, 0, 0], b: Vec3 = [0, 0, 1];
    expect(slerpUnit(a, b, 0)).toEqual(a);
    const end = slerpUnit(a, b, 1);
    for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(b[i], 9);
    expect(len(slerpUnit(a, b, 0.37))).toBeCloseTo(1, 9);
    const anti = slerpUnit([0, 0, 1], [0, 0, -1], 0.5);
    expect(len(anti)).toBeCloseTo(1, 9);
  });

  it('easeInOut is 0 → 1, symmetric', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 9);
  });
});
