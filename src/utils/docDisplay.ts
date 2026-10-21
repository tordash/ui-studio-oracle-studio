/**
 * Shared helper for computing document display info (project links, vault URLs, paths).
 * Used across DocDetail, Traces, Superseded, and LogCard (search results).
 *
 * Vault repo is read from /api/stats (configured via `oracle-vault init`).
 * No hardcoded defaults — each subscriber has their own vault.
 */

/** Cached vault repo from /api/stats — null until loaded */
let _vaultRepo: string | null = null;

/** Call once on app init to set the vault repo from /api/stats */
export function setVaultRepo(repo: string) {
  _vaultRepo = repo;
}

function getVaultBase(): string | null {
  if (!_vaultRepo) return null;
  return `https://github.com/${_vaultRepo}/blob/main`;
}

export interface DocDisplayInfo {
  /** Clean display path (strips github.com/owner/repo/ prefix) */
  displayPath: string;
  /** URL to the project's directory in oracle-vault, or null */
  projectVaultUrl: string | null;
  /** Short display name for the project (e.g. "soul-brews-studio/shrimp-oracle") */
  projectDisplay: string | null;
  /** URL to the specific file in oracle-vault, or null if no vault configured */
  vaultUrl: string | null;
  /** URL to the file on the project's own GitHub repo (for "View on GitHub"), or null */
  fileUrl: string | null;
  /** True if no project is associated (universal doc) */
  isUniversal: boolean;
}

/**
 * Compute display info for a document.
 * @param sourceFile - The source_file path (e.g. "github.com/owner/repo/ψ/memory/learnings/foo.md")
 * @param project - Optional project field (e.g. "github.com/owner/repo")
 */
export function getDocDisplayInfo(sourceFile: string, project?: string | null): DocDisplayInfo {
  const displayPath = sourceFile.startsWith('github.com/')
    ? sourceFile.replace(/^github\.com\/[^/]+\/[^/]+\//, '')
    : sourceFile;
  const repoPath = repoRelativePath(displayPath, project);

  const isUniversal = !project;
  const vaultBase = getVaultBase();

  let projectVaultUrl: string | null = null;
  let projectDisplay: string | null = null;
  let fileUrl: string | null = null;
  let vaultUrl: string | null = null;

  if (project) {
    const ghProject = project.includes('github.com') ? project : `github.com/${project}`;
    if (vaultBase) projectVaultUrl = `${vaultBase}/${ghProject}`;
    projectDisplay = project.replace('github.com/', '');
    fileUrl = repoPath == null ? null : `https://${ghProject}/blob/main/${repoPath}`;
  }

  if (vaultBase) vaultUrl = `${vaultBase}/${sourceFile}`;

  return { displayPath, projectVaultUrl, projectDisplay, vaultUrl, fileUrl, isUniversal };
}

/**
 * Path inside the project's own repo, for a GitHub blob URL.
 * Docs indexed from a sibling root carry `../Projects/<repo>/brain/…`: in a URL the
 * `..` eats the `main` ref (github.com/o/r/blob/main/../Projects/… → blob/Projects/… → 404).
 * Strips leading `./`; a `../` path also drops everything through its first `<repo>/` segment.
 * Returns null when a `..` path never reaches the repo (no honest URL to build).
 */
export function repoRelativePath(path: string, project?: string | null): string | null {
  let p = path.replace(/^(\.\.?\/)+/, '');
  const climbed = p !== path && /^\.\.\//.test(path);
  const repo = (project ?? '').replace(/\/+$/, '').split('/').pop()?.toLowerCase();
  if (repo) {
    const segs = p.split('/');
    const i = segs.slice(0, -1).findIndex(seg => seg.toLowerCase() === repo);
    if (climbed) {
      if (i < 0) return null;
      p = segs.slice(i + 1).join('/');
    }
  }
  return p || null;
}
