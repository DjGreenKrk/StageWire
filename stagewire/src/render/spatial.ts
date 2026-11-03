import RBush from 'rbush';
import { bboxOf, type Prim } from './drawlist.ts';

interface Item { minX: number; minY: number; maxX: number; maxY: number; i: number }

/** Indeks przestrzenny prymitywów (R-drzewo). Zapytania o okno świata i punkt; aktualizacja pojedynczych prymitywów. */
export class SpatialIndex {
  #tree = new RBush<Item>(16);
  #items: Item[] = [];
  prims: Prim[];

  constructor(prims: Prim[]) {
    this.prims = prims;
    this.#items = prims.map((p, i) => { const [a, b, c, d] = bboxOf(p); return { minX: a, minY: b, maxX: c, maxY: d, i }; });
    this.#tree.load(this.#items);
  }

  /** Indeksy prymitywów w oknie, w kolejności rysowania. */
  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const r = this.#tree.search({ minX, minY, maxX, maxY });
    const idx = new Int32Array(r.length);
    for (let k = 0; k < r.length; k++) idx[k] = r[k].i;
    idx.sort();
    return Array.from(idx);
  }

  /** Najwyżej narysowany prymityw pod punktem świata (tolerancja w jednostkach świata); linie testowane odcinkami. */
  hit(x: number, y: number, tol: number): number {
    const cand = this.query(x - tol, y - tol, x + tol, y + tol);
    for (let k = cand.length - 1; k >= 0; k--) {
      const p = this.prims[cand[k]];
      if (p.t === 'text') continue;
      if (p.t === 'line') { if (nearPolyline(p.pts, x, y, tol)) return cand[k]; continue; }
      if (p.t === 'dot') { if (Math.hypot(p.x - x, p.y - y) <= p.r + tol) return cand[k]; continue; }
      const a = -(p.rot * Math.PI) / 180, dx = x - p.x, dy = y - p.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= p.w / 2 + tol && Math.abs(ly) <= p.h / 2 + tol) return cand[k];
    }
    return -1;
  }

  /** Dodanie prymitywu na końcu (rysowany na wierzchu do następnej pełnej przebudowy). Zwraca jego indeks. */
  add(p: Prim): number {
    const i = this.prims.length; this.prims.push(p);
    const [a, b, c, d] = bboxOf(p); const it = { minX: a, minY: b, maxX: c, maxY: d, i };
    this.#items.push(it); this.#tree.insert(it); return i;
  }

  /** Ponowne zindeksowanie prymitywu po zmianie jego geometrii (np. trasa krawędzi). */
  refresh(i: number): void {
    const it = this.#items[i];
    this.#tree.remove(it);
    const [a, b, c, d] = bboxOf(this.prims[i]);
    it.minX = a; it.minY = b; it.maxX = c; it.maxY = d;
    this.#tree.insert(it);
  }

  /** Przesunięcie prymitywów (np. przeciąganie zaznaczenia) z aktualizacją indeksu. */
  move(indices: number[], dx: number, dy: number): void {
    for (const i of indices) {
      const it = this.#items[i], p = this.prims[i];
      this.#tree.remove(it);
      if (p.t === 'line') for (let k = 0; k < p.pts.length; k += 2) { p.pts[k] += dx; p.pts[k + 1] += dy; } else { p.x += dx; p.y += dy; }
      const [a, b, c, d] = bboxOf(p);
      it.minX = a; it.minY = b; it.maxX = c; it.maxY = d;
      this.#tree.insert(it);
    }
  }
}

function nearPolyline(pts: number[], x: number, y: number, tol: number): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    if (Math.hypot(ax + t * vx - x, ay + t * vy - y) <= tol) return true;
  }
  return false;
}
