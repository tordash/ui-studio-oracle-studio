// T21: in the desktop peek panel (flex column, max-height, overflow-y auto) the card and its
// rows section were shrinkable (min-h-0), so a long link list was squeezed and the
// "Dimmed rows are broad overlaps…" note drew over the last row. The card must keep its
// content height (shrink-0) and let the panel scroll.
import { describe, it, expect } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PeekCard } from '../PeekCard';
import type { PeekView } from '../../../lib/web/peek-model';

const view: PeekView = {
  eyebrow: 'Cluster', title: 'Helm', subtitle: '4,735 files · merged from 2 sources', tint: 0,
  facts: ['81% of files linked by shared concepts'],
  rows: Array.from({ length: 5 }, (_, i) => ({
    key: `r${i}`, label: `cluster ${i}`, value: '0.31', muted: i === 4, edge: i, chips: [{ text: 'disk', detail: '34%' }],
  })) as PeekView['rows'],
  rowsTitle: 'Links · 5',
  notes: ['Dimmed rows are broad overlaps: many shared concepts, none dominant.'],
  actions: [{ id: 'back', label: 'All clusters' }] as PeekView['actions'],
};

describe('PeekCard layout', () => {
  const html = renderToStaticMarkup(createElement(PeekCard, { view, palette: ['#64b5f6'], titleId: 't', onAction: () => {}, onRow: () => {} }));

  it('the card root keeps its content height (shrink-0, never min-h-0)', () => {
    const root = html.match(/^<div class="([^"]*)"/)?.[1] ?? '';
    expect(root.split(/\s+/)).toContain('shrink-0');
    expect(root.split(/\s+/)).not.toContain('min-h-0');
  });

  it('the rows section cannot be squeezed under the notes', () => {
    const rows = html.match(/<section class="([^"]*)" aria-label="Links · 5"/)?.[1] ?? '';
    expect(rows.split(/\s+/)).toContain('shrink-0');
    expect(rows.split(/\s+/)).not.toContain('min-h-0');
    // notes come after the rows in document order
    expect(html.indexOf('Dimmed rows are broad overlaps')).toBeGreaterThan(html.indexOf('cluster 4'));
  });
});
