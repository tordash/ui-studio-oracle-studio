// Knowledge Web — result caching.
//   session  : overview core memoised per `${computed_at}|${N}|ALGO_V1`; intra results in an LRU of 4
//   IDB      : the core (~30 KB) persisted for a day as `web:inter:<computed_at>:<N>:web-v1`, so a
//              second visit draws links without recomputing (shared `cached()` + idb store)
// The persist function is injected so this module stays testable without IndexedDB.

import { ALGO_V1 } from './protocol';
import type { CoreResult } from './protocol';

export const INTRA_LRU_SIZE = 4;
export const CORE_TTL_MS = 24 * 60 * 60 * 1000;

export function sessionKey(computedAt: string | null | undefined, n: number): string {
  return `${computedAt || 'unknown'}|${n}|${ALGO_V1}`;
}

export function persistedKey(computedAt: string | null | undefined, n: number): string {
  return `web:inter:${computedAt || 'unknown'}:${n}:${ALGO_V1}`;
}

/** Tiny LRU (Map keeps insertion order; a hit re-inserts). */
export class Lru<K, V> {
  private map = new Map<K, V>();
  readonly limit: number;
  constructor(limit: number) { this.limit = Math.max(1, limit); }
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as K);
  }
  has(k: K): boolean { return this.map.has(k); }
  /** Read without refreshing recency. */
  peek(k: K): V | undefined { return this.map.get(k); }
  delete(k: K): boolean { return this.map.delete(k); }
  get size(): number { return this.map.size; }
  keys(): K[] { return [...this.map.keys()]; }
}

const sessionCore = new Map<string, Promise<CoreResult>>();

export type PersistFn = <T>(key: string, ttlMs: number, compute: () => Promise<T>) => Promise<T>;

/**
 * The overview core for this snapshot: session memo → persisted copy → compute.
 * A cached copy whose algo tag differs is ignored and recomputed.
 */
export function memoCore(
  computedAt: string | null | undefined,
  n: number,
  compute: () => Promise<CoreResult>,
  persist?: PersistFn,
): Promise<CoreResult> {
  const sk = sessionKey(computedAt, n);
  const hit = sessionCore.get(sk);
  if (hit) return hit;
  const p = (async () => {
    if (!persist || !computedAt) return compute();
    const got = await persist(persistedKey(computedAt, n), CORE_TTL_MS, compute);
    return got && got.algo === ALGO_V1 ? got : compute();
  })();
  sessionCore.set(sk, p);
  p.catch(() => { if (sessionCore.get(sk) === p) sessionCore.delete(sk); });
  return p;
}

/** Test-only. */
export function __resetWebCache(): void {
  sessionCore.clear();
}
