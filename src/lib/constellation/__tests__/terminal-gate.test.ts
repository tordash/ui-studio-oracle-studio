import { describe, it, expect } from 'bun:test';
import { canUseTerminal } from '../terminal-gate';

describe('canUseTerminal (C-D4)', () => {
  it('true only for a local host and no remote ?host=', () => {
    expect(canUseTerminal(false, 'localhost')).toBe(true);
    expect(canUseTerminal(false, '127.0.0.1')).toBe(true);
  });

  it('false when remote, whatever the hostname', () => {
    expect(canUseTerminal(true, 'localhost')).toBe(false);
    expect(canUseTerminal(true, '127.0.0.1')).toBe(false);
  });

  it('false on any other hostname (tailnet, LAN, public, look-alikes)', () => {
    for (const h of ['mac-tor.tail1234.ts.net', '192.168.1.5', 'studio.buildwithoracle.com', 'localhost.evil.com', '127.0.0.1.nip.io', '', '0.0.0.0', '::1', 'LOCALHOST ']) {
      expect(canUseTerminal(false, h)).toBe(false);
    }
  });
});
