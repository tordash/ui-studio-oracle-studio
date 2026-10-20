import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as shaders from '../shaders';
import { GLOW_POINT_FRAG } from '../../../lib/three/shaders';

type Decl = { kind: 'attribute' | 'uniform' | 'varying'; type: string; name: string };

function decls(src: string): Decl[] {
  const out: Decl[] = [];
  const re = /^\s*(attribute|uniform|varying)\s+(\w+)\s+(\w+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ kind: m[1] as Decl['kind'], type: m[2], name: m[3] });
  return out;
}
const DIM: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

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

const S = shaders as unknown as Record<string, string>;
const vertexNames = Object.keys(shaders.LAYOUTS) as (keyof typeof shaders.LAYOUTS)[];

describe('varying contracts', () => {
  const frag = decls(GLOW_POINT_FRAG).filter(d => d.kind === 'varying');
  it('GLOW_POINT_FRAG reads vColor/vAlpha/vHot', () => {
    expect(frag.map(d => `${d.type} ${d.name}`).sort()).toEqual(['float vAlpha', 'float vHot', 'vec3 vColor']);
  });
  for (const name of shaders.GLOW_POINT_SHADERS) {
    it(`${name} writes exactly the glow-point varyings`, () => {
      const v = decls(S[name]).filter(d => d.kind === 'varying');
      expect(v.map(d => `${d.type} ${d.name}`).sort()).toEqual(frag.map(d => `${d.type} ${d.name}`).sort());
      for (const d of v) expect(S[name]).toMatch(new RegExp(`\\b${d.name}\\s*=`));
    });
  }
  const lineFrag = decls(shaders.LINE_FRAG).filter(d => d.kind === 'varying');
  for (const name of shaders.LINE_SHADERS) {
    it(`${name} writes exactly LINE_FRAG's varyings`, () => {
      const v = decls(S[name]).filter(d => d.kind === 'varying');
      expect(v.map(d => `${d.type} ${d.name}`).sort()).toEqual(lineFrag.map(d => `${d.type} ${d.name}`).sort());
      for (const d of v) expect(S[name]).toMatch(new RegExp(`\\b${d.name}\\s*=`));
    });
  }
  it('HALO_VERT matches HALO_FRAG', () => {
    const a = decls(shaders.HALO_VERT).filter(d => d.kind === 'varying').map(d => `${d.type} ${d.name}`).sort();
    const b = decls(shaders.HALO_FRAG).filter(d => d.kind === 'varying').map(d => `${d.type} ${d.name}`).sort();
    expect(a).toEqual(b);
  });
});

describe('attribute layouts', () => {
  for (const name of vertexNames) {
    it(`${name}: GLSL attributes == LAYOUTS (names and sizes)`, () => {
      const attrs = decls(S[name]).filter(d => d.kind === 'attribute');
      const fromGlsl: Record<string, number> = {};
      for (const a of attrs) fromGlsl[a.name] = DIM[a.type];
      const layout: Record<string, number> = { ...shaders.LAYOUTS[name] };
      // three.js declares `position` itself; a shader may use it without declaring it
      if ('position' in layout && !('position' in fromGlsl)) fromGlsl.position = 3;
      expect(fromGlsl).toEqual(layout);
    });
  }
  it('ribbon instance attributes are part of its layout', () => {
    for (const a of shaders.RIBBON_INSTANCE_ATTRS) expect(a in shaders.LAYOUTS.RIBBON_VERT).toBe(true);
  });
});

describe('GLSL hygiene', () => {
  for (const [name, src] of Object.entries(S)) {
    if (typeof src !== 'string') continue;
    it(`${name}: no duplicate declarations`, () => {
      const names = decls(src).map(d => d.name);
      expect(new Set(names).size).toBe(names.length);
    });
    it(`${name}: every pow() base is non-negative by construction`, () => {
      for (const b of powBases(src)) expect(b).toMatch(/^(1\.0 - |max\()/);
    });
  }
  it('shared WEB_POS drives every star-attached shader', () => {
    for (const name of ['STAR_VERT', 'MOTE_VERT', 'HALO_VERT', 'INTRA_LINE_VERT', 'INTRA_PULSE_VERT']) {
      expect(S[name]).toContain('vec3 webStarPos(');
      expect(S[name]).toMatch(/webStarPos\(aCentre/);
    }
  });
  it('nothing uses Math.random (shaders are deterministic)', () => {
    const src = readFileSync(join(import.meta.dir, '../shaders.ts'), 'utf8');
    expect(src).not.toContain('Math.random');
  });
});
