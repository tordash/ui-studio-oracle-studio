// Fleet Constellation — /api/feed event → parsed message (pure, no DOM).
//
// The feed carries maw relays only (event = MessageSend). There is no `to`
// field: the recipient lives in the message prefix
//   <node>:<target>: [<node>:<Sender>] <body>
// so it is parsed here. The `oracle` field is trusted as the sender; a tag
// sender that disagrees is only counted. No event id either, so the dedupe key
// is timestamp + oracle + fnv1a(message).

import type { FeedEvent } from '../../api/oracle';

export interface ParsedMsg {
  /** dedupe key: `${timestamp}|${oracle}|${fnv1a(message)}` */
  key: string;
  /** epoch ms */
  t: number;
  ts: string;
  /** lower-case oracle keys */
  from: string;
  to: string;
  /** first-seen casing for display */
  fromLabel: string;
  toLabel: string;
  /** node in the prefix (`mac-tor`), lower-case */
  node: string;
  /** event `host`, lower-case */
  host: string;
  /** message text after the prefix */
  body: string;
}

export interface ParseStats {
  /** no prefix match / bad timestamp → skipped */
  malformed: number;
  /** event ≠ MessageSend → skipped */
  ignored: number;
  /** [node:Sender] tag ≠ oracle field → kept, counted */
  tagMismatch: number;
}

export const newParseStats = (): ParseStats => ({ malformed: 0, ignored: 0, tagMismatch: 0 });

const PREFIX = /^([\w.-]+):([\w.-]+): \[([\w.-]+):([\w.-]+)\]\s?/;

/** Case-insensitive identity: SomTor = somtor. */
export const oracleKey = (name: string) => name.trim().toLowerCase();

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Prefix target as written (for the stream list's from → to chip), or null. */
export function recipientOf(message: string): string | null {
  return PREFIX.exec(message ?? '')?.[2] ?? null;
}

export const dedupeKey =(e: FeedEvent) => `${e.timestamp}|${e.oracle}|${fnv1a(e.message ?? '')}`;

function label(labels: Map<string, string>, key: string, raw: string): string {
  const seen = labels.get(key);
  if (seen !== undefined) return seen;
  labels.set(key, raw);
  return raw;
}

/** Parse one feed event. `labels` keeps the first-seen casing per key across calls. */
export function parseFeedEvent(e: FeedEvent, stats: ParseStats, labels: Map<string, string>): ParsedMsg | null {
  if (e.event !== 'MessageSend') { stats.ignored++; return null; }
  const m = PREFIX.exec(e.message ?? '');
  const t = Date.parse(e.timestamp);
  if (!m || !Number.isFinite(t) || !e.oracle) { stats.malformed++; return null; }
  const from = oracleKey(e.oracle);
  const to = oracleKey(m[2]);
  if (oracleKey(m[4]) !== from) stats.tagMismatch++;
  return {
    key: dedupeKey(e),
    t,
    ts: e.timestamp,
    from,
    to,
    fromLabel: label(labels, from, e.oracle.trim()),
    toLabel: label(labels, to, m[2]),
    node: oracleKey(m[1]),
    host: oracleKey(e.host ?? ''),
    body: e.message.slice(m[0].length),
  };
}
