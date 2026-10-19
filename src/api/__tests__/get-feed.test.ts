import { describe, it, expect, afterEach } from 'bun:test';
import { getFeed, ApiError } from '../oracle';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Call = { url: string; init?: RequestInit };
function mockFetch(res: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return res();
  }) as typeof fetch;
  return calls;
}

describe('getFeed', () => {
  it('returns the JSON body on 200 and passes limit / since', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ events: [], total: 0, active_oracles: [] }), { status: 200 }));
    const r = await getFeed({ limit: 100, since: '2026-10-18T14:00:00.000Z' });
    expect(r.total).toBe(0);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url, 'http://x');
    expect(u.pathname.endsWith('/api/feed')).toBe(true);
    expect(u.searchParams.get('limit')).toBe('100');
    expect(u.searchParams.get('since')).toBe('2026-10-18T14:00:00.000Z');
  });

  it('throws ApiError on a non-ok response (bug A: no silent res.json())', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
    let err: unknown;
    try { await getFeed({ limit: 1 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it('passes opts.signal to fetch', async () => {
    const calls = mockFetch(() => new Response('{"events":[],"total":0,"active_oracles":[]}', { status: 200 }));
    const ac = new AbortController();
    await getFeed({ limit: 1, signal: ac.signal });
    expect(calls[0].init?.signal).toBe(ac.signal);
  });
});
