import { describe, it, expect } from 'bun:test';
import type { FeedEvent } from '../../../api/oracle';
import { pairEvents, shortenMsg } from '../stream';

const T0 = Date.UTC(2026, 9, 18, 14, 0, 0);
// Synthetic fixtures only.
const ev = (sec: number, o: Partial<FeedEvent>): FeedEvent => ({
  timestamp: new Date(T0 + sec * 1000).toISOString(),
  oracle: 'neo', host: 'mac-tor', event: 'PreToolUse', project: '', session_id: 's1', message: 'Edit: a.ts',
  ...o,
});
/** feed order is newest first */
const newestFirst = (xs: FeedEvent[]) => [...xs].reverse();

describe('pairEvents — MessageSend (bug B)', () => {
  it('3+ consecutive MessageSend from one sender no longer collapse into "… N more mac-tor calls"', () => {
    const sends = [0, 1, 2, 3].map(i => ev(i, {
      event: 'MessageSend', oracle: 'SomTor', session_id: '',
      message: `mac-tor:helm: [mac-tor:SomTor] synthetic ${i}`,
    }));
    const r = pairEvents(newestFirst(sends));
    expect(r.events).toHaveLength(4);
    expect(r.events.some(e => e.event === 'Collapsed')).toBe(false);
    expect(r.events.some(e => e.message.includes('more mac-tor calls'))).toBe(false);
    expect(r.collapsedGroups.size).toBe(0);
    expect(r.events.map(e => e.message)).toEqual(newestFirst(sends).map(e => e.message));
  });

  it('a MessageSend run does not swallow a following hook event either', () => {
    const xs = [
      ev(0, { event: 'MessageSend', session_id: '', message: 'mac-tor:helm: [mac-tor:neo] synthetic a' }),
      ev(1, { event: 'MessageSend', session_id: '', message: 'mac-tor:helm: [mac-tor:neo] synthetic b' }),
      ev(2, { event: 'Stop', message: 'mac-tor: synthetic stop' }),
    ];
    const r = pairEvents(newestFirst(xs));
    expect(r.events.map(e => e.event)).toEqual(['Stop', 'MessageSend', 'MessageSend']);
  });
});

describe('pairEvents — hook-style events (unchanged)', () => {
  it('pairs PreToolUse + PostToolUse into ToolDone with a duration', () => {
    const r = pairEvents(newestFirst([ev(0, {}), ev(0.5, { event: 'PostToolUse' })]));
    expect(r.events).toHaveLength(1);
    expect(r.events[0].event).toBe('ToolDone');
    expect(r.events[0].session_id).toBe('s1|500ms');
  });

  it('PostToolUseFailure → ToolFailed, seconds label ≥ 1 s', () => {
    const r = pairEvents(newestFirst([ev(0, {}), ev(2.5, { event: 'PostToolUseFailure' })]));
    expect(r.events[0].event).toBe('ToolFailed');
    expect(r.events[0].session_id).toBe('s1|2.5s');
  });

  it('collapses 4 consecutive same-tool calls into first + "… 2 more Edit calls" + last', () => {
    const xs: FeedEvent[] = [];
    for (let i = 0; i < 4; i++) {
      xs.push(ev(i * 10, { message: `Edit: f${i}.ts` }));
      xs.push(ev(i * 10 + 1, { event: 'PostToolUse', message: `Edit: f${i}.ts` }));
    }
    const r = pairEvents(newestFirst(xs));
    expect(r.events.map(e => e.event)).toEqual(['ToolDone', 'Collapsed', 'ToolDone']);
    expect(r.events[1].message).toBe('... 2 more Edit calls');
    expect(r.collapsedGroups.size).toBe(1);
    const g = r.collapsedGroups.get(1)!;
    expect(g.placeholder).toBe(r.events[1]);
    expect(g.hidden.map(e => e.message)).toEqual(['Edit: f2.ts', 'Edit: f1.ts']);
  });

  it('two same-tool calls stay as they are', () => {
    const r = pairEvents(newestFirst([ev(0, {}), ev(5, {})]));
    expect(r.events).toHaveLength(2);
    expect(r.collapsedGroups.size).toBe(0);
  });

  it('a different oracle breaks the run', () => {
    const r = pairEvents(newestFirst([ev(0, {}), ev(1, { oracle: 'mother' }), ev(2, {})]));
    expect(r.events.some(e => e.event === 'Collapsed')).toBe(false);
  });
});

describe('shortenMsg', () => {
  it('keeps the last two path segments', () => {
    expect(shortenMsg('Read: /home/x/Code/github.com/org/repo/src/a/b/c.ts')).toBe('Read: .../b/c.ts');
  });
});
