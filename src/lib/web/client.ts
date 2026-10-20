// Knowledge Web — main-thread side of the worker.
//
// Encodes the docs once, transfers the buffers to the worker and asks it for the
// overview core and per-cluster intra links. If the worker can't start or dies,
// the same pure handler runs on the main thread, one request per macrotask (the
// docs are re-encoded, because the first buffers were transferred away).
// Intra results are kept in a session LRU of 4 clusters.

import type { MapDocument } from '../../api/oracle';
import { encodeForWorker, transferables } from './encode';
import type { EncodedWeb } from './encode';
import type { IntraResult } from './intra';
import { createCoreState, handleWebRequest } from './worker-core';
import type { CoreResult, WebRequest, WebResponse } from './protocol';
import { INTRA_LRU_SIZE, Lru } from './cache';

/** The slice of `Worker` this client uses (lets tests pass a fake). */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface WebCompute {
  /** 'worker' while the worker is healthy; 'main' after a fallback */
  readonly mode: 'worker' | 'main';
  core(): Promise<CoreResult>;
  intra(cluster: number): Promise<IntraResult>;
  dispose(): void;
}

export interface WebComputeOptions {
  makeWorker?: () => WorkerLike | null;
  /** the page's own encoding of `docs`: a COPY is transferred, the caller keeps its buffers */
  encoded?: EncodedWeb;
  /** how main-thread work is deferred (default: setTimeout 0, i.e. one request per task) */
  schedule?: (fn: () => void) => void;
}

type Docs = readonly Pick<MapDocument, 'id' | 'project' | 'concepts' | 'x' | 'y' | 'z'>[];
type Pending = { req: WebRequest; resolve: (r: WebResponse) => void };

export function createWebCompute(docs: Docs, opts: WebComputeOptions = {}): WebCompute {
  const schedule = opts.schedule ?? ((fn: () => void) => { setTimeout(fn, 0); });
  let mode: 'worker' | 'main' = 'worker';
  let disposed = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const intraCache = new Lru<number, Promise<IntraResult>>(INTRA_LRU_SIZE);
  let mainState: ReturnType<typeof createCoreState> | null = null;

  const runMain = (p: Pending) => {
    schedule(() => {
      if (disposed) return;
      if (!mainState) {
        mainState = createCoreState();
        mainState.enc = opts.encoded ?? encodeForWorker(docs);
      }
      p.resolve(handleWebRequest(mainState, p.req).res);
    });
  };

  const fallBack = () => {
    if (mode === 'main') return;
    mode = 'main';
    try { worker?.terminate(); } catch { /* ignore */ }
    worker = null;
    const queued = [...pending.values()].filter(p => p.req.kind !== 'init');
    pending.clear();
    for (const p of queued) runMain(p);
  };

  let worker: WorkerLike | null = null;
  try { worker = opts.makeWorker?.() ?? null; } catch { worker = null; }
  if (worker) {
    worker.onmessage = (ev: MessageEvent) => {
      const res = ev.data as WebResponse;
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      p.resolve(res);
    };
    worker.onerror = () => fallBack();
    try {
      const enc = opts.encoded ? copyEncoded(opts.encoded) : encodeForWorker(docs);
      const req: WebRequest = { id: nextId++, kind: 'init', enc };
      pending.set(req.id, { req, resolve: () => {} });
      worker.postMessage(req, transferables(enc));
    } catch {
      fallBack();
    }
  } else {
    mode = 'main';
  }

  const send = (req: WebRequest): Promise<WebResponse> => new Promise(resolve => {
    if (disposed) { resolve({ id: req.id, ok: false, error: 'disposed' }); return; }
    const p: Pending = { req, resolve };
    if (mode === 'worker' && worker) {
      pending.set(req.id, p);
      try { worker.postMessage(req, []); } catch { fallBack(); }
    } else {
      runMain(p);
    }
  });

  return {
    get mode() { return mode; },
    async core() {
      const res = await send({ id: nextId++, kind: 'core' });
      if (!res.ok) throw new Error(res.error);
      if (res.kind !== 'core') throw new Error('unexpected reply');
      return res.result;
    },
    intra(cluster: number) {
      const hit = intraCache.get(cluster);
      if (hit) return hit;
      const p = send({ id: nextId++, kind: 'intra', cluster }).then(res => {
        if (!res.ok) throw new Error(res.error);
        if (res.kind !== 'intra') throw new Error('unexpected reply');
        return res.result;
      });
      intraCache.set(cluster, p);
      p.catch(() => { if (intraCache.peek(cluster) === p) intraCache.delete(cluster); });
      return p;
    },
    dispose() {
      disposed = true;
      try { worker?.terminate(); } catch { /* ignore */ }
      worker = null;
      for (const p of pending.values()) p.resolve({ id: p.req.id, ok: false, error: 'disposed' });
      pending.clear();
    },
  };
}

/** Fresh buffers with the same content (the copy is what gets transferred). */
export function copyEncoded(e: EncodedWeb): EncodedWeb {
  return {
    ...e,
    clusterOf: e.clusterOf.slice(),
    conceptOff: e.conceptOff.slice(),
    conceptIds: e.conceptIds.slice(),
    pos: e.pos.slice(),
    rank: e.rank.slice(),
  };
}
