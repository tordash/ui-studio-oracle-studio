import { describe, it, expect } from 'bun:test';
import { chooseLabels, backside, labelPriority, LABEL_MAX, BACKSIDE_DOT } from '../label-pool';

const ranked = Array.from({ length: 20 }, (_, i) => `n${String(i).padStart(2, '0')}`);

describe('chooseLabels', () => {
  it('≤ 12 labels, top ranks first', () => {
    expect(LABEL_MAX).toBe(12);
    const r = chooseLabels(ranked, null, null, 12);
    expect(r).toHaveLength(12);
    expect(r).toEqual(ranked.slice(0, 12));
  });

  it('selected and hovered are always included, even when ranked past 12', () => {
    const r = chooseLabels(ranked, 'n18', 'n15', 12);
    expect(r).toHaveLength(12);
    expect(r).toContain('n18');
    expect(r).toContain('n15');
    expect(r.slice(0, 2)).toEqual(['n18', 'n15']);
    expect(r).not.toContain('n10');
    expect(r).not.toContain('n11');
  });

  it('no duplicates when selected = hovered or already in the top ranks', () => {
    const r = chooseLabels(ranked, 'n01', 'n01', 12);
    expect(new Set(r).size).toBe(r.length);
    expect(r).toHaveLength(12);
    expect(r[0]).toBe('n01');
  });

  it('fewer nodes than the cap → all of them', () => {
    expect(chooseLabels(['a', 'b'], null, 'b', 12)).toEqual(['b', 'a']);
    expect(chooseLabels([], null, null, 12)).toEqual([]);
  });

  it('a selected key that is not a node is ignored', () => {
    expect(chooseLabels(['a', 'b'], 'ghost', null, 12)).toEqual(['a', 'b']);
  });

  it('labelPriority: selected > hovered > rank', () => {
    expect(labelPriority('a', 5, 'a', null)).toBeGreaterThan(labelPriority('b', 0, 'a', null));
    expect(labelPriority('b', 9, null, 'b')).toBeGreaterThan(labelPriority('c', 0, null, 'b'));
    expect(labelPriority('c', 0, null, null)).toBeGreaterThan(labelPriority('d', 1, null, null));
  });
});

describe('backside', () => {
  it('hidden when dot(normal, viewDir) < −0.15', () => {
    expect(BACKSIDE_DOT).toBe(-0.15);
    expect(backside(-0.2)).toBe(true);
    expect(backside(-0.15)).toBe(false);
    expect(backside(0.5)).toBe(false);
  });
});
