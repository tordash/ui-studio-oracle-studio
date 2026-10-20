// Header "Tools" menu state (pure). Opened by tap / click / keyboard — never by hover
// (S1: hover-only menus are unreachable on touch and by keyboard).

export interface ToolsMenuState { open: boolean; /** return focus to the trigger after Esc */ refocus: boolean }

export type ToolsMenuAction =
  | { type: 'toggle' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'escape' }
  | { type: 'outside' }
  | { type: 'navigate' }
  | { type: 'refocused' };

export const TOOLS_CLOSED: ToolsMenuState = { open: false, refocus: false };

export function toolsMenuReducer(s: ToolsMenuState, a: ToolsMenuAction): ToolsMenuState {
  switch (a.type) {
    case 'toggle': return { open: !s.open, refocus: false };
    case 'open': return s.open ? s : { open: true, refocus: false };
    case 'close':
    case 'outside':
    case 'navigate': return s.open ? { open: false, refocus: false } : s;
    case 'escape': return s.open ? { open: false, refocus: true } : s;
    case 'refocused': return s.refocus ? { ...s, refocus: false } : s;
  }
}
