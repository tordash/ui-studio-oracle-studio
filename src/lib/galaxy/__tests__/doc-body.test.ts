import { describe, it, expect } from 'bun:test';
import { loadDocBody, loadEmbeddedBody, DOC_BODY_TIMEOUT_MS } from '../doc-body';

class HttpErr extends Error {
  status: number;
  constructor(status: number) { super(`HTTP ${status}`); this.status = status; }
}
const isNotFound = (e: unknown) => e instanceof HttpErr && e.status === 404;
const isHttpError = (e: unknown) => e instanceof HttpErr;

type Doc = { id: string; content: string };

describe('loadDocBody', () => {
  it('resolves a doc on 200', async () => {
    const r = await loadDocBody<Doc>('a', {
      getDoc: async id => ({ id, content: 'x' }), isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r).toEqual({ kind: 'doc', doc: { id: 'a', content: 'x' } });
  });

  it('settles on not-indexed as soon as the 404 lands, and memoises the id', async () => {
    const memo = new Set<string>();
    let calls = 0;
    const getDoc = async (): Promise<Doc> => { calls++; throw new HttpErr(404); };
    const t0 = performance.now();
    const r = await loadDocBody<Doc>('vec_1', { getDoc, isNotFound, isHttpError, notIndexed: memo, timeoutMs: 5000 });
    expect(r).toEqual({ kind: 'not-indexed' });
    expect(performance.now() - t0).toBeLessThan(200); // not held by the timeout
    expect(memo.has('vec_1')).toBe(true);
    const again = await loadDocBody<Doc>('vec_1', { getDoc, isNotFound, isHttpError, notIndexed: memo });
    expect(again).toEqual({ kind: 'not-indexed' });
    expect(calls).toBe(1); // reopen is instant, no second request
  });

  it('treats an { error } body as not-indexed', async () => {
    const r = await loadDocBody<Doc>('b', {
      getDoc: async () => ({ id: '', content: '', error: 'not found' }), isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r.kind).toBe('not-indexed');
  });

  it('maps a rejected fetch (network) to unreachable, not to "not in the index"', async () => {
    const memo = new Set<string>();
    const r = await loadDocBody<Doc>('c', {
      getDoc: async () => { throw new TypeError('Failed to fetch'); }, isNotFound, isHttpError, notIndexed: memo,
    });
    expect(r).toEqual({ kind: 'unreachable', reason: 'network' });
    expect(memo.size).toBe(0); // a network failure is retryable
  });

  it('maps a 5xx to unreachable/server', async () => {
    const r = await loadDocBody<Doc>('d', {
      getDoc: async () => { throw new HttpErr(500); }, isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r).toEqual({ kind: 'unreachable', reason: 'server' });
  });

  it('times out a hanging request instead of leaving the sheet on a skeleton', async () => {
    const t0 = performance.now();
    const r = await loadDocBody<Doc>('e', {
      getDoc: () => new Promise<Doc>(() => { /* never settles */ }), isNotFound, isHttpError, notIndexed: new Set(), timeoutMs: 40,
    });
    expect(r).toEqual({ kind: 'unreachable', reason: 'timeout' });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('an empty id resolves immediately as not-indexed', async () => {
    let called = false;
    const r = await loadDocBody<Doc>('', {
      getDoc: async () => { called = true; return { id: '', content: '' }; }, isNotFound, notIndexed: new Set(),
    });
    expect(r.kind).toBe('not-indexed');
    expect(called).toBe(false);
  });
});

describe('loadEmbeddedBody (file first)', () => {
  const src = { path: '../Projects/marketing-agency-team/brain/Episodic/x.md', project: 'github.com/tordash/marketing-agency-team' };

  it('reads the map record\'s file and never asks /api/doc (no FTS scan to stall /api/similar)', async () => {
    let docCalls = 0;
    const seen: [string, string | undefined][] = [];
    const r = await loadEmbeddedBody<Doc>('learning_../Projects/x_0', src, {
      getFile: async (p, proj) => { seen.push([p, proj]); return { content: '# hi' }; },
      getDoc: async id => { docCalls++; return { id, content: 'row' }; },
      isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r).toEqual({ kind: 'file', content: '# hi' });
    expect(seen).toEqual([[src.path, src.project]]);
    expect(docCalls).toBe(0);
  });

  it('falls back to the doc row when the file is missing, empty, throws or hangs', async () => {
    const cases: (() => Promise<{ content: string; error?: string }>)[] = [
      async () => ({ content: '', error: 'File not found' }),
      async () => ({ content: '' }),
      async () => { throw new TypeError('Failed to fetch'); },
      () => new Promise(() => { /* never settles */ }),
    ];
    for (const getFile of cases) {
      const r = await loadEmbeddedBody<Doc>('a', src, {
        getFile, getDoc: async id => ({ id, content: 'indexed' }), isNotFound, isHttpError, notIndexed: new Set(), fileTimeoutMs: 30,
      });
      expect(r).toEqual({ kind: 'doc', doc: { id: 'a', content: 'indexed' } });
    }
  });

  it('no source path → straight to the doc row; both missing → not-indexed', async () => {
    let fileCalls = 0;
    const r = await loadEmbeddedBody<Doc>('vec_9', null, {
      getFile: async () => { fileCalls++; return { content: 'x' }; },
      getDoc: async () => { throw new HttpErr(404); }, isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r).toEqual({ kind: 'not-indexed' });
    expect(fileCalls).toBe(0);
  });

  it('file gone + doc index down → unreachable (the sheet shows Try again)', async () => {
    const r = await loadEmbeddedBody<Doc>('b', src, {
      getFile: async () => ({ content: '', error: 'Cannot connect to server' }),
      getDoc: async () => { throw new TypeError('Failed to fetch'); }, isNotFound, isHttpError, notIndexed: new Set(),
    });
    expect(r).toEqual({ kind: 'unreachable', reason: 'network' });
  });

  it('the doc-row cap sits above the measured 5.5 s cold /api/doc scan', () => {
    expect(DOC_BODY_TIMEOUT_MS).toBeGreaterThan(5500);
  });
});
