import type { Project } from './types.ts';

/** Generator syntetycznych projektów do benchmarków i testów własności. Deterministyczny (seed). */
/** local=true: pozycje na siatce i połączenia między sąsiadami (jak w prawdziwych schematach); false: losowe, długie połączenia (najgorszy przypadek). */
export function syntheticProject(devices: number, connections: number, seed = 1, local = false): Project {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const pad = (n: number) => n.toString(36).padStart(6, '0');
  const portsPer = 8;
  const mkPorts = (dir: 'in' | 'out') => Object.fromEntries(Array.from({ length: portsPer }, (_, i) => [
    `prt_${dir}${i}`, { label: `${dir.toUpperCase()} ${i + 1}`, order: i, connectorKey: 'std/bnc-75', signalKeys: ['std/sdi-3g'], direction: dir, side: 'auto' as const, capacity: 1 },
  ]));
  const p: Project = {
    formatVersion: '1.0.0-draft', id: 'prj_synth', name: 'Synthetic', settings: { stockCableLengthsMm: [1000, 3000, 5000, 10000, 20000] },
    registries: {
      'std/bnc-75': { kind: 'connector', name: 'BNC' },
      'std/sdi-3g': { kind: 'signal', name: 'SDI 3G', prefix: 'V' },
      'std/cable-sdi': { kind: 'cable', name: 'SDI', endPairs: [['std/bnc-75', 'std/bnc-75']], carriesSignals: ['std/sdi-3g'] },
    },
    definitions: { eqd_src: { latestRevision: 1, revisions: { '1': { manufacturer: 'Generic', model: 'Src', category: 'x', kind: 'physical', ports: mkPorts('out') } } },
                   eqd_dst: { latestRevision: 1, revisions: { '1': { manufacturer: 'Generic', model: 'Dst', category: 'x', kind: 'physical', ports: mkPorts('in') } } } },
    equipment: {}, connections: {}, cables: {}, placements: {}, spaces: { spc_hall: { name: 'Hall', boundary: [[0, 0], [100000, 0], [100000, 100000], [0, 100000]] } },
  };
  const srcIds: string[] = [], dstIds: string[] = [];
  for (let i = 0; i < devices; i++) {
    const isSrc = i % 2 === 0;
    const id = `eqi_${pad(i)}`;
    p.equipment[id] = { definitionId: isSrc ? 'eqd_src' : 'eqd_dst', definitionRevision: 1, name: `${isSrc ? 'SRC' : 'DST'}${i}`, supply: 'rental', portOverrides: {} };
    (isSrc ? srcIds : dstIds).push(id);
    p.placements![`plc_${pad(i)}`] = { spaceId: 'spc_hall', targetKind: 'equipment', targetId: id, position: local ? { x: (i % Math.ceil(Math.sqrt(devices))) * 1500 + 1000, y: Math.floor(i / Math.ceil(Math.sqrt(devices))) * 1500 + 1000, z: 0 } : { x: rnd() * 100000, y: rnd() * 100000, z: 0 }, rotationDeg: 0 };
  }
  // każdy port wyjściowy łączymy co najwyżej raz, każdy wejściowy co najwyżej raz
  const free = (ids: string[]) => ids.flatMap((id) => Array.from({ length: portsPer }, (_, i) => [id, i] as const));
  const outs = free(srcIds), ins = free(dstIds);
  for (let i = outs.length - 1; !local && i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ins[i], ins[j]] = [ins[j] ?? ins[i], ins[i]]; }
  const n = Math.min(connections, outs.length, ins.length);
  for (let k = 0; k < n; k++) {
    const [fi, fp] = outs[k], [ti, tp] = ins[k];
    p.connections[`cnx_${pad(k)}`] = { from: { instanceId: fi, portId: `prt_out${fp}` }, to: { instanceId: ti, portId: `prt_in${tp}` }, signalKey: 'std/sdi-3g', medium: 'physical', cableId: `cbl_${pad(k)}` };
    p.cables[`cbl_${pad(k)}`] = { cableTypeKey: 'std/cable-sdi', lengthSource: 'unknown' };
  }
  return p;
}
