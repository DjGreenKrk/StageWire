import type { Project, Id } from './types.ts';
import type { Mutator } from './store.ts';
import type { DiagramView } from './render/drawlist.ts';

/** Główny widok schematu zapisany w projekcie (`views`). Układ węzłów jest częścią projektu i podlega cofaniu (Q-28, ADR-041). */
export const VIEW_ID = 'viw_main';
/** Klucz węzła w widoku wynika z ID instancji (eqi_k1 → nod_k1); w nowym ID nie ma drugiego podkreślenia. */
export const nodeKey = (instanceId: Id): string => 'nod_' + instanceId.slice(instanceId.indexOf('_') + 1);

/** Zapis pozycji węzłów w jednej transakcji (tworzy widok, jeśli go nie ma). Zmiana tylko wtedy, gdy pozycja się różni. */
export function setNodePositions(moves: Record<Id, { x: number; y: number }>): Mutator {
  return (d) => {
    d.views ??= {};
    const v = (d.views[VIEW_ID] ??= { name: 'Schemat', kind: 'diagram', nodes: {}, edgeLayouts: {} });
    v.nodes ??= {};
    for (const [iid, pos] of Object.entries(moves)) {
      const x = Math.round(pos.x), y = Math.round(pos.y), k = nodeKey(iid), cur = v.nodes[k];
      if (cur && cur.instanceId === iid && cur.x === x && cur.y === y) continue;
      v.nodes[k] = { instanceId: iid, x, y };
    }
  };
}

/** Uzupełnia/nadpisuje układ widoku pozycjami z projektu; urządzeń bez zapisu nie rusza, usuniętych usuwa. */
export function syncLayout(p: Project, view: DiagramView, fallback: () => DiagramView): void {
  const blocks = Object.entries(p.cabinets ?? {}).filter(([, c]: [string, any]) => c.asBlock).map(([id]) => id);
  for (const id of Object.keys(view.nodes)) if (!p.equipment[id] && !blocks.includes(id)) delete view.nodes[id];
  const saved = p.views?.[VIEW_ID]?.nodes ?? {};
  let grid: DiagramView | undefined;
  for (const id of Object.keys(p.equipment)) {
    const s = saved[nodeKey(id)];
    if (s && s.instanceId === id) view.nodes[id] = { x: s.x, y: s.y };
    else if (!view.nodes[id]) view.nodes[id] = (grid ??= fallback()).nodes[id];
  }
  // blok szafy: zapisana pozycja albo miejsce pierwszego osprzętu z tej szafy
  for (const cid of blocks) {
    const s = saved[nodeKey(cid)];
    if (s && s.instanceId === cid) view.nodes[cid] = { x: s.x, y: s.y };
    else if (!view.nodes[cid]) { const first = Object.entries(p.equipment).find(([, i]: [string, any]) => i.din?.cabinetId === cid)?.[0]; view.nodes[cid] = { ...(first ? view.nodes[first] : { x: 0, y: 0 }) }; }
  }
}
