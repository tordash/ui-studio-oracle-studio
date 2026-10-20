import { describe, it, expect } from 'bun:test';
import { keyboardAction, ignoreKeyEvent, ZOOM_IN, ZOOM_OUT } from '../keyboard';
import type { KeyState } from '../keyboard';
import { clusterRows, fileRows, listFootnote, FILE_PAGE } from '../list-model';
import type { WebModel } from '../peek-model';

const base: KeyState = { drilled: -1, armed: null, clusterOrder: [3, 0, 2, 1], starOrder: [], listOpen: false };

describe('keyboardAction', () => {
  it('← / → cycle clusters by size, wrapping', () => {
    expect(keyboardAction('ArrowRight', base)).toEqual({ kind: 'arm', target: { kind: 'cluster', index: 3 } });
    expect(keyboardAction('ArrowRight', { ...base, armed: { kind: 'cluster', index: 3 } })).toEqual({ kind: 'arm', target: { kind: 'cluster', index: 0 } });
    expect(keyboardAction('ArrowLeft', { ...base, armed: { kind: 'cluster', index: 3 } })).toEqual({ kind: 'arm', target: { kind: 'cluster', index: 1 } });
    expect(keyboardAction('ArrowLeft', base)).toEqual({ kind: 'arm', target: { kind: 'cluster', index: 1 } });
  });
  it('inside a drill ← / → cycle the cluster’s files', () => {
    const s = { ...base, drilled: 2, starOrder: [10, 11, 12] };
    expect(keyboardAction('ArrowRight', s)).toEqual({ kind: 'arm', target: { kind: 'star', index: 10 } });
    expect(keyboardAction('ArrowRight', { ...s, armed: { kind: 'star', index: 12 } })).toEqual({ kind: 'arm', target: { kind: 'star', index: 10 } });
    expect(keyboardAction('ArrowRight', { ...s, starOrder: [] })).toBeNull();
  });
  it('Enter drills into the armed cluster or opens the armed file', () => {
    expect(keyboardAction('Enter', { ...base, armed: { kind: 'cluster', index: 0 } })).toEqual({ kind: 'enter', cluster: 0 });
    expect(keyboardAction('Enter', { ...base, armed: { kind: 'star', index: 5 } })).toEqual({ kind: 'open', star: 5 });
    expect(keyboardAction('Enter', base)).toEqual({ kind: 'arm', target: { kind: 'cluster', index: 3 } });
    expect(keyboardAction('Enter', { ...base, armed: { kind: 'edge', index: 1 } })).toBeNull();
    expect(keyboardAction('Enter', { ...base, drilled: 0, armed: { kind: 'cluster', index: 0 } })).toBeNull();
  });
  it('Esc: list → disarm → back out', () => {
    expect(keyboardAction('Escape', { ...base, listOpen: true, armed: { kind: 'cluster', index: 0 } })).toEqual({ kind: 'close-list' });
    expect(keyboardAction('Escape', { ...base, armed: { kind: 'cluster', index: 0 } })).toEqual({ kind: 'disarm' });
    expect(keyboardAction('Escape', { ...base, drilled: 1 })).toEqual({ kind: 'back' });
    expect(keyboardAction('Escape', base)).toBeNull();
  });
  it('+ / − zoom, Home resets', () => {
    expect(keyboardAction('+', base)).toEqual({ kind: 'zoom', factor: ZOOM_IN });
    expect(keyboardAction('=', base)).toEqual({ kind: 'zoom', factor: ZOOM_IN });
    expect(keyboardAction('-', base)).toEqual({ kind: 'zoom', factor: ZOOM_OUT });
    expect(keyboardAction('Home', base)).toEqual({ kind: 'home' });
    expect(keyboardAction('x', base)).toBeNull();
  });
  it('ignores typing, modifiers, handled events, and Enter on buttons', () => {
    expect(ignoreKeyEvent({ key: 'ArrowRight', targetTag: 'input' })).toBe(true);
    expect(ignoreKeyEvent({ key: '+', ctrlKey: true })).toBe(true);
    expect(ignoreKeyEvent({ key: 'Escape', defaultPrevented: true })).toBe(true);
    expect(ignoreKeyEvent({ key: 'Enter', targetTag: 'BUTTON' })).toBe(true);
    expect(ignoreKeyEvent({ key: 'ArrowRight', targetTag: 'BUTTON' })).toBe(false);
    expect(ignoreKeyEvent({ key: 'a', editable: true })).toBe(true);
  });
});

const m: WebModel = {
  labels: ['somtor', 'arra', 'Unsorted', 'solo'],
  sizes: [92, 12, 300, 1],
  sources: [[], [], [], []],
  unsorted: 2,
  edges: [
    { a: 0, b: 1, w: 0.2, shared: 5, top5: 0.9, evidence: [{ concept: 'ci', share: 0.6, nA: 1, nB: 1 }, { concept: 'proof', share: 0.4, nA: 1, nB: 1 }] },
    { a: 0, b: 2, w: 0.1, shared: 9, top5: 0.4, evidence: [{ concept: 'session-notes', share: 0.3, nA: 1, nB: 1 }] },
  ],
  degree: [2, 1, 1, 0],
  orphans: [3],
  weak: {},
  totalFiles: 405,
  moteSource: 'estimate',
  moteTotal: 2400,
};

describe('list model (same data as the canvas)', () => {
  it('cluster rows: largest first, files / links / top shared concepts', () => {
    const rows = clusterRows(m);
    expect(rows.map(r => r.label)).toEqual(['Unsorted', 'somtor', 'arra', 'solo']);
    const som = rows.find(r => r.label === 'somtor')!;
    expect(som).toMatchObject({ files: 92, links: 2, unsorted: false, orphan: false });
    expect(som.concepts).toEqual(['ci', 'proof', 'session-notes']);
    expect(rows.find(r => r.label === 'solo')).toMatchObject({ links: 0, orphan: true, concepts: [] });
    expect(rows[0].unsorted).toBe(true);
  });
  it('file rows: newest first, 100 at a time', () => {
    const stars = Array.from({ length: 250 }, (_, i) => i);
    const titles = stars.map(i => `t${String(i).padStart(3, '0')}`);
    const dates = stars.map(i => (i % 10 === 0 ? null : i * 1000));
    const p1 = fileRows(stars, titles, dates, ms => (ms == null ? 'undated' : String(ms)), s => s % 3, 1);
    expect(FILE_PAGE).toBe(100);
    expect(p1.rows).toHaveLength(100);
    expect(p1.more).toBe(true);
    expect(p1.total).toBe(250);
    expect(p1.rows[0]).toEqual({ star: 249, title: 't249', date: '249000', links: 0 });
    const p3 = fileRows(stars, titles, dates, () => '', null, 3);
    expect(p3.rows).toHaveLength(250);
    expect(p3.more).toBe(false);
    expect(p3.rows[249].date).toBe('');
    expect(p3.rows[0].links).toBeNull();
  });
  it('footnote states the concept cap, coverage and the estimate', () => {
    const f = listFootnote(m, 0.814);
    expect(f[0]).toMatch(/first 10 concepts/);
    expect(f[1]).toMatch(/^81% of this cluster/);
    expect(f[2]).toMatch(/≈6 per file from 2,400 indexed chunks/);
    expect(listFootnote({ ...m, moteSource: 'real' }, null)).toHaveLength(1);
  });
});
