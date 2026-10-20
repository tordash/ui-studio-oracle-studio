import { describe, it, expect } from 'bun:test';
import { sizeRanks, labelEligible, LABEL_TOP_N_WIDE, LABEL_TOP_N_PHONE, LABEL_REVEAL_PX, LABEL_INSET_X, LABEL_INSET_Y } from '../labels';
import { declutterLabels } from '../../galaxy/labels';

const sizes = [5311, 4735, 1368, 191, 148, 115, 68, 65, 46, 38, 14, 10, 2];

describe('sizeRanks', () => {
  it('0 = biggest, ties by index', () => {
    expect([...sizeRanks(sizes)]).toEqual(sizes.map((_, i) => i));
    expect([...sizeRanks([3, 9, 3, 9])]).toEqual([2, 0, 3, 1]);
  });
});

describe('labelEligible (top-N + armed + reveal on zoom)', () => {
  const rank = sizeRanks(sizes);
  const at = (cluster: number, radiusPx: number) => ({ cluster, radiusPx });
  it('home: only the top-N by size are offered', () => {
    const shown = sizes.map((_, c) => labelEligible(at(c, 20), rank, -1, LABEL_TOP_N_WIDE)).filter(Boolean).length;
    expect(shown).toBe(LABEL_TOP_N_WIDE);
    const phone = sizes.map((_, c) => labelEligible(at(c, 20), rank, -1, LABEL_TOP_N_PHONE)).filter(Boolean).length;
    expect(phone).toBe(LABEL_TOP_N_PHONE);
    expect(LABEL_TOP_N_PHONE).toBeLessThan(LABEL_TOP_N_WIDE);
  });
  it('the armed (tapped / hovered) cluster always gets its label', () => {
    expect(labelEligible(at(12, 3), rank, 12, LABEL_TOP_N_PHONE)).toBe(true);
  });
  it('zooming in reveals smaller clusters once they are drawn big enough', () => {
    expect(labelEligible(at(10, LABEL_REVEAL_PX - 1), rank, -1, LABEL_TOP_N_WIDE)).toBe(false);
    expect(labelEligible(at(10, LABEL_REVEAL_PX), rank, -1, LABEL_TOP_N_WIDE)).toBe(true);
  });
});

describe('pill-tight declutter', () => {
  // ClusterLabels buttons: px-1 (4 px) around the pill, min-h-11 (44 px) around a ~23 px pill
  const btn = { w: 120, h: 44 };
  const pillW = btn.w - 8;
  it('two pills that would touch or overlap never both show; a ≥ 4 px gap is kept', () => {
    for (let gap = -20; gap <= 12; gap++) {
      const dx = pillW + gap; // centre distance
      const placed = declutterLabels(
        [{ x: 400, y: 300, ...btn, priority: 2 }, { x: 400 + dx, y: 300, ...btn, priority: 1 }],
        1440, 812, { margin: 8, insetX: LABEL_INSET_X, insetY: LABEL_INSET_Y },
      );
      if (placed[1].visible) expect(gap).toBeGreaterThanOrEqual(4);
      expect(placed[0].visible).toBe(true);
    }
  });
  it('stacked rows: pills ~23 px tall in 44 px buttons may sit 26 px apart, not closer', () => {
    const at = (dy: number) => declutterLabels(
      [{ x: 400, y: 300, ...btn, priority: 2 }, { x: 430, y: 300 + dy, ...btn, priority: 1 }],
      1440, 812, { margin: 8, insetX: LABEL_INSET_X, insetY: LABEL_INSET_Y },
    )[1].visible;
    expect(at(20)).toBe(false);
    expect(at(28)).toBe(true);
  });
});
