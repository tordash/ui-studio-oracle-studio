import { describe, it, expect } from 'bun:test';
import { clusterKey, clusterLabels, parseClusterKey, sourcesByKey, OWN_OWNERS, UNSORTED_KEY } from '../keys';
import { DISPLAY_NAMES } from '../display-names';
import { SNAPSHOT_PROJECTS, SNAPSHOT_TOTAL_FILES } from './fixtures/projects';

describe('clusterKey', () => {
  it('merges ต่อ’s own owners into own/<repo>', () => {
    expect(OWN_OWNERS).toEqual(['tordash', 'torsupakit', 'local']);
    expect(clusterKey('github.com/tordash/underdog')).toBe('own/underdog');
    expect(clusterKey('github.com/torsupakit/underdog')).toBe('own/underdog');
    expect(clusterKey('github.com/local/underdog')).toBe('own/underdog');
  });
  it('is case-insensitive for github values', () => {
    expect(clusterKey('GitHub.com/Tordash/SomTor-Oracle')).toBe('own/somtor-oracle');
    expect(clusterKey('github.com/NousResearch/hermes-agent')).toBe('github.com/nousresearch/hermes-agent');
  });
  it('keeps third-party owners separate', () => {
    expect(clusterKey('github.com/soul-brews-studio/arra-oracle-v3')).toBe('github.com/soul-brews-studio/arra-oracle-v3');
    expect(clusterKey('github.com/soul-brews-studio/arra-oracle-v3')).not.toBe(clusterKey('github.com/tordash/arra-oracle-v3'));
  });
  it('keeps non-github values verbatim (trimmed)', () => {
    const v = 'baan bangkok x underdog collab brew day — expat influencer invite';
    expect(clusterKey(v)).toBe(v);
    expect(clusterKey(`  ${v} `)).toBe(v);
    expect(clusterKey('github.com/a/b/c')).toBe('github.com/a/b/c');
  });
  it('maps null, undefined and blank to Unsorted', () => {
    expect(clusterKey(null)).toBe(UNSORTED_KEY);
    expect(clusterKey(undefined)).toBe(UNSORTED_KEY);
    expect(clusterKey('  ')).toBe(UNSORTED_KEY);
  });
  it('parses keys back', () => {
    expect(parseClusterKey('own/x')).toEqual({ kind: 'repo', own: true, owner: 'own', repo: 'x' });
    expect(parseClusterKey('github.com/o/r')).toEqual({ kind: 'repo', own: false, owner: 'o', repo: 'r' });
    expect(parseClusterKey(UNSORTED_KEY)).toEqual({ kind: 'unsorted' });
    expect(parseClusterKey('free text')).toEqual({ kind: 'other', value: 'free text' });
  });
});

describe('snapshot projects', () => {
  const keys = SNAPSHOT_PROJECTS.map(([p]) => clusterKey(p));
  const counts = new Map<string, number>();
  SNAPSHOT_PROJECTS.forEach(([, n], i) => counts.set(keys[i], (counts.get(keys[i]) ?? 0) + n));

  it('88 raw values → 77 clusters (76 named + Unsorted), no file lost', () => {
    expect(SNAPSHOT_PROJECTS.length).toBe(88);
    expect(counts.size).toBe(77);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(SNAPSHOT_TOTAL_FILES);
    expect(counts.get(UNSORTED_KEY)).toBe(5311);
    expect(counts.get('own/marketing-agency-team')).toBe(4733 + 1);
    expect(counts.get('own/underdog')).toBe(11 + 12);
  });

  it('gives all 77 clusters a unique label', () => {
    const labels = clusterLabels(counts.keys());
    expect(labels.size).toBe(77);
    expect(new Set(labels.values()).size).toBe(77);
  });

  it('labels: -oracle stripped when unique, twins keep the full repo, owner suffix across owners', () => {
    const l = clusterLabels(counts.keys());
    expect(l.get('own/somtor-oracle')).toBe('somtor');
    expect(l.get('own/tor-oracle')).toBe('tor');
    expect(l.get('own/exped-oracle')).toBe('exped');
    // <x> and <x>-oracle are separate repos of the same owner (ต่อ Q1)
    expect(l.get('own/nntn')).toBe('nntn');
    expect(l.get('own/nntn-oracle')).toBe('nntn-oracle');
    expect(l.get('own/underdog')).toBe('underdog');
    expect(l.get('own/underdog-oracle')).toBe('underdog-oracle');
    expect(l.get('github.com/rspongsakorn/underdog')).toBe('underdog · rspongsakorn');
    expect(l.get('own/hermes-agent')).toBe('hermes-agent');
    expect(l.get('github.com/nousresearch/hermes-agent')).toBe('hermes-agent · nousresearch');
    expect(l.get('github.com/soul-brews-studio/arra-oracle-v3')).toBe('arra-oracle-v3 · soul-brews-studio');
    expect(l.get('github.com/hu-uh/awesome-design-md')).toBe('awesome-design-md · hu-uh');
    expect(l.get('github.com/voltagent/awesome-design-md')).toBe('awesome-design-md · voltagent');
    expect(l.get(UNSORTED_KEY)).toBe('Unsorted');
    expect(l.get('baan bangkok x underdog collab brew day — expat influencer invite'))
      .toBe('baan bangkok x underdog collab brew day — expat influencer invite');
  });

  it('applies the Helm display override (ต่อ Q5)', () => {
    expect(DISPLAY_NAMES).toEqual({ 'own/marketing-agency-team': 'Helm' });
    expect(clusterLabels(counts.keys()).get('own/marketing-agency-team')).toBe('Helm');
    expect(clusterLabels(counts.keys(), {}).get('own/marketing-agency-team')).toBe('marketing-agency-team');
  });

  it('does not depend on input order', () => {
    const a = clusterLabels(counts.keys());
    const b = clusterLabels([...counts.keys()].reverse());
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  });

  it('a clashing override is disambiguated, never silently shared', () => {
    const l = clusterLabels(['own/a-oracle', 'own/b'], { 'own/b': 'a' });
    expect(l.get('own/a-oracle')).not.toBe(l.get('own/b'));
  });

  it('reports merged sources per key', () => {
    const s = sourcesByKey(SNAPSHOT_PROJECTS.map(([p]) => p));
    expect(s.get('own/marketing-agency-team')).toEqual([
      'github.com/local/marketing-agency-team', 'github.com/tordash/marketing-agency-team',
    ]);
    expect(s.get('own/dopelab')).toEqual([
      'github.com/local/dopelab', 'github.com/tordash/dopelab', 'github.com/torsupakit/dopelab',
    ]);
    expect(s.get(UNSORTED_KEY)).toEqual(['(none)']);
  });
});
