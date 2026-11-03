import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { spaceOrigin, floorLevel } from './plan.ts';

/**
 * Przejście kablowe między salami (ADR-059): np. multicore z FOH do sceny, kanał kablowy lub przepust w ścianie.
 * Model: `passages[pas_*] = { name, a: {spaceId, x, y, z}, b: {spaceId, x, y, z}, lengthMm? }`; punkty są we współrzędnych swoich sal (mm).
 * Bez `lengthMm` długość przejścia to odległość prostopadła między punktami we wspólnym układzie budynku (plus różnica wysokości);
 * `lengthMm` pozwala wpisać rzeczywistą długość trasy (korytarz, zakręty).
 */
export interface PassageEnd { spaceId: Id; x: number; y: number; z: number }
export interface Passage { name: string; a: PassageEnd; b: PassageEnd; lengthMm?: number }
export const DEFAULT_PASSAGE_Z = 2500;
export const passagesOf = (p: Project): [Id, Passage][] => Object.entries(((p as any).passages ?? {}) as Record<Id, Passage>);

/** Punkt przejścia we współrzędnych budynku. */
export const passageEndWorld = (p: Project, e: PassageEnd): number[] => { const o = spaceOrigin(p, e.spaceId); return [e.x + o[0], e.y + o[1], e.z + floorLevel(p, e.spaceId)]; };
/** Długość przejścia: wpisana ręcznie albo odległość prostopadła między końcami w budynku. */
export function passageLength(p: Project, ps: Passage): number {
  if (ps.lengthMm !== undefined) return ps.lengthMm;
  const a = passageEndWorld(p, ps.a), b = passageEndWorld(p, ps.b);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
/** Przejścia łączące dwie sale; koniec `near` leży w sali `from`, koniec `far` w sali `to`. */
export function passagesBetween(p: Project, from: Id, to: Id): { id: Id; ps: Passage; near: PassageEnd; far: PassageEnd }[] {
  const out: { id: Id; ps: Passage; near: PassageEnd; far: PassageEnd }[] = [];
  for (const [id, ps] of passagesOf(p)) {
    if (ps.a.spaceId === from && ps.b.spaceId === to) out.push({ id, ps, near: ps.a, far: ps.b });
    else if (ps.b.spaceId === from && ps.a.spaceId === to) out.push({ id, ps, near: ps.b, far: ps.a });
  }
  return out;
}

const num = (v: unknown, lo: number, hi: number, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new CommandError(`${what}: liczba z zakresu ${lo}–${hi}`); };
const checkEnd = (d: Project, e: PassageEnd) => {
  if (!d.spaces?.[e.spaceId]) throw new CommandError('Koniec przejścia musi leżeć w istniejącej sali');
  num(e.x, -2_000_000, 2_000_000, 'X'); num(e.y, -2_000_000, 2_000_000, 'Y'); num(e.z, 0, 100_000, 'Wysokość');
};

export const passageCmd = {
  add(id: Id, ps: Passage): Mutator {
    return (d) => {
      if (!ps.name.trim()) throw new CommandError('Podaj nazwę przejścia');
      checkEnd(d as Project, ps.a); checkEnd(d as Project, ps.b);
      if (ps.a.spaceId === ps.b.spaceId) throw new CommandError('Przejście łączy dwie różne sale');
      if (ps.lengthMm !== undefined) num(ps.lengthMm, 100, 2_000_000, 'Długość');
      (((d as any).passages ??= {}) as Record<Id, Passage>)[id] = { name: ps.name.trim(), a: { ...ps.a, x: Math.round(ps.a.x), y: Math.round(ps.a.y), z: Math.round(ps.a.z) }, b: { ...ps.b, x: Math.round(ps.b.x), y: Math.round(ps.b.y), z: Math.round(ps.b.z) }, ...(ps.lengthMm !== undefined ? { lengthMm: Math.round(ps.lengthMm) } : {}) };
    };
  },
  /** `lengthMm: null` = liczona z planu. `z` ustawia wysokość obu końców. */
  update(id: Id, patch: { name?: string; lengthMm?: number | null; z?: number; a?: Partial<PassageEnd>; b?: Partial<PassageEnd> }): Mutator {
    return (d) => {
      const ps = (d as any).passages?.[id] as Passage | undefined; if (!ps) throw new CommandError(`Brak przejścia ${id}`);
      if (patch.name !== undefined) { if (!patch.name.trim()) throw new CommandError('Podaj nazwę przejścia'); ps.name = patch.name.trim(); }
      if (patch.lengthMm === null) delete ps.lengthMm; else if (patch.lengthMm !== undefined) { num(patch.lengthMm, 100, 2_000_000, 'Długość'); ps.lengthMm = Math.round(patch.lengthMm); }
      if (patch.z !== undefined) { num(patch.z, 0, 100_000, 'Wysokość'); ps.a.z = ps.b.z = Math.round(patch.z); }
      for (const k of ['a', 'b'] as const) if (patch[k]) { const next = { ...ps[k], ...patch[k]! }; checkEnd(d as Project, next); ps[k] = { spaceId: next.spaceId, x: Math.round(next.x), y: Math.round(next.y), z: Math.round(next.z) }; }
      if (ps.a.spaceId === ps.b.spaceId) throw new CommandError('Przejście łączy dwie różne sale');
    };
  },
  remove(id: Id): Mutator { return (d) => { if (!(d as any).passages?.[id]) throw new CommandError(`Brak przejścia ${id}`); delete (d as any).passages[id]; }; },
};

/** Wywoływane przy usuwaniu sali: przejścia z jej udziałem znikają razem z nią. */
export function dropPassagesOf(d: Project, spaceId: Id) {
  const all = (d as any).passages as Record<Id, Passage> | undefined; if (!all) return;
  for (const [k, ps] of Object.entries(all)) if (ps.a.spaceId === spaceId || ps.b.spaceId === spaceId) delete all[k];
}
/** Wywoływane po przesunięciu zawartości sali o (−dx, −dy) (zmiana obrysu): końce przejść w tej sali jadą razem z nią. */
export function shiftPassagesOf(d: Project, spaceId: Id, dx: number, dy: number) {
  for (const ps of Object.values<Passage>(((d as any).passages ?? {}) as Record<Id, Passage>)) for (const e of [ps.a, ps.b]) if (e.spaceId === spaceId) { e.x -= dx; e.y -= dy; }
}
