import { describe, it, expect } from 'bun:test';
import type { MapDocument } from '../../../api/oracle';
import { kmeans, buildClusters, mulberry32 } from '../clusters';

function blob(cx: number, n: number, mk: (i: number) => Partial<MapDocument>): MapDocument[] {
  const r = mulberry32(cx * 100 + n);
  return Array.from({ length: n }, (_, i) => ({
    id: `${cx}_${i}`, type: 'learning', source_file: `ψ/learn/f${cx}/d${i}.md`, concepts: [], project: null,
    x: cx + (r() - 0.5) * 0.2, y: (r() - 0.5) * 0.2, z: (r() - 0.5) * 0.2, created_at: null, ...mk(i),
  }));
}
const pos = (docs: MapDocument[]) => new Float32Array(docs.flatMap(d => [d.x, d.y, d.z ?? 0]));

describe('kmeans', () => {
  it('separates well-separated blobs deterministically', () => {
    const docs = [...blob(-5, 60, () => ({})), ...blob(5, 60, () => ({}))];
    const a = kmeans(pos(docs), 2);
    const b = kmeans(pos(docs), 2);
    expect(Array.from(a.assign)).toEqual(Array.from(b.assign));
    expect(a.assign[0]).not.toBe(a.assign[60]);
    expect(new Set(Array.from(a.assign.slice(0, 60))).size).toBe(1);
  });
});

describe('buildClusters', () => {
  it('labels by top concept when members have concepts, else by folder (marked folder)', () => {
    const docs = [
      ...blob(-5, 60, () => ({ concepts: ['oracle', 'brain'] })),
      ...blob(5, 60, () => ({})),
    ];
    const cs = buildClusters(docs, pos(docs), { maxClusters: 2 });
    expect(cs.length).toBe(2);
    const c1 = cs.find(c => c.cx < 0)!;
    const c2 = cs.find(c => c.cx > 0)!;
    expect(c1.kind).toBe('concept');
    expect(['oracle', 'brain']).toContain(c1.label);
    expect(c2.kind).toBe('folder');
    expect(c2.label).toBe('learn/f5');
    expect(c1.size + c2.size).toBe(120);
  });
  it('never repeats a concept label across clusters and caps the count', () => {
    const docs = [-9, -3, 3, 9].flatMap(cx => blob(cx, 50, () => ({ concepts: ['pattern', `c${cx}`] })));
    const cs = buildClusters(docs, pos(docs), { maxClusters: 4 });
    const labels = cs.map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(cs.length).toBeLessThanOrEqual(4);
  });
  it('returns nothing for tiny inputs', () => {
    expect(buildClusters(blob(0, 5, () => ({})), new Float32Array(15))).toEqual([]);
  });
});
