import { describe, it, expect } from 'bun:test';
import * as shaders from '../shaders';

// GLSL ES: pow(x, y) is undefined for x < 0 (review r1 #3). Every pow() base in
// these shaders must be provably ≥ 0: `1.0 - <value in 0..1>` or max(…, 0.0).
const SAFE_BASE = /^(1\.0 - |max\()/;

function powBases(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf('pow(');
  while (i >= 0) {
    let depth = 0, j = i + 4;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) break;
    }
    out.push(src.slice(i + 4, j).trim());
    i = src.indexOf('pow(', j);
  }
  return out;
}

describe('shader pow() bases', () => {
  it('the parser finds bases', () => {
    expect(powBases('a = pow(t - 1.0, 3.0) + pow(max(x, 0.0), 2.0);')).toEqual(['t - 1.0', 'max(x, 0.0)']);
  });

  for (const [name, src] of Object.entries(shaders)) {
    if (typeof src !== 'string') continue;
    it(`${name}: every pow() base is non-negative by construction`, () => {
      for (const b of powBases(src)) expect(b).toMatch(SAFE_BASE);
    });
  }
});
