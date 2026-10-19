import { describe, it, expect } from 'bun:test';
import type { FeedEvent } from '../../../api/oracle';
import {
  liveState, nextDelay, newFeedStore, mergeFeed, sinceParam, oldestHeld, heldMsgs, liveLabel,
  POLL_MS, LIVE_MS, STALE_MS, FEED_LIMIT, PRUNE_AGE_MS, PRUNE_MAX,
} from '../poll-state';

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);
const S = 1000;

// Synthetic fixtures only.
const ev = (sAgo: number, i: number, o: Partial<FeedEvent> = {}): FeedEvent => ({
  timestamp: new Date(NOW - sAgo * S).toISOString(),
  oracle: 'helm', host: 'mac-tor', event: 'MessageSend', project: '', session_id: '',
  message: `mac-tor:somtor: [mac-tor:helm] synthetic ${i}`,
  ...o,
});
const batch = (n: number, startAgoS = 0) => Array.from({ length: n }, (_, i) => ev(startAgoS + i, i));

describe('liveState (fake clock)', () => {
  it('live < 15 s, stale 15–60 s, offline > 60 s', () => {
    expect(LIVE_MS).toBe(15_000);
    expect(STALE_MS).toBe(60_000);
    expect(liveState(NOW, NOW - 14_999, false, false)).toBe('live');
    expect(liveState(NOW, NOW - 15_000, false, false)).toBe('stale');
    expect(liveState(NOW, NOW - 60_000, false, false)).toBe('stale');
    expect(liveState(NOW, NOW - 60_001, false, false)).toBe('offline');
  });

  it('the last attempt errored → offline, even right after a success', () => {
    expect(liveState(NOW, NOW - 1000, true, false)).toBe('offline');
  });

  it('hidden → paused, whatever the rest says', () => {
    expect(liveState(NOW, NOW - 1000, false, true)).toBe('paused');
    expect(liveState(NOW, null, true, true)).toBe('paused');
  });

  it('no success yet and no error → stale (connecting), never live', () => {
    expect(liveState(NOW, null, false, false)).toBe('stale');
  });

  it('liveLabel', () => {
    expect(liveLabel('live', NOW, NOW - 4000, 0)).toBe('live · polled 4 s ago');
    expect(liveLabel('stale', NOW, NOW - 23_000, 0)).toBe('polled 23 s ago');
    expect(liveLabel('stale', NOW, null, 0)).toBe('connecting…');
    expect(liveLabel('offline', NOW, NOW - 90_000, 40_000)).toBe('offline · retry in 40 s');
    expect(liveLabel('paused', NOW, NOW - 1000, 0)).toBe('paused');
  });
});

describe('nextDelay (backoff)', () => {
  it('10 → 20 → 40 → 60 s cap; success (0 failures) resets to the 10 s cadence', () => {
    expect(POLL_MS).toBe(10_000);
    expect([0, 1, 2, 3, 4, 5, 9].map(nextDelay)).toEqual([10_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });
});

describe('mergeFeed', () => {
  it('full fetch: parses, holds, reports every message as added, and flags a full buffer', () => {
    const st = newFeedStore();
    const r = mergeFeed(st, batch(FEED_LIMIT), { full: true, now: NOW });
    expect(r.added).toHaveLength(FEED_LIMIT);
    expect(r.refetchFull).toBe(false);
    expect(st.bufferFull).toBe(true);
    expect(heldMsgs(st)).toHaveLength(FEED_LIMIT);
    const r2 = mergeFeed(newFeedStore(), batch(7), { full: true, now: NOW });
    expect(r2.added).toHaveLength(7);
  });

  it('a short full fetch clears bufferFull', () => {
    const st = newFeedStore();
    mergeFeed(st, batch(FEED_LIMIT), { full: true, now: NOW });
    mergeFeed(st, batch(3), { full: true, now: NOW });
    expect(st.bufferFull).toBe(false);
  });

  it('dedupe-merge: a re-sent boundary event is not added again (no re-fired pulse)', () => {
    const st = newFeedStore();
    mergeFeed(st, [ev(5, 1), ev(9, 2)], { full: true, now: NOW });
    const r = mergeFeed(st, [ev(0, 3), ev(5, 1)], { full: false, now: NOW });
    expect(r.added.map(m => m.body)).toEqual(['synthetic 3']);
    expect(heldMsgs(st)).toHaveLength(3);
    const again = mergeFeed(st, [ev(0, 3)], { full: false, now: NOW });
    expect(again.added).toHaveLength(0);
  });

  it('parse stats count each raw event once, even when re-sent', () => {
    const st = newFeedStore();
    const bad = ev(3, 0, { message: 'synthetic no prefix' });
    mergeFeed(st, [bad], { full: true, now: NOW });
    mergeFeed(st, [bad], { full: false, now: NOW });
    expect(st.stats.malformed).toBe(1);
  });

  it('an incremental response of exactly 100 → refetchFull + gap', () => {
    const st = newFeedStore();
    mergeFeed(st, batch(10, 500), { full: true, now: NOW });
    const r = mergeFeed(st, batch(FEED_LIMIT), { full: false, now: NOW });
    expect(r.refetchFull).toBe(true);
    expect(st.gap).toBe(true);
    const short = mergeFeed(st, batch(3), { full: false, now: NOW });
    expect(short.refetchFull).toBe(false);
    // sticky: the hole stays in the held data, even after the full refetch it triggers
    expect(st.gap).toBe(true);
    mergeFeed(st, batch(FEED_LIMIT), { full: true, now: NOW });
    expect(st.gap).toBe(true);
  });

  it('prunes messages older than 24 h', () => {
    expect(PRUNE_AGE_MS).toBe(24 * 3600 * 1000);
    const st = newFeedStore();
    mergeFeed(st, [ev(10, 1), ev(25 * 3600, 2)], { full: true, now: NOW });
    expect(heldMsgs(st).map(m => m.body)).toEqual(['synthetic 1']);
  });

  it('prunes to the newest 3,000 messages', () => {
    expect(PRUNE_MAX).toBe(3000);
    const st = newFeedStore();
    for (let k = 0; k < 31; k++) mergeFeed(st, batch(100, k * 100).map((e, i) => ({ ...e, message: `${e.message}-${k}-${i}` })), { full: false, now: NOW });
    const held = heldMsgs(st);
    expect(held).toHaveLength(PRUNE_MAX);
    // the 100 oldest (k = 30) are gone
    expect(Math.min(...held.map(m => m.t))).toBe(NOW - 2999 * S);
  });

  it('since = newest held timestamp; oldestHeld = oldest', () => {
    const st = newFeedStore();
    expect(sinceParam(st)).toBeUndefined();
    expect(oldestHeld(st)).toBeNull();
    mergeFeed(st, [ev(30, 1), ev(2, 2), ev(90, 3)], { full: true, now: NOW });
    expect(sinceParam(st)).toBe(new Date(NOW - 2 * S).toISOString());
    expect(oldestHeld(st)).toBe(NOW - 90 * S);
  });

  it('heldMsgs is newest first', () => {
    const st = newFeedStore();
    mergeFeed(st, [ev(30, 1), ev(2, 2), ev(90, 3)], { full: true, now: NOW });
    expect(heldMsgs(st).map(m => m.body)).toEqual(['synthetic 2', 'synthetic 1', 'synthetic 3']);
  });
});
