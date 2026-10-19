import { describe, it, expect } from 'bun:test';
import type { ParsedMsg } from '../parse';
import { buildGraph } from '../aggregate';
import { summary, pairRows, busiestPair, relTime } from '../summary';

// local-time fixtures so HH:MM holds in any TZ
const T0 = new Date(2026, 9, 18, 21, 18).getTime();
let seq = 0;
// Synthetic fixtures only.
const msg = (from: string, to: string, t: number, fromLabel = from, toLabel = to, host = 'mac-tor'): ParsedMsg => ({
  key: `k${seq++}`, t, ts: new Date(t).toISOString(), from, to, fromLabel, toLabel, node: host, host, body: 'synthetic',
});

/** 8 oracles, 100 messages, helm ⇄ SomTor busiest with 37 (26 → · 11 ←). */
function fixture(): ParsedMsg[] {
  const out: ParsedMsg[] = [];
  let t = T0;
  const push = (from: string, to: string, n: number, fl = from, tl = to) => { for (let i = 0; i < n; i++) out.push(msg(from, to, t++ * 1 + i * 10_000, fl, tl, 'node-x')); };
  push('helm', 'somtor', 26, 'helm', 'SomTor');
  push('somtor', 'helm', 11, 'SomTor', 'helm');
  push('helm', 'mktexpert', 25);
  push('helm', 'dopelab', 21);
  push('helm', 'ez', 9);
  push('somtor', 'forge', 3, 'SomTor', 'forge');
  push('helm', 'reelsmith', 3);
  push('helm', 'neo', 2);
  return out;
}

describe('summary', () => {
  it('"8 oracles, 100 messages since 21:18, busiest pair helm and SomTor (37)"', () => {
    const msgs = fixture();
    expect(msgs).toHaveLength(100);
    const g = buildGraph(msgs, null, T0 + 3600_000);
    expect(summary(g)).toBe('8 oracles, 100 messages since 21:18, busiest pair helm and SomTor (37)');
  });

  it('counts the host node separately (it is not an oracle)', () => {
    const g = buildGraph([msg('mac-tor', 'helm', T0), msg('helm', 'somtor', T0 + 1, 'helm', 'SomTor')], null, T0 + 10);
    expect(summary(g)).toBe('3 nodes (2 oracles + 1 host), 2 messages since 21:18, busiest pair helm and mac-tor (1)');
  });

  it('singular and empty', () => {
    expect(summary(buildGraph([msg('a', 'b', T0)], null, T0 + 1))).toBe('2 oracles, 1 message since 21:18, busiest pair a and b (1)');
    expect(summary(buildGraph([], null, T0))).toBe('No messages in this window');
  });
});

describe('pairRows (fallback table)', () => {
  it('sorted by count, with labels and the direction split', () => {
    const rows = pairRows(buildGraph(fixture(), null, T0 + 3600_000));
    expect(rows.map(r => r.count)).toEqual([37, 25, 21, 9, 3, 3, 2]);
    expect(rows[0]).toEqual({ key: 'helm|somtor', a: 'helm', b: 'somtor', labelA: 'helm', labelB: 'SomTor', count: 37, countAB: 26, countBA: 11 });
    for (let i = 1; i < rows.length; i++) expect(rows[i].count).toBeLessThanOrEqual(rows[i - 1].count);
  });

  it('busiestPair is the first row, or null', () => {
    expect(busiestPair(buildGraph([], null, T0))).toBeNull();
    expect(busiestPair(buildGraph(fixture(), null, T0 + 3600_000))!.count).toBe(37);
  });
});

describe('relTime', () => {
  it('s / min / h / d ago', () => {
    expect(relTime(T0, T0 - 4_000)).toBe('4 s ago');
    expect(relTime(T0, T0 - 3 * 60_000)).toBe('3 min ago');
    expect(relTime(T0, T0 - 2 * 3600_000)).toBe('2 h ago');
    expect(relTime(T0, T0 - 3 * 86400_000)).toBe('3 d ago');
    expect(relTime(T0, T0 + 5_000)).toBe('just now');
  });
});
