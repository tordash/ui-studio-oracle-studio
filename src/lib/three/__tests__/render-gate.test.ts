import { describe, it, expect, afterEach } from 'bun:test';
import { bindRenderGate } from '../render-gate';

const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, IntersectionObserver: g.IntersectionObserver };
const had = { document: 'document' in g, IntersectionObserver: 'IntersectionObserver' in g };

type Entry = { isIntersecting: boolean };

function setup(withIO: boolean) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (t: string, f: () => void) => { if (t === 'visibilitychange') listeners.add(f); },
    removeEventListener: (t: string, f: () => void) => { if (t === 'visibilitychange') listeners.delete(f); },
  };
  g.document = doc;
  const ios: { cb: (e: Entry[]) => void; observed: unknown[]; disconnected: boolean }[] = [];
  if (withIO) {
    g.IntersectionObserver = class {
      rec: (typeof ios)[number];
      constructor(cb: (e: Entry[]) => void) { this.rec = { cb, observed: [], disconnected: false }; ios.push(this.rec); }
      observe(el: unknown) { this.rec.observed.push(el); }
      disconnect() { this.rec.disconnected = true; }
    };
  } else {
    delete g.IntersectionObserver;
  }
  const fireVisibility = (hidden: boolean) => { doc.hidden = hidden; for (const f of listeners) f(); };
  return { listeners, ios, fireVisibility };
}

afterEach(() => {
  for (const k of ['document', 'IntersectionObserver'] as const) {
    if (had[k]) g[k] = saved[k];
    else delete g[k];
  }
});

describe('bindRenderGate', () => {
  it('reports tab visibility as !document.hidden', () => {
    const { fireVisibility } = setup(true);
    const seen: boolean[] = [];
    bindRenderGate({} as Element, { onVisibility: v => seen.push(v), onScreen: () => {} });
    fireVisibility(true);
    fireVisibility(false);
    expect(seen).toEqual([false, true]);
  });

  it('observes the host and uses the last IO entry', () => {
    const { ios } = setup(true);
    const host = {} as Element;
    const seen: boolean[] = [];
    bindRenderGate(host, { onVisibility: () => {}, onScreen: s => seen.push(s) });
    expect(ios).toHaveLength(1);
    expect(ios[0].observed).toEqual([host]);
    ios[0].cb([{ isIntersecting: true }, { isIntersecting: false }]);
    ios[0].cb([{ isIntersecting: false }, { isIntersecting: true }]);
    ios[0].cb([]);
    expect(seen).toEqual([false, true, false]);
  });

  it('without IntersectionObserver never reports offscreen', () => {
    setup(false);
    const seen: boolean[] = [];
    expect(() => bindRenderGate({} as Element, { onVisibility: () => {}, onScreen: s => seen.push(s) })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('the disposer removes the listener and disconnects the observer', () => {
    const { listeners, ios, fireVisibility } = setup(true);
    const seen: boolean[] = [];
    const off = bindRenderGate({} as Element, { onVisibility: v => seen.push(v), onScreen: () => {} });
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
    expect(ios[0].disconnected).toBe(true);
    fireVisibility(true);
    expect(seen).toEqual([]);
  });
});
