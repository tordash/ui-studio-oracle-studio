// Shared "space" surface styles for the 3D pages (moved from pages/Map.tsx so Knowledge
// Web reuses them without importing a page module).

/** The one glass recipe (sparingly: floating controls and cards over the canvas). */
export const GLASS = { background: 'rgba(9, 10, 22, 0.66)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } as const;

export const SPACE_BG =
  'radial-gradient(1100px 760px at 62% 38%, rgba(58, 66, 150, 0.22), transparent 62%),' +
  'radial-gradient(800px 640px at 18% 82%, rgba(120, 64, 150, 0.12), transparent 60%),' +
  'linear-gradient(180deg, #05060f 0%, #03030a 100%)';
