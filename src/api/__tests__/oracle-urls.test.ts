// URL building for ids that contain `../` and `/` (studio#12 T21: the sheet's doc id is
// `learning_../Projects/…_0`). The client must send ONE encoding, keep the `..` inside its
// segment (not a dot-segment), and the serve.ts proxy forwards `new URL(req.url).pathname`
// untouched — so arra receives exactly the id.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { API_BASE, getDoc, getSimilar, getFile } from '../oracle';

const ID = 'learning_../Projects/marketing-agency-team/brain/Episodic/2026-03-05-content-series-research-journal_0';
const PATH = '../Projects/marketing-agency-team/brain/Episodic/2026-03-05-content-series-research-journal.md';
const PROJECT = 'github.com/tordash/marketing-agency-team';
const ENC_ID = 'learning_..%2FProjects%2Fmarketing-agency-team%2Fbrain%2FEpisodic%2F2026-03-05-content-series-research-journal_0';

const realFetch = globalThis.fetch;
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: ID, type: 'learning', content: 'x', source_file: PATH, concepts: [], results: [], docId: ID }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

/** What bin/serve.ts forwards: `${API_URL}${url.pathname}${url.search}` of the incoming request. */
const proxied = (u: string) => {
  const url = new URL(u, 'http://127.0.0.1:3112');
  return `${url.pathname}${url.search}`;
};

describe('doc id URLs (ids with ../ and /)', () => {
  it('getDoc: one encoding, %2F for every slash, `..` kept inside its segment', async () => {
    await getDoc(ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${API_BASE}/doc/${ENC_ID}`);
    expect(calls[0]).not.toContain('%25'); // never double-encoded
    // the proxy hop neither collapses `..` nor decodes %2F
    expect(proxied(calls[0])).toBe(calls[0].replace(/^https?:\/\/[^/]+/, ''));
    expect(decodeURIComponent(new URL(calls[0], 'http://h').pathname.split('/doc/')[1])).toBe(ID);
  });

  it('getSimilar: the id travels as one query value', async () => {
    await getSimilar(ID, 12);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0], 'http://h');
    expect(u.pathname.endsWith('/api/similar')).toBe(true);
    expect(u.searchParams.get('id')).toBe(ID);
    expect(u.searchParams.get('limit')).toBe('12');
    expect(proxied(calls[0])).toContain(`id=${ENC_ID}`);
  });

  it('getFile: path + project are query values (the sheet reads the md this way first)', async () => {
    await getFile(PATH, PROJECT);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0], 'http://h');
    expect(u.pathname.endsWith('/api/file')).toBe(true);
    expect(u.searchParams.get('path')).toBe(PATH);
    expect(u.searchParams.get('project')).toBe(PROJECT);
  });
});
