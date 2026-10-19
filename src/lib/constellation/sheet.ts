// Fleet Constellation — OracleSheet data (pure): everything comes from the
// feed graph, no :3456 call. Bodies render as text, never HTML (the sheet
// uses React text nodes); long ones truncate at 140 and can expand.

import type { Graph } from './aggregate';

export const BODY_TRUNCATE = 140;
export const RECENT_MAX = 20;

export interface SheetPartner {
  key: string;
  label: string;
  kind: 'oracle' | 'node';
  count: number;
  /** this node → partner */
  out: number;
  /** partner → this node */
  in: number;
}

export interface SheetMsg {
  key: string;
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  t: number;
  body: string;
  dir: 'out' | 'in';
}

export interface SheetData {
  key: string;
  label: string;
  kind: 'oracle' | 'node';
  sent: number;
  recv: number;
  firstTs: number;
  lastTs: number;
  /** ranked by count, then key */
  partners: SheetPartner[];
  /** ≤ RECENT_MAX, newest first */
  recent: SheetMsg[];
}

export function sheetData(g: Graph, key: string): SheetData | null {
  const n = g.nodes.find(x => x.key === key);
  if (!n) return null;
  const nodes = new Map(g.nodes.map(x => [x.key, x]));
  const partners: SheetPartner[] = g.edges
    .filter(e => e.a === key || e.b === key)
    .map(e => {
      const other = e.a === key ? e.b : e.a;
      const o = nodes.get(other);
      const out = e.a === key ? e.countAB : e.countBA;
      return { key: other, label: o?.label ?? other, kind: o?.kind ?? 'oracle', count: e.count, out, in: e.count - out };
    })
    .sort((p, q) => q.count - p.count || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  const recent: SheetMsg[] = [];
  for (const m of g.msgs) {
    if (m.from !== key && m.to !== key) continue;
    recent.push({ key: m.key, from: m.from, fromLabel: m.fromLabel, to: m.to, toLabel: m.toLabel, t: m.t, body: m.body, dir: m.from === key ? 'out' : 'in' });
    if (recent.length >= RECENT_MAX) break;
  }
  return { key, label: n.label, kind: n.kind, sent: n.sent, recv: n.recv, firstTs: n.firstTs, lastTs: n.lastTs, partners, recent };
}

/** Cut at `max` UTF-16 units without splitting a surrogate pair. */
export function truncateBody(text: string, max: number = BODY_TRUNCATE): { text: string; cut: boolean; rest: number } {
  if (text.length <= max) return { text, cut: false, rest: 0 };
  let end = max;
  const c = text.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return { text: text.slice(0, end), cut: true, rest: text.length - end };
}

export { relTime } from './summary';
