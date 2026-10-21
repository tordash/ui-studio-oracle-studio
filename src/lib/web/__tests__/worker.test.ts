import { describe, it, expect, beforeEach } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encodeForWorker } from '../encode';
import { interEdges } from '../inter';
import { intraEdges } from '../intra';
import { createCoreState, handleWebRequest, computeCore } from '../worker-core';
import { createWebCompute } from '../client';
import type { WorkerLike } from '../client';
import { Lru, memoCore, persistedKey, sessionKey, __resetWebCache, INTRA_LRU_SIZE } from '../cache';
import { ALGO_V1 } from '../protocol';
import type { CoreResult, WebRequest } from '../protocol';
import { webFixture } from './fixtures/synth';

const docs = webFixture();

describe('worker dispatcher (pure, no real Worker)', () => {
  it('init → core → intra call the pure functions', () => {
    const st = createCoreState();
    const enc = encodeForWorker(docs);
    expect(handleWebRequest(st, { id: 1, kind: 'core' }).res).toEqual({ id: 1, ok: false, error: 'not initialised' });
    expect(handleWebRequest(st, { id: 2, kind: 'init', enc }).res).toEqual({ id: 2, ok: true, kind: 'init' });
    const core = handleWebRequest(st, { id: 3, kind: 'core' }).res;
    expect(core.ok).toBe(true);
    if (core.ok && core.kind === 'core') {
      expect(core.result.algo).toBe(ALGO_V1);
      expect(core.result.inter).toEqual(interEdges(enc));
      expect(core.result.centres).toHaveLength(enc.clusterKeys.length * 3);
      expect(core.result.palette).toHaveLength(enc.clusterKeys.length);
      expect(JSON.parse(JSON.stringify(core.result.inter))).toEqual(core.result.inter); // persistable
    }
    const c = enc.clusterKeys.indexOf('own/somtor-oracle');
    const { res, transfer } = handleWebRequest(st, { id: 4, kind: 'intra', cluster: c });
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === 'intra') {
      const want = intraEdges(enc, c);
      expect([...res.result.edgeI]).toEqual([...want.edgeI]);
      expect(res.result.coverage).toBe(want.coverage);
    }
    expect(transfer).toHaveLength(7);
    expect(new Set(transfer).size).toBe(7); // no buffer listed twice (DataCloneError)
    expect(handleWebRequest(st, { id: 5, kind: 'intra', cluster: 999 }).res.ok).toBe(false);
  });

  it('the worker file is a thin dispatcher that never touches the DOM', () => {
    const src = readFileSync(join(import.meta.dir, '../../../workers/web.worker.ts'), 'utf8');
    expect(src).toContain('handleWebRequest');
    expect(src).not.toMatch(/document\.|window\./);
    const factory = readFileSync(join(import.meta.dir, '../../../workers/make-web-worker.ts'), 'utf8');
    expect(factory).toMatch(/new Worker\(new URL\('\.\/web\.worker\.ts', import\.meta\.url\), \{ type: 'module'/);
  });
});

/** In-process fake: replies on a later task, structured-clones like a real worker. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: WebRequest[] = [];
  private st = createCoreState();
  constructor(private failOn?: WebRequest['kind']) {}
  postMessage(message: unknown): void {
    const req = message as WebRequest;
    this.posted.push(req);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.failOn === req.kind) { this.onerror?.({} as ErrorEvent); return; }
      const { res } = handleWebRequest(this.st, structuredClone(req));
      this.onmessage?.({ data: structuredClone(res) } as MessageEvent);
    }, 0);
  }
  terminate() { this.terminated = true; }
}

describe('createWebCompute', () => {
  it('uses the worker: init with transferred buffers, then core and intra', async () => {
    const w = new FakeWorker();
    const wc = createWebCompute(docs, { makeWorker: () => w });
    expect(wc.mode).toBe('worker');
    const core = await wc.core();
    expect(core.inter.edges.length).toBeGreaterThan(0);
    const intra = await wc.intra(1);
    expect(intra.cluster).toBe(1);
    expect(w.posted.map(r => r.kind)).toEqual(['init', 'core', 'intra']);
    wc.dispose();
    expect(w.terminated).toBe(true);
  });

  it('caches intra per cluster (LRU of 4)', async () => {
    const w = new FakeWorker();
    const wc = createWebCompute(docs, { makeWorker: () => w });
    const a = wc.intra(0);
    expect(wc.intra(0)).toBe(a);
    await a;
    for (const c of [1, 2, 3, 4]) await wc.intra(c);
    expect(INTRA_LRU_SIZE).toBe(4);
    const n = w.posted.length;
    await wc.intra(0); // evicted → recomputed
    expect(w.posted.length).toBe(n + 1);
    wc.dispose();
  });

  it('falls back to the main thread when the worker errors, re-encoding the docs', async () => {
    const w = new FakeWorker('core');
    const wc = createWebCompute(docs, { makeWorker: () => w });
    const core = await wc.core();
    expect(wc.mode).toBe('main');
    expect(w.terminated).toBe(true);
    expect(core).toEqual({ ...computeCore(encodeForWorker(docs)), ms: core.ms });
  });

  it('transfers a copy of a pre-encoded input; the caller keeps its buffers', async () => {
    const enc = encodeForWorker(docs);
    const before = enc.conceptIds.slice();
    const posted: unknown[][] = [];
    const w = new FakeWorker();
    const orig = w.postMessage.bind(w);
    w.postMessage = (m: unknown, t?: unknown) => { posted.push(t as unknown[]); orig(m); };
    const wc = createWebCompute(docs, { makeWorker: () => w, encoded: enc });
    expect(posted[0]).toHaveLength(5);
    expect((posted[0] as ArrayBuffer[]).includes(enc.conceptIds.buffer as ArrayBuffer)).toBe(false);
    expect([...enc.conceptIds]).toEqual([...before]);
    expect((await wc.core()).inter).toEqual(interEdges(enc));
    wc.dispose();
  });

  it('computes on the main thread when no worker can be made', async () => {
    const wc = createWebCompute(docs, { makeWorker: () => null });
    expect(wc.mode).toBe('main');
    expect((await wc.intra(2)).cluster).toBe(2);
    await expect(wc.intra(42)).rejects.toThrow('unknown cluster 42');
  });

  it('main-thread fallback yields between requests (one per task, never all at once)', async () => {
    const queue: (() => void)[] = [];
    const wc = createWebCompute(docs, { makeWorker: () => null, schedule: fn => { queue.push(fn); } });
    const a = wc.core();
    const b = wc.intra(0);
    expect(queue).toHaveLength(2);
    queue.shift()!();
    await a;
    let bDone = false;
    void b.then(() => { bDone = true; });
    await Promise.resolve();
    expect(bDone).toBe(false); // second request still waiting for its own task
    queue.shift()!();
    expect((await b).cluster).toBe(0);
  });

  it('dispose resolves pending requests as errors', async () => {
    const wc = createWebCompute(docs, { makeWorker: () => new FakeWorker() });
    const p = wc.core();
    wc.dispose();
    await expect(p).rejects.toThrow('disposed');
  });
});

describe('cache', () => {
  beforeEach(() => __resetWebCache());

  it('keys carry computed_at, N and the algorithm version', () => {
    expect(sessionKey('2026-10-20T16:38:57Z', 13089)).toBe(`2026-10-20T16:38:57Z|13089|${ALGO_V1}`);
    expect(persistedKey('2026-10-20T16:38:57Z', 13089)).toBe(`web:inter:2026-10-20T16:38:57Z:13089:${ALGO_V1}`);
  });

  it('Lru evicts the least recently used', () => {
    const l = new Lru<number, string>(2);
    l.set(1, 'a'); l.set(2, 'b');
    l.get(1);
    l.set(3, 'c');
    expect(l.keys()).toEqual([1, 3]);
    expect(l.peek(2)).toBeUndefined();
    expect(l.delete(1)).toBe(true);
    expect(l.size).toBe(1);
  });

  const fake = (algo = ALGO_V1): CoreResult => ({ algo, inter: { edges: [], degree: [], orphans: [], weak: {} }, centres: [], radii: [], palette: [], ms: 1 });

  it('memoises per session and persists through the injected store', async () => {
    let computes = 0, persists = 0;
    const compute = async () => { computes++; return fake(); };
    const store = new Map<string, unknown>();
    const persist = async <T,>(key: string, _ttl: number, f: () => Promise<T>): Promise<T> => {
      persists++;
      if (store.has(key)) return store.get(key) as T;
      const v = await f(); store.set(key, v); return v;
    };
    await memoCore('t1', 10, compute, persist);
    await memoCore('t1', 10, compute, persist);
    expect(computes).toBe(1);
    expect(persists).toBe(1);
    __resetWebCache();
    await memoCore('t1', 10, compute, persist); // new session: persisted copy, no recompute
    expect(computes).toBe(1);
    expect(store.has(persistedKey('t1', 10))).toBe(true);
  });

  it('ignores a persisted copy from another algorithm version; skips persistence without computed_at', async () => {
    let computes = 0;
    const compute = async () => { computes++; return fake(); };
    await memoCore('t2', 10, compute, async <T,>() => fake('web-v0') as T);
    expect(computes).toBe(1);
    let persisted = false;
    await memoCore(undefined, 11, compute, async <T,>(_k: string, _t: number, f: () => Promise<T>) => { persisted = true; return f(); });
    expect(persisted).toBe(false);
  });

  it('a failed compute is not memoised', async () => {
    let n = 0;
    await expect(memoCore('t3', 1, async () => { n++; throw new Error('x'); })).rejects.toThrow('x');
    await memoCore('t3', 1, async () => { n++; return fake(); });
    expect(n).toBe(2);
  });
});
