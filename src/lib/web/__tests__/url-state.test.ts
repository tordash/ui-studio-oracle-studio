import { describe, it, expect } from 'bun:test';
import { parseWebUrl, webSearch, webUrl, resolveWebState, parentState, WebHistory, UNSORTED_PARAM } from '../url-state';
import { UNSORTED_KEY } from '../keys';
import { webSheets } from '../sheets';

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

describe('file sheet follows the URL on every location change (T21 back test)', () => {
  const C = 'own/marketing-agency-team';
  const F = 'learning_../Projects/marketing-agency-team/brain/Episodic/2026-03-05-content-series-research-journal_0';
  const keys = ['∅', C, 'own/tor-oracle'];
  const ids: Record<string, number> = { [F]: 7 };
  const clusterOfStar = (i: number) => (i === 7 ? 1 : 0);
  /** what KnowledgeWeb derives from `location.search` on each render */
  const derive = (search: string, ui = { wide: false, listOpen: false, peekSnap: 'peek' as const }) => {
    const st = resolveWebState(parseWebUrl(search), keys, id => ids[id] ?? -1, clusterOfStar);
    // drilled → the cluster's card exists (hasPeek); a file open hides it
    return { st, sheets: webSheets({ openStar: st.star, hasPeek: st.cluster >= 0, ...ui }) };
  };

  it('raw pushState(&f=) + popstate opens the file; browser back closes it, the card returns as a non-dialog region', () => {
    const h = new StubHistory(webSearch({ c: C, f: null }));
    const w = new WebHistory();
    w.onLocation(h.current);
    expect(derive(h.current).sheets).toEqual({ doc: false, peekPanel: false, peekSheet: true, peekRole: 'region' });

    // the T21 harness: history.pushState(…&f=…) bypassing go(), then a popstate
    h.push(webSearch({ c: C, f: F }));
    w.onLocation(h.current);
    const open = derive(h.current);
    expect(open.st).toEqual({ cluster: 1, star: 7 });
    expect(open.sheets.doc).toBe(true);
    expect(open.sheets.peekSheet).toBe(false);

    // page.goBack(): popstate to ?c=
    h.back();
    w.onLocation(h.current);
    const back = derive(h.current);
    expect(parseWebUrl(h.current)).toEqual({ c: C, f: null });
    expect(back.st.star).toBe(-1);
    expect(back.sheets.doc).toBe(false);
    expect(back.sheets.peekSheet).toBe(true);
    expect(back.sheets.peekRole).toBe('region'); // no role="dialog" left on screen
  });

  it('the in-app Back on an entry the page did not push replaces with the parent (never navigates out), same result', () => {
    const h = new StubHistory(webSearch({ c: C, f: null }));
    const w = new WebHistory();
    w.onLocation(h.current);
    h.push(webSearch({ c: C, f: F })); w.onLocation(h.current); // raw push, not go()
    const a = w.back(h.current);
    expect(a).toEqual({ kind: 'replace', search: webSearch({ c: C, f: null }) }); // unknown entry → replace with the parent
    h.replace(a.kind === 'replace' ? a.search : h.current); w.onLocation(h.current);
    expect(derive(h.current).sheets.doc).toBe(false);
  });

  it('desktop: the card is the side panel; a full phone card is the only modal case', () => {
    expect(webSheets({ openStar: -1, hasPeek: true, wide: true, listOpen: false, peekSnap: 'peek' })).toMatchObject({ peekPanel: true, peekSheet: false });
    expect(webSheets({ openStar: -1, hasPeek: true, wide: false, listOpen: false, peekSnap: 'full' }).peekRole).toBe('dialog');
    expect(webSheets({ openStar: -1, hasPeek: true, wide: false, listOpen: true, peekSnap: 'peek' }).peekSheet).toBe(false);
    expect(webSheets({ openStar: 3, hasPeek: true, wide: true, listOpen: false, peekSnap: 'peek' })).toMatchObject({ doc: true, peekPanel: false });
  });
});
