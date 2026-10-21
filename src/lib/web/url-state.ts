// Knowledge Web — URL state + history (pure).
//   /graph?c=<cluster key>&f=<doc id>       Unsorted is c=_unsorted
// Entering a cluster and opening a file each PUSH an entry, so the iOS swipe-back /
// Android back gesture closes the sheet first, then leaves the cluster. The in-app
// Back button pops when the current entry is one we pushed, and otherwise replaces
// (a shared link must never navigate out of the studio).

import { UNSORTED_KEY } from './keys';

export const UNSORTED_PARAM = '_unsorted';

export interface WebUrlState {
  /** cluster key (UNSORTED_KEY for Unsorted) or null for the overview */
  c: string | null;
  /** doc id of the open file, or null */
  f: string | null;
}

export function parseWebUrl(search: string): WebUrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const c = (p.get('c') ?? '').trim();
  const f = (p.get('f') ?? '').trim();
  return { c: c ? (c === UNSORTED_PARAM ? UNSORTED_KEY : c) : null, f: f || null };
}

/** `?c=…&f=…` (empty string for the overview). */
export function webSearch(s: WebUrlState): string {
  const p = new URLSearchParams();
  if (s.c) p.set('c', s.c === UNSORTED_KEY ? UNSORTED_PARAM : s.c);
  if (s.f) p.set('f', s.f);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export function webUrl(path: string, s: WebUrlState): string {
  return `${path}${webSearch(s)}`;
}

/** Resolve URL state against the loaded data: unknown c → overview, bad f → ignored. */
export function resolveWebState(
  s: WebUrlState,
  clusterKeys: readonly string[],
  starOfId: (id: string) => number,
  clusterOfStar: (i: number) => number,
): { cluster: number; star: number } {
  const star = s.f ? starOfId(s.f) : -1;
  let cluster = s.c ? clusterKeys.indexOf(s.c) : -1;
  if (cluster < 0 && star >= 0) cluster = clusterOfStar(star);
  return { cluster, star };
}

/** The state one level up: close the file first, then leave the cluster. */
export function parentState(s: WebUrlState): WebUrlState {
  if (s.f) return { c: s.c, f: null };
  return { c: null, f: null };
}

/**
 * Tracks the entries this page pushed, so "Back" knows whether popping stays inside
 * the page. `onLocation` must be called on every location change (push or pop).
 */
export class WebHistory {
  private stack: string[] = [];

  /** We are about to push `search` from the current location `from`. */
  push(from: string, search: string) {
    if (this.stack.length === 0 || this.stack[this.stack.length - 1] !== from) this.stack.push(from);
    this.stack.push(search);
  }

  /** A location change happened (ours or the browser's back/forward). */
  onLocation(search: string) {
    const i = this.stack.lastIndexOf(search);
    if (i >= 0) this.stack.length = i + 1;
    else this.stack = [search];
  }

  /** What the in-app Back button should do from `current`. */
  back(current: string): { kind: 'pop' } | { kind: 'replace'; search: string } {
    const n = this.stack.length;
    if (n >= 2 && this.stack[n - 1] === current) return { kind: 'pop' };
    return { kind: 'replace', search: webSearch(parentState(parseWebUrl(current))) };
  }
}
