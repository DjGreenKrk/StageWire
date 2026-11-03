// Grupy urządzeń na schemacie (ramka z nazwą, np. „FOH”, „Scena”) i automatyczne porządkowanie układu schematu po połączeniach.
import type { Project, Id } from './types.ts';
import type { Mutator } from './store.ts';
import { CommandError } from './store.ts';
import { effectivePosition } from './plan.ts';
import { NODE_W, nodeSize, outerRef, blockCabOf, type DiagramView, type Prim } from './render/drawlist.ts';

export interface Group { name: string; members: Id[]; color?: string; /** utworzona automatycznie z sal; „Grupy wg sal” zastępuje takie grupy */ auto?: boolean }
const HEX = /^#[0-9a-fA-F]{6}$/;
export const GROUP_COLORS = ['#64B5F6', '#81C784', '#FFB74D', '#BA68C8', '#4DB6AC', '#E57373'];
export const groupsOf = (p: Project): [Id, Group][] => Object.entries(((p as any).groups ?? {}) as Record<Id, Group>);

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const known = (d: Project, ids: Id[]) => ids.filter((i) => d.equipment[i] || d.cabinets?.[i]);

export const groupCmd = {
  /** Nowa grupa; urządzenie należy do najwyżej jednej grupy (przenosi się z poprzedniej). */
  add(id: Id, name: string, members: Id[], color?: string): Mutator {
    return (d) => {
      if (!clean(name)) throw new CommandError('Podaj nazwę grupy');
      if (color && !HEX.test(color)) throw new CommandError('Kolor w formacie #rrggbb');
      const g = ((d as any).groups ??= {}) as Record<Id, Group>;
      if (Object.values(g).some((x) => x.name === clean(name))) throw new CommandError(`Grupa „${clean(name)}” już istnieje`);
      const m = known(d as Project, members);
      for (const o of Object.values(g)) o.members = o.members.filter((x) => !m.includes(x));
      g[id] = { name: clean(name), members: m, ...(color ? { color: color.toLowerCase() } : {}) };
    };
  },
  update(id: Id, patch: { name?: string; color?: string | null; members?: Id[] }): Mutator {
    return (d) => {
      const g = ((d as any).groups ?? {}) as Record<Id, Group>, cur = g[id]; if (!cur) throw new CommandError(`Brak grupy ${id}`);
      if (patch.name !== undefined) {
        if (!clean(patch.name)) throw new CommandError('Podaj nazwę grupy');
        if (Object.entries(g).some(([k, x]) => k !== id && x.name === clean(patch.name!))) throw new CommandError(`Grupa „${clean(patch.name)}” już istnieje`);
        cur.name = clean(patch.name); delete cur.auto;
      }
      if (patch.color === null) delete cur.color; else if (patch.color !== undefined) { if (!HEX.test(patch.color)) throw new CommandError('Kolor w formacie #rrggbb'); cur.color = patch.color.toLowerCase(); }
      if (patch.members) {
        const m = known(d as Project, patch.members);
        for (const [k, o] of Object.entries(g)) if (k !== id) o.members = o.members.filter((x) => !m.includes(x));
        cur.members = m; delete cur.auto;
      }
    };
  },
  remove(id: Id): Mutator { return (d) => { const g = (d as any).groups; if (!g?.[id]) throw new CommandError(`Brak grupy ${id}`); delete g[id]; if (!Object.keys(g).length) delete (d as any).groups; }; },
  /** Grupy z sal: każde urządzenie stojące na planie trafia do grupy o nazwie sali (także w racku/szafie); poprzednie grupy automatyczne są zastępowane. */
  fromRooms(newIds: (n: number) => Id[]): Mutator {
    return (d) => {
      const g = ((d as any).groups ??= {}) as Record<Id, Group>;
      for (const [k, x] of Object.entries(g)) if (x.auto) delete g[k];
      const bySpace = new Map<Id, Id[]>();
      for (const id of Object.keys(d.equipment)) { if (blockCabOf(d as Project, id)) continue; const ep = effectivePosition(d as Project, id); if (ep) (bySpace.get(ep.spaceId) ?? bySpace.set(ep.spaceId, []).get(ep.spaceId)!).push(id); }
      const fresh = newIds(bySpace.size); let n = 0;
      for (const [sid, ids] of bySpace) {
        const name = clean(d.spaces?.[sid]?.name ?? sid);
        for (const o of Object.values(g)) o.members = o.members.filter((x) => !ids.includes(x));
        if (Object.values(g).some((x) => x.name === name)) continue;
        g[fresh[n++]] = { name, members: ids, color: GROUP_COLORS[(n - 1) % GROUP_COLORS.length], auto: true };
      }
      if (!Object.keys(g).length) delete (d as any).groups;
    };
  },
};

/** Węzeł schematu reprezentujący urządzenie (urządzenie w szafie narysowanej jako blok jest częścią bloku szafy). */
const nodeOf = (p: Project, id: Id): Id => blockCabOf(p, id) ?? id;

/** Ramki grup pod węzłami: prostokąt obejmujący węzły członków z marginesem i nazwą u góry. Ramki są prymitywami pod kablami i urządzeniami. */
export function groupFrames(p: Project, v: DiagramView): Prim[] {
  const out: Prim[] = [], PAD = 18, TOP = 22;
  groupsOf(p).forEach(([gid, g], gi) => {
    const nodes = [...new Set(g.members.map((m) => nodeOf(p, m)))].filter((n) => v.nodes[n] && (p.equipment[n] || p.cabinets?.[n]));
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { const q = v.nodes[n], [w, h] = nodeSize(p, n); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + w); y1 = Math.max(y1, q.y + h); }
    const col = g.color ?? GROUP_COLORS[gi % GROUP_COLORS.length];
    out.push({ t: 'rect', id: gid, x: (x0 + x1) / 2, y: (y0 - TOP + y1 + PAD) / 2, w: x1 - x0 + 2 * PAD, h: y1 - y0 + TOP + PAD, rot: 0, fill: col + '14', stroke: col, lw: 1.5 });
    out.push({ t: 'text', id: gid, x: x0 - PAD + 8, y: y0 - TOP + 15, s: g.name, size: 14, color: col });
  });
  return out;
}

/**
 * Układ „od źródeł do odbiorników”: kolumny wg najdłuższej ścieżki po połączeniach (wyjście → wejście), a w kolumnie kolejność wg położenia sąsiadów po lewej.
 * Gdy są grupy, każda grupa dostaje własny pas (jeden pod drugim, kolumny wspólne), reszta urządzeń leży w pasie na dole; urządzenia bez połączeń na samym końcu.
 */
export function autoLayout(p: Project): Record<Id, { x: number; y: number }> {
  const nodes = [...Object.keys(p.equipment).filter((i) => !blockCabOf(p, i)), ...Object.entries(p.cabinets ?? {}).filter(([, c]: [string, any]) => c.asBlock).map(([k]) => k)];
  const name = (n: Id) => ((p.equipment[n] ?? p.cabinets?.[n]) as any)?.name ?? n;
  const succ = new Map<Id, Set<Id>>(), pred = new Map<Id, Set<Id>>();
  for (const n of nodes) { succ.set(n, new Set()); pred.set(n, new Set()); }
  for (const c of Object.values(p.connections)) {
    const a = outerRef(p, c.from)?.instanceId, b = outerRef(p, c.to)?.instanceId; if (!a || !b || a === b || !succ.has(a) || !succ.has(b)) continue;
    // kierunek: od portu wyjściowego do wejściowego (połączenia zapisano od → do)
    succ.get(a)!.add(b); pred.get(b)!.add(a);
  }
  const layer = new Map<Id, number>(nodes.map((n) => [n, 0]));
  for (let it = 0; it < nodes.length; it++) { let ch = false; for (const n of nodes) for (const s of succ.get(n)!) if (layer.get(s)! < layer.get(n)! + 1 && layer.get(n)! < nodes.length) { layer.set(s, layer.get(n)! + 1); ch = true; } if (!ch) break; }
  const linked = nodes.filter((n) => succ.get(n)!.size || pred.get(n)!.size), loose = nodes.filter((n) => !succ.get(n)!.size && !pred.get(n)!.size);
  const lanes: Id[][] = []; // członkowie grupy bez połączeń zostają w jej pasie
  const used = new Set<Id>();
  for (const [, g] of groupsOf(p)) { const m = nodes.filter((n) => g.members.some((x) => nodeOf(p, x) === n) && !used.has(n)); m.forEach((n) => used.add(n)); if (m.length) lanes.push(m); }
  const rest = linked.filter((n) => !used.has(n)); if (rest.length) lanes.push(rest);
  const GAPX = 150, GAPY = 36, LANE_GAP = 90, out: Record<Id, { x: number; y: number }> = {}, yOf = new Map<Id, number>();
  let y = 0, maxCol = 0;
  for (const lane of lanes) {
    const cols = new Map<number, Id[]>(); for (const n of lane) (cols.get(layer.get(n)!) ?? cols.set(layer.get(n)!, []).get(layer.get(n)!)!).push(n);
    let laneH = 0;
    for (const l of [...cols.keys()].sort((a, b) => a - b)) {
      const list = cols.get(l)!, bary = (n: Id) => { const ys = [...pred.get(n)!].map((q) => yOf.get(q)).filter((v): v is number => v !== undefined); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity; };
      list.sort((a, b) => (bary(a) - bary(b)) || name(a).localeCompare(name(b), 'pl', { numeric: true }));
      let cy = y; for (const n of list) { out[n] = { x: l * (NODE_W + GAPX), y: cy }; yOf.set(n, cy); cy += nodeSize(p, n)[1] + GAPY; maxCol = Math.max(maxCol, l); }
      laneH = Math.max(laneH, cy - y);
    }
    y += laneH + LANE_GAP;
  }
  // urządzenia bez połączeń: siatka pod resztą
  const free = loose.filter((n) => !used.has(n)), per = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(free.length)))); let cx = 0, cy = y, rowH = 0;
  free.forEach((n, i) => { if (i && i % per === 0) { cx = 0; cy += rowH + GAPY; rowH = 0; } out[n] = { x: cx, y: cy }; cx += NODE_W + 60; rowH = Math.max(rowH, nodeSize(p, n)[1]); });
  return out;
}
