// Fleet Constellation — pulse scheduling (pure).
//
// A poll returns a burst, not a stream. New messages replay staggered by
// their real relative timestamps, compressed so the whole burst fits in
// COMPRESS_S (first load: the last ≤ 10 over FIRST_REPLAY_S). Same-edge fires
// keep a MIN_EDGE_GAP_S gap; the window reserves room for those gaps so the
// burst still ends within the budget. Caps: PER_EDGE_CAP per edge (oldest
// dropped), GLOBAL_CAP per batch (newest kept). Messages past the caps still
// count toward width and heat — they just don't animate.
//
// Times are in the shader clock `uTime` (seconds), which starts at
// UTIME_START so a signed fire time (+ a→b, − b→a) is never ambiguous.

import type { ParsedMsg } from './parse';
import { pairKey } from './aggregate';

export const UTIME_START = 1000;
export const COMPRESS_S = 8;
export const FIRST_REPLAY_S = 4;
export const FIRST_REPLAY_MAX = 10;
export const MIN_EDGE_GAP_S = 0.12;
export const PER_EDGE_CAP = 4;
export const GLOBAL_CAP = 48;
export const CATCHUP_MAX_AGE_MS = 15_000;

export interface Fire {
  /** pairKey(a, b) */
  edge: string;
  /** uTime seconds */
  at: number;
  /** +1 = a→b, −1 = b→a (a < b) */
  dir: 1 | -1;
  from: string;
  to: string;
  msgKey: string;
}

export interface ScheduleInput {
  /** only the messages that are new since the last poll */
  msgs: readonly ParsedMsg[];
  /** uTime of the first fire */
  startS: number;
  /** wall clock, for the catch-up age test */
  nowMs: number;
  /** live poll · first load (intro replay) · first poll after the tab was hidden */
  mode: 'live' | 'first' | 'catchup';
  reducedMotion: boolean;
}

export interface ScheduleResult {
  fires: Fire[];
  /** nodes touched by catch-up messages too old to animate: one soft flash each */
  catchUpFlash: Set<string>;
  /** reduced motion: nodes that get a static "new" ring until the next poll */
  newRing: Set<string>;
}

const nodesOf = (msgs: readonly ParsedMsg[]) => {
  const s = new Set<string>();
  for (const m of msgs) { s.add(m.from); s.add(m.to); }
  return s;
};

export function schedulePulses({ msgs, startS, nowMs, mode, reducedMotion }: ScheduleInput): ScheduleResult {
  const catchUpFlash = new Set<string>();
  let list = [...msgs].filter(m => m.from !== m.to).sort((p, q) => p.t - q.t);

  if (mode === 'first') list = list.slice(-FIRST_REPLAY_MAX);
  if (reducedMotion) return { fires: [], catchUpFlash, newRing: nodesOf(list) };
  if (mode === 'catchup') {
    const old = list.filter(m => nowMs - m.t >= CATCHUP_MAX_AGE_MS);
    for (const n of nodesOf(old)) catchUpFlash.add(n);
    list = list.filter(m => nowMs - m.t < CATCHUP_MAX_AGE_MS);
  }

  // caps: newest PER_EDGE_CAP per edge, then newest GLOBAL_CAP overall
  const perEdge = new Map<string, number>();
  const kept: ParsedMsg[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = pairKey(list[i].from, list[i].to);
    const n = perEdge.get(e) ?? 0;
    if (n >= PER_EDGE_CAP) continue;
    perEdge.set(e, n + 1);
    kept.push(list[i]);
    if (kept.length >= GLOBAL_CAP) break;
  }
  kept.reverse();
  if (kept.length === 0) return { fires: [], catchUpFlash, newRing: new Set() };

  const budget = (mode === 'first' ? FIRST_REPLAY_S : COMPRESS_S) - MIN_EDGE_GAP_S * (PER_EDGE_CAP - 1);
  const t0 = kept[0].t;
  const spanS = (kept[kept.length - 1].t - t0) / 1000;
  const scale = spanS > budget ? budget / spanS : 1;

  const lastAt = new Map<string, number>();
  const fires: Fire[] = kept.map(m => {
    const edge = pairKey(m.from, m.to);
    let at = startS + ((m.t - t0) / 1000) * scale;
    const prev = lastAt.get(edge);
    if (prev !== undefined && at < prev + MIN_EDGE_GAP_S) at = prev + MIN_EDGE_GAP_S;
    lastAt.set(edge, at);
    return { edge, at, dir: m.from < m.to ? 1 : -1, from: m.from, to: m.to, msgKey: m.key };
  });
  fires.sort((p, q) => p.at - q.at);
  return { fires, catchUpFlash, newRing: new Set() };
}

/** Per-edge ring of the PER_EDGE_CAP most recent signed fire times (0 = empty). */
export interface FireRing { times: number[]; next: number }

export const newFireRing = (): FireRing => ({ times: new Array(PER_EDGE_CAP).fill(0), next: 0 });

/** Overwrites the oldest slot. */
export function pushFire(ring: FireRing, at: number, dir: 1 | -1) {
  ring.times[ring.next] = dir * at;
  ring.next = (ring.next + 1) % PER_EDGE_CAP;
}

/** The ribbon's `aFire` vec4. */
export const packFire = (ring: FireRing): number[] => ring.times.slice(0, 4);
