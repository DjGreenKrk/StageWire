import type { Id, Project } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { newId } from './ids.ts';
import { pruneTerminals, cabinetContents, type Cabinet } from './cabinets.ts';

/**
 * Racki (DOMAIN-MODEL §5.10, ADR-051). Rack jest obiektem projektu (`racks`), a pozycja urządzenia to wartość osadzona w instancji
 * (`mount`), nie osobna encja. Zajętość liczymy na stronę (przód/tył) i szerokość (pełna, połowa, jedna trzecia).
 */
export const U_MM = 44.45;
export type Face = 'front' | 'rear';
export type Slot = 'full' | 'left' | 'center' | 'right';
export interface Rack { name: string; units: number; widthIn: number; depthMm?: number; notes?: string }
export interface Mount { rackId: Id; uStart: number; face: Face; slot: Slot }

export const MAX_UNITS = 60;
export const FRACTIONS = [1, 0.5, 0.33] as const;

/** Dozwolone miejsca w poziomie dla urządzenia o danej szerokości. */
export const slotsFor = (widthFraction: number): Slot[] => (widthFraction >= 1 ? ['full'] : widthFraction >= 0.5 ? ['left', 'right'] : ['left', 'center', 'right']);
/** Zakres zajmowanej szerokości racka (0–1) dla miejsca i szerokości urządzenia. */
export function slotRange(slot: Slot, widthFraction: number): [number, number] {
  if (slot === 'full' || widthFraction >= 1) return [0, 1];
  if (widthFraction >= 0.5) return slot === 'left' ? [0, 0.5] : [0.5, 1];
  return slot === 'left' ? [0, 1 / 3] : slot === 'center' ? [1 / 3, 2 / 3] : [2 / 3, 1];
}

export interface RackFit { heightU: number; widthFraction: number }
/** Wymiary urządzenia w racku z jego aktualnej rewizji; undefined, gdy urządzenie nie jest rackowe. */
export function rackFit(p: Project, instanceId: Id): RackFit | undefined {
  const cab = p.cabinets?.[instanceId] as Cabinet | undefined; // szafa DIN zadeklarowana jako moduł do racka (np. 3U)
  if (cab) return cab.rackUnits ? { heightU: cab.rackUnits.heightU, widthFraction: 1 } : undefined;
  const i = p.equipment[instanceId]; const r = i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]?.rackUnits;
  return r ? { heightU: r.heightU, widthFraction: r.widthFraction } : undefined;
}

/** Obiekt trzymający pozycję `mount`: instancja urządzenia albo szafa DIN będąca modułem do racka. */
export const holder = (p: Project, id: Id): { mount?: Mount } | undefined => (p.equipment[id] ?? p.cabinets?.[id]) as { mount?: Mount } | undefined;

export interface ItemInfo { name: string; device: string; category: string; weightKg?: number; powerW?: number; powerMaxW?: number; depthMm?: number; weightMissing: number; powerMissing: number; isCabinet: boolean }
/** Opis elementu racka: urządzenie albo szafa DIN (masa i pobór = suma osprzętu w środku; brakujące dane liczone osobno). */
export function itemInfo(p: Project, id: Id): ItemInfo {
  const cab = p.cabinets?.[id] as Cabinet | undefined;
  if (cab) {
    let w = 0, pw = 0, pm = 0, wm = 0, pmis = 0;
    for (const o of cabinetContents(p, id)) {
      const i = p.equipment[o.id], r = p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)];
      if (typeof r?.weightKg === 'number') w += r.weightKg; else wm++;
      if (typeof r?.powerW === 'number') { pw += r.powerW; pm += typeof r.powerMaxW === 'number' ? r.powerMaxW : r.powerW; } else pmis++;
    }
    return { name: cab.name, device: `Szafa DIN ${cab.rows} × ${cab.modules} mod.`, category: 'zasilanie', weightKg: w, powerW: pw, powerMaxW: pm, depthMm: cab.depthMm, weightMissing: wm, powerMissing: pmis, isCabinet: true };
  }
  const i = p.equipment[id], r = i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)];
  return { name: i?.name ?? id, device: r ? `${r.manufacturer} ${r.model}` : '?', category: r?.category ?? '', weightKg: r?.weightKg, powerW: r?.powerW, powerMaxW: typeof r?.powerMaxW === 'number' ? r.powerMaxW : undefined, depthMm: r?.dimensionsMm?.depth, weightMissing: typeof r?.weightKg === 'number' ? 0 : 1, powerMissing: typeof r?.powerW === 'number' ? 0 : 1, isCabinet: false };
}

const eps = 1e-6;
const overlapW = (a: [number, number], b: [number, number]) => a[0] < b[1] - eps && b[0] < a[1] - eps;

/** Zamontowane urządzenia racka. */
export function rackContents(p: Project, rackId: Id): { id: Id; mount: Mount; fit: RackFit }[] {
  const out: { id: Id; mount: Mount; fit: RackFit }[] = [];
  for (const [id, i] of Object.entries(p.equipment)) {
    const m = i.mount as Mount | undefined;
    if (m?.rackId !== rackId) continue;
    out.push({ id, mount: m, fit: rackFit(p, id) ?? { heightU: 1, widthFraction: 1 } });
  }
  for (const [id, c] of Object.entries(p.cabinets ?? {}) as [string, Cabinet][]) {
    const m = c.mount as Mount | undefined;
    if (m?.rackId === rackId) out.push({ id, mount: m, fit: rackFit(p, id) ?? { heightU: 1, widthFraction: 1 } });
  }
  return out.sort((a, b) => a.mount.uStart - b.mount.uStart);
}

/** Urządzenia kolidujące z podaną pozycją (ta sama strona, nakładające się U i szerokość). */
export function conflicts(p: Project, m: Mount, fit: RackFit, ignore?: Id): Id[] {
  const rng = slotRange(m.slot, fit.widthFraction);
  return rackContents(p, m.rackId).filter((o) => o.id !== ignore && o.mount.face === m.face
    && o.mount.uStart < m.uStart + fit.heightU && m.uStart < o.mount.uStart + o.fit.heightU
    && overlapW(rng, slotRange(o.mount.slot, o.fit.widthFraction))).map((o) => o.id);
}

/** Powód, dla którego pozycja jest niedozwolona (po polsku), albo undefined. */
export function mountProblem(p: Project, instanceId: Id, m: Mount): string | undefined {
  const rack = p.racks?.[m.rackId] as Rack | undefined; if (!rack) return `Brak racka ${m.rackId}`;
  const fit = rackFit(p, instanceId); if (!fit) return 'To urządzenie nie ma wysokości w U (nie jest rackowe). Ustaw ją w definicji urządzenia';
  if (!Number.isInteger(m.uStart) || m.uStart < 1) return 'Pozycja U musi być liczbą całkowitą ≥ 1';
  if (m.uStart + fit.heightU - 1 > rack.units) return `Urządzenie (${fit.heightU} U) nie mieści się w racku ${rack.units} U od pozycji ${m.uStart}`;
  if (!slotsFor(fit.widthFraction).includes(m.slot)) return 'Miejsce w poziomie nie pasuje do szerokości urządzenia';
  const c = conflicts(p, m, fit, instanceId);
  if (c.length) return `Miejsce jest zajęte przez ${c.map((id) => itemInfo(p, id).name).join(', ')}`;
  return undefined;
}

/** Pierwsze wolne miejsce dla urządzenia (od dołu racka, przód, potem tył). */
export function firstFree(p: Project, instanceId: Id, rackId: Id): Mount | undefined {
  const rack = p.racks?.[rackId] as Rack | undefined, fit = rackFit(p, instanceId); if (!rack || !fit) return undefined;
  for (const face of ['front', 'rear'] as Face[]) for (let u = 1; u + fit.heightU - 1 <= rack.units; u++) for (const slot of slotsFor(fit.widthFraction)) {
    const m: Mount = { rackId, uStart: u, face, slot };
    if (!conflicts(p, m, fit, instanceId).length) return m;
  }
  return undefined;
}

const clean = (n: string) => n.trim();
export const rackCmd = {
  addRack(id: Id, v: { name: string; units: number; depthMm?: number; notes?: string }): Mutator {
    return (d) => {
      if (!clean(v.name)) throw new CommandError('Rack bez nazwy');
      if (!Number.isInteger(v.units) || v.units < 1 || v.units > MAX_UNITS) throw new CommandError(`Liczba U: całkowita 1–${MAX_UNITS}`);
      if (v.depthMm !== undefined && !(v.depthMm > 0 && v.depthMm <= 3000)) throw new CommandError('Głębokość racka: 1–3000 mm');
      if (Object.values(d.racks ?? {}).some((r: any) => r.name === clean(v.name))) throw new CommandError(`Rack „${clean(v.name)}” już istnieje`);
      d.racks ??= {};
      d.racks[id] = { name: clean(v.name), units: v.units, widthIn: 19, ...(v.depthMm ? { depthMm: v.depthMm } : {}), ...(v.notes ? { notes: v.notes } : {}) } satisfies Rack;
    };
  },
  /** Zmiana nazwy, wysokości lub głębokości. Zmniejszenie racka poniżej zajętego U jest odrzucane. */
  updateRack(id: Id, v: { name?: string; units?: number; depthMm?: number | null; notes?: string }): Mutator {
    return (d) => {
      const r = d.racks?.[id] as Rack | undefined; if (!r) throw new CommandError(`Brak racka ${id}`);
      if (v.name !== undefined) {
        const nm = clean(v.name);
        if (!nm) throw new CommandError('Rack bez nazwy');
        if (Object.entries(d.racks!).some(([k, o]: [string, any]) => k !== id && o.name === nm)) throw new CommandError(`Rack „${nm}” już istnieje`);
        r.name = nm;
      }
      if (v.units !== undefined) {
        if (!Number.isInteger(v.units) || v.units < 1 || v.units > MAX_UNITS) throw new CommandError(`Liczba U: całkowita 1–${MAX_UNITS}`);
        const top = Math.max(0, ...rackContents(d as Project, id).map((o) => o.mount.uStart + o.fit.heightU - 1));
        if (v.units < top) throw new CommandError(`Rack nie może mieć mniej niż ${top} U: zajęte są wyższe pozycje`);
        r.units = v.units;
      }
      if (v.depthMm !== undefined) { if (v.depthMm === null) delete r.depthMm; else { if (!(v.depthMm > 0 && v.depthMm <= 3000)) throw new CommandError('Głębokość racka: 1–3000 mm'); r.depthMm = v.depthMm; } }
      if (v.notes !== undefined) { if (v.notes.trim()) r.notes = v.notes.trim(); else delete r.notes; }
    };
  },
  /** Usunięcie racka zdejmuje z niego urządzenia (zostają w projekcie bez pozycji) i kasuje jego położenie na planie. */
  removeRack(id: Id): Mutator {
    return (d) => {
      if (!d.racks?.[id]) throw new CommandError(`Brak racka ${id}`);
      for (const i of Object.values(d.equipment)) if ((i.mount as Mount | undefined)?.rackId === id) delete i.mount;
      for (const c of Object.values(d.cabinets ?? {}) as Cabinet[]) if (c.mount?.rackId === id) delete c.mount;
      for (const [k, pl] of Object.entries(d.placements ?? {})) if ((pl as any).targetKind === 'rack' && (pl as any).targetId === id) delete d.placements![k];
      delete d.racks[id];
    };
  },
  /** Montaż albo przeniesienie urządzenia. Odrzuca pozycje poza rackiem, kolizje i niepasującą szerokość. */
  mount(instanceId: Id, m: Mount): Mutator {
    return (d) => {
      const i = holder(d as Project, instanceId) as any; if (!i) throw new CommandError(`Brak instancji ${instanceId}`);
      const why = mountProblem(d as Project, instanceId, m); if (why) throw new CommandError(why);
      if (i.din || i.plate) { delete i.din; delete i.plate; pruneTerminals(d, instanceId); } // w racku 19″ albo na szynie/płycie, nie jednocześnie
      i.mount = { rackId: m.rackId, uStart: m.uStart, face: m.face, slot: m.slot };
    };
  },
  unmount(instanceId: Id): Mutator {
    return (d) => { const i = holder(d as Project, instanceId); if (!i) throw new CommandError(`Brak instancji ${instanceId}`); delete i.mount; };
  },
};
export const newRackId = () => newId("rck");

export interface RackTotals { usedU: number; freeU: number; devices: number; weightKg: number; weightUnknown: number; powerW: number; powerMaxW: number; powerUnknown: number }
/** Zajęte i wolne U (liczone raz dla przodu i tyłu: pozycja zajęta na którejkolwiek stronie), masa i pobór mocy z definicji. */
export function rackTotals(p: Project, rackId: Id): RackTotals {
  const rack = p.racks?.[rackId] as Rack | undefined, items = rackContents(p, rackId);
  const used = new Set<number>(); let w = 0, wu = 0, pw = 0, pm = 0, pu = 0;
  for (const o of items) {
    for (let u = o.mount.uStart; u < o.mount.uStart + o.fit.heightU; u++) used.add(u);
    const r = itemInfo(p, o.id); w += r.weightKg ?? 0; wu += r.weightMissing; pw += r.powerW ?? 0; pm += r.powerMaxW ?? r.powerW ?? 0; pu += r.powerMissing;
  }
  return { usedU: used.size, freeU: Math.max(0, (rack?.units ?? 0) - used.size), devices: items.length, weightKg: Math.round(w * 100) / 100, weightUnknown: wu, powerW: Math.round(pw * 10) / 10, powerMaxW: Math.round(pm * 10) / 10, powerUnknown: pu };
}

export interface RackRow { rack: string; face: string; uStart: number; uEnd: number; slot: string; name: string; device: string; weightKg?: number; powerW?: number }
const SLOT_PL: Record<Slot, string> = { full: 'cała', left: 'lewa', center: 'środek', right: 'prawa' };
/** Zawartość wszystkich racków, od góry racka w dół (jak na elewacji). */
export function rackReport(p: Project): RackRow[] {
  const rows: RackRow[] = [];
  for (const [rid, r] of Object.entries(p.racks ?? {}) as [string, Rack][]) {
    const items = rackContents(p, rid).sort((a, b) => (a.mount.face === b.mount.face ? 0 : a.mount.face === 'front' ? -1 : 1) || b.mount.uStart - a.mount.uStart);
    for (const o of items) {
      const it = itemInfo(p, o.id);
      rows.push({ rack: r.name, face: o.mount.face === 'front' ? 'przód' : 'tył', uStart: o.mount.uStart, uEnd: o.mount.uStart + o.fit.heightU - 1, slot: SLOT_PL[o.mount.slot], name: it.name, device: it.device, weightKg: it.weightKg, powerW: it.powerW });
    }
  }
  return rows;
}
