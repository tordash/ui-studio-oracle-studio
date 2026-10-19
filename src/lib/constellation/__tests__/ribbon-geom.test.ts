import { describe, it, expect } from 'bun:test';
import {
  ribbonStrip, RIBBON_SEGMENTS, INSTANCE_LAYOUT, instanceFloats, edgeDim, writeInstance, pulseDuration, DIM_OUT,
} from '../ribbon-geom';
import { newFireRing, pushFire, packFire } from '../schedule';

describe('ribbonStrip', () => {
  it('32 segments → 66 verts, 192 indices (errata #3)', () => {
    expect(RIBBON_SEGMENTS).toBe(32);
    const s = ribbonStrip(32);
    expect(s.t).toHaveLength(66);
    expect(s.side).toHaveLength(66);
    expect(s.index).toHaveLength(192);
    expect(s.index.length / 3).toBe(64);
  });

  it('t runs 0 → 1 along the strip, sides alternate −1 / +1', () => {
    const s = ribbonStrip(4);
    expect([...s.t]).toEqual([0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1]);
    expect([...s.side]).toEqual([-1, 1, -1, 1, -1, 1, -1, 1, -1, 1]);
  });

  it('every index is in range and each quad is two triangles', () => {
    const s = ribbonStrip(32);
    for (const i of s.index) expect(i).toBeLessThan(66);
    expect([...s.index.slice(0, 6)]).toEqual([0, 1, 2, 2, 1, 3]);
  });
});

describe('instance layout', () => {
  it('names and sizes', () => {
    expect(INSTANCE_LAYOUT).toEqual([
      ['aFrom', 3], ['aTo', 3], ['aCtrl', 3], ['aWidth', 1], ['aColA', 3], ['aColB', 3],
      ['aHeat', 1], ['aShare', 1], ['aFire', 4], ['aDim', 1],
    ]);
    expect(instanceFloats()).toBe(23);
  });

  it('writeInstance packs one edge, aFire from the T5 ring', () => {
    const ring = newFireRing();
    pushFire(ring, 1001, 1);
    pushFire(ring, 1002.5, -1);
    const arrays = Object.fromEntries(INSTANCE_LAYOUT.map(([n, k]) => [n, new Float32Array(2 * k)])) as Record<string, Float32Array>;
    writeInstance(arrays, 1, {
      from: [1, 2, 3], to: [4, 5, 6], ctrl: [7, 8, 9], width: 4.5,
      colA: [0.1, 0.2, 0.3], colB: [0.4, 0.5, 0.6], heat: 0.7, share: 0.25, fire: packFire(ring), dim: 0.15,
    });
    expect([...arrays.aFrom.slice(3, 6)]).toEqual([1, 2, 3]);
    expect([...arrays.aCtrl.slice(3, 6)]).toEqual([7, 8, 9]);
    expect(arrays.aWidth[1]).toBeCloseTo(4.5, 6);
    expect([...arrays.aFire.slice(4, 8)]).toEqual([1001, -1002.5, 0, 0]);
    expect(arrays.aDim[1]).toBeCloseTo(0.15, 6);
    expect(arrays.aShare[1]).toBeCloseTo(0.25, 6);
    // slot 0 untouched
    expect([...arrays.aFrom.slice(0, 3)]).toEqual([0, 0, 0]);
  });
});

describe('edgeDim', () => {
  const e = { a: 'helm', b: 'somtor' };
  it('1 with no focus and no selection', () => {
    expect(edgeDim(e, new Set(), null)).toBe(1);
  });
  it('0.15 for edges outside the focus set; 1 when touching it', () => {
    expect(DIM_OUT).toBe(0.15);
    expect(edgeDim(e, new Set(['ez']), null)).toBe(0.15);
    expect(edgeDim(e, new Set(['somtor']), null)).toBe(1);
  });
  it('0.15 for edges not touching the selection; selection wins over focus', () => {
    expect(edgeDim(e, new Set(), 'forge')).toBe(0.15);
    expect(edgeDim(e, new Set(), 'helm')).toBe(1);
    expect(edgeDim(e, new Set(['helm']), 'forge')).toBe(0.15);
  });
});

describe('pulseDuration', () => {
  it('1.2 s + 0.04 s per world unit of chord', () => {
    expect(pulseDuration(0)).toBeCloseTo(1.2, 9);
    expect(pulseDuration(20)).toBeCloseTo(2.0, 9);
  });
});
