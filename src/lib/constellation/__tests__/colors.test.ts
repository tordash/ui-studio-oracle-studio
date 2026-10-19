import { describe, it, expect } from 'bun:test';
import { oracleColor, ORACLE_PALETTE, LEGACY_ORACLE_COLORS, NODE_COLOR, hashHue } from '../colors';

const HEX6 = /^#[0-9a-f]{6}$/;

describe('oracleColor', () => {
  it('curated set matches design §5', () => {
    expect(ORACLE_PALETTE).toEqual({
      helm: '#7dd3fc',
      somtor: '#fbbf24',
      mktexpert: '#f472b6',
      dopelab: '#a78bfa',
      ez: '#34d399',
      forge: '#fb923c',
      reelsmith: '#f87171',
    });
    expect(oracleColor('helm')).toBe('#7dd3fc');
  });

  it('is case-insensitive (SomTor = somtor)', () => {
    expect(oracleColor('SomTor')).toBe('#fbbf24');
    expect(oracleColor(' HELM ')).toBe('#7dd3fc');
  });

  it('keeps the old Pulse ORACLE_COLORS keys, lowercased', () => {
    for (const k of ['neo', 'mother', 'hermes', 'pulse', 'fireman', 'volt', 'nexus', 'dustboy', 'arthur', 'odin', 'homekeeper', 'xiaoer']) {
      expect(LEGACY_ORACLE_COLORS[k]).toBeDefined();
      expect(oracleColor(k)).toBe(LEGACY_ORACLE_COLORS[k]);
      expect(oracleColor(k.toUpperCase())).toBe(LEGACY_ORACLE_COLORS[k]);
    }
    expect(oracleColor('neo')).toBe('#64b5f6');
  });

  it('unknown name → golden-angle HSL(h, 70%, 68%) as deterministic 6-digit hex', () => {
    const a = oracleColor('synthetic-oracle-a');
    expect(a).toMatch(HEX6);
    expect(oracleColor('synthetic-oracle-a')).toBe(a);
    expect(oracleColor('Synthetic-Oracle-A')).toBe(a);
    expect(oracleColor('synthetic-oracle-b')).not.toBe(a);
    const h = hashHue('synthetic-oracle-a');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('a hash colour has HSL lightness ≈ 68 % and saturation ≈ 70 %', () => {
    const hex = oracleColor('synthetic-oracle-c');
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = (max - min) / (1 - Math.abs(2 * l - 1));
    expect(l).toBeCloseTo(0.68, 1);
    expect(s).toBeCloseTo(0.7, 1);
  });

  it('every output matches HEX6 — fallback, empty name and node colour included', () => {
    const names = ['', ' ', 'x', 'mac-tor', 'helm', 'neo', 'zz-top', '日本', 'สมต่อ', ...Array.from({ length: 50 }, (_, i) => `n${i}`)];
    for (const n of names) expect(oracleColor(n)).toMatch(HEX6);
    for (const v of Object.values(LEGACY_ORACLE_COLORS)) expect(v).toMatch(HEX6);
    expect(NODE_COLOR).toBe('#f5efe3');
    // Pulse appends alpha: color + '50' must be valid #rrggbbaa
    expect(oracleColor('anything') + '50').toMatch(/^#[0-9a-f]{8}$/);
  });
});
