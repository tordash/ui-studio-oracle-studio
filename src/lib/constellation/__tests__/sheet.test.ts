import { describe, it, expect } from 'bun:test';
import type { ParsedMsg } from '../parse';
import { buildGraph } from '../aggregate';
import { sheetData, truncateBody, BODY_TRUNCATE, RECENT_MAX } from '../sheet';

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);
let seq = 0;
// Synthetic fixtures only.
const msg = (from: string, to: string, agoS: number, body = 'synthetic'): ParsedMsg => {
  const t = NOW - agoS * 1000;
  return { key: `k${seq++}`, t, ts: new Date(t).toISOString(), from, to, fromLabel: from === 'somtor' ? 'SomTor' : from, toLabel: to === 'somtor' ? 'SomTor' : to, node: 'mac-tor', host: 'mac-tor', body };
};

describe('sheetData', () => {
  const msgs = [
    msg('helm', 'somtor', 10), msg('somtor', 'helm', 20), msg('helm', 'somtor', 30),
    msg('somtor', 'forge', 40), msg('ez', 'somtor', 50), msg('ez', 'helm', 60),
  ];
  const g = buildGraph(msgs, null, NOW);

  it('identity, kind, sent / received, first / last seen', () => {
    const s = sheetData(g, 'somtor')!;
    expect(s.key).toBe('somtor');
    expect(s.label).toBe('SomTor');
    expect(s.kind).toBe('oracle');
    expect(s.sent).toBe(2);
    expect(s.recv).toBe(3);
    expect(s.lastTs).toBe(NOW - 10_000);
    expect(s.firstTs).toBe(NOW - 50_000);
  });

  it('partners ranked by count with the → / ← split', () => {
    const s = sheetData(g, 'somtor')!;
    expect(s.partners.map(p => [p.key, p.count, p.out, p.in])).toEqual([
      ['helm', 3, 1, 2],
      ['ez', 1, 0, 1],
      ['forge', 1, 1, 0],
    ]);
    expect(s.partners[0].label).toBe('helm');
  });

  it('recent: messages involving it, newest first, at most 20', () => {
    expect(RECENT_MAX).toBe(20);
    const s = sheetData(g, 'somtor')!;
    expect(s.recent.map(m => [m.from, m.to])).toEqual([['helm', 'somtor'], ['somtor', 'helm'], ['helm', 'somtor'], ['somtor', 'forge'], ['ez', 'somtor']]);
    expect(s.recent[0].dir).toBe('in');
    expect(s.recent[1].dir).toBe('out');
    const many = buildGraph(Array.from({ length: 30 }, (_, i) => msg('helm', 'ez', i)), null, NOW);
    const r = sheetData(many, 'ez')!.recent;
    expect(r).toHaveLength(20);
    expect(r[0].t).toBe(NOW);
  });

  it('host node kind, unknown key → null', () => {
    const h = buildGraph([msg('mac-tor', 'helm', 5)], null, NOW);
    expect(sheetData(h, 'mac-tor')!.kind).toBe('node');
    expect(sheetData(g, 'nobody')).toBeNull();
  });
});

describe('truncateBody', () => {
  it('cuts at 140 characters and says so', () => {
    expect(BODY_TRUNCATE).toBe(140);
    const long = 'x'.repeat(141);
    expect(truncateBody(long)).toEqual({ text: 'x'.repeat(140), cut: true, rest: 1 });
    expect(truncateBody('short')).toEqual({ text: 'short', cut: false, rest: 0 });
    expect(truncateBody('y'.repeat(140)).cut).toBe(false);
  });

  it('never splits a surrogate pair', () => {
    const s = 'a'.repeat(139) + '😀' + 'b';
    const r = truncateBody(s);
    expect(r.text.endsWith('\uD83D')).toBe(false);
  });
});
