// Knowledge Web — which sheet / panel shows, derived from URL state + UI state (pure).
//
// The file sheet is open exactly while the URL names a file (`f`): every popstate /
// location change re-derives it, so browser back (or the in-app Back) closes it.
// While drilled, closing the file brings the cluster's peek card back. On phones that
// card is a bottom sheet; at its peek / half snap it is a non-modal labelled REGION
// (like the desktop card), and only a dialog (modal) when expanded to full — so after
// "back" the only dialog on screen is gone (T21: the test's [role="dialog"] matched the
// returning cluster card, not the file sheet, which had already closed).

import type { SnapPoint } from '../ui/sheet-snap';

export interface SheetInputs {
  /** resolved star of the URL's `f` (-1 = none) */
  openStar: number;
  /** a peek model exists (armed target, or the drilled cluster) */
  hasPeek: boolean;
  wide: boolean;
  listOpen: boolean;
  peekSnap: SnapPoint;
}

export interface SheetState {
  /** the file sheet (role="dialog") */
  doc: boolean;
  /** desktop peek card (a labelled region) */
  peekPanel: boolean;
  /** phone peek bottom sheet */
  peekSheet: boolean;
  peekRole: 'dialog' | 'region';
}

export function webSheets(s: SheetInputs): SheetState {
  const doc = s.openStar >= 0;
  const peek = s.hasPeek && !doc;
  return {
    doc,
    peekPanel: peek && s.wide,
    peekSheet: peek && !s.wide && !s.listOpen,
    peekRole: s.peekSnap === 'full' ? 'dialog' : 'region',
  };
}
