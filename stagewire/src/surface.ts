import type { Box3 } from './view3d.ts';

/**
 * Trasa „po bryle” (ADR-056): wysokość górnej powierzchni brył (urządzenia, racki, szafy, obiekty sceniczne, w tym stopnie i walce) w punkcie planu
 * oraz profil trasy poprowadzonej po tych bryłach (kabel idzie po podłodze, wchodzi na stopnie i zchodzi z nich pionowymi odcinkami).
 */
const EPS = 1e-6;
/** Czy punkt planu leży nad podstawą bryły (prostokąt lub elipsa/wielokąt obrócone o rotDeg). */
export function insideBox(b: Box3, x: number, y: number): boolean {
  const a = (b.rotDeg * Math.PI) / 180, dx = x - b.cx, dy = y - b.cy, lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
  if (b.sides && b.sides > 4) return (lx / (b.w / 2)) ** 2 + (ly / (b.d / 2)) ** 2 <= 1 + EPS;
  return Math.abs(lx) <= b.w / 2 + EPS && Math.abs(ly) <= b.d / 2 + EPS;
}
/** Wysokość górnej powierzchni najwyższej bryły pod punktem (mm) albo undefined, gdy pod punktem nie ma bryły. */
export function topAt(boxes: Box3[], x: number, y: number): number | undefined {
  let best: number | undefined;
  for (const b of boxes) if (insideBox(b, x, y)) { const t = b.z0 + b.h; if (best === undefined || t > best) best = t; }
  return best;
}
/** Wysokość trasy w punkcie: nie niżej niż `floorZ` (wysokość ustawiona w oknie) ani niż górna powierzchnia bryły pod punktem. */
export const routeZAt = (boxes: Box3[], x: number, y: number, floorZ: number): number => Math.max(floorZ, topAt(boxes, x, y) ?? -Infinity);

/**
 * Punkty do dopisania do trasy, by od punktu `a` [x, y, z] dojść do [bx, by] po bryłach: na krawędziach brył (stopnie, podesty, kostki)
 * pojawiają się pionowe odcinki. Zwraca punkty po `a`, ostatni to [bx, by, z na końcu]. `stepMm` = rozdzielczość próbkowania odcinka.
 */
export function followSurface(boxes: Box3[], a: number[], bx: number, by: number, floorZ: number, stepMm = 25): number[][] {
  const ax = a[0], ay = a[1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / stepMm));
  const at = (t: number) => routeZAt(boxes, ax + (bx - ax) * t, ay + (by - ay) * t, floorZ);
  const out: number[][] = []; let prevZ = a[2] ?? at(0);
  const push = (x: number, y: number, z: number) => { const l = out.at(-1) ?? a; if (l[0] !== x || l[1] !== y || l[2] !== z) out.push([x, y, z]); };
  let t0 = 0, z0 = at(0);
  if (z0 !== prevZ) { push(ax, ay, z0); prevZ = z0; } // początek leży nad inną powierzchnią niż ostatni punkt: pion w miejscu
  for (let i = 1; i <= n; i++) {
    const t1 = i / n, z1 = at(t1);
    if (z1 !== z0) { // zmiana powierzchni między t0 a t1: bisekcja krawędzi (0,5 mm), pion na krawędzi
      let lo = t0, hi = t1; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (at(m) === z0) lo = m; else hi = m; }
      const e = hi, ex = Math.round(ax + (bx - ax) * lo), ey = Math.round(ay + (by - ay) * lo), exh = Math.round(ax + (bx - ax) * e), eyh = Math.round(ay + (by - ay) * e);
      push(ex, ey, prevZ); push(exh, eyh, z1); prevZ = z1;
    }
    t0 = t1; z0 = z1;
  }
  push(Math.round(bx), Math.round(by), prevZ);
  return out;
}
