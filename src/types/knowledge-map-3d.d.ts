// Type stub for `knowledge-map-3d` (#10).
//
// The package ships raw .ts ("types": "src/index.ts"), so `tsc -b` followed its
// imports into KnowledgeMap.tsx / useHandTracking.ts and applied this repo's
// noUnusedLocals to them (skipLibCheck only skips .d.ts files). tsconfig.app.json
// `paths` points the bare specifier here instead. Runtime is unchanged: Vite has
// no tsconfig-paths plugin, so it still bundles the real package.
//
// The data types come straight from the package's types.ts (interfaces only, no
// imports — safe to typecheck). The component is declared with the props that
// src/components/planets/PlanetsCanvas.tsx passes.

import type { ReactElement } from 'react';
import type { MapDocument, ClusterMeta, NebulaMeta, Stats } from 'knowledge-map-3d/src/types';

export type { MapDocument, ClusterMeta, NebulaMeta, Stats } from 'knowledge-map-3d/src/types';

export interface KnowledgeMapProps {
  documents: MapDocument[];
  clusters: ClusterMeta[];
  nebulae: NebulaMeta[];
  stats?: Stats | null;
  onDocumentClick?: (doc: MapDocument) => void;
  onClusterClick?: (cluster: ClusterMeta) => void;
  highlightIds?: Set<string>;
  embedded?: boolean;
  typeColors?: Record<string, string>;
  typeFilters?: string[];
  onTypeFilterChange?: (filter: string) => void;
  sidebarTitle?: string;
  ambientAudioSrc?: string;
  className?: string;
  heightMode?: 'full' | 'auto' | 'embed';
}

export declare function KnowledgeMap(props: KnowledgeMapProps): ReactElement;
