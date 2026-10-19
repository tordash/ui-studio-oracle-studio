// Fleet Constellation — parsed messages → graph for one time window (pure).
//
// Window membership is inclusive at the start: t ≥ now − windowMs. A null
// window keeps everything held ("All buffered"). Edges are unordered pairs
// {a, b} with a < b; countAB counts a → b. Self-messages count as activity
// but make no edge. A node whose key is a host / prefix node name (mac-tor)
// is kind 'node', not an oracle (C-D2).

import type { ParsedMsg } from './parse';

export type WindowId = '15m' | '1h' | 'all';

export const WINDOW_MS: Record<WindowId, number | null> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  all: null,
};

/** Heat decay constant for nodes and edges. */
export const HEAT_TAU_MS = 10 * 60_000;

export interface GraphNode {
  key: string;
  label: string;
  kind: 'oracle' | 'node';
  sent: number;
  recv: number;
  activity: number;
  firstTs: number;
  lastTs: number;
  /** exp(−(now − lastTs)/τ), 0..1 */
  heat: number;
}

export interface GraphEdge {
  /** `${a}|${b}` */
  key: string;
  a: string;
  b: string;
  count: number;
  countAB: number;
  countBA: number;
  lastTs: number;
  heat: number;
}

export interface Graph {
  /** by activity desc, then key */
  nodes: GraphNode[];
  /** by count desc, then key */
  edges: GraphEdge[];
  /** window messages, newest first */
  msgs: ParsedMsg[];
  /** null = All buffered */
  windowStart: number | null;
  now: number;
}

export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export const heatAt = (now: number, lastTs: number) => Math.exp(-Math.max(0, now - lastTs) / HEAT_TAU_MS);

export function buildGraph(all: readonly ParsedMsg[], windowMs: number | null, now: number): Graph {
  const windowStart = windowMs == null ? null : now - windowMs;
  const msgs = (windowStart == null ? [...all] : all.filter(m => m.t >= windowStart)).sort((p, q) => q.t - p.t);

  const hosts = new Set<string>();
  for (const m of all) {
    if (m.host) hosts.add(m.host);
    if (m.node) hosts.add(m.node);
  }

  const nodes = new Map<string, GraphNode>();
  const touch = (key: string, label: string, t: number) => {
    let n = nodes.get(key);
    if (!n) {
      n = { key, label, kind: hosts.has(key) ? 'node' : 'oracle', sent: 0, recv: 0, activity: 0, firstTs: t, lastTs: t, heat: 0 };
      nodes.set(key, n);
    }
    if (t < n.firstTs) n.firstTs = t;
    if (t > n.lastTs) n.lastTs = t;
    return n;
  };

  const edges = new Map<string, GraphEdge>();
  for (const m of msgs) {
    touch(m.from, m.fromLabel, m.t).sent++;
    if (m.to === m.from) continue;
    touch(m.to, m.toLabel, m.t).recv++;
    const key = pairKey(m.from, m.to);
    let e = edges.get(key);
    if (!e) {
      const [a, b] = m.from < m.to ? [m.from, m.to] : [m.to, m.from];
      e = { key, a, b, count: 0, countAB: 0, countBA: 0, lastTs: m.t, heat: 0 };
      edges.set(key, e);
    }
    e.count++;
    if (m.from === e.a) e.countAB++; else e.countBA++;
    if (m.t > e.lastTs) e.lastTs = m.t;
  }

  for (const n of nodes.values()) {
    n.activity = n.sent + n.recv;
    n.heat = heatAt(now, n.lastTs);
  }
  for (const e of edges.values()) e.heat = heatAt(now, e.lastTs);

  const byKey = (p: { key: string }, q: { key: string }) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0);
  return {
    nodes: [...nodes.values()].sort((p, q) => q.activity - p.activity || byKey(p, q)),
    edges: [...edges.values()].sort((p, q) => q.count - p.count || byKey(p, q)),
    msgs,
    windowStart,
    now,
  };
}

/** Local HH:MM. */
export function formatHM(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface WindowLabelInput {
  /** messages in the window */
  count: number;
  /** null = All buffered */
  windowStart: number | null;
  /** oldest event held in memory (null = nothing held) */
  oldestHeld: number | null;
  /** the last full fetch came back at the server cap */
  bufferFull: boolean;
}

/**
 * Honesty label: "N msgs since HH:MM". "since" is where the data really
 * starts — the window start, or the oldest held event if that is later.
 * When the window reaches past what the server still keeps, say so.
 */
export function windowLabel({ count, windowStart, oldestHeld, bufferFull }: WindowLabelInput, fmt: (t: number) => string = formatHM): string {
  const n = `${count} ${count === 1 ? 'msg' : 'msgs'}`;
  const since = windowStart == null ? oldestHeld : oldestHeld == null ? windowStart : Math.max(windowStart, oldestHeld);
  if (since == null) return n;
  const partial = bufferFull && oldestHeld != null && (windowStart == null || windowStart < oldestHeld);
  return `${n} since ${fmt(since)}${partial ? ' · partial (server keeps last 100)' : ''}`;
}
