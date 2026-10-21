import { describe, expect, it } from 'bun:test';
import { getDocDisplayInfo, repoRelativePath } from '../docDisplay';

describe('View on GitHub URL', () => {
  it('keeps the main ref for ../Projects/<repo>/… paths (was blob/Projects/… 404)', () => {
    const info = getDocDisplayInfo('../Projects/marketing-agency-team/brain/Episodic/sessions/a.md', 'github.com/tordash/marketing-agency-team');
    expect(info.fileUrl).toBe('https://github.com/tordash/marketing-agency-team/blob/main/brain/Episodic/sessions/a.md');
  });
  it('leaves plain repo-relative and github.com/ paths as they were', () => {
    expect(getDocDisplayInfo('brain/Episodic/x.md', 'github.com/tordash/marketing-agency-team').fileUrl)
      .toBe('https://github.com/tordash/marketing-agency-team/blob/main/brain/Episodic/x.md');
    expect(getDocDisplayInfo('github.com/tordash/somtor-oracle/ψ/x.md', 'github.com/tordash/somtor-oracle').fileUrl)
      .toBe('https://github.com/tordash/somtor-oracle/blob/main/ψ/x.md');
  });
  it('bare ψ/ vault docs get no link: the project tag is the caller, not the file\'s repo', () => {
    expect(getDocDisplayInfo('ψ/memory/learnings/x.md', 'github.com/tordash/somtor-oracle').fileUrl).toBeNull();
    expect(getDocDisplayInfo('ψ/learn/o/r/origin/README.md', 'github.com/tordash/tor-oracle').fileUrl).toBeNull();
  });
  it('../ghq/github.com/<owner>/<repo>/… links to that repo, with or without a project tag', () => {
    expect(getDocDisplayInfo('../ghq/github.com/tordash/SomTor-oracle/ψ/memory/x.md', '').fileUrl)
      .toBe('https://github.com/tordash/SomTor-oracle/blob/main/ψ/memory/x.md');
    expect(getDocDisplayInfo('../../ghq/github.com/o/r/a/b.md', 'github.com/x/y').fileUrl)
      .toBe('https://github.com/o/r/blob/main/a/b.md');
  });
  it('repo name matches case-insensitively; a leading ./ is dropped', () => {
    expect(repoRelativePath('../Projects/SomTor-oracle/ψ/x.md', 'github.com/tordash/somtor-oracle')).toBe('ψ/x.md');
    expect(repoRelativePath('./brain/x.md', 'github.com/o/r')).toBe('brain/x.md');
  });
  it('a ../ path that never reaches the repo gets no URL instead of a wrong one', () => {
    expect(getDocDisplayInfo('../elsewhere/x.md', 'github.com/o/r').fileUrl).toBeNull();
  });
  it('a folder named like the repo deeper in a normal path is kept', () => {
    expect(repoRelativePath('docs/r/x.md', 'github.com/o/r')).toBe('docs/r/x.md');
  });
});
