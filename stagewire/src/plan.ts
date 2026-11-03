import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { newId } from './ids.ts';
import { dropPassagesOf, shiftPassagesOf } from './passage.ts';
import { U_MM, rackFit, type Mount } from './racks.ts';

/** Plan sali: sale (prostokąt), rozmieszczenie urządzeń (placements). Jednostki: mm, oś Y w górę (jak w modelu). */
export const SNAP_MM = 100;
export const snap = (v: number, step = SNAP_MM) => Math.round(v / step) * step;
export const placementKey = (instanceId: Id) => 'plc_' + instanceId.slice(instanceId.indexOf('_') + 1);

/** Rack lub szafa DIN na planie: klucz położenia (inny niż urządzeń, żeby id nigdy się nie zderzyły) i obrys (rack 19\" ≈ 600 mm, głębokość z racka albo 1000 mm; szafa wg swoich wymiarów). */
export const rackPlacementKey = (objId: Id) => 'plc_' + objId.replace('_', '');
export const RACK_W_MM = 600, RACK_D_DEFAULT_MM = 1000, CAB_D_DEFAULT_MM = 300;
const isCabId = (id: Id) => id.startsWith('cab_');
export const isStageId = (id: Id) => id.startsWith('sob_');
export const rackFootprint = (p: Project, id: Id) => {
  if (isStageId(id)) { const s = p.stageObjects?.[id] as any; return { w: s?.footprint?.widthMm ?? 1000, d: s?.footprint?.depthMm ?? 1000 }; }
  if (isCabId(id)) { const c = p.cabinets?.[id] as any; return { w: c?.widthMm ?? 400, d: c?.depthMm ?? CAB_D_DEFAULT_MM }; }
  return { w: RACK_W_MM, d: (p.racks?.[id] as any)?.depthMm ?? RACK_D_DEFAULT_MM };
};

type Pos = { spaceId: Id; x: number; y: number; z: number };
/** Gdzie stoi szafa DIN: w racku, który jest na planie (środek racka, wysokość z pozycji U), inaczej własne położenie na planie. */
export function cabinetPosition(p: Project, cabId: Id): Pos | undefined {
  const c = p.cabinets?.[cabId] as any, m = c?.mount as Mount | undefined, rp = m && p.placements?.[rackPlacementKey(m.rackId)];
  if (m && rp) return { spaceId: rp.spaceId, x: rp.position.x, y: rp.position.y, z: Math.round((rp.position.z ?? 0) + (m.uStart - 1 + (c.rackUnits?.heightU ?? 1) / 2) * U_MM) };
  const q = p.placements?.[rackPlacementKey(cabId)];
  return q ? { spaceId: q.spaceId, x: q.position.x, y: q.position.y, z: q.position.z ?? 0 } : undefined;
}

/** Urządzenie stoi w racku lub szafie, które mają położenie na planie: nie ma wtedy własnego punktu (rysowany i etykietowany jest rack/szafa). */
export function inPlacedHolder(p: Project, instanceId: Id): boolean {
  const i = p.equipment[instanceId], m = i?.mount as Mount | undefined, d = i?.din as { cabinetId: Id } | undefined;
  return !!(i && ((m && p.placements?.[rackPlacementKey(m.rackId)]) || (d && cabinetPosition(p, d.cabinetId))));
}

/**
 * Gdzie urządzenie faktycznie stoi: na szynie w szafie, która ma położenie (szafa → x, y; wysokość z numeru szyny, dla modułu w racku środek modułu),
 * zamontowane w racku na planie = rack (wysokość z pozycji U), inaczej własne położenie urządzenia. Taki element nie ma wtedy własnego punktu na planie.
 */
export function effectivePosition(p: Project, instanceId: Id): Pos | undefined {
  const inst = p.equipment[instanceId], din = inst?.din as { cabinetId: Id; row: number } | undefined;
  if (din) {
    const c = p.cabinets?.[din.cabinetId] as any, cp = cabinetPosition(p, din.cabinetId);
    if (c && cp) {
      const rows = c.rows || 1, rowZ = c.mount ? 0 : Math.round(c.heightMm - (din.row - 0.5) * (c.heightMm / rows));
      return { ...cp, z: cp.z + rowZ };
    }
  }
  const m = inst?.mount as Mount | undefined, rp = m && p.placements?.[rackPlacementKey(m.rackId)];
  if (m && rp) {
    const fit = rackFit(p, instanceId);
    return { spaceId: rp.spaceId, x: rp.position.x, y: rp.position.y, z: Math.round((rp.position.z ?? 0) + (m.uStart - 1 + (fit?.heightU ?? 1) / 2) * U_MM) };
  }
  const q = p.placements?.[placementKey(instanceId)];
  return q ? { spaceId: q.spaceId, x: q.position.x, y: q.position.y, z: q.position.z ?? 0 } : undefined;
}

const rect = (w: number, d: number): number[][] => [[0, 0], [w, 0], [w, d], [0, d]];

// ---------- wiele sal: układ budynku ----------
export const ROOM_GAP_MM = 2000;
/** Położenie lokalnego punktu 0,0 sali we wspólnym układzie budynku (mm); brak pola = 0,0. */
export const spaceOrigin = (p: Project, id: Id): [number, number] => { const o = (p.spaces?.[id] as any)?.origin; return Array.isArray(o) ? [Number(o[0]) || 0, Number(o[1]) || 0] : [0, 0]; };
/** Gdzie postawić nową salę, by nie nachodziła na istniejące: na prawo od wszystkich, z odstępem (pierwsza sala w 0,0). */
export function nextFreeOrigin(p: Project): [number, number] {
  const ids = Object.keys(p.spaces ?? {}); if (!ids.length) return [0, 0];
  const right = Math.max(...ids.map((id) => spaceOrigin(p, id)[0] + Math.max(0, ...((p.spaces![id] as any).boundary ?? [[0, 0]]).map((q: number[]) => q[0]))));
  return [Math.round(right + ROOM_GAP_MM), 0];
}
const setOrigin = (s: any, o: [number, number]) => { if (o[0] || o[1]) s.origin = [Math.round(o[0]), Math.round(o[1])]; else delete s.origin; };

// ---------- kształt sali (wielokąt) ----------
export const MAX_SPACE_VERTICES = 200;
/** Pole wielokąta [mm²] (wartość bezwzględna, wzór Gaussa). */
export const polygonArea = (pts: number[][]): number => Math.abs(pts.reduce((s, q, i) => { const n = pts[(i + 1) % pts.length]; return s + (q[0] * n[1] - n[0] * q[1]); }, 0)) / 2;
/** Czy punkt leży wewnątrz wielokąta lub na jego brzegu. */
export function pointInPolygon(pt: number[], poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const cross = (pt[0] - xi) * (yj - yi) - (pt[1] - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-6 && pt[0] >= Math.min(xi, xj) && pt[0] <= Math.max(xi, xj) && pt[1] >= Math.min(yi, yj) && pt[1] <= Math.max(yi, yj)) return true;
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const orient = (a: number[], b: number[], c: number[]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSeg = (a: number[], b: number[], c: number[]) => c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
function segsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}
/** Opis problemu z obrysem sali (undefined = poprawny): >= 3 różne wierzchołki, bez przecinających się boków, pole >= 1 m2, rozmiar <= 500 m. */
export function polygonProblem(pts: number[][]): string | undefined {
  const n = pts.length;
  if (n < 3) return 'Obrys sali wymaga co najmniej 3 wierzchołków';
  if (n > MAX_SPACE_VERTICES) return `Obrys sali może mieć najwyżej ${MAX_SPACE_VERTICES} wierzchołków`;
  if (pts.some((q) => q.length < 2 || !q.every(Number.isFinite))) return 'Współrzędne wierzchołków muszą być liczbami';
  for (let i = 0; i < n; i++) if (pts[i][0] === pts[(i + 1) % n][0] && pts[i][1] === pts[(i + 1) % n][1]) return 'Sąsiednie wierzchołki obrysu nie mogą się pokrywać';
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const adjacent = j === i + 1 || (i === 0 && j === n - 1);
    if (adjacent) { // boki sąsiednie stykają się we wspólnym wierzchołku; nie mogą się nakładać (zawrócenie o 180 stopni)
      const v = j === i + 1 ? pts[j] : pts[0], a = j === i + 1 ? pts[i] : pts[n - 1], c = j === i + 1 ? pts[(j + 1) % n] : pts[1];
      if (orient(a, v, c) === 0 && (a[0] - v[0]) * (c[0] - v[0]) + (a[1] - v[1]) * (c[1] - v[1]) > 0) return 'Obrys sali zawraca sam na siebie (boki nakładają się)';
      continue;
    }
    if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return 'Boki obrysu sali przecinają się; narysuj kształt bez krzyżowania';
  }
  if (polygonArea(pts) < 1_000_000) return 'Sala musi mieć co najmniej 1 m²';
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  if (Math.max(...xs) - Math.min(...xs) > 500_000 || Math.max(...ys) - Math.min(...ys) > 500_000) return 'Sala nie może być większa niż 500 × 500 m';
  return undefined;
}
/** Obrys przesunięty tak, by lewy dolny róg ramki leżał w 0,0 (reszta aplikacji liczy od tego rogu); zwraca też przesunięcie. */
export function normalizePolygon(pts: number[][]): { pts: number[][]; dx: number; dy: number } {
  const r = pts.map((q) => [Math.round(q[0]), Math.round(q[1])]), dx = Math.min(...r.map((q) => q[0])), dy = Math.min(...r.map((q) => q[1]));
  return { pts: r.map((q) => [q[0] - dx, q[1] - dy]), dx, dy };
}
/** Czy obrys jest prostokątem równoległym do osi (4 wierzchołki). */
export const isRectBoundary = (b: number[][]): boolean => b.length === 4 && new Set(b.map((q) => q[0])).size === 2 && new Set(b.map((q) => q[1])).size === 2;

function checkHeight(h?: number) { if (h !== undefined && !(h >= 1000 && h <= 100_000)) throw new CommandError('Wysokość sali musi mieścić się w zakresie 1–100 m'); }
function checkSize(widthMm: number, depthMm: number) {
  if (!(widthMm >= 1000 && depthMm >= 1000)) throw new CommandError('Sala musi mieć co najmniej 1 × 1 m');
  if (widthMm > 500_000 || depthMm > 500_000) throw new CommandError('Sala nie może być większa niż 500 × 500 m');
}

/** Poziom podłogi sali w budynku [mm] względem podłogi pierwszej sali (np. FOH na galerii: 2600). */
export const floorLevel = (p: Project, spaceId: Id): number => ((p.spaces?.[spaceId] as any)?.floorLevelMm as number | undefined) ?? 0;
/** Kolejność rysowania i zaznaczania na planie: bryły sceniczne na spodzie, nad nimi racki i szafy, na wierzchu urządzenia; w obrębie rodzaju niższe pod wyższymi. Nie zależy od kolejności dodania. */
export const placementRank = (pl: any): number => (pl.targetKind === 'stageObject' ? 0 : pl.targetKind === 'equipment' ? 2 : 1);
export const byDrawOrder = (a: any, b: any): number => placementRank(a) - placementRank(b) || (a.position?.z ?? 0) - (b.position?.z ?? 0);
const LOCKED = 'Obiekt jest zablokowany (odblokuj go we właściwościach)';
const notLocked = (pl: any) => { if (pl?.locked) throw new CommandError(LOCKED); };

export const plan = {
  /** Nowa sala prostokątna (róg w punkcie 0,0; podłoga na z = 0); `heightMm` = wysokość do sufitu/kratownicy (opcjonalna). */
  addSpace(id: Id, name: string, widthMm: number, depthMm: number, heightMm?: number, origin?: [number, number]): Mutator {
    return (d) => {
      if (!name.trim()) throw new CommandError('Podaj nazwę sali');
      checkSize(widthMm, depthMm); checkHeight(heightMm);
      const o = origin ?? nextFreeOrigin(d as Project);
      const sp: any = (d.spaces ??= {})[id] = { name: name.trim(), kind: 'room', boundary: rect(Math.round(widthMm), Math.round(depthMm)), ...(heightMm ? { ceilingHeightMm: Math.round(heightMm) } : {}) };
      setOrigin(sp, o);
    };
  },
  /** Nowa sala o dowolnym obrysie (wielokąt prosty, wierzchołki w mm; obrys przesuwany do rogu 0,0). */
  /** `origin`: początek układu odniesienia, w którym podano punkty (np. rysowanie na planie względem innej sali): sala dostaje początek = origin + przesunięcie obrysu do 0,0. Bez `origin` sala trafia obok istniejących. */
  addSpaceShape(id: Id, name: string, points: number[][], heightMm?: number, origin?: [number, number]): Mutator {
    return (d) => {
      if (!name.trim()) throw new CommandError('Podaj nazwę sali');
      const pr = polygonProblem(points.map((q) => [Math.round(q[0]), Math.round(q[1])])); if (pr) throw new CommandError(pr);
      checkHeight(heightMm);
      const nz = normalizePolygon(points), sp: any = (d.spaces ??= {})[id] = { name: name.trim(), kind: 'room', boundary: nz.pts, ...(heightMm ? { ceilingHeightMm: Math.round(heightMm) } : {}) };
      setOrigin(sp, origin ? [origin[0] + nz.dx, origin[1] + nz.dy] : nextFreeOrigin(d as Project));
    };
  },
  /** Zmiana obrysu istniejącej sali na dowolny wielokąt; gdy obrys przesunięto do rogu 0,0, urządzenia i trasy przesuwają się o to samo (zostają w tych samych miejscach względem sali). */
  setSpaceShape(id: Id, points: number[][], name?: string, heightMm?: number | null): Mutator {
    return (d) => {
      const s = d.spaces?.[id]; if (!s) throw new CommandError(`Brak sali ${id}`);
      const pr = polygonProblem(points.map((q) => [Math.round(q[0]), Math.round(q[1])])); if (pr) throw new CommandError(pr);
      if (name !== undefined && !name.trim()) throw new CommandError('Podaj nazwę sali');
      if (heightMm !== undefined && heightMm !== null) checkHeight(heightMm);
      if (name !== undefined) s.name = name.trim();
      const { pts, dx, dy } = normalizePolygon(points); s.boundary = pts;
      if (heightMm === null) delete s.ceilingHeightMm; else if (heightMm !== undefined) s.ceilingHeightMm = Math.round(heightMm);
      if (dx || dy) {
        const o0 = spaceOrigin(d as Project, id); setOrigin(s, [o0[0] + dx, o0[1] + dy]); // położenie w budynku zostaje: początek przesuwa się o tyle, o ile przesunięto obrys
        for (const pl of Object.values<any>(d.placements ?? {})) if (pl.spaceId === id) { pl.position.x -= dx; pl.position.y -= dy; }
        for (const r of Object.values<any>(s.cableRoutes ?? {})) for (const q of r.points) { q[0] -= dx; q[1] -= dy; }
        shiftPassagesOf(d as Project, id, dx, dy);
      }
    };
  },
  /** Poziom podłogi sali względem pierwszej sali (mm, może być ujemny). Wysokości w obrębie sali zostają lokalne; poziom liczy się przy kablach między salami. */
  setFloorLevel(id: Id, mm: number): Mutator {
    return (d) => {
      const s = d.spaces?.[id]; if (!s) throw new CommandError(`Brak sali ${id}`);
      if (!Number.isFinite(mm) || Math.abs(mm) > 100_000) throw new CommandError('Poziom podłogi: liczba w zakresie ±100 m');
      if (Math.round(mm)) (s as any).floorLevelMm = Math.round(mm); else delete (s as any).floorLevelMm;
    };
  },
  /** Przesuwa salę w układzie budynku (zawartość jedzie razem z nią, bo współrzędne w sali są lokalne). */
  setSpaceOrigin(id: Id, x: number, y: number): Mutator {
    return (d) => {
      const s = d.spaces?.[id]; if (!s) throw new CommandError(`Brak sali ${id}`);
      if (![x, y].every((v) => Number.isFinite(v) && Math.abs(v) <= 2_000_000)) throw new CommandError('Położenie sali musi być liczbą w zakresie ±2 km');
      setOrigin(s, [x, y]);
    };
  },
  /** Usuwa salę razem z trasami, rozmieszczeniem urządzeń, racków i szaf w niej oraz obiektami scenicznymi, które w niej stały (urządzenia, racki i szafy zostają w projekcie bez położenia). */
  removeSpace(id: Id): Mutator {
    return (d) => {
      if (!d.spaces?.[id]) throw new CommandError(`Brak sali ${id}`);
      for (const [k, pl] of Object.entries<any>(d.placements ?? {})) if (pl.spaceId === id) { if (pl.targetKind === 'stageObject' && d.stageObjects) delete d.stageObjects[pl.targetId]; delete d.placements![k]; }
      dropPassagesOf(d as Project, id);
      delete d.spaces[id];
    };
  },
  /** Zmiana nazwy i wymiarów sali; urządzenia zostają na swoich pozycjach. */
  editSpace(id: Id, name: string, widthMm: number, depthMm: number, heightMm?: number): Mutator {
    return (d) => {
      const s = d.spaces?.[id]; if (!s) throw new CommandError(`Brak sali ${id}`);
      if (!name.trim()) throw new CommandError('Podaj nazwę sali');
      checkSize(widthMm, depthMm); checkHeight(heightMm);
      s.name = name.trim(); s.boundary = rect(Math.round(widthMm), Math.round(depthMm));
      if (heightMm) s.ceilingHeightMm = Math.round(heightMm); else delete s.ceilingHeightMm;
    };
  },
  /** Ustawienie urządzenia na planie (tworzy lub zmienia rozmieszczenie; jedno na instancję). `z` = wysokość podstawy nad podłogą (mm); pominięte = zachowaj dotychczasową. */
  place(instanceId: Id, spaceId: Id, x: number, y: number, rotationDeg?: number, z?: number): Mutator {
    return (d) => {
      if (!d.equipment[instanceId]) throw new CommandError(`Brak instancji ${instanceId}`);
      if (!d.spaces?.[spaceId]) throw new CommandError(`Brak sali ${spaceId}`);
      if (z !== undefined && !(z >= -10_000 && z <= 100_000)) throw new CommandError('Wysokość poza zakresem');
      const k = placementKey(instanceId), cur = (d.placements ??= {})[k]; notLocked(cur);
      d.placements[k] = { spaceId, targetKind: 'equipment', targetId: instanceId, position: { x: Math.round(x), y: Math.round(y), z: Math.round(z ?? cur?.position?.z ?? 0) }, rotationDeg: rotationDeg ?? cur?.rotationDeg ?? 0 };
    };
  },
  /** Ustawienie racka na planie (jedno położenie na rack). Urządzenia zamontowane w nim wędrują razem z nim. */
  placeRack(rackId: Id, spaceId: Id, x: number, y: number, rotationDeg?: number, z?: number): Mutator {
    return (d) => {
      if (isStageId(rackId)) { if (!d.stageObjects?.[rackId]) throw new CommandError(`Brak obiektu ${rackId}`); }
      else if (isCabId(rackId)) { const c = d.cabinets?.[rackId] as any; if (!c) throw new CommandError(`Brak szafy ${rackId}`); if (c.mount) throw new CommandError('Szafa stoi w racku: jej położenie wynika z położenia racka'); }
      else if (!d.racks?.[rackId]) throw new CommandError(`Brak racka ${rackId}`);
      if (!d.spaces?.[spaceId]) throw new CommandError(`Brak sali ${spaceId}`);
      if (z !== undefined && !(z >= -10_000 && z <= 100_000)) throw new CommandError('Wysokość poza zakresem');
      const k = rackPlacementKey(rackId), cur = (d.placements ??= {})[k]; notLocked(cur);
      d.placements[k] = { spaceId, targetKind: isStageId(rackId) ? 'stageObject' : isCabId(rackId) ? 'cabinet' : 'rack', targetId: rackId, position: { x: Math.round(x), y: Math.round(y), z: Math.round(z ?? cur?.position?.z ?? 0) }, rotationDeg: rotationDeg ?? cur?.rotationDeg ?? 0 };
    };
  },
  rotateRack(rackId: Id, deltaDeg: number): Mutator {
    return (d) => {
      const pl = d.placements?.[rackPlacementKey(rackId)]; if (!pl) throw new CommandError('Obiekt nie jest na planie'); notLocked(pl);
      pl.rotationDeg = (((pl.rotationDeg ?? 0) + deltaDeg) % 360 + 360) % 360;
    };
  },
  unplaceRack(rackId: Id): Mutator {
    return (d) => { if (d.placements) { notLocked(d.placements[rackPlacementKey(rackId)]); delete d.placements[rackPlacementKey(rackId)]; } };
  },
  rotate(instanceId: Id, deltaDeg: number): Mutator {
    return (d) => {
      const pl = d.placements?.[placementKey(instanceId)]; if (!pl) throw new CommandError('Urządzenie nie jest na planie'); notLocked(pl);
      pl.rotationDeg = (((pl.rotationDeg ?? 0) + deltaDeg) % 360 + 360) % 360;
    };
  },
  unplace(instanceId: Id): Mutator {
    return (d) => { if (d.placements) { notLocked(d.placements[placementKey(instanceId)]); delete d.placements[placementKey(instanceId)]; } };
  },
  /** Blokada położenia: zablokowany obiekt nie da się przesunąć, obrócić ani zdjąć z planu (także przez przypadkowe przeciągnięcie). */
  setLocked(targetIds: Id[], locked: boolean): Mutator {
    return (d) => {
      for (const pl of Object.values<any>(d.placements ?? {})) if (targetIds.includes(pl.targetId)) { if (locked) pl.locked = true; else delete pl.locked; }
    };
  },
  /** Rozmieszcza w rzędach wszystkie urządzenia, których nie ma na planie (od lewego dolnego rogu sali, z odstępem). */
  placeMissing(spaceId: Id, only?: Id[]): Mutator {
    return (d) => {
      const sp = d.spaces?.[spaceId]; if (!sp) throw new CommandError(`Brak sali ${spaceId}`);
      const w = Math.max(...sp.boundary.map((p: number[]) => p[0])), GAP = 300;
      const placed = new Set(Object.values<any>(d.placements ?? {}).filter((p) => p.targetKind === 'equipment').map((p) => p.targetId));
      let x = GAP, y = GAP, rowH = 0;
      for (const [iid, inst] of Object.entries(d.equipment)) {
        if (only && !only.includes(iid)) continue;
        if (placed.has(iid) || effectivePosition(d as Project, iid)) continue; // jest na planie albo stoi w racku, który jest na planie
        const dim = d.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)]?.dimensionsMm;
        const dw = dim?.width ?? 400, dd = dim?.depth ?? 300;
        if (x + dw > w - GAP && x > GAP) { x = GAP; y += rowH + GAP; rowH = 0; }
        (d.placements ??= {})[placementKey(iid)] = { spaceId, targetKind: 'equipment', targetId: iid, position: { x: Math.round(x + dw / 2), y: Math.round(y + dd / 2), z: 0 }, rotationDeg: 0 };
        x += dw + GAP; rowH = Math.max(rowH, dd);
      }
    };
  },
};

export const spaceSize = (p: Project, spaceId: Id): { widthMm: number; depthMm: number } | undefined => {
  const b: number[][] | undefined = p.spaces?.[spaceId]?.boundary; if (!b?.length) return undefined;
  return { widthMm: Math.max(...b.map((q) => q[0])) - Math.min(...b.map((q) => q[0])), depthMm: Math.max(...b.map((q) => q[1])) - Math.min(...b.map((q) => q[1])) };
};
export const newSpaceId = () => newId('spc');
