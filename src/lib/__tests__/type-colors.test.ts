import { describe, it, expect } from 'bun:test';
import { getTypeColor, TYPE_COLORS, TYPE_COLOR_FALLBACK } from '../type-colors';

// Callers append a 2-digit alpha (`${color}33`), so every colour must be 6-digit hex:
// '#888' + '33' = '#88833' is invalid CSS and the whole declaration is dropped.
const HEX6 = /^#[0-9a-f]{6}$/i;

describe('type colours', () => {
  it('every type colour and the fallback are 6-digit hex', () => {
    expect(Object.entries(TYPE_COLORS).filter(([, c]) => !HEX6.test(c))).toEqual([]);
    expect(TYPE_COLOR_FALLBACK).toMatch(HEX6);
  });
  it('unknown and missing types get the fallback, which takes an alpha suffix', () => {
    expect(getTypeColor('nope')).toBe(TYPE_COLOR_FALLBACK);
    expect(getTypeColor(null)).toBe(TYPE_COLOR_FALLBACK);
    expect(getTypeColor(undefined)).toBe(TYPE_COLOR_FALLBACK);
    expect(`${getTypeColor(null)}33`).toMatch(/^#[0-9a-f]{8}$/i);
  });
});
