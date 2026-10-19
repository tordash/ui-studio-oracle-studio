// Render-loop pause: tell an on-demand rAF loop when the tab is hidden or the canvas is offscreen.
// The caller keeps its own flags and cancels its rAF when either goes false.

export interface RenderGateHandlers {
  /** document visibilitychange → `!document.hidden` */
  onVisibility: (visible: boolean) => void;
  /** IntersectionObserver on the host (last entry wins). Never fires where IO is missing, so stay "on screen". */
  onScreen: (onScreen: boolean) => void;
}

/** Returns the disposer. */
export function bindRenderGate(el: Element, h: RenderGateHandlers): () => void {
  const onVisibility = () => h.onVisibility(!document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(entries => {
      const e = entries[entries.length - 1];
      h.onScreen(!!e && e.isIntersecting);
    });
    io.observe(el);
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    io?.disconnect();
    io = null;
  };
}
