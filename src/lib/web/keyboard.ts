// Knowledge Web — keyboard map (pure).
//   ← / →   cycle clusters by size (inside a drill: the cluster's files)
//   Enter   enter the armed cluster / open the armed file (nothing armed: arm the first)
//   Esc     close the list → disarm → leave the cluster  (an open file closes itself)
//   + / −   zoom      Home   reset the view
// Tab still reaches labels and controls; the page ignores keys typed into inputs.

export type KeyTarget = { kind: 'star' | 'cluster' | 'edge'; index: number } | null;

export interface KeyState {
  drilled: number;
  armed: KeyTarget;
  /** clusters, largest first */
  clusterOrder: readonly number[];
  /** files of the drilled cluster, in list order */
  starOrder: readonly number[];
  listOpen: boolean;
}

export type KeyAction =
  | { kind: 'arm'; target: { kind: 'star' | 'cluster'; index: number } }
  | { kind: 'enter'; cluster: number }
  | { kind: 'open'; star: number }
  | { kind: 'disarm' }
  | { kind: 'back' }
  | { kind: 'close-list' }
  | { kind: 'zoom'; factor: number }
  | { kind: 'home' };

export const ZOOM_IN = 0.72;
export const ZOOM_OUT = 1.4;

function cycle(order: readonly number[], current: number, dir: 1 | -1): number {
  if (order.length === 0) return -1;
  const i = order.indexOf(current);
  if (i < 0) return dir > 0 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

export function keyboardAction(key: string, s: KeyState): KeyAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (s.drilled >= 0) {
        const cur = s.armed?.kind === 'star' ? s.armed.index : -1;
        const next = cycle(s.starOrder, cur, dir);
        return next >= 0 ? { kind: 'arm', target: { kind: 'star', index: next } } : null;
      }
      const cur = s.armed?.kind === 'cluster' ? s.armed.index : -1;
      const next = cycle(s.clusterOrder, cur, dir);
      return next >= 0 ? { kind: 'arm', target: { kind: 'cluster', index: next } } : null;
    }
    case 'Enter': {
      if (s.armed?.kind === 'cluster' && s.armed.index !== s.drilled) return { kind: 'enter', cluster: s.armed.index };
      if (s.armed?.kind === 'star') return { kind: 'open', star: s.armed.index };
      if (!s.armed) {
        const first = s.drilled >= 0 ? s.starOrder[0] : s.clusterOrder[0];
        if (first == null) return null;
        return { kind: 'arm', target: { kind: s.drilled >= 0 ? 'star' : 'cluster', index: first } };
      }
      return null;
    }
    case 'Escape':
      if (s.listOpen) return { kind: 'close-list' };
      if (s.armed) return { kind: 'disarm' };
      if (s.drilled >= 0) return { kind: 'back' };
      return null;
    case '+':
    case '=':
      return { kind: 'zoom', factor: ZOOM_IN };
    case '-':
    case '_':
    case '−':
      return { kind: 'zoom', factor: ZOOM_OUT };
    case 'Home':
      return { kind: 'home' };
    default:
      return null;
  }
}

/** Keys typed into a text field (or with a command modifier) never drive the map. */
export function ignoreKeyEvent(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; defaultPrevented?: boolean; targetTag?: string; editable?: boolean }): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  if (e.editable) return true;
  const t = (e.targetTag ?? '').toUpperCase();
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
  // Enter on a focused button activates the button itself
  if (e.key === 'Enter' && (t === 'BUTTON' || t === 'A')) return true;
  return false;
}
