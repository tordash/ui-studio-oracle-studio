import { describe, it, expect } from 'bun:test';
import type { ParsedMsg } from '../parse';
import {
  schedulePulses, newFireRing, pushFire, packFire, UTIME_START, COMPRESS_S, FIRST_REPLAY_S,
  FIRST_REPLAY_MAX, MIN_EDGE_GAP_S, PER_EDGE_CAP, GLOBAL_CAP, CATCHUP_MAX_AGE_MS,
} from '../schedule';
import { pairKey } from '../aggregate';

const T0 = Date.UTC(2026, 9, 18, 15, 0, 0);
let seq = 0;
// Synthetic fixtures only.
const msg = (from: string, to: string, tMs: number): ParsedMsg => ({
  key: `k${seq++}`, t: tMs, ts: new Date(tMs).toISOString(), from, to,
  fromLabel: from, toLabel: to, node: 'mac-tor', host: 'mac-tor', body: 'synthetic',
});
const START = UTIME_START + 50;
const live = (msgs: ParsedMsg[], nowMs = T0 + 60_000) =>
  schedulePulses({ msgs, startS: START, nowMs, mode: 'live', reducedMotion: false });

describe('constants', () => {
  it('match the design', () => {
    expect(UTIME_START).toBe(1000);
    expect(COMPRESS_S).toBe(8);
    expect(FIRST_REPLAY_S).toBe(4);
    expect(FIRST_REPLAY_MAX).toBe(10);
    expect(MIN_EDGE_GAP_S).toBeCloseTo(0.12, 9);
    expect(PER_EDGE_CAP).toBe(4);
    expect(GLOBAL_CAP).toBe(48);
    expect(CATCHUP_MAX_AGE_MS).toBe(15_000);
  });
});

describe('schedulePulses — live', () => {
  it('keeps order and real Δt when the burst is short (newest-first input is fine)', () => {
    const ms = [msg('helm', 'somtor', T0 + 3000), msg('ez', 'forge', T0 + 1000), msg('helm', 'dopelab', T0)];
    const r = live(ms);
    expect(r.fires.map(f => f.at - START)).toEqual([0, 1, 3].map(x => expect.closeTo(x, 9) as unknown as number));
    expect(r.fires.map(f => f.to)).toEqual(['dopelab', 'forge', 'somtor']);
  });

  it('compresses a long burst into ≤ 8 s, order preserved', () => {
    const ms = Array.from({ length: 20 }, (_, i) => msg(`s${i}`, `r${i}`, T0 + i * 30_000));
    const r = live(ms, T0 + 20 * 30_000);
    const offs = r.fires.map(f => f.at - START);
    expect(Math.max(...offs)).toBeLessThanOrEqual(COMPRESS_S + 1e-9);
    expect(offs[0]).toBe(0);
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThan(offs[i - 1]);
  });

  it('keeps a 120 ms minimum gap per edge, still ≤ 8 s', () => {
    const ms = [msg('helm', 'somtor', T0), msg('somtor', 'helm', T0 + 10), msg('helm', 'somtor', T0 + 20), msg('ez', 'forge', T0 + 15)];
    const r = live(ms);
    const pair = r.fires.filter(f => f.edge === pairKey('helm', 'somtor')).map(f => f.at);
    for (let i = 1; i < pair.length; i++) expect(pair[i] - pair[i - 1]).toBeGreaterThanOrEqual(MIN_EDGE_GAP_S - 1e-9);
    // other edges are not delayed by it
    expect(r.fires.find(f => f.edge === pairKey('ez', 'forge'))!.at - START).toBeLessThan(0.1);
    // worst case: the per-edge cap of gaps at the end of a long burst
    const long = [msg('a', 'b', T0), ...Array.from({ length: 4 }, (_, i) => msg('c', 'd', T0 + 600_000 + i))];
    for (const f of live(long, T0 + 700_000).fires) expect(f.at - START).toBeLessThanOrEqual(COMPRESS_S + 1e-9);
  });

  it('caps 4 per edge (the oldest are dropped) and 48 globally (newest kept)', () => {
    const one = Array.from({ length: 7 }, (_, i) => msg('helm', 'somtor', T0 + i * 1000));
    const r1 = live(one);
    expect(r1.fires).toHaveLength(PER_EDGE_CAP);
    expect(r1.fires.map(f => f.msgKey)).toEqual(one.slice(3).map(m => m.key));

    const many = Array.from({ length: 80 }, (_, i) => msg(`s${i}`, `r${i}`, T0 + i * 10));
    const r2 = live(many);
    expect(r2.fires).toHaveLength(GLOBAL_CAP);
    expect(r2.fires[r2.fires.length - 1].msgKey).toBe(many[79].key);
    expect(r2.fires[0].msgKey).toBe(many[32].key);
  });

  it('direction sign: + = a→b, − = b→a (a < b)', () => {
    const r = live([msg('helm', 'somtor', T0), msg('somtor', 'helm', T0 + 500)]);
    expect(r.fires[0].dir).toBe(1);   // helm < somtor
    expect(r.fires[1].dir).toBe(-1);
  });

  it('self-messages never fire', () => {
    expect(live([msg('helm', 'helm', T0)]).fires).toHaveLength(0);
  });
});

describe('schedulePulses — first load', () => {
  it('replays only the last ≤ 10 over ≤ 4 s', () => {
    const ms = Array.from({ length: 30 }, (_, i) => msg(`s${i}`, `r${i}`, T0 + i * 60_000));
    const r = schedulePulses({ msgs: ms, startS: START, nowMs: T0 + 31 * 60_000, mode: 'first', reducedMotion: false });
    expect(r.fires).toHaveLength(FIRST_REPLAY_MAX);
    expect(r.fires.map(f => f.msgKey)).toEqual(ms.slice(20).map(m => m.key));
    for (const f of r.fires) expect(f.at - START).toBeLessThanOrEqual(FIRST_REPLAY_S + 1e-9);
  });
});

describe('schedulePulses — catch-up after hidden', () => {
  it('animates only messages < 15 s old; the rest flash their nodes once', () => {
    const now = T0 + 120_000;
    const fresh = msg('helm', 'somtor', now - 5_000);
    const old1 = msg('ez', 'forge', now - 60_000);
    const old2 = msg('dopelab', 'helm', now - 15_000);
    const r = schedulePulses({ msgs: [fresh, old1, old2], startS: START, nowMs: now, mode: 'catchup', reducedMotion: false });
    expect(r.fires.map(f => f.msgKey)).toEqual([fresh.key]);
    expect([...r.catchUpFlash].sort()).toEqual(['dopelab', 'ez', 'forge', 'helm']);
    expect(r.newRing.size).toBe(0);
  });
});

describe('schedulePulses — reduced motion', () => {
  it('0 pulses; the new messages go to a newRing node set', () => {
    for (const mode of ['live', 'first', 'catchup'] as const) {
      const r = schedulePulses({ msgs: [msg('helm', 'somtor', T0), msg('ez', 'helm', T0 + 1)], startS: START, nowMs: T0 + 2, mode, reducedMotion: true });
      expect(r.fires).toHaveLength(0);
      expect([...r.newRing].sort()).toEqual(['ez', 'helm', 'somtor']);
      expect(r.catchUpFlash.size).toBe(0);
    }
  });
});

describe('fire ring (aFire vec4)', () => {
  it('packFire gives a vec4 of signed fire times, 0 = empty', () => {
    const ring = newFireRing();
    expect(packFire(ring)).toEqual([0, 0, 0, 0]);
    pushFire(ring, 1001.5, 1);
    pushFire(ring, 1002, -1);
    expect(packFire(ring)).toEqual([1001.5, -1002, 0, 0]);
  });

  it('a fifth fire overwrites the oldest', () => {
    const ring = newFireRing();
    for (let i = 0; i < 5; i++) pushFire(ring, 1000 + i + 1, 1);
    expect(packFire(ring)).toEqual([1005, 1002, 1003, 1004]);
  });

  it('sign is never ambiguous because uTime starts at 1000', () => {
    const ring = newFireRing();
    pushFire(ring, UTIME_START, -1);
    expect(packFire(ring)[0]).toBe(-1000);
  });
});
