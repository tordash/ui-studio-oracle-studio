import { describe, it, expect } from 'bun:test';
import { encodeForWorker, documentFrequency, membersByCluster, transferables } from '../encode';
import { clusterVectors, edgeContributions, interEdges, pairWeights, isDiffuse, edgesOf, INTER_DEFAULTS } from '../inter';
import { doc, shuffled, webFixture } from './fixtures/synth';

const enc = (docs: Parameters<typeof encodeForWorker>[0]) => encodeForWorker(docs);
const idx = (e: ReturnType<typeof enc>, key: string) => e.clusterKeys.indexOf(key);

describe('encodeForWorker', () => {
  it('builds sorted keys/concepts and a CSR of unique sorted concept ids', () => {
    const e = enc([
      doc('a', 'github.com/tordash/x', ['b', 'a', 'b']),
      doc('b', null, []),
      doc('c', 'github.com/torsupakit/x', ['c', 'a']),
    ]);
    expect(e.n).toBe(3);
    expect(e.clusterKeys).toEqual(['own/x', '∅']);
    expect([...e.clusterOf]).toEqual([0, 1, 0]);
    expect(e.conceptNames).toEqual(['a', 'b', 'c']);
    expect([...e.conceptOff]).toEqual([0, 2, 2, 4]);
    expect([...e.conceptIds]).toEqual([0, 1, 0, 2]);
    expect([...documentFrequency(e)]).toEqual([2, 1, 1]);
    expect(membersByCluster(e).map(m => [...m])).toEqual([[0, 2], [1]]);
    expect(transferables(e)).toHaveLength(4);
  });
  it('treats missing z as 0 (2D map fallback)', () => {
    const d = doc('a', null, []);
    delete (d as { z?: number }).z;
    expect([...enc([d]).pos]).toEqual([0, 0, 0]);
  });
});

describe('interEdges', () => {
  const docs = webFixture();
  const e = enc(docs);
  const r = interEdges(e);
  const vec = clusterVectors(e);

  it('a concept every file carries has zero weight and never appears as evidence', () => {
    const withU = docs.map(d => ({ ...d, concepts: [...d.concepts, 'everywhere'] }));
    const eu = enc(withU);
    const vu = clusterVectors(eu);
    const u = eu.conceptNames.indexOf('everywhere');
    expect([...vu.ids].includes(u)).toBe(false);
    for (const x of interEdges(eu).edges) expect(x.evidence.some(v => v.concept === 'everywhere')).toBe(false);
  });

  it('w equals the sum of its exact per-concept contributions; shares sum to 1', () => {
    expect(r.edges.length).toBeGreaterThan(0);
    for (const x of r.edges) {
      const all = edgeContributions(vec, x.a, x.b);
      const sum = all.reduce((s, c) => s + c.contrib, 0);
      expect(Math.abs(sum - x.w)).toBeLessThan(1e-9);
      expect(Math.abs(all.reduce((s, c) => s + c.contrib / x.w, 0) - 1)).toBeLessThan(1e-9);
      expect(all.length).toBe(x.shared);
      expect(x.evidence.length).toBeLessThanOrEqual(INTER_DEFAULTS.maxEvidence);
      for (let i = 1; i < x.evidence.length; i++) expect(x.evidence[i - 1].share).toBeGreaterThanOrEqual(x.evidence[i].share);
    }
  });

  it('is symmetric', () => {
    const { C, w } = pairWeights(vec, e.conceptNames.length);
    for (let a = 0; a < C; a++) for (let b = a + 1; b < C; b++) {
      const ab = edgeContributions(vec, a, b).reduce((s, c) => s + c.contrib, 0);
      const ba = edgeContributions(vec, b, a).reduce((s, c) => s + c.contrib, 0);
      expect(Math.abs(ab - ba)).toBeLessThan(1e-12);
      expect(Math.abs(ab - w[a * C + b])).toBeLessThan(1e-9);
    }
  });

  it('keeps an edge only if it is top-k of either endpoint, with ≥ minShared and ≥ wMin', () => {
    const { C, w, shared } = pairWeights(vec, e.conceptNames.length);
    const W = (a: number, b: number) => (a < b ? w[a * C + b] : w[b * C + a]);
    const S = (a: number, b: number) => (a < b ? shared[a * C + b] : shared[b * C + a]);
    const topk = (a: number) => [...Array(C).keys()]
      .filter(b => b !== a && S(a, b) >= 3 && W(a, b) >= 0.02)
      .sort((x, y) => W(a, y) - W(a, x) || x - y).slice(0, 3);
    const expected = new Set<string>();
    for (let a = 0; a < C; a++) for (const b of topk(a)) expected.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    expect(new Set(r.edges.map(x => `${x.a}-${x.b}`))).toEqual(expected);
    for (const x of r.edges) { expect(x.shared).toBeGreaterThanOrEqual(3); expect(x.w).toBeGreaterThanOrEqual(0.02); }
    // stricter options only remove edges
    const strict = interEdges(e, { k: 1, minShared: 5, wMin: 0.1 });
    for (const x of strict.edges) expect(expected.has(`${x.a}-${x.b}`)).toBe(true);
  });

  it('degree counts drawn edges; orphans carry their best weak matches', () => {
    const deg = new Array(e.clusterKeys.length).fill(0);
    for (const x of r.edges) { deg[x.a]++; deg[x.b]++; }
    expect(r.degree).toEqual(deg);
    expect(r.orphans).toEqual(deg.map((d, i) => (d === 0 ? i : -1)).filter(i => i >= 0));
    const lonely = enc([
      ...docs,
      doc('solo', 'github.com/tordash/reelsmith-oracle', ['reel-only-a', 'reel-only-b']),
    ]);
    const lr = interEdges(lonely);
    const solo = idx(lonely, 'own/reelsmith-oracle');
    expect(lr.orphans).toContain(solo);
    expect(Array.isArray(lr.weak[solo])).toBe(true);
    expect(edgesOf(lr, solo)).toEqual([]);
  });

  it('links the themed pairs (somtor ↔ arra, beam ↔ lookout) and merges owner aliases first', () => {
    const k = (s: string) => idx(e, s);
    const has = (a: number, b: number) => r.edges.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    expect(k('github.com/torsupakit/marketing-agency-team')).toBe(-1);
    expect(has(k('own/somtor-oracle'), k('own/arra-oracle-v3'))).toBe(true);
    expect(has(k('own/beam-oracle'), k('own/lookout-oracle'))).toBe(true);
    const bl = r.edges.find(x => [x.a, x.b].includes(k('own/beam-oracle')) && [x.a, x.b].includes(k('own/lookout-oracle')))!;
    expect(bl.evidence.slice(0, 2).map(v => v.concept).sort()).toEqual(['identity', 'soul-sync']);
  });

  it('α shrinks a small cluster toward the global rate: a broad concept in every file of a 2-file cluster loses lift', () => {
    const base = [
      ...Array.from({ length: 40 }, (_, i) => doc(`bg${i}`, null, i % 2 ? ['broad', `bg-${i % 5}`] : [`bg-${i % 5}`])),
      doc('t1', 'github.com/tordash/tiny', ['broad', 'rare']),
      doc('t2', 'github.com/tordash/tiny', ['broad', 'rare']),
    ];
    const e2 = enc(base);
    const tiny = idx(e2, 'own/tiny');
    const lift = (alpha: number) => {
      const v = clusterVectors(e2, alpha);
      const b = e2.conceptNames.indexOf('broad'), rr = e2.conceptNames.indexOf('rare');
      let vb = 0, vr = 0;
      for (let k = v.off[tiny]; k < v.off[tiny + 1]; k++) {
        if (v.ids[k] === b) vb = v.vals[k];
        if (v.ids[k] === rr) vr = v.vals[k];
      }
      return vb / vr; // broad relative to rare, after normalisation
    };
    expect(lift(5)).toBeLessThan(lift(0));
  });

  it('a singleton with one rare concept ranks below a 50-file cluster sharing 10 concepts', () => {
    const themed = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const pick = (i: number) => themed.filter((_, j) => (i + j) % 3 === 0);
    const docs3 = [
      ...Array.from({ length: 50 }, (_, i) => doc(`x${i}`, 'github.com/tordash/x', i === 0 ? [...pick(i), 'rare'] : pick(i))),
      ...Array.from({ length: 50 }, (_, i) => doc(`y${i}`, 'github.com/tordash/y', pick(i + 1))),
      doc('s', 'github.com/tordash/single', ['rare']),
      ...Array.from({ length: 200 }, (_, i) => doc(`bg${i}`, null, [`bg-${i % 20}`, themed[i % 10]])),
    ];
    const e3 = enc(docs3);
    const v = clusterVectors(e3);
    const { C, w } = pairWeights(v, e3.conceptNames.length);
    const W = (a: number, b: number) => (a < b ? w[a * C + b] : w[b * C + a]);
    const X = idx(e3, 'own/x'), Y = idx(e3, 'own/y'), Sg = idx(e3, 'own/single');
    expect(W(X, Y)).toBeGreaterThan(W(X, Sg));
    // and the singleton is never a drawn neighbour of x (one shared concept < minShared)
    expect(edgesOf(interEdges(e3), X).some(x => x.a === Sg || x.b === Sg)).toBe(false);
  });

  it('input order does not change the output (bit-identical)', () => {
    const r2 = interEdges(enc(shuffled(docs, 7)));
    expect(r2).toEqual(r);
  });

  it('flags broad (diffuse) edges by top-5 share', () => {
    expect(isDiffuse({ top5: 0.49 })).toBe(true);
    expect(isDiffuse({ top5: 0.5 })).toBe(false);
  });
});
