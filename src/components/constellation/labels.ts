// Fleet Constellation — DOM label pool (≤ 12 absolutely positioned <button>s,
// projected per camera change; no 3D text). Buttons are real focus targets:
// Tab walks them, Enter selects. Mono 12 px, uppercase, 0.12em tracking, in
// the node colour at 80 %. Overlaps are resolved by the pure Galaxy
// declutter (read-only import).

import { declutterLabels } from '../../lib/galaxy/labels';
import { LABEL_MAX } from '../../lib/constellation/label-pool';

export interface LabelItem {
  key: string;
  text: string;
  color: string;
  /** anchor: bottom-centre, CSS px; NaN = hidden */
  x: number;
  y: number;
  priority: number;
}

const H = 22;
const CHAR_W = 8.7; // 12 px mono uppercase + 0.12em tracking
const PAD_X = 12;

export class DomLabelPool {
  private root: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private keys: (string | null)[] = [];
  private onSelect: (key: string) => void;

  constructor(container: HTMLElement, onSelect: (key: string) => void) {
    this.onSelect = onSelect;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    for (let i = 0; i < LABEL_MAX; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = 0;
      b.style.cssText = [
        'position:absolute', 'left:0', 'top:0', 'display:none', 'pointer-events:auto',
        `height:${H}px`, 'padding:0 6px', 'border:0', 'border-radius:6px', 'background:rgba(4,5,11,0.55)',
        'font:500 12px/22px ui-monospace,SFMono-Regular,Menlo,monospace', 'letter-spacing:0.12em', 'text-transform:uppercase',
        'white-space:nowrap', 'cursor:pointer', 'transform-origin:50% 100%',
      ].join(';');
      b.addEventListener('click', e => {
        e.stopPropagation();
        const k = this.keys[i];
        if (k) this.onSelect(k);
      });
      // keep pointer events on the label from reaching the canvas orbit
      b.addEventListener('pointerdown', e => e.stopPropagation());
      this.root.appendChild(b);
      this.buttons.push(b);
      this.keys.push(null);
    }
    container.appendChild(this.root);
  }

  update(items: readonly LabelItem[], width: number, height: number) {
    const boxes = items.map(it => ({ x: it.x, y: it.y, w: it.text.length * CHAR_W + PAD_X, h: H, priority: it.priority }));
    const placed = declutterLabels(boxes, width, height, { margin: 6 });
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      const it = items[i];
      const pl = placed[i];
      if (!it || !pl || !pl.visible) {
        if (b.style.display !== 'none') b.style.display = 'none';
        this.keys[i] = null;
        continue;
      }
      if (this.keys[i] !== it.key) {
        this.keys[i] = it.key;
        b.textContent = it.text;
        b.style.color = it.color;
        b.setAttribute('aria-label', `Select ${it.text}`);
      }
      const x = it.x - boxes[i].w / 2 + pl.dx;
      const y = it.y - H + pl.dy;
      b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (b.style.display !== 'block') b.style.display = 'block';
    }
  }

  dispose() {
    this.root.remove();
    this.buttons = [];
  }
}
