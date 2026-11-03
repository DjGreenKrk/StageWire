import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';

/**
 * Podkład (ADR-057): obraz rzutu budynku (PDF, SVG, DXF, PNG, JPG) pod planem sal, do wyskalowania i ustawienia, żeby narysować salę na projekcie budynku.
 * Model: `underlays[und_*] = { name, kind, source, mime, image (base64), widthPx, heightPx, x, y, mmPerPx, rotationDeg, opacity, invert, visible, locked, scaleKnown }`.
 * `x, y` to położenie lewego dolnego rogu obrazu we współrzędnych budynku (mm); obraz jest zawsze rastrem (PDF/SVG/DXF zamieniane przy imporcie).
 */
export type UnderlayKind = 'pdf' | 'svg' | 'dxf' | 'image';
export interface Underlay {
  name: string; kind: UnderlayKind; source: string; mime: string; image: string; widthPx: number; heightPx: number;
  x: number; y: number; mmPerPx: number; rotationDeg: number; opacity: number; invert: boolean; visible: boolean; locked: boolean; scaleKnown: boolean;
}
export const MAX_UNDERLAY_BYTES = 24 * 1024 * 1024; // obraz po zakodowaniu base64
export const underlaysOf = (p: Project): [Id, Underlay][] => Object.entries(((p as any).underlays ?? {}) as Record<Id, Underlay>);

const checkNum = (v: unknown, lo: number, hi: number, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new CommandError(`${what}: liczba z zakresu ${lo}–${hi}`); };

export const underlayCmd = {
  add(id: Id, u: Underlay): Mutator {
    return (d) => {
      if (!u.name.trim()) throw new CommandError('Podaj nazwę podkładu');
      if (!u.image.startsWith('data:image/')) throw new CommandError('Podkład musi być obrazem');
      if (u.image.length > MAX_UNDERLAY_BYTES) throw new CommandError('Obraz podkładu jest za duży (limit 24 MB po zakodowaniu); zmniejsz rozdzielczość importu');
      checkNum(u.mmPerPx, 0.01, 100_000, 'Skala'); checkNum(u.widthPx, 1, 20_000, 'Szerokość obrazu'); checkNum(u.heightPx, 1, 20_000, 'Wysokość obrazu');
      (((d as any).underlays ??= {}) as Record<Id, Underlay>)[id] = { ...u, name: u.name.trim() };
    };
  },
  update(id: Id, patch: Partial<Pick<Underlay, 'name' | 'x' | 'y' | 'mmPerPx' | 'rotationDeg' | 'opacity' | 'invert' | 'visible' | 'locked' | 'scaleKnown'>>): Mutator {
    return (d) => {
      const u = (d as any).underlays?.[id] as Underlay | undefined; if (!u) throw new CommandError(`Brak podkładu ${id}`);
      if (patch.name !== undefined) { if (!patch.name.trim()) throw new CommandError('Podaj nazwę podkładu'); u.name = patch.name.trim(); }
      if (patch.x !== undefined) { checkNum(patch.x, -5_000_000, 5_000_000, 'Położenie X'); u.x = Math.round(patch.x); }
      if (patch.y !== undefined) { checkNum(patch.y, -5_000_000, 5_000_000, 'Położenie Y'); u.y = Math.round(patch.y); }
      if (patch.mmPerPx !== undefined) { checkNum(patch.mmPerPx, 0.01, 100_000, 'Skala'); u.mmPerPx = patch.mmPerPx; }
      if (patch.rotationDeg !== undefined) { checkNum(patch.rotationDeg, -360, 360, 'Obrót'); u.rotationDeg = patch.rotationDeg; }
      if (patch.opacity !== undefined) { checkNum(patch.opacity, 0.05, 1, 'Przezroczystość'); u.opacity = patch.opacity; }
      for (const k of ['invert', 'visible', 'locked', 'scaleKnown'] as const) if (patch[k] !== undefined) u[k] = !!patch[k];
    };
  },
  remove(id: Id): Mutator { return (d) => { if (!(d as any).underlays?.[id]) throw new CommandError(`Brak podkładu ${id}`); delete (d as any).underlays[id]; }; },
  /** Wyskalowanie podkładu: dwa punkty (w mm, współrzędne budynku) mają dzielić `realMm`; skala zmienia się wokół pierwszego punktu, więc on zostaje na miejscu. */
  scaleByPoints(id: Id, p1: number[], p2: number[], realMm: number): Mutator {
    return (d) => {
      const u = (d as any).underlays?.[id] as Underlay | undefined; if (!u) throw new CommandError(`Brak podkładu ${id}`);
      const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); if (dist < 1) throw new CommandError('Wskaż dwa różne punkty');
      checkNum(realMm, 1, 5_000_000, 'Odległość rzeczywista [mm]');
      const k = realMm / dist, next = u.mmPerPx * k; checkNum(next, 0.01, 100_000, 'Skala');
      u.x = Math.round(p1[0] + (u.x - p1[0]) * k); u.y = Math.round(p1[1] + (u.y - p1[1]) * k); u.mmPerPx = next; u.scaleKnown = true;
    };
  },
  /** Obrót podkładu wokół punktu (np. wyprostowanie skanu): lewy dolny róg krąży wokół `pivot`. */
  rotateAbout(id: Id, pivot: number[], deltaDeg: number): Mutator {
    return (d) => {
      const u = (d as any).underlays?.[id] as Underlay | undefined; if (!u) throw new CommandError(`Brak podkładu ${id}`);
      const a = (deltaDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = u.x - pivot[0], dy = u.y - pivot[1];
      u.x = Math.round(pivot[0] + dx * c - dy * s); u.y = Math.round(pivot[1] + dx * s + dy * c); u.rotationDeg = ((((u.rotationDeg + deltaDeg) % 360) + 540) % 360) - 180;
    };
  },
};

/** Obraz podkładu: współrzędne obrazu (px, od lewego dolnego rogu, Y w górę) → współrzędne budynku (mm) i z powrotem. */
export function imageToWorld(u: Pick<Underlay, 'x' | 'y' | 'mmPerPx' | 'rotationDeg'>, px: number, py: number): number[] {
  const a = (u.rotationDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), lx = px * u.mmPerPx, ly = py * u.mmPerPx;
  return [u.x + lx * c - ly * s, u.y + lx * s + ly * c];
}
export function worldToImage(u: Pick<Underlay, 'x' | 'y' | 'mmPerPx' | 'rotationDeg'>, wx: number, wy: number): number[] {
  const a = (u.rotationDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = wx - u.x, dy = wy - u.y;
  return [(dx * c + dy * s) / u.mmPerPx, (-dx * s + dy * c) / u.mmPerPx];
}

// ---------- DXF (tylko tekstowy ASCII; DWG jest formatem zamkniętym) ----------
export interface DxfResult { polylines: number[][][]; minX: number; minY: number; maxX: number; maxY: number; mmPerUnit: number; units: string; skipped: Record<string, number>; entities: number }
const UNITS: Record<number, [number, string]> = { 0: [1, 'bez jednostek (przyjęto mm)'], 1: [25.4, 'cale'], 2: [304.8, 'stopy'], 4: [1, 'mm'], 5: [10, 'cm'], 6: [1000, 'm'], 7: [1_000_000, 'km'], 10: [914.4, 'jardy'] };
const SEG_PER_CIRCLE = 64;

/** Prosty parser DXF: LINE, LWPOLYLINE (łuki z bulge jako odcinki proste), POLYLINE/VERTEX, CIRCLE, ARC; inne obiekty są liczone jako pominięte. */
export function parseDxf(text: string): DxfResult {
  const lines = text.split(/\r?\n/); const polylines: number[][][] = [], skipped: Record<string, number> = {};
  let insunits = 0, entities = 0, i = 0;
  const next = (): [number, string] | undefined => { if (i + 1 >= lines.length) return undefined; const code = parseInt(lines[i].trim(), 10), val = lines[i + 1].trim(); i += 2; return Number.isNaN(code) ? next() : [code, val]; };
  // nagłówek: $INSUNITS
  for (let k = 0; k + 3 < lines.length; k++) if (lines[k].trim() === '$INSUNITS') { const v = parseInt(lines[k + 2].trim(), 10); if (!Number.isNaN(v)) insunits = v; break; }
  // sekcja ENTITIES
  let inEntities = false, pair: [number, string] | undefined;
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number): number[][] => {
    let e = a1; while (e <= a0) e += 360; const n = Math.max(4, Math.ceil((SEG_PER_CIRCLE * (e - a0)) / 360)); const out: number[][] = [];
    for (let k = 0; k <= n; k++) { const a = ((a0 + ((e - a0) * k) / n) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  };
  pair = next();
  while (pair) {
    const [code, val] = pair;
    if (code === 0 && val === 'SECTION') { const n = next(); inEntities = n?.[0] === 2 && n[1] === 'ENTITIES'; pair = next(); continue; }
    if (code === 0 && val === 'ENDSEC') { inEntities = false; pair = next(); continue; }
    if (!inEntities || code !== 0) { pair = next(); continue; }
    const type = val, data: [number, string][] = []; pair = next();
    while (pair && pair[0] !== 0) { data.push(pair); pair = next(); }
    const num = (c: number, d = 0) => { const f = data.find((q) => q[0] === c); return f ? Number(f[1]) : d; };
    entities++;
    if (type === 'LINE') polylines.push([[num(10), num(20)], [num(11), num(21)]]);
    else if (type === 'CIRCLE') polylines.push(arcPts(num(10), num(20), num(40), 0, 360));
    else if (type === 'ARC') polylines.push(arcPts(num(10), num(20), num(40), num(50), num(51)));
    else if (type === 'LWPOLYLINE') {
      const pts: number[][] = []; let cx = 0;
      for (const [c, v] of data) { if (c === 10) { cx = Number(v); } else if (c === 20) pts.push([cx, Number(v)]); }
      if (num(70) & 1 && pts.length) pts.push([...pts[0]]);
      if (pts.length > 1) polylines.push(pts);
    } else if (type === 'POLYLINE') {
      const pts: number[][] = []; const closed = num(70) & 1;
      while (pair && pair[0] === 0 && pair[1] === 'VERTEX') { const vd: [number, string][] = []; pair = next(); while (pair && pair[0] !== 0) { vd.push(pair); pair = next(); } const vx = vd.find((q) => q[0] === 10), vy = vd.find((q) => q[0] === 20); if (vx && vy) pts.push([Number(vx[1]), Number(vy[1])]); }
      if (closed && pts.length) pts.push([...pts[0]]);
      if (pts.length > 1) polylines.push(pts);
      if (pair && pair[0] === 0 && pair[1] === 'SEQEND') { pair = next(); while (pair && pair[0] !== 0) pair = next(); }
    } else if (type !== 'SEQEND' && type !== 'VERTEX') skipped[type] = (skipped[type] ?? 0) + 1;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) for (const [x, y] of pl) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const [mm, units] = UNITS[insunits] ?? [1, `kod jednostek ${insunits} (przyjęto mm)`];
  return { polylines, minX, minY, maxX, maxY, mmPerUnit: mm, units, skipped, entities };
}
