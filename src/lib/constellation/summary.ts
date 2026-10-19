// Fleet Constellation — the same graph as words and rows (pure): the
// visually-hidden live summary next to the canvas, and the no-WebGL fallback.

import type { Graph } from './aggregate';
import { formatHM } from './aggregate';

export interface PairRow {
  key: string;
  a: string;
  b: string;
  labelA: string;
  labelB: string;
  count: number;
  /** a → b */
  countAB: number;
  countBA: number;
}

/** Edges as table rows, busiest first (graph.edges is already sorted). */
export function pairRows(g: Graph): PairRow[] {
  const label = new Map(g.nodes.map(n => [n.key, n.label]));
  return g.edges.map(e => ({
    key: e.key, a: e.a, b: e.b,
    labelA: label.get(e.a) ?? e.a,
    labelB: label.get(e.b) ?? e.b,
    count: e.count, countAB: e.countAB, countBA: e.countBA,
  }));
}

export const busiestPair = (g: Graph): PairRow | null => pairRows(g)[0] ?? null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "8 oracles, 100 messages since 21:18, busiest pair helm and SomTor (37)" */
export function summary(g: Graph, fmt: (t: number) => string = formatHM): string {
  if (g.msgs.length === 0) return 'No messages in this window';
  const hosts = g.nodes.filter(n => n.kind === 'node').length;
  const oracles = g.nodes.length - hosts;
  const who = hosts > 0
    ? `${plural(g.nodes.length, 'node', 'nodes')} (${plural(oracles, 'oracle', 'oracles')} + ${hosts} host)`
    : plural(oracles, 'oracle', 'oracles');
  const oldest = g.msgs[g.msgs.length - 1].t;
  const top = busiestPair(g);
  const pair = top ? `, busiest pair ${top.labelA} and ${top.labelB} (${top.count})` : '';
  return `${who}, ${plural(g.msgs.length, 'message', 'messages')} since ${fmt(oldest)}${pair}`;
}

export function relTime(now: number, t: number): string {
  const s = Math.floor((now - t) / 1000);
  if (s < 1) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
