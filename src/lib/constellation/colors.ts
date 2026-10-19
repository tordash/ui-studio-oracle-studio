// Fleet Constellation — one identity colour per oracle (shared with the Pulse list, decision Q7).
// Curated, additive-safe (~70 % luminance) set first, then the old Pulse
// upstream names, then a golden-angle hash hue. Every output is #rrggbb, so
// callers can append an alpha byte (`color + '50'`).

import { fnv1a, oracleKey } from './parse';

export const ORACLE_PALETTE: Record<string, string> = {
  helm: '#7dd3fc',
  somtor: '#fbbf24',
  mktexpert: '#f472b6',
  dopelab: '#a78bfa',
  ez: '#34d399',
  forge: '#fb923c',
  reelsmith: '#f87171',
};

/** Pulse's original ORACLE_COLORS (upstream oracle names), kept as fallbacks. */
export const LEGACY_ORACLE_COLORS: Record<string, string> = {
  neo: '#64b5f6',
  mother: '#ce93d8',
  hermes: '#ffb74d',
  pulse: '#4dd0e1',
  fireman: '#ef5350',
  volt: '#fdd835',
  nexus: '#81c784',
  dustboy: '#a1887f',
  arthur: '#ff8a65',
  odin: '#b39ddb',
  homekeeper: '#90a4ae',
  xiaoer: '#f48fb1',
};

/** Host / human node (mac-tor): warm white hollow ring, not an oracle (C-D2). */
export const NODE_COLOR = '#f5efe3';

const GOLDEN_ANGLE = 137.508;

/** Deterministic hue 0..360 for a key. */
export function hashHue(key: string): number {
  return (parseInt(fnv1a(oracleKey(key)), 16) * GOLDEN_ANGLE) % 360;
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function oracleColor(name: string): string {
  const k = oracleKey(name);
  return ORACLE_PALETTE[k] ?? LEGACY_ORACLE_COLORS[k] ?? hslHex(hashHue(k), 0.7, 0.68);
}
