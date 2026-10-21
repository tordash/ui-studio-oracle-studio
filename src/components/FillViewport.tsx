import { useLayoutEffect, useRef } from 'react';

// Promoted from pages/Map.tsx (GalaxyShell). The global nav changes height with the
// viewport, so the page measures where it starts instead of assuming a header height,
// and fills the rest of the dynamic viewport (iOS bars).
export function FillViewport({ className, style, children }: { className: string; style: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      el.style.height = `calc(100vh - ${top}px)`; // fallback where dvh is unsupported (invalid value is ignored)
      el.style.height = `calc(100dvh - ${top}px)`;
    };
    update();
    const ro = new ResizeObserver(update);
    const header = document.querySelector('header');
    if (header) ro.observe(header);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  // height is owned by the layout effect (runs before paint), never by React's style prop
  return <div ref={ref} className={className} style={style}>{children}</div>;
}
