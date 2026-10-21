// Knowledge Web — cluster keys and labels (pure, no DOM).
//
// One cluster per project. arra stores `project` as `github.com/<owner>/<repo>`
// (or null, or the odd free-text value). ต่อ's own repos appear under several
// owners (tordash, torsupakit, local) for the same repo, so those merge into one
// `own/<repo>` key (ต่อ Q1). Third-party owners stay separate.
//
//   github.com/tordash/somtor-oracle      → own/somtor-oracle
//   github.com/torsupakit/underdog        → own/underdog
//   github.com/nousresearch/hermes-agent  → github.com/nousresearch/hermes-agent
//   null / ''                             → ∅  (Unsorted)
//   "baan bangkok x underdog …"           → kept verbatim
//
// GitHub owner/repo names are case-insensitive, so github values are lowercased.

import { DISPLAY_NAMES } from './display-names';

/** Owners whose repos are ต่อ's own and merge into `own/<repo>`. */
export const OWN_OWNERS: readonly string[] = ['tordash', 'torsupakit', 'local'];

/** Key for files without a project tag. */
export const UNSORTED_KEY = '∅';

const GITHUB_RE = /^github\.com\/([^/\s]+)\/([^/\s]+)$/i;

export function clusterKey(project: string | null | undefined): string {
  if (project == null) return UNSORTED_KEY;
  const s = project.trim();
  if (!s) return UNSORTED_KEY;
  const m = GITHUB_RE.exec(s);
  if (!m) return s;
  const owner = m[1].toLowerCase();
  const repo = m[2].toLowerCase();
  return OWN_OWNERS.includes(owner) ? `own/${repo}` : `github.com/${owner}/${repo}`;
}

export type ParsedKey =
  | { kind: 'unsorted' }
  | { kind: 'repo'; own: boolean; owner: string; repo: string }
  | { kind: 'other'; value: string };

export function parseClusterKey(key: string): ParsedKey {
  if (key === UNSORTED_KEY) return { kind: 'unsorted' };
  if (key.startsWith('own/')) return { kind: 'repo', own: true, owner: 'own', repo: key.slice(4) };
  const m = GITHUB_RE.exec(key);
  if (m) return { kind: 'repo', own: false, owner: m[1], repo: m[2] };
  return { kind: 'other', value: key };
}

const stripOracle = (repo: string) => {
  const s = repo.replace(/-oracle$/, '');
  return s || repo;
};

/**
 * Display labels for every cluster key, unique across the set.
 *
 *   1. repo name minus a `-oracle` suffix (`somtor-oracle` → `somtor`), when that is unique;
 *   2. otherwise the full repo name — `<x>` and `<x>-oracle` are separate repos of the
 *      same owner (`nntn` vs `nntn-oracle`), so an owner suffix can't tell them apart;
 *   3. if the full name still collides across owners, third-party owners get ` · owner`
 *      (`hermes-agent` vs `hermes-agent · nousresearch`);
 *   4. DISPLAY_NAMES overrides win (`own/marketing-agency-team` → Helm).
 *
 * Unsorted is "Unsorted"; free-text project values are shown verbatim.
 * Output does not depend on the order of `keys`.
 */
export function clusterLabels(
  keys: Iterable<string>,
  overrides: Readonly<Record<string, string>> = DISPLAY_NAMES,
): Map<string, string> {
  const uniq = [...new Set(keys)].sort();
  const out = new Map<string, string>();
  const byShort = new Map<string, { key: string; own: boolean; owner: string; repo: string }[]>();

  for (const key of uniq) {
    const p = parseClusterKey(key);
    if (p.kind === 'unsorted') out.set(key, 'Unsorted');
    else if (p.kind === 'other') out.set(key, p.value);
    else {
      const short = stripOracle(p.repo);
      const g = byShort.get(short);
      const rec = { key, own: p.own, owner: p.owner, repo: p.repo };
      if (g) g.push(rec); else byShort.set(short, [rec]);
    }
  }

  for (const [short, group] of byShort) {
    if (group.length === 1) { out.set(group[0].key, short); continue; }
    const byRepo = new Map<string, number>();
    for (const r of group) byRepo.set(r.repo, (byRepo.get(r.repo) ?? 0) + 1);
    for (const r of group) {
      if (byRepo.get(r.repo) === 1 || r.own) out.set(r.key, r.repo);
      else out.set(r.key, `${r.repo} · ${r.owner}`);
    }
  }

  for (const key of uniq) {
    const o = overrides[key];
    if (o) out.set(key, o);
  }

  // safety net: any label still shared (e.g. an override equal to an automatic
  // label) gets its key appended, so a label always identifies one cluster
  const seen = new Map<string, string[]>();
  for (const key of uniq) {
    const l = out.get(key)!;
    const arr = seen.get(l);
    if (arr) arr.push(key); else seen.set(l, [key]);
  }
  for (const [label, ks] of seen) {
    if (ks.length < 2) continue;
    for (const k of ks) out.set(k, `${label} (${k})`);
  }
  return out;
}

/** Raw project values that merged into each key, sorted ("merged from N sources"). */
export function sourcesByKey(projects: Iterable<string | null | undefined>): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const p of projects) {
    const k = clusterKey(p);
    const raw = p == null || !p.trim() ? '(none)' : p.trim();
    const s = m.get(k);
    if (s) s.add(raw); else m.set(k, new Set([raw]));
  }
  const out = new Map<string, string[]>();
  for (const [k, s] of m) out.set(k, [...s].sort());
  return out;
}
