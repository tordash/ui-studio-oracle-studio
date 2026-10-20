import { describe, it, expect } from 'bun:test';
import { parseWebUrl, webSearch, webUrl, resolveWebState, parentState, WebHistory, UNSORTED_PARAM } from '../url-state';
import { UNSORTED_KEY } from '../keys';

describe('parse / build', () => {
  it('round-trips, encoding keys and ids', () => {
    const s = { c: 'own/somtor-oracle', f: 'learning_ψ/memory/x y.md_0' };
    const q = webSearch(s);
    expect(q).toBe('?c=own%2Fsomtor-oracle&f=learning_%CF%88%2Fmemory%2Fx+y.md_0');
    expect(parseWebUrl(q)).toEqual(s);
    expect(webUrl('/graph', s)).toBe(`/graph${q}`);
  });
  it('Unsorted is c=_unsorted', () => {
    expect(webSearch({ c: UNSORTED_KEY, f: null })).toBe(`?c=${UNSORTED_PARAM}`);
    expect(parseWebUrl('?c=_unsorted').c).toBe(UNSORTED_KEY);
  });
  it('bad / empty input → overview', () => {
    expect(parseWebUrl('')).toEqual({ c: null, f: null });
    expect(parseWebUrl('?c=&f=')).toEqual({ c: null, f: null });
    expect(parseWebUrl('?zzz=1')).toEqual({ c: null, f: null });
    expect(webSearch({ c: null, f: null })).toBe('');
  });
  it('resolves against data: unknown c → overview, bad f ignored, f alone drills its cluster', () => {
    const keys = ['own/a', 'own/b', UNSORTED_KEY];
    const ids: Record<string, number> = { d1: 0, d2: 1 };
    const cl = [1, 2];
    const r = (c: string | null, f: string | null) => resolveWebState({ c, f }, keys, id => ids[id] ?? -1, i => cl[i]);
    expect(r('own/zzz', null)).toEqual({ cluster: -1, star: -1 });
    expect(r('own/a', 'nope')).toEqual({ cluster: 0, star: -1 });
    expect(r(null, 'd2')).toEqual({ cluster: 2, star: 1 });
    expect(r('own/b', 'd1')).toEqual({ cluster: 1, star: 0 });
  });
  it('parent: file first, then cluster', () => {
    expect(parentState({ c: 'own/a', f: 'x' })).toEqual({ c: 'own/a', f: null });
    expect(parentState({ c: 'own/a', f: null })).toEqual({ c: null, f: null });
  });
});

/** Minimal browser history stub: push / back with popstate-like notifications. */
class StubHistory {
  entries: string[];
  idx = 0;
  constructor(start: string) { this.entries = [start]; }
  get current() { return this.entries[this.idx]; }
  push(s: string) { this.entries = this.entries.slice(0, this.idx + 1); this.entries.push(s); this.idx++; }
  replace(s: string) { this.entries[this.idx] = s; }
  back() { if (this.idx > 0) this.idx--; }
}

describe('WebHistory (stub browser history)', () => {
  it('drill then open; back pops f, then c', () => {
    const h = new StubHistory('');
    const w = new WebHistory();
    w.onLocation(h.current);
    const go = (s: string) => { w.push(h.current, s); h.push(s); w.onLocation(h.current); };
    const back = () => {
      const a = w.back(h.current);
      if (a.kind === 'pop') h.back(); else h.replace(a.search);
      w.onLocation(h.current);
    };
    go(webSearch({ c: 'own/somtor-oracle', f: null }));
    go(webSearch({ c: 'own/somtor-oracle', f: 'doc-1' }));
    expect(parseWebUrl(h.current)).toEqual({ c: 'own/somtor-oracle', f: 'doc-1' });
    back();
    expect(parseWebUrl(h.current)).toEqual({ c: 'own/somtor-oracle', f: null });
    back();
    expect(parseWebUrl(h.current)).toEqual({ c: null, f: null });
    expect(h.idx).toBe(0); // popped, never left the page
  });

  it('a shared deep link never navigates out: Back replaces with the parent', () => {
    const h = new StubHistory(webSearch({ c: 'own/a', f: 'x' }));
    const w = new WebHistory();
    w.onLocation(h.current);
    const a = w.back(h.current);
    expect(a).toEqual({ kind: 'replace', search: webSearch({ c: 'own/a', f: null }) });
  });

  it('browser back (popstate) keeps the stack in sync', () => {
    const h = new StubHistory('');
    const w = new WebHistory();
    w.onLocation(h.current);
    w.push(h.current, '?c=own%2Fa'); h.push('?c=own%2Fa'); w.onLocation(h.current);
    w.push(h.current, '?c=own%2Fa&f=x'); h.push('?c=own%2Fa&f=x'); w.onLocation(h.current);
    h.back(); w.onLocation(h.current); // swipe-back
    expect(w.back(h.current)).toEqual({ kind: 'pop' });
  });
});
