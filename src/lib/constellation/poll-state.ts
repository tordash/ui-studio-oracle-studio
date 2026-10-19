// Fleet Constellation — feed polling state (pure; the hook in hooks/useFeedPoll drives it).
//
// One poller for the whole Pulse page: full fetch on mount, then `since=`
// incremental every POLL_MS while the tab is visible. Raw events are deduped
// by key before parsing, so a re-sent boundary event neither re-counts a
// parse stat nor re-fires a pulse: `added` holds only messages new to the
// store. An incremental response at the server cap means events may have been
// dropped in between → one full refetch, and `gap` stays set for the session.
//
// The live dot reflects the last *successful* poll, not the data.

import type { FeedEvent } from '../../api/oracle';
import type { ParsedMsg, ParseStats } from './parse';
import { dedupeKey, newParseStats, parseFeedEvent } from './parse';

export const POLL_MS = 10_000;
export const LIVE_MS = 15_000;
export const STALE_MS = 60_000;
/** server ring cap for /api/feed */
export const FEED_LIMIT = 100;
export const PRUNE_AGE_MS = 24 * 3600 * 1000;
export const PRUNE_MAX = 3000;
const BACKOFF_MS = [10_000, 10_000, 20_000, 40_000, 60_000];

export type LiveState = 'live' | 'stale' | 'offline' | 'paused';

export function liveState(now: number, lastOkAt: number | null, lastErr: boolean, hidden: boolean): LiveState {
  if (hidden) return 'paused';
  if (lastErr) return 'offline';
  if (lastOkAt == null) return 'stale';
  const age = now - lastOkAt;
  if (age < LIVE_MS) return 'live';
  if (age <= STALE_MS) return 'stale';
  return 'offline';
}

export function liveLabel(state: LiveState, now: number, lastOkAt: number | null, retryInMs: number): string {
  const ago = lastOkAt == null ? null : `polled ${Math.max(0, Math.round((now - lastOkAt) / 1000))} s ago`;
  switch (state) {
    case 'paused': return 'paused';
    case 'offline': return `offline · retry in ${Math.max(0, Math.round(retryInMs / 1000))} s`;
    case 'live': return `live · ${ago}`;
    default: return ago ?? 'connecting…';
  }
}

/** Delay before the next poll after `failures` consecutive errors (0 = healthy cadence). */
export const nextDelay = (failures: number) => BACKOFF_MS[Math.min(Math.max(0, failures), BACKOFF_MS.length - 1)];

export interface FeedStore {
  /** parsed messages by dedupe key */
  msgs: Map<string, ParsedMsg>;
  /** every raw event key seen (parsed or not) → time, for dedupe */
  seen: Map<string, number>;
  /** first-seen casing per oracle key */
  labels: Map<string, string>;
  stats: ParseStats;
  /** the last full fetch came back at the server cap */
  bufferFull: boolean;
  /** events were possibly dropped between two polls (sticky) */
  gap: boolean;
}

export const newFeedStore = (): FeedStore => ({
  msgs: new Map(), seen: new Map(), labels: new Map(), stats: newParseStats(), bufferFull: false, gap: false,
});

export interface MergeResult {
  /** messages new to the store (only these may fire pulses) */
  added: ParsedMsg[];
  refetchFull: boolean;
}

/** Mutates `store`. */
export function mergeFeed(store: FeedStore, events: readonly FeedEvent[], { full, now }: { full: boolean; now: number }): MergeResult {
  const added: ParsedMsg[] = [];
  for (const e of events) {
    const k = dedupeKey(e);
    if (store.seen.has(k)) continue;
    const t = Date.parse(e.timestamp);
    store.seen.set(k, Number.isFinite(t) ? t : now);
    const m = parseFeedEvent(e, store.stats, store.labels);
    if (!m || m.t < now - PRUNE_AGE_MS) continue;
    store.msgs.set(m.key, m);
    added.push(m);
  }
  let refetchFull = false;
  if (full) store.bufferFull = events.length >= FEED_LIMIT;
  else if (events.length >= FEED_LIMIT) { refetchFull = true; store.gap = true; }
  prune(store, now);
  const kept = added.filter(m => store.msgs.has(m.key));
  return { added: kept, refetchFull };
}

function prune(store: FeedStore, now: number) {
  const cutoff = now - PRUNE_AGE_MS;
  for (const [k, m] of store.msgs) if (m.t < cutoff) store.msgs.delete(k);
  if (store.msgs.size > PRUNE_MAX) {
    const old = [...store.msgs.values()].sort((a, b) => a.t - b.t).slice(0, store.msgs.size - PRUNE_MAX);
    for (const m of old) store.msgs.delete(m.key);
  }
  for (const [k, t] of store.seen) if (t < cutoff) store.seen.delete(k);
  if (store.seen.size > PRUNE_MAX * 2) {
    const old = [...store.seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, store.seen.size - PRUNE_MAX * 2);
    for (const [k] of old) store.seen.delete(k);
  }
}

/** Newest held timestamp, as the server's `since=`. */
export function sinceParam(store: FeedStore): string | undefined {
  let best: ParsedMsg | undefined;
  for (const m of store.msgs.values()) if (!best || m.t > best.t) best = m;
  return best?.ts;
}

export function oldestHeld(store: FeedStore): number | null {
  let t: number | null = null;
  for (const m of store.msgs.values()) if (t == null || m.t < t) t = m.t;
  return t;
}

/** Newest first. */
export const heldMsgs = (store: FeedStore): ParsedMsg[] => [...store.msgs.values()].sort((a, b) => b.t - a.t);
