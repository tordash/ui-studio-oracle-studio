import { describe, it, expect } from 'bun:test';
import { peekModel, pct, webSummary, enteredText, diffuseNote, moteNote, clusterSubtitle } from '../peek-model';
import type { WebModel, StarInfo } from '../peek-model';
import type { InterEdge } from '../inter';

const edges: InterEdge[] = [
  {
    a: 0, b: 1, w: 0.133, shared: 12, top5: 0.9,
    evidence: [
      { concept: 'story-pipeline', share: 0.34, nA: 12, nB: 30 },
      { concept: 'ci', share: 0.21, nA: 8, nB: 9 },
      { concept: 'proof', share: 0.12, nA: 5, nB: 4 },
      { concept: 'review', share: 0.1, nA: 3, nB: 3 },
    ],
  },
  {
    a: 2, b: 3, w: 0.313, shared: 1457, top5: 0.004,
    evidence: [{ concept: 'news-card', share: 0.0012, nA: 40, nB: 31 }],
  },
];

const m: WebModel = {
  labels: ['somtor', 'arra-oracle-v3', 'Helm', 'Unsorted', 'reelsmith'],
  sizes: [92, 12, 4734, 5311, 1],
  sources: [['github.com/tordash/somtor-oracle'], ['github.com/tordash/arra-oracle-v3'], ['github.com/local/marketing-agency-team', 'github.com/tordash/marketing-agency-team'], ['(none)'], ['github.com/tordash/reelsmith-oracle']],
  unsorted: 3,
  edges,
  degree: [1, 1, 1, 1, 0],
  orphans: [4],
  weak: { 4: [{ b: 2, w: 0.004, shared: 2 }] },
  totalFiles: 10150,
  moteSource: 'estimate',
  moteTotal: 60900,
};

describe('peekModel', () => {
  it('overview: real totals, Unsorted and estimate notes', () => {
    const v = peekModel(m, { kind: 'none', drilled: -1 });
    expect(v.title).toBe('5 clusters');
    expect(v.subtitle).toBe('10,150 files · 2 links');
    expect(v.notes).toEqual([
      'Unsorted (grey, dashed links) = 5,311 files without a project tag',
      'Chunk particles: ≈6 per file, estimated from 60,900 indexed chunks · exact counts pending arra',
    ]);
    expect(v.actions.map(a => a.id)).toEqual(['list']);
  });

  it('cluster: links with top shared concepts, enter action, merged sources', () => {
    const v = peekModel(m, { kind: 'cluster', cluster: 0, drilled: false });
    expect(v.title).toBe('somtor');
    expect(v.subtitle).toBe('92 files');
    expect(v.rowsTitle).toBe('Links · 1');
    expect(v.rows[0]).toMatchObject({ label: 'arra-oracle-v3', value: '0.13', edge: 0, cluster: 1 });
    expect(v.rows[0].chips.map(c => c.text)).toEqual(['story-pipeline 34%', 'ci 21%', 'proof 12%']);
    expect(v.actions).toEqual([{ id: 'enter', label: 'Enter somtor' }]);
    expect(peekModel(m, { kind: 'cluster', cluster: 2, drilled: false }).subtitle).toBe('4,734 files · merged from 2 sources');
  });

  it('drilled cluster: honest coverage + back action', () => {
    const v = peekModel(m, { kind: 'cluster', cluster: 0, drilled: true, coverage: 0.891 });
    expect(v.facts).toEqual(['89% of files linked by shared concepts']);
    expect(v.actions).toEqual([{ id: 'back', label: 'All clusters' }]);
  });

  it('Unsorted says what it is; broad links are flagged', () => {
    const v = peekModel(m, { kind: 'cluster', cluster: 3, drilled: false });
    expect(v.eyebrow).toBe('Unsorted');
    expect(v.subtitle).toBe('5,311 files without a project tag');
    expect(v.notes).toContain('Unsorted is not a project: these files have no project tag in the index');
    expect(v.notes).toContain('Dimmed rows are broad overlaps: many shared concepts, none dominant');
    expect(v.rows[0].muted).toBe(true);
  });

  it('orphan: says why, lists weak matches', () => {
    const v = peekModel(m, { kind: 'cluster', cluster: 4, drilled: false });
    expect(v.subtitle).toBe('1 file');
    expect(v.notes).toContain('No link with ≥ 3 specific shared concepts');
    expect(v.rowsTitle).toBe('Closest weak matches');
    expect(v.rows[0]).toMatchObject({ label: 'Helm', value: '0.004', muted: true });
    expect(v.rows[0].chips[0].text).toBe('2 shared');
  });

  it('edge: exact evidence shares, file counts per side, "+N more"', () => {
    const v = peekModel(m, { kind: 'edge', edge: 0 });
    expect(v.title).toBe('somtor ↔ arra-oracle-v3');
    expect(v.subtitle).toBe('weight 0.13 · 12 shared concepts');
    expect(v.rows.map(r => `${r.label} ${r.value}`)).toEqual(['story-pipeline 34%', 'ci 21%', 'proof 12%', 'review 10%']);
    expect(v.rows[0].chips.map(c => c.text)).toEqual(['12 somtor', '30 arra-oracle-v3']);
    expect(v.notes).toEqual(['+8 more shared concepts']);
  });

  it('diffuse edge: labelled broad, not hidden', () => {
    const v = peekModel(m, { kind: 'edge', edge: 1 });
    expect(v.notes[0]).toBe('Broad overlap: 1,457 shared concepts, top 5 = 0.4% of the weight');
    expect(v.notes).toContain('Link to Unsorted: files without a project tag');
    expect(v.rows[0].value).toBe('0.1%');
    expect(diffuseNote(edges[0])).toBeNull();
  });

  it('star: estimated chunks are labelled; links pending until the cluster loads', () => {
    const star: StarInfo = { index: 7, title: 'story pipeline retro', cluster: 0, dateLabel: '20 Oct 2026', concepts: ['ci', 'proof'], chunks: 6, links: null };
    const v = peekModel(m, { kind: 'star', star });
    expect(v.eyebrow).toBe('somtor');
    expect(v.facts).toEqual(['20 Oct 2026', '≈6 chunks (estimated)']);
    expect(v.notes).toEqual(['Links appear when you enter the cluster']);
    expect(v.actions).toEqual([{ id: 'open', label: 'Open' }]);
    const real = peekModel({ ...m, moteSource: 'real' }, { kind: 'star', star: { ...star, chunks: 1, links: [{ title: 'ci notes', shared: ['ci', 'proof', 'x', 'y'] }] } });
    expect(real.facts[1]).toBe('1 chunk');
    expect(real.rowsTitle).toBe('Concept links · 1');
    expect(real.rows[0].chips.map(c => c.text)).toEqual(['ci', 'proof', 'x']);
    const none = peekModel(m, { kind: 'star', star: { ...star, links: [] } });
    expect(none.notes[0]).toMatch(/No concept link above the threshold/);
  });

  it('summary + live-region text', () => {
    expect(webSummary(m)).toBe('Knowledge Web: 5 nodes (one per cluster), 2 links between them, 10,150 files');
    expect(webSummary(m)).toMatch(/\d+\s*nodes/i); // e2e/graph.spec.ts reads body text
    expect(webSummary(m)).toMatch(/\d+\s*links/i);
    expect(enteredText('somtor', 92, 223)).toBe('Entered somtor: 92 files, 223 links');
    expect(enteredText('reelsmith', 1, null)).toBe('Entered reelsmith: 1 file');
    expect(pct(0.004)).toBe('0.4%');
    expect(pct(0.336)).toBe('34%');
    expect(moteNote({ moteSource: 'real', moteTotal: 1, totalFiles: 1 })).toBeNull();
    expect(moteNote({ moteSource: 'none', moteTotal: 0, totalFiles: 1 })).toMatch(/off/);
    expect(clusterSubtitle(m, 3)).toBe('5,311 files without a project tag');
  });
});
