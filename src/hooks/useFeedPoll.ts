// One /api/feed poller for the whole Pulse page (constellation + stream list).
//
// Mount: full fetch. Then every `intervalMs` while the tab is visible:
// `since=` incremental, dedupe-merged by lib/constellation/poll-state. Hidden:
// stop the timer and abort the in-flight request. Visible again: poll at once
// (the batch replays as 'catchup'). Errors back off 10 → 20 → 40 → 60 s.
// Freeze stops applying new data to the snapshot; polling (and the live dot)
// keep going, and the held-back batch is applied on unfreeze.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFeed } from '../api/oracle';
import type { FeedEvent } from '../api/oracle';
import type { ParsedMsg, ParseStats } from '../lib/constellation/parse';
import { dedupeKey, newParseStats } from '../lib/constellation/parse';
import {
  FEED_LIMIT, POLL_MS, heldMsgs, mergeFeed, newFeedStore, nextDelay, oldestHeld, sinceParam,
} from '../lib/constellation/poll-state';

/** raw events kept for the stream list (all event types, newest first) */
const RAW_MAX = 300;

export type BatchMode = 'first' | 'live' | 'catchup';

export interface FeedBatch {
  seq: number;
  /** only messages new to the store — the ones that may pulse */
  added: ParsedMsg[];
  mode: BatchMode;
}

export interface FeedSnapshot {
  /** held parsed messages, newest first */
  msgs: ParsedMsg[];
  /** raw events for the stream list, newest first */
  raw: FeedEvent[];
  stats: ParseStats;
  bufferFull: boolean;
  gap: boolean;
  oldestHeld: number | null;
  total: number;
  activeOracles: string[];
  batch: FeedBatch | null;
}

export interface FeedNet {
  lastOkAt: number | null;
  lastErr: boolean;
  /** when the next poll is due (epoch ms) */
  nextAt: number | null;
}

export interface FeedPoll extends FeedSnapshot, FeedNet {
  hidden: boolean;
  frozen: boolean;
  setFrozen: (f: boolean) => void;
}

const EMPTY: FeedSnapshot = {
  msgs: [], raw: [], stats: newParseStats(), bufferFull: false, gap: false, oldestHeld: null, total: 0, activeOracles: [], batch: null,
};

export function useFeedPoll({ intervalMs = POLL_MS }: { intervalMs?: number } = {}): FeedPoll {
  const storeRef = useRef(newFeedStore());
  const rawRef = useRef(new Map<string, FeedEvent>());
  const metaRef = useRef({ total: 0, activeOracles: [] as string[] });
  const seqRef = useRef(0);
  const frozenRef = useRef(false);
  const heldBackRef = useRef<ParsedMsg[]>([]);
  const [snap, setSnap] = useState<FeedSnapshot>(EMPTY);
  const [net, setNet] = useState<FeedNet>({ lastOkAt: null, lastErr: false, nextAt: null });
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [frozen, setFrozenState] = useState(false);

  const publish = useCallback((added: ParsedMsg[], mode: BatchMode) => {
    if (frozenRef.current) {
      heldBackRef.current.push(...added);
      return;
    }
    const st = storeRef.current;
    const raw = [...rawRef.current.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    setSnap({
      msgs: heldMsgs(st),
      raw,
      stats: { ...st.stats },
      bufferFull: st.bufferFull,
      gap: st.gap,
      oldestHeld: oldestHeld(st),
      total: metaRef.current.total,
      activeOracles: metaRef.current.activeOracles,
      batch: { seq: ++seqRef.current, added, mode },
    });
  }, []);

  const setFrozen = useCallback((f: boolean) => {
    frozenRef.current = f;
    setFrozenState(f);
    if (!f) {
      const added = heldBackRef.current;
      heldBackRef.current = [];
      publish(added, 'catchup');
    }
  }, [publish]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ac: AbortController | null = null;
    let failures = 0;
    let first = true;
    let catchUp = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void poll(false); }, ms);
      return Date.now() + ms;
    };

    const keepRaw = (events: readonly FeedEvent[]) => {
      const raw = rawRef.current;
      for (const e of events) raw.set(dedupeKey(e), e);
      if (raw.size > RAW_MAX) {
        const old = [...raw.entries()].sort((a, b) => Date.parse(a[1].timestamp) - Date.parse(b[1].timestamp)).slice(0, raw.size - RAW_MAX);
        for (const [k] of old) raw.delete(k);
      }
    };

    async function poll(forceFull: boolean): Promise<void> {
      if (!alive || document.hidden) return;
      clearTimeout(timer);
      ac?.abort();
      const ctl = new AbortController();
      ac = ctl;
      const st = storeRef.current;
      const since = sinceParam(st);
      const full = forceFull || first || !since;
      try {
        const res = await getFeed(full ? { limit: FEED_LIMIT, signal: ctl.signal } : { limit: FEED_LIMIT, since, signal: ctl.signal });
        if (!alive || ctl.signal.aborted) return;
        const now = Date.now();
        const r = mergeFeed(st, res.events ?? [], { full, now });
        keepRaw(res.events ?? []);
        metaRef.current = { total: res.total ?? 0, activeOracles: res.active_oracles ?? [] };
        failures = 0;
        const mode: BatchMode = first ? 'first' : catchUp ? 'catchup' : 'live';
        first = false;
        catchUp = false;
        publish(r.added, mode);
        if (r.refetchFull) { void poll(true); return; }
        const nextAt = schedule(intervalMs);
        setNet({ lastOkAt: now, lastErr: false, nextAt });
      } catch {
        if (!alive || ctl.signal.aborted) return;
        failures++;
        const nextAt = schedule(nextDelay(failures));
        setNet(n => ({ ...n, lastErr: true, nextAt }));
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        ac?.abort();
        catchUp = true;
        setHidden(true);
      } else {
        setHidden(false);
        void poll(false);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void poll(true);
    return () => {
      alive = false;
      clearTimeout(timer);
      ac?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, publish]);

  return { ...snap, ...net, hidden, frozen, setFrozen };
}
