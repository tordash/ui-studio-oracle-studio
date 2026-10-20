import { describe, it, expect } from 'bun:test';
import { encodeForWorker } from '../encode';
import type { EncodedWeb } from '../encode';
import { intraEdges, membersOf, neighboursOf, sharedConcepts, INTRA_DEFAULTS } from '../intra';
import { synthDocs, shuffled, doc } from './fixtures/synth';

const t = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i}`);

// 200 docs in one cluster + 40 in another, with broad, medium and rare concepts
const docs = synthDocs([
  { project: 'github.com/tordash/big', size: 200, theme: [...t('a', 6), ...t('b', 20), ...t('c', 60)] },
  { project: 'github.com/tordash/other', size: 40, theme: [...t('a', 6), ...t('z', 10)] },
], { seed: 5, common: ['session', 'oracle'], commonRate: 0.25, perFile: [2, 9] });

function bruteForce(e: EncodedWeb, cluster: number, k: number, tau: number) {
  const mem = [...membersOf(e, cluster)];
  const S = mem.length;
  const cs = mem.map(f => [...e.conceptIds.subarray(e.conceptOff[f], e.conceptOff[f + 1])]);
  const nA = new Map<number, number>();
  for (const c of cs) for (const x of c) nA.set(x, (nA.get(x) ?? 0) + 1);
  const idf2 = (x: number) => Math.log(S / nA.get(x)!) ** 2;
  const norm = cs.map(c => Math.sqrt(c.reduce((s, x) => s + idf2(x), 0)));
  const cos = (i: number, j: number) => {
    if (!norm[i] || !norm[j]) return 0;
    const sj = new Set(cs[j]);
    let dot = 0;
    for (const x of cs[i]) if (sj.has(x)) dot += idf2(x);
    return dot / (norm[i] * norm[j]);
  };
  const lists = mem.map((f, i) => mem
    .map((g, j) => ({ file: g, j, s: i === j ? -1 : cos(i, j) }))
    .filter(x => x.j !== i && x.s >= tau)
    .sort((x, y) => y.s - x.s || e.rank[x.file] - e.rank[y.file])
    .slice(0, k)
    .map(x => ({ file: x.file, score: x.s })));
  return { mem, lists, cos: (a: number, b: number) => cos(mem.indexOf(a), mem.indexOf(b)) };
}

describe('intraEdges', () => {
  const e = encodeForWorker(docs);
  const big = e.clusterKeys.indexOf('own/big');

  it('with pMax = ∞ equals brute-force O(n²) cosine', () => {
    const r = intraEdges(e, big, { pMax: Infinity });
    const bf = bruteForce(e, big, 6, 0.12);
    expect([...r.members]).toEqual(bf.mem);
    let linked = 0;
    bf.mem.forEach((f, i) => {
      const got = neighboursOf(r, f);
      expect(got.map(x => x.file)).toEqual(bf.lists[i].map(x => x.file));
      got.forEach((x, q) => expect(Math.abs(x.score - bf.lists[i][q].score)).toBeLessThan(1e-12));
      if (got.length) linked++;
    });
    expect(linked).toBeGreaterThan(100);
  });

  it('with a cap: a subset, every score exact and ≥ τ', () => {
    const r = intraEdges(e, big, { pMax: 12 });
    const bf = bruteForce(e, big, 6, 0.12);
    const full = intraEdges(e, big, { pMax: Infinity });
    expect(r.postingOps).toBeLessThan(full.postingOps);
    for (const f of r.members) {
      for (const x of neighboursOf(r, f)) {
        expect(Math.abs(x.score - bf.cos(f, x.file))).toBeLessThan(1e-9);
        expect(x.score).toBeGreaterThanOrEqual(0.12);
      }
    }
    for (let q = 0; q < r.edgeS.length; q++) {
      expect(Math.abs(r.edgeS[q] - bf.cos(r.edgeI[q], r.edgeJ[q]))).toBeLessThan(1e-9);
    }
    expect(r.covered).toBeLessThanOrEqual(full.covered);
  });

  it('never crosses clusters; respects K and τ', () => {
    for (const opts of [{}, { k: 2 }, { tau: 0.4 }]) {
      const r = intraEdges(e, big, opts);
      const k = opts.k ?? INTRA_DEFAULTS.k;
      const tau = opts.tau ?? INTRA_DEFAULTS.tau;
      for (let i = 0; i < r.members.length; i++) {
        expect(r.nbrOff[i + 1] - r.nbrOff[i]).toBeLessThanOrEqual(k);
        for (let q = r.nbrOff[i]; q < r.nbrOff[i + 1]; q++) {
          expect(e.clusterOf[r.nbr[q]]).toBe(big);
          expect(r.nbr[q]).not.toBe(r.members[i]);
          expect(r.score[q]).toBeGreaterThanOrEqual(tau);
          if (q > r.nbrOff[i]) expect(r.score[q - 1]).toBeGreaterThanOrEqual(r.score[q]);
        }
      }
      for (let q = 0; q < r.edgeI.length; q++) {
        expect(e.clusterOf[r.edgeI[q]]).toBe(big);
        expect(e.clusterOf[r.edgeJ[q]]).toBe(big);
        if (q) expect(r.edgeS[q - 1]).toBeGreaterThanOrEqual(r.edgeS[q]);
      }
    }
  });

  it('coverage = members with ≥ 1 link', () => {
    const r = intraEdges(e, big);
    let c = 0;
    for (let i = 0; i < r.members.length; i++) if (r.nbrOff[i + 1] > r.nbrOff[i]) c++;
    expect(r.covered).toBe(c);
    expect(r.coverage).toBeCloseTo(c / r.members.length, 12);
    expect(r.coverage).toBeGreaterThan(0.5);
  });

  it('undirected edges are unique and cover every directed link', () => {
    const r = intraEdges(e, big);
    const keys = new Set<string>();
    for (let q = 0; q < r.edgeI.length; q++) {
      const k = `${Math.min(r.edgeI[q], r.edgeJ[q])}-${Math.max(r.edgeI[q], r.edgeJ[q])}`;
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
    for (let i = 0; i < r.members.length; i++) for (let q = r.nbrOff[i]; q < r.nbrOff[i + 1]; q++) {
      const a = r.members[i], b = r.nbr[q];
      expect(keys.has(`${Math.min(a, b)}-${Math.max(a, b)}`)).toBe(true);
    }
  });

  it('a concept every member carries links nothing (local idf = 0)', () => {
    const e2 = encodeForWorker([
      doc('a', 'github.com/tordash/m', ['dopelab', 'x']),
      doc('b', 'github.com/tordash/m', ['dopelab', 'y']),
      doc('c', 'github.com/tordash/m', ['dopelab', 'z']),
    ]);
    const r = intraEdges(e2, 0);
    expect(r.edgeI.length).toBe(0);
    expect(r.coverage).toBe(0);
  });

  it('handles empty and singleton clusters', () => {
    const e2 = encodeForWorker([doc('a', 'github.com/tordash/solo', ['x'])]);
    const r = intraEdges(e2, 0);
    expect(r.covered).toBe(0);
    expect(r.coverage).toBe(0);
    expect(intraEdges(e2, 5).members.length).toBe(0);
  });

  it('input order does not change the links (by doc id)', () => {
    const byId = (enc: EncodedWeb, d: typeof docs, r: ReturnType<typeof intraEdges>) =>
      [...r.members].map(f => [d[f].id, neighboursOf(r, f).map(x => [d[x.file].id, x.score])] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const s = shuffled(docs, 3);
    const e2 = encodeForWorker(s);
    const r1 = intraEdges(e, big);
    const r2 = intraEdges(e2, e2.clusterKeys.indexOf('own/big'));
    expect(byId(e2, s, r2)).toEqual(byId(e, docs, r1));
    expect(r2.covered).toBe(r1.covered);
  });

  it('sharedConcepts lists the overlap by name', () => {
    const e2 = encodeForWorker([doc('a', null, ['x', 'y', 'q']), doc('b', null, ['y', 'q', 'z'])]);
    expect(sharedConcepts(e2, 0, 1)).toEqual(['q', 'y']);
  });
});
