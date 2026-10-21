import { describe, it, expect } from 'bun:test';
import { snapHeights, snapTo, cycleSnap, PEEK_PX } from '../sheet-snap';

const H = snapHeights(844, 34); // iPhone-ish: 844 px tall, 34 px home indicator

describe('snapHeights', () => {
  it('peek 168 px + inset, half 50 %, full 92 %', () => {
    expect(PEEK_PX).toBe(168);
    expect(H).toEqual({ peek: 202, half: 422, full: 776 });
  });
  it('stays ordered on a very short viewport', () => {
    const h = snapHeights(300, 34);
    expect(h.peek).toBeLessThanOrEqual(h.half);
    expect(h.half).toBeLessThanOrEqual(h.full);
  });
});

describe('snapTo', () => {
  it('slow release → nearest snap', () => {
    expect(snapTo(420, 0, H)).toBe('half');
    expect(snapTo(700, 0.1, H)).toBe('full');
    expect(snapTo(260, -0.05, H)).toBe('peek');
  });
  it('flick moves one snap in its direction', () => {
    expect(snapTo(430, 0.8, H)).toBe('full');
    expect(snapTo(430, -0.8, H)).toBe('peek');
    expect(snapTo(210, 0.9, H)).toBe('half');
    expect(snapTo(780, 2, H)).toBe('full'); // already at the top
  });
  it('dragging well below peek (or flicking down from peek) closes a closable sheet', () => {
    expect(snapTo(100, 0, H)).toBe('close');
    expect(snapTo(200, -1, H)).toBe('close');
    expect(snapTo(100, 0, H, ['peek', 'half', 'full'], false)).toBe('peek');
    expect(snapTo(200, -1, H, ['peek', 'half', 'full'], false)).toBe('peek');
  });
  it('respects the allowed snaps', () => {
    expect(snapTo(300, 0, H, ['half', 'full'])).toBe('half');
    expect(snapTo(430, 0.8, H, ['peek', 'half'])).toBe('half');
  });
});

describe('cycleSnap', () => {
  it('cycles peek → half → full → peek', () => {
    expect(cycleSnap('peek')).toBe('half');
    expect(cycleSnap('half')).toBe('full');
    expect(cycleSnap('full')).toBe('peek');
    expect(cycleSnap('half', ['half', 'full'])).toBe('full');
  });
});
