import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { rackPlacementKey } from './plan.ts';

/**
 * Obiekty sceniczne i dekoracje (ADR-055): proste bryły (prostopadłościany) do zobrazowania sceny, podestów, ścian, stołów i scenografii.
 * Model: `stageObjects[sob_*] = { name, footprint: {widthMm, depthMm, heightMm}, color?, notes? }`; położenie to zwykły placement (targetKind 'stageObject')
 * z x, y, z (wysokość podstawy: kostki można piętrzyć) i obrotem.
 */
export type StageShape = 'box' | 'stairs' | 'cylinder';
export const STAGE_SHAPES: Record<StageShape, string> = { box: 'Prostopadłościan', stairs: 'Schody / widownia', cylinder: 'Walec' };
export const MIN_STEPS = 2, MAX_STEPS = 60, DEFAULT_STEPS = 6;
/**
 * Kształty: `box` (kostka, podest, ściana), `stairs` (stopnie rosnące w głąb obiektu: lokalny +Y to strona najwyższa; wysokość = wysokość ostatniego stopnia,
 * `steps` stopni; imituje widownię) i `cylinder` (walec lub elipsa: szerokość i głębokość to średnice, np. kolumna, okrągły stół).
 */
export interface StageObject { name: string; shape?: StageShape; steps?: number; footprint: { widthMm: number; depthMm: number; heightMm: number }; color?: string; notes?: string }

export interface StagePreset { key: string; label: string; widthMm: number; depthMm: number; heightMm: number; color: string; shape?: StageShape; steps?: number }
export const STAGE_PRESETS: StagePreset[] = [
  { key: 'cube', label: 'Kostka 1 m', widthMm: 1000, depthMm: 1000, heightMm: 1000, color: '#6b7a99' },
  { key: 'riser', label: 'Podest 2 × 1 m, wys. 0,4 m', widthMm: 2000, depthMm: 1000, heightMm: 400, color: '#7a6b5a' },
  { key: 'stage', label: 'Scena 8 × 6 m, wys. 1 m', widthMm: 8000, depthMm: 6000, heightMm: 1000, color: '#5a5a66' },
  { key: 'wall', label: 'Ściana / ekran 4 × 0,2 m, wys. 2,5 m', widthMm: 4000, depthMm: 200, heightMm: 2500, color: '#8a8aa0' },
  { key: 'table', label: 'Stół 1,8 × 0,8 m, wys. 0,75 m', widthMm: 1800, depthMm: 800, heightMm: 750, color: '#8a6a4a' },
  { key: 'pillar', label: 'Filar 0,4 × 0,4 m, wys. 3 m', widthMm: 400, depthMm: 400, heightMm: 3000, color: '#707070' },
  { key: 'audience', label: 'Widownia (schody) 8 × 5 m, 8 stopni, wys. 2 m', widthMm: 8000, depthMm: 5000, heightMm: 2000, color: '#7a5a8a', shape: 'stairs', steps: 8 },
  { key: 'steps', label: 'Schody 1,2 × 2 m, 5 stopni, wys. 0,9 m', widthMm: 1200, depthMm: 2000, heightMm: 900, color: '#8a8a70', shape: 'stairs', steps: 5 },
  { key: 'column', label: 'Kolumna Ø 0,6 m, wys. 3 m', widthMm: 600, depthMm: 600, heightMm: 3000, color: '#909090', shape: 'cylinder' },
  { key: 'roundtable', label: 'Okrągły stół Ø 1,8 m, wys. 0,75 m', widthMm: 1800, depthMm: 1800, heightMm: 750, color: '#8a6a4a', shape: 'cylinder' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
export const stepsProblem = (shape: StageShape | undefined, steps: number | undefined): string | undefined =>
  shape === 'stairs' && !(Number.isInteger(steps) && steps! >= MIN_STEPS && steps! <= MAX_STEPS) ? `Liczba stopni musi być liczbą całkowitą z zakresu ${MIN_STEPS}–${MAX_STEPS}` : undefined;
export const stageSizeProblem = (w: number, d: number, h: number): string | undefined => {
  if (![w, d, h].every((v) => Number.isFinite(v))) return 'Wymiary muszą być liczbami';
  if (![w, d, h].every((v) => v >= 10 && v <= 200_000)) return 'Każdy wymiar obiektu musi mieścić się w zakresie 1 cm – 200 m';
  return undefined;
};

export const stageCmd = {
  addObject(id: Id, o: { name: string; widthMm: number; depthMm: number; heightMm: number; color?: string; notes?: string; shape?: StageShape; steps?: number }): Mutator {
    return (d) => {
      if (!o.name.trim()) throw new CommandError('Podaj nazwę obiektu');
      const pr = stageSizeProblem(o.widthMm, o.depthMm, o.heightMm); if (pr) throw new CommandError(pr);
      if (o.color && !HEX.test(o.color)) throw new CommandError('Kolor w formacie #rrggbb');
      const sp = stepsProblem(o.shape, o.steps ?? DEFAULT_STEPS); if (sp) throw new CommandError(sp);
      (d.stageObjects ??= {})[id] = { name: o.name.trim(), ...(o.shape && o.shape !== 'box' ? { shape: o.shape } : {}), ...(o.shape === 'stairs' ? { steps: o.steps ?? DEFAULT_STEPS } : {}), footprint: { widthMm: Math.round(o.widthMm), depthMm: Math.round(o.depthMm), heightMm: Math.round(o.heightMm) }, ...(o.color ? { color: o.color.toLowerCase() } : {}), ...(o.notes?.trim() ? { notes: o.notes.trim() } : {}) };
    };
  },
  updateObject(id: Id, patch: Partial<{ name: string; widthMm: number; depthMm: number; heightMm: number; color: string | null; notes: string; shape: StageShape; steps: number }>): Mutator {
    return (d) => {
      const s = d.stageObjects?.[id] as StageObject | undefined; if (!s) throw new CommandError(`Brak obiektu ${id}`);
      if (patch.name !== undefined) { if (!patch.name.trim()) throw new CommandError('Podaj nazwę obiektu'); s.name = patch.name.trim(); }
      const w = patch.widthMm ?? s.footprint.widthMm, dd = patch.depthMm ?? s.footprint.depthMm, h = patch.heightMm ?? s.footprint.heightMm;
      const pr = stageSizeProblem(w, dd, h); if (pr) throw new CommandError(pr);
      if (patch.shape !== undefined) { if (patch.shape === 'box') delete s.shape; else s.shape = patch.shape; }
      if (patch.steps !== undefined) s.steps = patch.steps;
      const sp = stepsProblem(s.shape, s.steps ?? DEFAULT_STEPS); if (sp) throw new CommandError(sp);
      if (s.shape === 'stairs') s.steps ??= DEFAULT_STEPS; else delete s.steps;
      s.footprint = { widthMm: Math.round(w), depthMm: Math.round(dd), heightMm: Math.round(h) };
      if (patch.color === null) delete s.color; else if (patch.color !== undefined) { if (!HEX.test(patch.color)) throw new CommandError('Kolor w formacie #rrggbb'); s.color = patch.color.toLowerCase(); }
      if (patch.notes !== undefined) { if (patch.notes.trim()) s.notes = patch.notes.trim(); else delete s.notes; }
    };
  },
  /** Usuwa obiekt razem z jego położeniem na planie. */
  removeObject(id: Id): Mutator {
    return (d) => { if (!d.stageObjects?.[id]) throw new CommandError(`Brak obiektu ${id}`); if (d.placements?.[rackPlacementKey(id)]?.locked) throw new CommandError('Obiekt jest zablokowany (odblokuj go we właściwościach)'); delete d.stageObjects[id]; if (d.placements) delete d.placements[rackPlacementKey(id)]; };
  },
  /** Kopia obiektu (z nazwą „… (kopia)”) w nowym miejscu; wymiary, kolor i wysokość podstawy jak w oryginale. */
  duplicateObject(id: Id, newIdValue: Id, dx = 1000, dy = 0): Mutator {
    return (d) => {
      const s = d.stageObjects?.[id] as StageObject | undefined; if (!s) throw new CommandError(`Brak obiektu ${id}`);
      (d.stageObjects ??= {})[newIdValue] = { ...JSON.parse(JSON.stringify(s)), name: `${s.name} (kopia)` };
      const pl = d.placements?.[rackPlacementKey(id)];
      if (pl) (d.placements ??= {})[rackPlacementKey(newIdValue)] = { ...JSON.parse(JSON.stringify(pl)), targetId: newIdValue, position: { ...pl.position, x: pl.position.x + dx, y: pl.position.y + dy } };
    };
  },
};
export const stageObjectsOf = (p: Project): [Id, StageObject][] => Object.entries((p.stageObjects ?? {}) as Record<Id, StageObject>);
