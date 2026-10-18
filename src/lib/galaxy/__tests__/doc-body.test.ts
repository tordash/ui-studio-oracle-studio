import { describe, it, expect } from 'bun:test';
import { loadDocBody } from '../doc-body';

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
