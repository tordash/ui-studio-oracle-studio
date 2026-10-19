import { describe, it, expect } from 'bun:test';
import { parseViewState, writeViewState, DEFAULT_VIEW } from '../url-state';

describe('URL view state', () => {
  it('parses ?focus=helm,somtor&w=1h&sel=helm', () => {
    expect(parseViewState('?focus=helm,somtor&w=1h&sel=helm')).toEqual({ focus: ['helm', 'somtor'], w: '1h', sel: 'helm' });
  });

  it('round-trips', () => {
    for (const q of ['?focus=helm,somtor&w=1h&sel=helm', '?w=15m', '?focus=mac-tor&w=all', '']) {
      const s = parseViewState(q);
      expect(parseViewState(writeViewState(q, s))).toEqual(s);
    }
    expect(writeViewState('', { focus: ['helm', 'somtor'], w: '1h', sel: 'helm' })).toBe('?focus=helm%2Csomtor&w=1h&sel=helm');
  });

  it('bad values fall back to defaults (w = 1h, C-D3)', () => {
    expect(DEFAULT_VIEW).toEqual({ focus: [], w: '1h', sel: null });
    expect(parseViewState('?w=2d')).toEqual(DEFAULT_VIEW);
    expect(parseViewState('?w=')).toEqual(DEFAULT_VIEW);
    expect(parseViewState('?sel=<script>&focus=,,,')).toEqual(DEFAULT_VIEW);
    expect(parseViewState('?focus=helm,bad name,%3Cx%3E,ez')).toEqual({ focus: ['helm', 'ez'], w: '1h', sel: null });
  });

  it('normalises keys: lower-case, deduped', () => {
    expect(parseViewState('?focus=SomTor,somtor,HELM&sel=SomTor')).toEqual({ focus: ['somtor', 'helm'], w: '1h', sel: 'somtor' });
  });

  it('writing keeps unrelated params and drops empty ones', () => {
    expect(writeViewState('?x=1&focus=old', { focus: [], w: '15m', sel: null })).toBe('?x=1&w=15m');
    expect(writeViewState('?x=1', DEFAULT_VIEW)).toBe('?x=1&w=1h');
  });
});
