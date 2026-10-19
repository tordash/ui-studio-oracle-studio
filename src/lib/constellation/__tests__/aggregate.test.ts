import { describe, it, expect } from 'bun:test';
import type { ParsedMsg } from '../parse';
import { buildGraph, windowLabel, WINDOW_MS, HEAT_TAU_MS, pairKey } from '../aggregate';

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);
const MIN = 60_000;

let seq = 0;
// Synthetic fixtures only.
const msg = (from: string, to: string, agoMin: number, o: Partial<ParsedMsg> = {}): ParsedMsg => {
  const t = NOW - agoMin * MIN;
  return {
    key: `k${seq++}`, t, ts: new Date(t).toISOString(), from, to,
    fromLabel: from, toLabel: to, node: 'mac-tor', host: 'mac-tor', body: 'synthetic', ...o,
  };
};

describe('buildGraph', () => {
  it('window start is inclusive: t ≥ now − windowMs is in, one ms older is out', () => {
    const inside = msg('helm', 'somtor', 60);
    const outside = { ...msg('helm', 'forge', 60), t: NOW - 60 * MIN - 1 };
    const g = buildGraph([inside, outside], WINDOW_MS['1h'], NOW);
    expect(g.msgs).toHaveLength(1);
    expect(g.nodes.map(n => n.key).sort()).toEqual(['helm', 'somtor']);
  });

  it('window = null keeps everything held (All buffered)', () => {
    const g = buildGraph([msg('helm', 'somtor', 1), msg('helm', 'forge', 600)], WINDOW_MS.all, NOW);
    expect(g.msgs).toHaveLength(2);
    expect(g.windowStart).toBeNull();
  });

  it('counts each unordered pair once with a countAB / countBA split', () => {
    const g = buildGraph([
      msg('helm', 'somtor', 1), msg('somtor', 'helm', 2), msg('helm', 'somtor', 3), msg('helm', 'mktexpert', 4),
    ], WINDOW_MS['1h'], NOW);
    const e = g.edges.find(x => x.key === pairKey('somtor', 'helm'))!;
    expect(e.a).toBe('helm');
    expect(e.b).toBe('somtor');
    expect(e.count).toBe(3);
    expect(e.countAB).toBe(2); // helm → somtor
    expect(e.countBA).toBe(1);
    expect(g.edges).toHaveLength(2);
    // busiest first
    expect(g.edges[0].key).toBe(e.key);
  });

  it('nodes = senders ∪ targets (a target-only node exists)', () => {
    const g = buildGraph([msg('helm', 'reelsmith', 1)], WINDOW_MS['1h'], NOW);
    const r = g.nodes.find(n => n.key === 'reelsmith')!;
    expect(r).toBeDefined();
    expect(r.sent).toBe(0);
    expect(r.recv).toBe(1);
  });

  it("kind 'node' when the name is the host (mac-tor), else 'oracle'", () => {
    const g = buildGraph([msg('mac-tor', 'helm', 1)], WINDOW_MS['1h'], NOW);
    expect(g.nodes.find(n => n.key === 'mac-tor')!.kind).toBe('node');
    expect(g.nodes.find(n => n.key === 'helm')!.kind).toBe('oracle');
  });

  it('activity = sent + recv; lastTs / firstTs; heat = exp(−Δ/10 min)', () => {
    const g = buildGraph([msg('helm', 'somtor', 2), msg('somtor', 'forge', 5), msg('ez', 'somtor', 30)], WINDOW_MS['1h'], NOW);
    const s = g.nodes.find(n => n.key === 'somtor')!;
    expect(s.sent).toBe(1);
    expect(s.recv).toBe(2);
    expect(s.activity).toBe(3);
    expect(s.lastTs).toBe(NOW - 2 * MIN);
    expect(s.firstTs).toBe(NOW - 30 * MIN);
    expect(HEAT_TAU_MS).toBe(10 * MIN);
    expect(s.heat).toBeCloseTo(Math.exp(-2 / 10), 10);
    const e = g.edges.find(x => x.key === pairKey('ez', 'somtor'))!;
    expect(e.heat).toBeCloseTo(Math.exp(-3), 10);
  });

  it('heat never exceeds 1 for a timestamp slightly in the future (clock skew)', () => {
    const g = buildGraph([msg('helm', 'somtor', -0.5)], WINDOW_MS['1h'], NOW);
    expect(g.nodes[0].heat).toBe(1);
  });

  it('nodes are sorted by activity, then key', () => {
    const g = buildGraph([msg('helm', 'somtor', 1), msg('helm', 'ez', 2), msg('forge', 'dopelab', 3)], WINDOW_MS['1h'], NOW);
    expect(g.nodes.map(n => n.key)).toEqual(['helm', 'dopelab', 'ez', 'forge', 'somtor']);
  });

  it('a self-message counts as activity but makes no edge', () => {
    const g = buildGraph([msg('helm', 'helm', 1)], WINDOW_MS['1h'], NOW);
    expect(g.edges).toHaveLength(0);
    expect(g.nodes[0].sent).toBe(1);
  });

  it('keeps the window messages newest first', () => {
    const g = buildGraph([msg('a', 'b', 9), msg('a', 'b', 1), msg('a', 'b', 5)], WINDOW_MS['1h'], NOW);
    expect(g.msgs.map(m => m.t)).toEqual([NOW - MIN, NOW - 5 * MIN, NOW - 9 * MIN]);
  });
});

describe('windowLabel', () => {
  // local-time fixtures, so HH:MM holds in any TZ
  const local = (h: number, m: number) => new Date(2026, 9, 18, h, m).getTime();

  it('"N msgs since HH:MM" uses the window start when data covers it', () => {
    expect(windowLabel({ count: 12, windowStart: local(21, 18), oldestHeld: local(20, 0), bufferFull: true })).toBe('12 msgs since 21:18');
  });

  it('shows the oldest held event when the window starts earlier', () => {
    expect(windowLabel({ count: 40, windowStart: local(20, 0), oldestHeld: local(20, 34), bufferFull: false })).toBe('40 msgs since 20:34');
  });

  it('adds "· partial (server keeps last 100)" when the window starts before the oldest held event and the buffer was full', () => {
    expect(windowLabel({ count: 100, windowStart: local(20, 0), oldestHeld: local(20, 34), bufferFull: true }))
      .toBe('100 msgs since 20:34 · partial (server keeps last 100)');
  });

  it('All buffered with a full buffer is partial; with a short buffer it is not', () => {
    expect(windowLabel({ count: 100, windowStart: null, oldestHeld: local(9, 5), bufferFull: true }))
      .toBe('100 msgs since 09:05 · partial (server keeps last 100)');
    expect(windowLabel({ count: 7, windowStart: null, oldestHeld: local(9, 5), bufferFull: false })).toBe('7 msgs since 09:05');
  });

  it('singular, and nothing held', () => {
    expect(windowLabel({ count: 1, windowStart: local(21, 0), oldestHeld: local(21, 30), bufferFull: false })).toBe('1 msg since 21:30');
    expect(windowLabel({ count: 0, windowStart: local(21, 0), oldestHeld: null, bufferFull: false })).toBe('0 msgs since 21:00');
    expect(windowLabel({ count: 0, windowStart: null, oldestHeld: null, bufferFull: false })).toBe('0 msgs');
  });
});
