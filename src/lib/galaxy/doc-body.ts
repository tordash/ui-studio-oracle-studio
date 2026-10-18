// Knowledge Galaxy — body lookup for the side sheet (pure, no DOM / three).
//
// Most map ids are vector-only (no row behind /api/doc/:id). The sheet must
// settle quickly into one of three states and never sit on a skeleton:
//   • 'doc'          — the doc row loaded
//   • 'not-indexed'  — /api/doc said 404 (or an { error } body): calm note
//   • 'unreachable'  — the request rejected, hit a non-404 error, or timed out
// A cold 404 from arra takes ~1.7 s, so ids known to 404 are remembered for the
// session: reopening the same star resolves instantly.

export type DocBodyResult<D> =
  | { kind: 'doc'; doc: D }
  | { kind: 'not-indexed' }
  | { kind: 'unreachable'; reason: 'timeout' | 'network' | 'server' };

export interface DocBodyDeps<D> {
  getDoc: (id: string) => Promise<D & { error?: string }>;
  /** true when the thrown error means "no such doc" (HTTP 404). */
  isNotFound: (e: unknown) => boolean;
  /** true when the thrown error is an HTTP error from the server (not a network failure). */
  isHttpError?: (e: unknown) => boolean;
  timeoutMs?: number;
  /** ids already known to 404 — defaults to a module-level set (session memo). */
  notIndexed?: Set<string>;
}

export const DOC_BODY_TIMEOUT_MS = 4000;

const sessionNotIndexed = new Set<string>();

const TIMEOUT = Symbol('timeout');

/** Never rejects. Resolves within `timeoutMs` even if `getDoc` hangs. */
export async function loadDocBody<D>(id: string, deps: DocBodyDeps<D>): Promise<DocBodyResult<D>> {
  const memo = deps.notIndexed ?? sessionNotIndexed;
  if (!id) return { kind: 'not-indexed' };
  if (memo.has(id)) return { kind: 'not-indexed' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>(resolve => {
    timer = setTimeout(() => resolve(TIMEOUT), deps.timeoutMs ?? DOC_BODY_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([deps.getDoc(id), timeout]);
    if (res === TIMEOUT) return { kind: 'unreachable', reason: 'timeout' };
    if (!res || (res as { error?: string }).error) {
      memo.add(id);
      return { kind: 'not-indexed' };
    }
    return { kind: 'doc', doc: res as D };
  } catch (e) {
    if (deps.isNotFound(e)) {
      memo.add(id);
      return { kind: 'not-indexed' };
    }
    return { kind: 'unreachable', reason: deps.isHttpError?.(e) ? 'server' : 'network' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
