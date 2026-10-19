// Fleet Constellation — shareable view state in the URL: ?focus=helm,somtor&w=1h&sel=helm (pure).
// Bad values fall back to the defaults (window 1h, decision C-D3); keys are lower-cased.

import type { WindowId } from './aggregate';
import { oracleKey } from './parse';

export interface ViewState {
  /** focused oracle keys (multi-select) */
  focus: string[];
  w: WindowId;
  /** selected node key */
  sel: string | null;
}

export const DEFAULT_VIEW: ViewState = { focus: [], w: '1h', sel: null };

const NAME = /^[\w.-]{1,64}$/;
const WINDOWS: readonly WindowId[] = ['15m', '1h', 'all'];

const cleanKey = (raw: string | null): string | null => {
  const k = oracleKey(raw ?? '');
  return NAME.test(k) ? k : null;
};

export function parseViewState(search: string): ViewState {
  const p = new URLSearchParams(search);
  const focus: string[] = [];
  for (const part of (p.get('focus') ?? '').split(',')) {
    const k = cleanKey(part);
    if (k && !focus.includes(k)) focus.push(k);
  }
  const w = p.get('w');
  return {
    focus,
    w: WINDOWS.includes(w as WindowId) ? (w as WindowId) : DEFAULT_VIEW.w,
    sel: cleanKey(p.get('sel')),
  };
}

/** Returns the new `location.search`, keeping unrelated params. */
export function writeViewState(search: string, v: ViewState): string {
  const p = new URLSearchParams(search);
  p.delete('focus');
  p.delete('w');
  p.delete('sel');
  if (v.focus.length) p.set('focus', v.focus.join(','));
  p.set('w', v.w);
  if (v.sel) p.set('sel', v.sel);
  const s = p.toString();
  return s ? `?${s}` : '';
}
