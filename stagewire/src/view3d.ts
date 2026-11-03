import type { Project, Id } from './types.ts';
import { U_MM } from './racks.ts';
import { effectivePosition, inPlacedHolder, rackFootprint } from './plan.ts';
import { routesOf } from './routes.ts';
import { cablePaths3d } from './lengths.ts';

/**
 * Prosty widok 3D sali (ADR-053): bryły urządzeń, racków, szaf i obiektów scenicznych z wymiarów i położeń na planie (x, y, z, obrót),
 * obrys sali z wysokością, trasy kablowe 3D i (opcjonalnie) połączenia jako proste linie. Czyste funkcje (scena + rzutowanie perspektywiczne);
 * rysowanie i obsługa myszy w web/view3d.ts. Jednostki: mm, oś Z w górę (jak w modelu).
 */
export type Kind = 'equipment' | 'rack' | 'cabinet' | 'stage';
/** `sides`: liczba boków podstawy (brak = prostokąt; walec/elipsa ma ich 28). `step`/`total`: stopień schodów i wymiary całego obiektu (stopnie są osobnymi bryłami o tym samym id). */
export interface Box3 { id: Id; kind: Kind; name: string; detail: string; cx: number; cy: number; z0: number; w: number; d: number; h: number; rotDeg: number; color: string; sides?: number; step?: number; total?: { cx: number; cy: number; w: number; d: number; h: number; steps: number } }
export const CYL_SIDES = 28;
export interface Scene3 { spaceId?: Id; spaceName?: string; w: number; d: number; boundary: number[][]; ceiling?: number; boxes: Box3[]; routes: { id: Id; name: string; pts: number[][] }[]; links: { id: Id; a: number[]; b: number[]; pts: number[][]; method: 'route' | 'direct' }[] }

const COLORS: Record<string, string> = { wideo: '#2b5d8a', audio: '#8a4b2b', 'sieć': '#2b7a5d', 'oświetlenie': '#8a7a2b', sterowanie: '#5d2b8a', zasilanie: '#8a2b3f' };
const colorOf = (cat: string) => COLORS[cat.split('/')[0].trim().toLowerCase()] ?? '#4a4a5a';
const DEF_W = 400, DEF_D = 300, DEF_H = 100;
export const RACK_FRAME_MM = 60; // ramka nad ostatnim U

export function buildScene(p: Project, spaceId: Id | undefined = Object.keys(p.spaces ?? {})[0]): Scene3 {
  const sp = spaceId ? (p.spaces?.[spaceId] as any) : undefined;
  const bnd: number[][] = sp?.boundary ?? [];
  const w = bnd.length ? Math.max(...bnd.map((q) => q[0])) - Math.min(...bnd.map((q) => q[0])) : 10000, d = bnd.length ? Math.max(...bnd.map((q) => q[1])) - Math.min(...bnd.map((q) => q[1])) : 10000;
  const boxes: Box3[] = [], pls = Object.values<any>(p.placements ?? {}).filter((x) => x.spaceId === spaceId);
  for (const pl of pls) {
    const z0 = pl.position.z ?? 0, rot = pl.rotationDeg ?? 0;
    if (pl.targetKind === 'equipment') {
      const inst = p.equipment[pl.targetId]; if (!inst || inPlacedHolder(p, pl.targetId)) continue;
      const rev = p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)], dim = rev?.dimensionsMm;
      boxes.push({ id: pl.targetId, kind: 'equipment', name: inst.name, detail: rev ? `${rev.manufacturer} ${rev.model}` : '', cx: pl.position.x, cy: pl.position.y, z0, w: dim?.width ?? DEF_W, d: dim?.depth ?? DEF_D, h: dim?.height ?? DEF_H, rotDeg: rot, color: colorOf(rev?.category ?? '') });
    } else if (pl.targetKind === 'rack') {
      const r = p.racks?.[pl.targetId] as any; if (!r) continue; const f = rackFootprint(p, pl.targetId);
      boxes.push({ id: pl.targetId, kind: 'rack', name: r.name, detail: `Rack ${r.units} U`, cx: pl.position.x, cy: pl.position.y, z0, w: f.w, d: f.d, h: Math.round(r.units * U_MM + RACK_FRAME_MM), rotDeg: rot, color: '#7a6a2a' });
    } else if (pl.targetKind === 'cabinet') {
      const c = p.cabinets?.[pl.targetId] as any; if (!c || c.mount) continue; const f = rackFootprint(p, pl.targetId);
      boxes.push({ id: pl.targetId, kind: 'cabinet', name: c.name, detail: `Szafa DIN ${c.rows} × ${c.modules} mod.`, cx: pl.position.x, cy: pl.position.y, z0, w: f.w, d: f.d, h: c.heightMm, rotDeg: rot, color: '#9a5a3a' });
    } else if (pl.targetKind === 'stageObject') {
      const so = p.stageObjects?.[pl.targetId]; if (!so) continue;
      const fw = so.footprint?.widthMm ?? 1000, fd = so.footprint?.depthMm ?? 1000, fh = so.footprint?.heightMm ?? so.heightMm ?? 300, col = so.color ?? '#555566', base = { id: pl.targetId, kind: 'stage' as Kind, name: so.name ?? pl.targetId, cx: pl.position.x, cy: pl.position.y, z0, rotDeg: rot, color: col };
      if (so.shape === 'stairs') {
        const n = Math.max(2, Math.round(so.steps ?? 6)), a = (rot * Math.PI) / 180, total = { cx: pl.position.x, cy: pl.position.y, w: fw, d: fd, h: fh, steps: n };
        for (let i = 0; i < n; i++) { // stopień i: głębokość d/n, wysokość h·(i+1)/n; lokalny +Y to strona wysoka
          const oy = -fd / 2 + ((i + 0.5) * fd) / n;
          boxes.push({ ...base, detail: `Schody: ${n} stopni`, cx: Math.round(pl.position.x - oy * Math.sin(a)), cy: Math.round(pl.position.y + oy * Math.cos(a)), w: fw, d: fd / n, h: Math.round((fh * (i + 1)) / n), step: i, total });
        }
      } else if (so.shape === 'cylinder') boxes.push({ ...base, detail: 'Walec', w: fw, d: fd, h: fh, sides: CYL_SIDES });
      else boxes.push({ ...base, detail: 'Obiekt sceniczny', w: fw, d: fd, h: fh });
    }
  }
  const routes = spaceId ? Object.entries(routesOf(p, spaceId)).map(([id, r]) => ({ id, name: r.name, pts: r.points.map((q) => [q[0], q[1], q[2] ?? 0]) })) : [];
  const links: Scene3['links'] = cablePaths3d(p, spaceId).map((c) => ({ id: c.connectionId, a: c.pts[0], b: c.pts.at(-1)!, pts: c.pts, method: c.method }));
  const boundary: number[][] = bnd.length ? bnd : [[0, 0], [w, 0], [w, d], [0, d]];
  return { spaceId, spaceName: sp?.name, boundary, w, d, ceiling: sp?.ceilingHeightMm, boxes, routes, links };
}

// ---------- kamera i rzutowanie ----------
export interface Cam3 { yaw: number; pitch: number; dist: number; tx: number; ty: number; tz: number }
export const defaultCam = (s: Scene3): Cam3 => ({ yaw: -Math.PI / 4, pitch: 0.55, dist: Math.max(s.w, s.d, 3000) * 1.5, tx: s.w / 2, ty: s.d / 2, tz: 0 });
export const clampCam = (c: Cam3): Cam3 => ({ ...c, pitch: Math.min(1.5, Math.max(0.05, c.pitch)), dist: Math.min(500_000, Math.max(500, c.dist)) });

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function basis(c: Cam3) {
  const pos: V = [c.tx + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), c.ty + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.tz + c.dist * Math.sin(c.pitch)];
  const f = sub([c.tx, c.ty, c.tz], pos), fl = Math.hypot(...f), fw: V = [f[0] / fl, f[1] / fl, f[2] / fl];
  const rr: V = [fw[1], -fw[0], 0], rl = Math.hypot(rr[0], rr[1]) || 1, right: V = [rr[0] / rl, rr[1] / rl, 0];
  const up: V = [right[1] * fw[2] - right[2] * fw[1], right[2] * fw[0] - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
  return { pos, fw, right, up };
}
export interface Pr { x: number; y: number; depth: number }
/** Rzut perspektywiczny punktu świata na ekran W×H; null, gdy punkt jest za kamerą (bliżej niż 50 mm). */
export function project(c: Cam3, W: number, H: number, pt: number[]): Pr | null {
  const b = basis(c), v = sub([pt[0], pt[1], pt[2] ?? 0], b.pos), zc = dot(v, b.fw);
  if (zc < 50) return null;
  const focal = H * 0.95;
  return { x: W / 2 + (focal * dot(v, b.right)) / zc, y: H / 2 - (focal * dot(v, b.up)) / zc, depth: zc };
}
/** Odwrotnie: kierunek promienia (wektor jednostkowy) przez piksel; do przesuwania po podłodze. */
export function groundPoint(c: Cam3, W: number, H: number, sx: number, sy: number, z = 0): number[] | null {
  const b = basis(c), focal = H * 0.95, k: V = [(sx - W / 2) / focal, -(sy - H / 2) / focal, 1];
  const dir: V = [b.right[0] * k[0] + b.up[0] * k[1] + b.fw[0] * k[2], b.right[1] * k[0] + b.up[1] * k[1] + b.fw[1] * k[2], b.right[2] * k[0] + b.up[2] * k[1] + b.fw[2] * k[2]];
  if (Math.abs(dir[2]) < 1e-6) return null; const t = (z - b.pos[2]) / dir[2]; if (t <= 0) return null;
  return [b.pos[0] + dir[0] * t, b.pos[1] + dir[1] * t, z];
}

// ---------- ściany brył ----------
export interface Face { boxId: Id; pts: number[][]; normal: V; shade: number }
/** Narożniki podstawy bryły (obrót wokół osi Z, dodatni = przeciwnie do ruchu wskazówek w układzie planu). */
export function baseCorners(b: Box3): number[][] {
  const a = (b.rotDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const unit = b.sides && b.sides > 4 ? Array.from({ length: b.sides }, (_, k) => [Math.cos((2 * Math.PI * k) / b.sides!), Math.sin((2 * Math.PI * k) / b.sides!)]) : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return unit.map(([sx, sy]) => { const lx = (sx * b.w) / 2, ly = (sy * b.d) / 2; return [b.cx + lx * ca - ly * sa, b.cy + lx * sa + ly * ca]; });
}
const LIGHT: V = (() => { const l: V = [-0.4, -0.5, 0.75], n = Math.hypot(...l); return [l[0] / n, l[1] / n, l[2] / n]; })();
/** Widoczne ściany bryły (góra i boki zwrócone do kamery) z natężeniem światła 0.35–1. */
export function visibleFaces(b: Box3, camPos: V): Face[] {
  const c = baseCorners(b), z1 = b.z0 + b.h, out: Face[] = [];
  const consider = (pts: number[][], n: V) => {
    const ctr: V = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length, pts.reduce((s, q) => s + q[2], 0) / pts.length];
    if (dot(n, sub(camPos, ctr)) <= 0) return;
    out.push({ boxId: b.id, pts, normal: n, shade: 0.35 + 0.65 * Math.max(0, dot(n, LIGHT)) });
  };
  consider(c.map((q) => [q[0], q[1], z1]), [0, 0, 1]);
  for (let i = 0; i < c.length; i++) {
    const p0 = c[i], p1 = c[(i + 1) % c.length], ex = p1[0] - p0[0], ey = p1[1] - p0[1], l = Math.hypot(ex, ey) || 1;
    consider([[p0[0], p0[1], b.z0], [p1[0], p1[1], b.z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1]], [ey / l, -ex / l, 0]);
  }
  return out;
}
/** Wszystkie widoczne ściany sceny posortowane od najdalszej (algorytm malarza). */
export function sortedFaces(s: Scene3, cam: Cam3, W: number, H: number): { face: Face; poly: Pr[]; depth: number }[] {
  const b = basis(cam), res: { face: Face; poly: Pr[]; depth: number }[] = [];
  for (const box of s.boxes) for (const f of visibleFaces(box, b.pos)) {
    const poly = f.pts.map((q) => project(cam, W, H, q)); if (poly.some((q) => !q)) continue;
    const m = f.pts.length, ctr = [f.pts.reduce((a, q) => a + q[0], 0) / m, f.pts.reduce((a, q) => a + q[1], 0) / m, f.pts.reduce((a, q) => a + q[2], 0) / m];
    res.push({ face: f, poly: poly as Pr[], depth: project(cam, W, H, ctr)?.depth ?? 0 });
  }
  return res.sort((a, c) => c.depth - a.depth);
}
/** Najbliższa kamery bryła pod punktem ekranu (po ścianach) albo undefined. */
export function pickBox(s: Scene3, cam: Cam3, W: number, H: number, sx: number, sy: number): Id | undefined {
  const faces = sortedFaces(s, cam, W, H);
  for (let i = faces.length - 1; i >= 0; i--) {
    const poly = faces[i].poly; let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) if ((poly[a].y > sy) !== (poly[b].y > sy) && sx < ((poly[b].x - poly[a].x) * (sy - poly[a].y)) / (poly[b].y - poly[a].y) + poly[a].x) inside = !inside;
    if (inside) return faces[i].face.boxId;
  }
  return undefined;
}
/** Dopasowanie kamery do całej zawartości (sala i bryły). */
export function fitCam(s: Scene3, cam: Cam3): Cam3 {
  const hi = Math.max(s.ceiling ?? 0, ...s.boxes.map((b) => b.z0 + b.h), 1000);
  return clampCam({ ...cam, tx: s.w / 2, ty: s.d / 2, tz: hi / 4, dist: Math.max(Math.hypot(s.w, s.d) * 0.82, hi * 1.6) });
}

export interface RoutePick { routeId: Id; name: string; point: number[]; vertex: boolean }
/**
 * Punkt trasy pod kursorem (do łączenia tras na różnych wysokościach): najbliższy na ekranie punkt odcinka trasy w promieniu `tolPx`;
 * w pobliżu wierzchołka (`snapPx`) przyciąga się do niego. Zwraca punkt w mm (3D) albo undefined.
 */
export function pickRoutePoint(s: Scene3, cam: Cam3, W: number, H: number, sx: number, sy: number, tolPx = 14, snapPx = 12): RoutePick | undefined {
  let best: (RoutePick & { d: number }) | undefined;
  for (const r of s.routes) for (let i = 1; i < r.pts.length; i++) {
    const A = r.pts[i - 1], B = r.pts[i], a = project(cam, W, H, A), b = project(cam, W, H, B); if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
    const d = Math.hypot(sx - (a.x + t * dx), sy - (a.y + t * dy)); if (d > tolPx || (best && d >= best.d)) continue;
    const da = Math.hypot(sx - a.x, sy - a.y), db = Math.hypot(sx - b.x, sy - b.y);
    const vertex = da <= snapPx || db <= snapPx, tt = da <= snapPx ? 0 : db <= snapPx ? 1 : t; // (perspektywa pomijana: t z ekranu)
    best = { routeId: r.id, name: r.name, point: A.map((v, k) => Math.round(v + tt * (B[k] - v))), vertex, d };
  }
  return best && { routeId: best.routeId, name: best.name, point: best.point, vertex: best.vertex };
}
