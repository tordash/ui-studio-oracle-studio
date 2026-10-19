import { describe, it, expect } from 'bun:test';
import type { FeedEvent } from '../../../api/oracle';
import { parseFeedEvent, newParseStats, dedupeKey, fnv1a, oracleKey, recipientOf } from '../parse';

// Synthetic fixtures only — never real feed text.
const ev = (o: Partial<FeedEvent> = {}): FeedEvent => ({
  timestamp: '2026-10-18T14:00:00.000Z',
  oracle: 'SomTor',
  host: 'mac-tor',
  event: 'MessageSend',
  project: '',
  session_id: '',
  message: 'mac-tor:helm: [mac-tor:SomTor] synthetic ping one',
  ...o,
});

describe('parseFeedEvent', () => {
  it('parses the <node>:<target>: [<node>:<Sender>] prefix', () => {
    const stats = newParseStats();
    const m = parseFeedEvent(ev(), stats, new Map());
    expect(m).not.toBeNull();
    expect(m!.from).toBe('somtor');
    expect(m!.to).toBe('helm');
    expect(m!.node).toBe('mac-tor');
    expect(m!.host).toBe('mac-tor');
    expect(m!.body).toBe('synthetic ping one');
    expect(m!.t).toBe(Date.parse('2026-10-18T14:00:00.000Z'));
    expect(stats).toEqual({ malformed: 0, ignored: 0, tagMismatch: 0 });
  });

  it('accepts . and - in node, target and sender names', () => {
    const m = parseFeedEvent(ev({
      oracle: 'mac-tor',
      message: 'mac-tor:dope.lab-2: [mac-tor:mac-tor] synthetic',
    }), newParseStats(), new Map());
    expect(m!.from).toBe('mac-tor');
    expect(m!.to).toBe('dope.lab-2');
  });

  it('SomTor and somtor give one key; the first-seen casing is the label', () => {
    const labels = new Map<string, string>();
    const stats = newParseStats();
    const a = parseFeedEvent(ev({ oracle: 'SomTor' }), stats, labels)!;
    const b = parseFeedEvent(ev({ oracle: 'somtor', message: 'mac-tor:HELM: [mac-tor:somtor] synthetic' }), stats, labels)!;
    expect(a.from).toBe(b.from);
    expect(a.to).toBe(b.to);
    expect(labels.get('somtor')).toBe('SomTor');
    expect(labels.get('helm')).toBe('helm');
    expect(b.fromLabel).toBe('SomTor');
    expect(b.toLabel).toBe('helm');
    expect(oracleKey('SomTor')).toBe('somtor');
  });

  it('no prefix match → null and stats.malformed++', () => {
    const stats = newParseStats();
    expect(parseFeedEvent(ev({ message: 'synthetic text without a prefix' }), stats, new Map())).toBeNull();
    expect(parseFeedEvent(ev({ message: 'mac-tor:helm [mac-tor:SomTor] missing colon' }), stats, new Map())).toBeNull();
    expect(parseFeedEvent(ev({ message: '' }), stats, new Map())).toBeNull();
    expect(stats.malformed).toBe(3);
    expect(stats.ignored).toBe(0);
  });

  it('an unparseable timestamp counts as malformed', () => {
    const stats = newParseStats();
    expect(parseFeedEvent(ev({ timestamp: 'not-a-date' }), stats, new Map())).toBeNull();
    expect(stats.malformed).toBe(1);
  });

  it('event ≠ MessageSend → null and stats.ignored++', () => {
    const stats = newParseStats();
    expect(parseFeedEvent(ev({ event: 'PreToolUse' }), stats, new Map())).toBeNull();
    expect(parseFeedEvent(ev({ event: 'Stop' }), stats, new Map())).toBeNull();
    expect(stats.ignored).toBe(2);
    expect(stats.malformed).toBe(0);
  });

  it('tag sender ≠ oracle → stats.tagMismatch++, event kept with oracle as the sender', () => {
    const stats = newParseStats();
    const m = parseFeedEvent(ev({ oracle: 'helm', message: 'mac-tor:forge: [mac-tor:SomTor] synthetic' }), stats, new Map());
    expect(m).not.toBeNull();
    expect(m!.from).toBe('helm');
    expect(m!.to).toBe('forge');
    expect(stats.tagMismatch).toBe(1);
  });

  it('tag sender comparison is case-insensitive', () => {
    const stats = newParseStats();
    parseFeedEvent(ev({ oracle: 'SOMTOR' }), stats, new Map());
    expect(stats.tagMismatch).toBe(0);
  });
});

describe('dedupe key', () => {
  it('is timestamp + oracle + fnv1a(message), stable across calls', () => {
    const e = ev();
    expect(dedupeKey(e)).toBe(dedupeKey(ev()));
    expect(dedupeKey(e)).toBe(`${e.timestamp}|${e.oracle}|${fnv1a(e.message)}`);
    expect(parseFeedEvent(e, newParseStats(), new Map())!.key).toBe(dedupeKey(e));
  });

  it('differs when one character of the message changes', () => {
    expect(dedupeKey(ev({ message: 'mac-tor:helm: [mac-tor:SomTor] synthetic ping one' })))
      .not.toBe(dedupeKey(ev({ message: 'mac-tor:helm: [mac-tor:SomTor] synthetic ping onf' })));
  });

  it('differs on timestamp or oracle', () => {
    expect(dedupeKey(ev())).not.toBe(dedupeKey(ev({ timestamp: '2026-10-18T14:00:00.001Z' })));
    expect(dedupeKey(ev())).not.toBe(dedupeKey(ev({ oracle: 'helm' })));
  });

  it('fnv1a is 32-bit FNV-1a as 8 hex chars (known vectors)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

describe('recipientOf', () => {
  it('returns the prefix target with its casing, or null', () => {
    expect(recipientOf('mac-tor:HeLm: [mac-tor:SomTor] synthetic')).toBe('HeLm');
    expect(recipientOf('synthetic without prefix')).toBeNull();
    expect(recipientOf('')).toBeNull();
  });
});
