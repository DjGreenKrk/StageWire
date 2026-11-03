import type { Id, Project } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { newId } from './ids.ts';

/**
 * Szafy i rozdzielnice na szynę DIN (ADR-052). Obudowa ma wymiary, rzędy szyn i liczbę modułów na rząd (1 moduł = 17,5 mm).
 * Osprzęt ma szerokość w modułach (`dinModules` w definicji); pozycja to wartość osadzona w instancji (`din`), jak `mount` w racku.
 * Terminale szafy: porty osprzętu oznaczone jako wchodzące i wychodzące z szafy (reszta jest wewnętrzna).
 */
export const MODULE_MM = 17.5;
export const ROW_PITCH_MM = 125;
export interface PortRef { instanceId: Id; portId: Id }
/** Terminal szafy. Terminale o tej samej `group` (np. „230 V”: L z bezpiecznika + N z bloku + PE z szyny, albo „DMX”: A, B, GND) są na schemacie jednym portem bloku. */
export interface Terminal extends PortRef { group?: string }
/** `asBlock`: na schemacie blokowym szafa jest jednym blokiem z samymi terminalami (osprzęt w środku ukryty). */
export interface Cabinet { name: string; widthMm: number; heightMm: number; depthMm?: number; rows: number; modules: number; notes?: string; terminals?: Terminal[]; asBlock?: boolean;
  /** Szafa jako moduł do racka 19″ (np. 3U z szyną DIN w środku): wysokość w U; pozycja w racku w `mount` (patrz racks.ts). */
  rackUnits?: { heightU: number }; mount?: { rackId: Id; uStart: number; face: 'front' | 'rear'; slot: 'full' | 'left' | 'center' | 'right' } }
export interface DinMount { cabinetId: Id; row: number; at: number; layer?: 'body' | 'busbar' }
/** Montaż na płycie montażowej szafy (element bez DIN przykręcony do obudowy), mm od lewego górnego rogu płyty. */
export interface PlateMount { cabinetId: Id; x: number; y: number }
/** Warstwa montażu z definicji: `busbar` = grzebień/mostek leżący na zaciskach aparatów, reszta `body`. */
export function layerOf(p: Project, instanceId: Id): 'body' | 'busbar' {
  const i = p.equipment[instanceId]; return i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]?.placementLayer === 'busbar' ? 'busbar' : 'body';
}
/** Szafa, w której jest instancja: na szynie DIN albo na płycie. */
export const cabinetOf = (p: Project, instanceId: Id): Id | undefined => { const i = p.equipment[instanceId]; return (i?.din as DinMount | undefined)?.cabinetId ?? (i?.plate as PlateMount | undefined)?.cabinetId; };

export const MAX_ROWS = 12, MAX_MODULES = 72;

/** Typowe obudowy do wyboru przy tworzeniu (wymiary orientacyjne, edytowalne). */
export const CABINET_PRESETS: { key: string; label: string; v: Omit<Cabinet, 'name' | 'terminals'> }[] = [
  { key: 'rack3u', label: 'Moduł 3U do racka (1 szyna, 24 mod.)', v: { widthMm: 482, heightMm: 133, depthMm: 120, rows: 1, modules: 24, rackUnits: { heightU: 3 } } },
  { key: 'rack6u', label: 'Moduł 6U do racka (3 szyny, 24 mod.)', v: { widthMm: 482, heightMm: 266, depthMm: 120, rows: 3, modules: 24, rackUnits: { heightU: 6 } } },
  { key: 'din2x12', label: 'Rozdzielnica 2 × 12 modułów', v: { widthMm: 300, heightMm: 350, depthMm: 120, rows: 2, modules: 12 } },
  { key: 'din3x18', label: 'Rozdzielnica 3 × 18 modułów', v: { widthMm: 400, heightMm: 500, depthMm: 150, rows: 3, modules: 18 } },
  { key: 'din4x24', label: 'Szafa 4 × 24 moduły', v: { widthMm: 600, heightMm: 650, depthMm: 200, rows: 4, modules: 24 } },
];

/** Szerokość w modułach z aktualnej rewizji; undefined = urządzenie nie jest na szynę DIN. */
export function dinFit(p: Project, instanceId: Id): number | undefined {
  const i = p.equipment[instanceId]; const m = i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]?.dinModules;
  return typeof m === 'number' ? m : undefined;
}

export function cabinetContents(p: Project, cabinetId: Id): { id: Id; din: DinMount; modules: number; layer: 'body' | 'busbar' }[] {
  const out: { id: Id; din: DinMount; modules: number; layer: 'body' | 'busbar' }[] = [];
  for (const [id, i] of Object.entries(p.equipment)) {
    const m = i.din as DinMount | undefined;
    if (m?.cabinetId !== cabinetId) continue;
    out.push({ id, din: m, modules: dinFit(p, id) ?? 1, layer: m.layer ?? 'body' });
  }
  return out.sort((a, b) => a.din.row - b.din.row || a.din.at - b.din.at);
}

export const dinConflicts = (p: Project, m: DinMount, modules: number, ignore?: Id): Id[] =>
  cabinetContents(p, m.cabinetId).filter((o) => o.id !== ignore && o.layer === (m.layer ?? 'body') && o.din.row === m.row && o.din.at < m.at + modules && m.at < o.din.at + o.modules).map((o) => o.id);

export function dinProblem(p: Project, instanceId: Id, m: DinMount): string | undefined {
  const cab = p.cabinets?.[m.cabinetId] as Cabinet | undefined; if (!cab) return `Brak szafy ${m.cabinetId}`;
  const mod = dinFit(p, instanceId); if (mod === undefined) return 'To urządzenie nie ma szerokości w modułach DIN. Ustaw ją w definicji urządzenia';
  if (!Number.isInteger(m.row) || m.row < 1 || m.row > cab.rows) return `Rząd poza zakresem 1–${cab.rows}`;
  if (!Number.isInteger(m.at) || m.at < 1) return 'Pozycja musi być liczbą całkowitą ≥ 1';
  if (m.at + mod - 1 > cab.modules) return `Urządzenie (${mod} mod.) nie mieści się w rzędzie ${cab.modules} mod. od pozycji ${m.at}`;
  const c = dinConflicts(p, { ...m, layer: layerOf(p, instanceId) }, mod, instanceId);
  if (c.length) return `Miejsce jest zajęte przez ${c.map((id) => p.equipment[id]?.name ?? id).join(', ')}`;
  return undefined;
}

export function firstFreeDin(p: Project, instanceId: Id, cabinetId: Id): DinMount | undefined {
  const cab = p.cabinets?.[cabinetId] as Cabinet | undefined, mod = dinFit(p, instanceId); if (!cab || mod === undefined) return undefined;
  for (let row = 1; row <= cab.rows; row++) for (let at = 1; at + mod - 1 <= cab.modules; at++) { const m = { cabinetId, row, at }; if (!dinConflicts(p, { ...m, layer: layerOf(p, instanceId) }, mod, instanceId).length) return m; }
  return undefined;
}

const clean = (n: string) => n.trim();
function checkHeightU(h: number) { if (!Number.isInteger(h) || h < 1 || h > 60) throw new CommandError('Wysokość w racku: całkowita 1–60 U'); return h; }
function checkDims(v: { widthMm?: number; heightMm?: number; depthMm?: number | null; rows?: number; modules?: number }) {
  for (const [k, n] of [['widthMm', 'Szerokość'], ['heightMm', 'Wysokość']] as const) if (v[k] !== undefined && !(v[k]! >= 50 && v[k]! <= 5000)) throw new CommandError(`${n}: 50–5000 mm`);
  if (v.depthMm != null && !(v.depthMm > 0 && v.depthMm <= 2000)) throw new CommandError('Głębokość: 1–2000 mm');
  if (v.rows !== undefined && (!Number.isInteger(v.rows) || v.rows < 1 || v.rows > MAX_ROWS)) throw new CommandError(`Liczba szyn: całkowita 1–${MAX_ROWS}`);
  if (v.modules !== undefined && (!Number.isInteger(v.modules) || v.modules < 1 || v.modules > MAX_MODULES)) throw new CommandError(`Moduły na szynie: całkowite 1–${MAX_MODULES}`);
}
/** Usuwa terminale wskazujące na instancję (po zdjęciu z szafy lub usunięciu). */
export function pruneTerminals(d: { cabinets?: Record<string, any> }, instanceId: Id) {
  for (const c of Object.values(d.cabinets ?? {})) if (c.terminals) { c.terminals = c.terminals.filter((t: PortRef) => t.instanceId !== instanceId); if (!c.terminals.length) delete c.terminals; }
}

/** Ustawienie projektu: osprzęt zamontowany w szafach nie jest pokazywany na schemacie blokowym. */
export const setHideMountedDin = (on: boolean): Mutator => (d) => { d.settings ??= {} as Project['settings']; if (on) (d.settings as { hideMountedDin?: boolean }).hideMountedDin = true; else delete (d.settings as { hideMountedDin?: boolean }).hideMountedDin; };

export const cabCmd = {
  addCabinet(id: Id, v: { name: string; widthMm: number; heightMm: number; depthMm?: number; rows: number; modules: number; notes?: string; rackUnits?: { heightU: number } }): Mutator {
    return (d) => {
      if (!clean(v.name)) throw new CommandError('Szafa bez nazwy');
      checkDims(v);
      if (Object.values(d.cabinets ?? {}).some((c: any) => c.name === clean(v.name))) throw new CommandError(`Szafa „${clean(v.name)}” już istnieje`);
      (d.cabinets ??= {})[id] = { name: clean(v.name), widthMm: v.widthMm, heightMm: v.heightMm, ...(v.depthMm ? { depthMm: v.depthMm } : {}), rows: v.rows, modules: v.modules, ...(v.notes ? { notes: v.notes } : {}), ...(v.rackUnits ? { rackUnits: { heightU: checkHeightU(v.rackUnits.heightU) } } : {}) } satisfies Cabinet;
    };
  },
  updateCabinet(id: Id, v: { name?: string; widthMm?: number; heightMm?: number; depthMm?: number | null; rows?: number; modules?: number; notes?: string; rackHeightU?: number | null }): Mutator {
    return (d) => {
      const c = d.cabinets?.[id] as Cabinet | undefined; if (!c) throw new CommandError(`Brak szafy ${id}`);
      checkDims(v);
      if (v.name !== undefined) {
        const nm = clean(v.name); if (!nm) throw new CommandError('Szafa bez nazwy');
        if (Object.entries(d.cabinets!).some(([k, o]: [string, any]) => k !== id && o.name === nm)) throw new CommandError(`Szafa „${nm}” już istnieje`);
        c.name = nm;
      }
      const items = cabinetContents(d as Project, id);
      if (v.rows !== undefined) { const top = Math.max(0, ...items.map((o) => o.din.row)); if (v.rows < top) throw new CommandError(`Szafa nie może mieć mniej niż ${top} szyn: zajęte są dalsze rzędy`); c.rows = v.rows; }
      if (v.modules !== undefined) { const end = Math.max(0, ...items.map((o) => o.din.at + o.modules - 1)); if (v.modules < end) throw new CommandError(`Szyna nie może mieć mniej niż ${end} modułów: zajęte są dalsze pozycje`); c.modules = v.modules; }
      if (v.widthMm !== undefined) c.widthMm = v.widthMm; if (v.heightMm !== undefined) c.heightMm = v.heightMm;
      if (v.depthMm !== undefined) { if (v.depthMm === null) delete c.depthMm; else c.depthMm = v.depthMm; }
      if (v.notes !== undefined) { if (v.notes.trim()) c.notes = v.notes.trim(); else delete c.notes; }
      if (v.rackHeightU !== undefined) {
        if (v.rackHeightU === null) { if (c.mount) throw new CommandError('Szafa stoi w racku: najpierw zdejmij ją z racka'); delete c.rackUnits; }
        else {
          const h = checkHeightU(v.rackHeightU), rk = c.mount && (d.racks?.[c.mount.rackId] as { units: number } | undefined);
          if (c.mount && rk && c.mount.uStart + h - 1 > rk.units) throw new CommandError('Moduł nie zmieści się w racku przy tej wysokości');
          c.rackUnits = { heightU: h };
        }
      }
    };
  },
  /** Usunięcie szafy zdejmuje z niej osprzęt (zostaje w projekcie); połączenia osprzętu zostają. */
  removeCabinet(id: Id): Mutator {
    return (d) => {
      if (!d.cabinets?.[id]) throw new CommandError(`Brak szafy ${id}`);
      for (const i of Object.values(d.equipment)) { if ((i.din as DinMount | undefined)?.cabinetId === id) delete i.din; if ((i.plate as PlateMount | undefined)?.cabinetId === id) delete i.plate; }
      for (const [k, pl] of Object.entries<any>(d.placements ?? {})) if (pl.targetKind === 'cabinet' && pl.targetId === id) delete d.placements![k];
      for (const v of Object.values<any>(d.views ?? {})) for (const [k, n] of Object.entries<any>(v.nodes ?? {})) if (n.instanceId === id) delete v.nodes[k];
      delete d.cabinets[id];
    };
  },
  mount(instanceId: Id, m: DinMount): Mutator {
    return (d) => {
      const i = d.equipment[instanceId]; if (!i) throw new CommandError(`Brak instancji ${instanceId}`);
      const why = dinProblem(d as Project, instanceId, m); if (why) throw new CommandError(why);
      if (i.din && (i.din as DinMount).cabinetId !== m.cabinetId) pruneTerminals(d, instanceId);
      delete i.mount; delete i.plate; // osprzęt jest albo w racku 19″, albo na szynie, albo na płycie
      i.din = { cabinetId: m.cabinetId, row: m.row, at: m.at, ...(layerOf(d as Project, instanceId) === 'busbar' ? { layer: 'busbar' as const } : {}) };
    };
  },
  unmount(instanceId: Id): Mutator {
    return (d) => { const i = d.equipment[instanceId]; if (!i) throw new CommandError(`Brak instancji ${instanceId}`); delete i.din; delete i.plate; pruneTerminals(d, instanceId); };
  },
  /** Montaż na płycie montażowej szafy (element bez DIN przykręcony do obudowy); zdejmuje z szyny i z racka. */
  mountPlate(instanceId: Id, m: PlateMount): Mutator {
    return (d) => {
      const i = d.equipment[instanceId]; if (!i) throw new CommandError(`Brak instancji ${instanceId}`);
      const cab = d.cabinets?.[m.cabinetId] as Cabinet | undefined; if (!cab) throw new CommandError(`Brak szafy ${m.cabinetId}`);
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || m.x < 0 || m.y < 0) throw new CommandError('Położenie na płycie: wartości dodatnie w mm od lewego górnego rogu');
      const prev = cabinetOf(d as Project, instanceId); if (prev && prev !== m.cabinetId) pruneTerminals(d, instanceId);
      delete i.din; delete i.mount;
      i.plate = { cabinetId: m.cabinetId, x: Math.round(m.x), y: Math.round(m.y) };
    };
  },
  /** Pokazuje szafę na schemacie blokowym jako jeden blok (tylko terminale) albo rozwija ją do osprzętu. */
  setBlock(cabinetId: Id, on: boolean): Mutator {
    return (d) => { const c = d.cabinets?.[cabinetId] as Cabinet | undefined; if (!c) throw new CommandError(`Brak szafy ${cabinetId}`); if (on) c.asBlock = true; else delete c.asBlock; };
  },
  /** Oznacza port osprzętu jako terminal wchodzący/wychodzący z szafy (albo zdejmuje oznaczenie). */
  setTerminal(cabinetId: Id, ref: PortRef, on: boolean, group?: string | null): Mutator {
    return (d) => {
      const c = d.cabinets?.[cabinetId] as Cabinet | undefined; if (!c) throw new CommandError(`Brak szafy ${cabinetId}`);
      const i = d.equipment[ref.instanceId]; if (!i || cabinetOf(d as Project, ref.instanceId) !== cabinetId) throw new CommandError('Terminalem może być port osprzętu zamontowanego w tej szafie');
      const rev = d.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]; if (!rev?.ports[ref.portId]) throw new CommandError('Port nie istnieje');
      const old = (c.terminals ?? []).find((t) => t.instanceId === ref.instanceId && t.portId === ref.portId);
      const rest = (c.terminals ?? []).filter((t) => t !== old);
      const grp = group === undefined ? old?.group : group === null ? undefined : group.trim() || undefined;
      if (grp && grp.length > 40) throw new CommandError('Nazwa grupy: najwyżej 40 znaków');
      const next = on ? [...(old ? (c.terminals ?? []).map((t) => (t === old ? { instanceId: ref.instanceId, portId: ref.portId, ...(grp ? { group: grp } : {}) } : t)) : [...rest, { instanceId: ref.instanceId, portId: ref.portId, ...(grp ? { group: grp } : {}) }])] : rest;
      if (next.length) c.terminals = next; else delete c.terminals;
    };
  },
};
export const newCabinetId = () => newId('cab');

export interface CabinetTotals { usedModules: number; freeModules: number; devices: number; weightKg: number; weightUnknown: number; powerW: number; powerUnknown: number }
export function cabinetTotals(p: Project, cabinetId: Id): CabinetTotals {
  const cab = p.cabinets?.[cabinetId] as Cabinet | undefined, items = cabinetContents(p, cabinetId);
  let used = 0, w = 0, wu = 0, pw = 0, pu = 0;
  for (const o of items) {
    if (o.layer === 'body') used += o.modules; const i = p.equipment[o.id], r = p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)];
    if (typeof r?.weightKg === 'number') w += r.weightKg; else wu++;
    if (typeof r?.powerW === 'number') pw += r.powerW; else pu++;
  }
  return { usedModules: used, freeModules: Math.max(0, (cab ? cab.rows * cab.modules : 0) - used), devices: items.length, weightKg: Math.round(w * 100) / 100, weightUnknown: wu, powerW: Math.round(pw * 10) / 10, powerUnknown: pu };
}

/** Połączenia, których oba końce są w danej szafie (okablowanie wewnętrzne) i te, które wychodzą poza nią. */
export function cabinetWiring(p: Project, cabinetId: Id) {
  const inside = (id: Id) => cabinetOf(p, id) === cabinetId;
  const internal: Id[] = [], external: Id[] = [];
  for (const [cid, c] of Object.entries(p.connections)) { const a = inside(c.from.instanceId), b = inside(c.to.instanceId); if (a && b) internal.push(cid); else if (a || b) external.push(cid); }
  return { internal, external };
}
