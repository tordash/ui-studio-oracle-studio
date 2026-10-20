// Dev only (not CI): reproduce the Knowledge Web design numbers from a saved /api/map3d response.
//   curl -s <host>/api/map3d?model=bge-m3 > /tmp/map3d.json
//   bun scripts/web-stats.ts /tmp/map3d.json
// Never commit the snapshot itself.
import { readFileSync } from 'fs';
import { encodeForWorker } from '../src/lib/web/encode';
import { interEdges, isDiffuse } from '../src/lib/web/inter';
import { clusterLabels } from '../src/lib/web/keys';

const path = process.argv[2];
if (!path) { console.error('usage: bun scripts/web-stats.ts <map3d.json>'); process.exit(1); }
const data = JSON.parse(readFileSync(path, 'utf8'));
const t0 = performance.now();
const e = encodeForWorker(data.documents);
const t1 = performance.now();
const r = interEdges(e);
const t2 = performance.now();
const L = clusterLabels(e.clusterKeys);
const label = (i: number) => L.get(e.clusterKeys[i]) ?? e.clusterKeys[i];
const maxDeg = Math.max(...r.degree);
const ex = r.edges.map(x => x.top5).sort((a, b) => a - b);
console.log(`files ${e.n} · clusters ${e.clusterKeys.length} · concepts ${e.conceptNames.length}`);
console.log(`inter: ${r.edges.length} edges · max degree ${maxDeg} (${label(r.degree.indexOf(maxDeg))}) · ${r.orphans.length} orphans: ${r.orphans.map(label).join(', ')}`);
console.log(`top-5 share of weight: median ${ex[ex.length >> 1].toFixed(2)} · p10 ${ex[Math.floor(ex.length / 10)].toFixed(2)} · diffuse edges ${r.edges.filter(isDiffuse).length}`);
console.log(`time: encode ${(t1 - t0).toFixed(1)} ms · inter ${(t2 - t1).toFixed(1)} ms`);
for (const x of r.edges.slice(0, 10)) {
  console.log(`  ${label(x.a)} ↔ ${label(x.b)}  ${x.w.toFixed(3)}  ${x.evidence.slice(0, 3).map(v => `${v.concept} ${Math.round(v.share * 100)}%`).join(', ')}`);
}
