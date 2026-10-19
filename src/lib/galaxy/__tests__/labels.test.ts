import { describe, it, expect } from 'bun:test';
import { declutterLabels } from '../labels';
import type { LabelInput } from '../labels';

const W = 390, H = 780;
const box = (x: number, y: number, priority: number, w = 120, h = 38): LabelInput => ({ x, y, w, h, priority });

describe('declutterLabels', () => {
  it('keeps both labels when they do not overlap', () => {
    const r = declutterLabels([box(100, 200, 10), box(250, 400, 5)], W, H);
    expect(r.map(p => p.visible)).toEqual([true, true]);
  });

  it('on overlap hides the lower-count label (learn/kilo-org 400 under learn/gsd-build 510)', () => {
    const kilo = box(200, 300, 400, 130);
    const gsd = box(215, 316, 510, 140);
    const r = declutterLabels([kilo, gsd], W, H);
    expect(r[0].visible).toBe(false);
    expect(r[1].visible).toBe(true);
  });

  it('greedy chain: A > B > C with A∩B and B∩C but not A∩C keeps A and C', () => {
    const A = box(100, 300, 30, 100);
    const B = box(180, 300, 20, 100);
    const C = box(260, 300, 10, 100);
    const r = declutterLabels([C, A, B], W, H);
    expect(r.map(p => p.visible)).toEqual([true, true, false]);
  });

  it('ties break by input order (stable)', () => {
    const r = declutterLabels([box(200, 300, 7), box(205, 305, 7)], W, H);
    expect(r.map(p => p.visible)).toEqual([true, false]);
  });

  it('clamps a label at the left edge inside the margin (inbox/from-council)', () => {
    const r = declutterLabels([box(20, 300, 1, 140)], W, H, { margin: 8 });
    expect(r[0].visible).toBe(true);
    // left was 20 - 70 = -50 → shifted to 8
    expect(r[0].dx).toBe(58);
    expect(r[0].dy).toBe(0);
  });

  it('clamps at the right edge and at the top', () => {
    const r = declutterLabels([box(380, 20, 1, 100, 38)], W, H, { margin: 8 });
    // right was 430 → 382 (dx -48); top was -18 → 8 (dy +26)
    expect(r[0]).toEqual({ visible: true, dx: -48, dy: 26 });
  });

  it('a clamp shift is used for the overlap test (two edge labels pushed together)', () => {
    // unclamped [-65, 75] and [100, 140] are apart; clamped [8, 148] covers the second
    const r = declutterLabels([box(5, 300, 9, 140), box(120, 300, 3, 40)], W, H, { margin: 8 });
    expect(r[0].visible).toBe(true);
    expect(r[1].visible).toBe(false);
  });

  it('hides labels whose anchor is behind the camera or outside the canvas', () => {
    const r = declutterLabels([box(NaN, NaN, 99), box(-10, 300, 99), box(200, 900, 99), box(200, 300, 1)], W, H);
    expect(r.map(p => p.visible)).toEqual([false, false, false, true]);
  });

  it('insets shrink the overlap test (transparent padding does not collide)', () => {
    const a = box(100, 300, 2, 100);
    const b = box(195, 300, 1, 100); // boxes overlap by 5 px
    expect(declutterLabels([a, b], W, H)[1].visible).toBe(false);
    expect(declutterLabels([a, b], W, H, { insetX: 6 })[1].visible).toBe(true);
  });

  it('12 labels × 1000 runs stays cheap', () => {
    const items = Array.from({ length: 12 }, (_, i) => box(40 + (i * 29) % 320, 120 + (i * 53) % 600, 1000 - i * 37));
    const t0 = performance.now();
    for (let k = 0; k < 1000; k++) declutterLabels(items, W, H);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
