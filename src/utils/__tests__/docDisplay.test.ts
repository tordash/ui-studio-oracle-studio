import { describe, expect, it } from 'bun:test';
import { getDocDisplayInfo, repoRelativePath } from '../docDisplay';

describe('View on GitHub URL', () => {
  it('keeps the main ref for ../Projects/<repo>/… paths (was blob/Projects/… 404)', () => {
    const info = getDocDisplayInfo('../Projects/marketing-agency-team/brain/Episodic/sessions/a.md', 'github.com/tordash/marketing-agency-team');
    expect(info.fileUrl).toBe('https://github.com/tordash/marketing-agency-team/blob/main/brain/Episodic/sessions/a.md');
  });
  it('leaves plain repo-relative and github.com/ paths as they were', () => {
    expect(getDocDisplayInfo('ψ/memory/learnings/x.md', 'github.com/tordash/somtor-oracle').fileUrl)
      .toBe('https://github.com/tordash/somtor-oracle/blob/main/ψ/memory/learnings/x.md');
    expect(getDocDisplayInfo('github.com/tordash/somtor-oracle/ψ/x.md', 'github.com/tordash/somtor-oracle').fileUrl)
      .toBe('https://github.com/tordash/somtor-oracle/blob/main/ψ/x.md');
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
