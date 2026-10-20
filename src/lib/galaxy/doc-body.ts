// Knowledge Galaxy — body lookup for the side sheet (pure, no DOM / three).
//
// Most map ids are vector-only (no row behind /api/doc/:id). The sheet must
// settle quickly into one of three states and never sit on a skeleton:
//   • 'doc'          — the doc row loaded
//   • 'not-indexed'  — /api/doc said 404 (or an { error } body): calm note
//   • 'unreachable'  — the request rejected, hit a non-404 error, or timed out
// A cold 404 from arra takes ~1.7 s, so ids known to 404 are remembered for the
// session: reopening the same star resolves instantly.
//
// A cold 200 is slower still: /api/doc/:id joins oracle_fts on its unindexed `id`
// column (an FTS5 scan), measured 3.8–5.5 s under load (studio#12 T21). arra is
// single-threaded and the scan is synchronous, so every request behind it waits too
// (a /api/similar that takes 0.35 s alone took 4.9 s next to a cold doc). The
// embedded sheet therefore reads the md file first (loadEmbeddedBody): the map record
// already carries source_file + project and /api/file answers in ~0.1 s.

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

/** Hard cap for /api/doc before "unreachable" — above the measured 5.5 s cold scan. */
export const DOC_BODY_TIMEOUT_MS = 15000;
/** /api/file is a disk read (~0.1 s); past this the doc row is tried instead. */
export const FILE_BODY_TIMEOUT_MS = 6000;
/** The skeleton says "still loading" after this long. */
export const DOC_BODY_SLOW_MS = 3500;

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

export type EmbeddedBodyResult<D> = { kind: 'file'; content: string } | DocBodyResult<D>;

export interface EmbeddedBodyDeps<D> extends DocBodyDeps<D> {
  getFile: (path: string, project?: string) => Promise<{ content: string; error?: string }>;
  fileTimeoutMs?: number;
}

/**
 * The embedded sheet's body, file first. `source` is the map record's file; when it
 * reads, /api/doc is never called (so it can't hold Related's /api/similar behind its
 * scan). Only a missing / failed / slow file falls back to the doc row (indexed text,
 * or the not-indexed / unreachable states). Never rejects.
 */
export async function loadEmbeddedBody<D>(
  id: string,
  source: { path: string; project?: string | null } | null | undefined,
  deps: EmbeddedBodyDeps<D>,
): Promise<EmbeddedBodyResult<D>> {
  if (source?.path) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), deps.fileTimeoutMs ?? FILE_BODY_TIMEOUT_MS);
    });
    try {
      const f = await Promise.race([deps.getFile(source.path, source.project ?? undefined), timeout]);
      if (f !== TIMEOUT && f && !f.error && f.content) return { kind: 'file', content: f.content };
    } catch {
      /* fall through to the doc row */
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return loadDocBody(id, deps);
}
