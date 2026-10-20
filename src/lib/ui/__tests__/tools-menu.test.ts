import { describe, it, expect } from 'bun:test';
import { toolsMenuReducer, TOOLS_CLOSED } from '../tools-menu';

describe('toolsMenuReducer', () => {
  it('tap toggles open / closed', () => {
    const o = toolsMenuReducer(TOOLS_CLOSED, { type: 'toggle' });
    expect(o.open).toBe(true);
    expect(toolsMenuReducer(o, { type: 'toggle' }).open).toBe(false);
  });
  it('Esc closes and asks for focus back on the trigger', () => {
    const o = toolsMenuReducer(TOOLS_CLOSED, { type: 'open' });
    const e = toolsMenuReducer(o, { type: 'escape' });
    expect(e).toEqual({ open: false, refocus: true });
    expect(toolsMenuReducer(e, { type: 'refocused' })).toEqual(TOOLS_CLOSED);
  });
  it('outside tap and navigation close without stealing focus', () => {
    const o = toolsMenuReducer(TOOLS_CLOSED, { type: 'open' });
    expect(toolsMenuReducer(o, { type: 'outside' })).toEqual(TOOLS_CLOSED);
    expect(toolsMenuReducer(o, { type: 'navigate' })).toEqual(TOOLS_CLOSED);
    expect(toolsMenuReducer(o, { type: 'close' })).toEqual(TOOLS_CLOSED);
  });
  it('is a no-op (same object) when nothing changes', () => {
    expect(toolsMenuReducer(TOOLS_CLOSED, { type: 'escape' })).toBe(TOOLS_CLOSED);
    expect(toolsMenuReducer(TOOLS_CLOSED, { type: 'outside' })).toBe(TOOLS_CLOSED);
    const o = toolsMenuReducer(TOOLS_CLOSED, { type: 'open' });
    expect(toolsMenuReducer(o, { type: 'open' })).toBe(o);
  });
});
