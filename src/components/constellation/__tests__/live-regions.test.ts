import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// No DOM test env here, so this is a static check over the Pulse tree's
// source: one screen-reader live region per page (T16 #13). The LiveDot
// state announcer is the only one; the sr-only graph summary is plain text.
const dir = join(import.meta.dir, '..');
const files = [join(dir, '../../pages/Pulse.tsx'), ...readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => join(dir, f))];
const src = files.map(f => [f, readFileSync(f, 'utf8')] as const);
const count = (re: RegExp) => src.reduce((n, [, s]) => n + (s.match(re)?.length ?? 0), 0);

describe('Pulse page live regions', () => {
  it('exactly one aria-live attribute in the Pulse tree', () => {
    expect(count(/aria-live=/g)).toBe(1);
  });

  it('exactly one <LiveDot … announce> instance', () => {
    expect(count(/<LiveDot\b[^>]*\bannounce\b/g)).toBe(1);
  });

  it('the live region lives in LiveDot (state text, not the 1 s counter)', () => {
    const live = src.filter(([, s]) => /aria-live=/.test(s)).map(([f]) => f.split('/').pop());
    expect(live).toEqual(['LiveDot.tsx']);
  });
});
