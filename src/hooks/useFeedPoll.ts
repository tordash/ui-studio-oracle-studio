// One /api/feed poller for the whole Pulse page (constellation + stream list).
//
// Mount: full fetch. Then every `intervalMs` while the tab is visible:
// `since=` incremental, dedupe-merged by lib/constellation/poll-state. Hidden:
// stop the timer and abort the in-flight request. Visible again: poll at once
// (the batch replays as 'catchup'). Errors back off 10 → 20 → 40 → 60 s.
// Freeze stops applying new data to the snapshot; polling (and the live dot)
// keep going, and the held-back batch is applied on unfreeze.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getFeed } from '../api/oracle';
import type { FeedEvent } from '../api/oracle';
import type { ParsedMsg, ParseStats } from '../lib/constellation/parse';
import { dedupeKey, newParseStats } from '../lib/constellation/parse';
import {
  FEED_LIMIT, FETCH_TIMEOUT_MS, POLL_MS, failureKind, heldMsgs, mergeFeed, mergeMeta, newFeedStore, nextDelay, oldestHeld, sinceParam,
} from '../lib/constellation/poll-state';
import type { FeedMeta } from '../lib/constellation/poll-state';

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
  const metaRef = useRef<FeedMeta>({ total: 0, activeOracles: [] });
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

    /** Returns the events that were new to the list. */
    const keepRaw = (events: readonly FeedEvent[]): FeedEvent[] => {
      const raw = rawRef.current;
      const fresh: FeedEvent[] = [];
      for (const e of events) {
        const k = dedupeKey(e);
        if (!raw.has(k)) fresh.push(e);
        raw.set(k, e);
      }
      if (raw.size > RAW_MAX) {
        const old = [...raw.entries()].sort((a, b) => Date.parse(a[1].timestamp) - Date.parse(b[1].timestamp)).slice(0, raw.size - RAW_MAX);
        for (const [k] of old) raw.delete(k);
      }
      return fresh;
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
      // a hung request must not stop polling: abort it and count it as a failure
      let timedOut = false;
      const watchdog = setTimeout(() => { timedOut = true; ctl.abort(); }, FETCH_TIMEOUT_MS);
      try {
        const res = await getFeed(full ? { limit: FEED_LIMIT, signal: ctl.signal } : { limit: FEED_LIMIT, since, signal: ctl.signal });
        if (!alive || ctl.signal.aborted) return;
        const now = Date.now();
        const r = mergeFeed(st, res.events ?? [], { full, now });
        const fresh = keepRaw(res.events ?? []);
        // since-polls: the server's total / active_oracles cover the delta only
        metaRef.current = mergeMeta(metaRef.current, res, full, fresh);
        failures = 0;
        const mode: BatchMode = first ? 'first' : catchUp ? 'catchup' : 'live';
        first = false;
        catchUp = false;
        publish(r.added, mode);
        if (r.refetchFull) { void poll(true); return; }
        const nextAt = schedule(intervalMs);
        setNet({ lastOkAt: now, lastErr: false, nextAt });
      } catch (e) {
        if (failureKind({ alive, aborted: ctl.signal.aborted, timedOut }) === 'ignore') return;
        // network errors are TypeError, HTTP errors ApiError: anything else is a bug, not an outage
        if (!timedOut && !(e instanceof ApiError) && !(e instanceof TypeError)) console.error('useFeedPoll: poll failed', e);
        failures++;
        const nextAt = schedule(nextDelay(failures));
        setNet(n => ({ ...n, lastErr: true, nextAt }));
      } finally {
        clearTimeout(watchdog);
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
