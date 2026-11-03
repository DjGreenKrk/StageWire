import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';

/**
 * Trasy kablowe na planie: łamane 3D w mm (korytka, drabinki, ścieżki). Punkt = [x, y, z]; z to wysokość nad podłogą.
 * Dane sprzed wprowadzenia z (punkty [x, y]) czytane są jako z = 0. Przechowywane w sali: `spaces[id].cableRoutes`.
 */
export type Pt3 = [number, number, number];
export interface Route { name: string; points: number[][] }
export const JUNCTION_TOL_MM = 200; // koniec trasy leżący bliżej niż tyle (w 3D) od innej trasy łączy się z nią
export const MAX_STUB_MM = 10_000;  // najdalej tak daleko (dojście: poziomo prostopadle + w pionie) urządzenie jest „podpięte” do trasy

export const p3 = (q: number[]): Pt3 => [q[0], q[1], q[2] ?? 0];
export const routesOf = (p: Project, spaceId: Id): Record<Id, Route> => p.spaces?.[spaceId]?.cableRoutes ?? {};
export const routeLength = (r: Route): number => r.points.slice(1).reduce((s, q, i) => { const a = p3(r.points[i]), b = p3(q); return s + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }, 0);
export const routeHeight = (r: Route): { min: number; max: number } => { const zs = r.points.map((q) => q[2] ?? 0); return { min: Math.min(...zs), max: Math.max(...zs) }; };

export const routeCmd = {
  /** Nowa trasa; punkty [x,y] lub [x,y,z]. `defaultZ` dotyczy punktów bez z. */
  addRoute(spaceId: Id, id: Id, name: string, points: number[][], defaultZ = 0): Mutator {
    return (d) => {
      const s = d.spaces?.[spaceId]; if (!s) throw new CommandError(`Brak sali ${spaceId}`);
      const all = points.map((q) => [Math.round(q[0]), Math.round(q[1]), Math.round(q[2] ?? defaultZ)]);
      const pts = all.filter((q, i) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1] || q[2] !== all[i - 1][2]);
      if (pts.length < 2) throw new CommandError('Trasa potrzebuje co najmniej dwóch różnych punktów');
      if (pts.some((q) => q[2] < 0 || q[2] > 100_000)) throw new CommandError('Wysokość trasy poza zakresem 0–100 m');
      (s.cableRoutes ??= {})[id] = { name: name.trim() || 'Trasa', points: pts };
    };
  },
  renameRoute(spaceId: Id, id: Id, name: string): Mutator {
    return (d) => { const r = d.spaces?.[spaceId]?.cableRoutes?.[id]; if (!r) throw new CommandError('Brak trasy'); if (!name.trim()) throw new CommandError('Podaj nazwę trasy'); r.name = name.trim(); };
  },
  /** Ustawia tę samą wysokość wszystkich punktów trasy. */
  setRouteHeight(spaceId: Id, id: Id, zMm: number): Mutator {
    return (d) => {
      const r = d.spaces?.[spaceId]?.cableRoutes?.[id]; if (!r) throw new CommandError('Brak trasy');
      if (!(zMm >= 0 && zMm <= 100_000)) throw new CommandError('Wysokość trasy poza zakresem 0–100 m');
      r.points = r.points.map((q: number[]) => [q[0], q[1], Math.round(zMm)]);
    };
  },
  /** Podmiana punktów trasy (edycja wierzchołków: przesunięcie, dodanie, usunięcie) jako jeden krok cofania. */
  setRoutePoints(spaceId: Id, id: Id, points: number[][]): Mutator {
    return (d) => {
      const rt = d.spaces?.[spaceId]?.cableRoutes?.[id]; if (!rt) throw new CommandError('Brak trasy');
      const all = points.map((q) => [Math.round(q[0]), Math.round(q[1]), Math.round(q[2] ?? 0)]);
      const pts = all.filter((q, i) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1] || q[2] !== all[i - 1][2]);
      if (pts.length < 2) throw new CommandError('Trasa potrzebuje co najmniej dwóch różnych punktów');
      if (pts.some((q) => q[2] < 0 || q[2] > 100_000)) throw new CommandError('Wysokość trasy poza zakresem 0–100 m');
      rt.points = pts;
    };
  },
  deleteRoute(spaceId: Id, id: Id): Mutator {
    return (d) => { const m = d.spaces?.[spaceId]?.cableRoutes; if (!m?.[id]) throw new CommandError('Brak trasy'); delete m[id]; };
  },
};

// ---------- najkrótsza ścieżka po trasach (3D) ----------
interface Seg { a: Pt3; b: Pt3; route: Id }
const key = (q: Pt3) => `${Math.round(q[0])},${Math.round(q[1])},${Math.round(q[2])}`;
const dist3 = (a: Pt3, b: Pt3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function project(q: Pt3, a: Pt3, b: Pt3): { t: number; p: Pt3; d: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy + (q[2] - a[2]) * dz) / l2));
  const p: Pt3 = [a[0] + t * dx, a[1] + t * dy, a[2] + t * dz];
  return { t, p, d: dist3(q, p) };
}

export interface RouteNet {
  /** Podpięcie punktu (urządzenia) do sieci: węzeł i odcinek dojścia (poziomo prostopadle + pionowo) lub null, gdy za daleko. */
  attach(q: number[]): { node: number; stub: number } | null;
  /** Długość najkrótszej ścieżki po trasach między węzłami i lista użytych tras; null gdy brak połączenia. */
  path(a: number, b: number): { length: number; routes: Id[]; points: Pt3[] } | null;
}

/** Buduje graf z tras sali i podpina podane punkty (urządzenia; [x,y] lub [x,y,z]). */
export function buildNet(routes: Record<Id, Route>, points: number[][]): RouteNet {
  const segs: Seg[] = [];
  for (const [rid, r] of Object.entries(routes)) for (let i = 1; i < r.points.length; i++) segs.push({ a: p3(r.points[i - 1]), b: p3(r.points[i]), route: rid });
  const nodes: Pt3[] = [], nodeIdx = new Map<string, number>();
  const node = (q: Pt3) => { const k = key(q); let i = nodeIdx.get(k); if (i === undefined) { i = nodes.length; nodes.push([Math.round(q[0]), Math.round(q[1]), Math.round(q[2])]); nodeIdx.set(k, i); } return i; };
  const splits: { t: number; n: number }[][] = segs.map(() => []);
  const extra: [number, number, number][] = [];
  for (const s of segs) { node(s.a); node(s.b); }
  // złącza: wierzchołek jednej trasy blisko odcinka innej trasy (w 3D, więc trasy na różnych wysokościach się nie łączą)
  const verts = segs.flatMap((s) => [{ q: s.a, route: s.route }, { q: s.b, route: s.route }]);
  for (const v of verts) for (let si = 0; si < segs.length; si++) {
    const s = segs[si]; if (s.route === v.route) continue;
    const pr = project(v.q, s.a, s.b);
    if (pr.d > JUNCTION_TOL_MM) continue;
    const vn = node(v.q), pn = node(pr.p);
    if (vn !== pn) extra.push([vn, pn, pr.d]);
    splits[si].push({ t: pr.t, n: pn });
  }
  // podpięcia urządzeń do najbliższego odcinka (najbliższy w 3D)
  const attachments = new Map<string, { node: number; stub: number } | null>();
  for (const raw of points) {
    const q = p3(raw); let best: { si: number; pr: ReturnType<typeof project> } | undefined;
    for (let si = 0; si < segs.length; si++) { const pr = project(q, segs[si].a, segs[si].b); if (!best || pr.d < best.pr.d) best = { si, pr }; }
    if (!best) { attachments.set(key(q), null); continue; }
    const stub = Math.abs(q[0] - best.pr.p[0]) + Math.abs(q[1] - best.pr.p[1]) + Math.abs(q[2] - best.pr.p[2]);
    if (stub > MAX_STUB_MM) { attachments.set(key(q), null); continue; }
    const n = node(best.pr.p); splits[best.si].push({ t: best.pr.t, n });
    attachments.set(key(q), { node: n, stub });
  }
  const adj: { to: number; w: number; route?: Id }[][] = [];
  const edge = (u: number, v: number, w: number, route?: Id) => { (adj[u] ??= []).push({ to: v, w, route }); (adj[v] ??= []).push({ to: u, w, route }); };
  segs.forEach((s, si) => {
    const chain = [{ t: 0, n: node(s.a) }, ...splits[si], { t: 1, n: node(s.b) }].sort((x, y) => x.t - y.t);
    const len = dist3(s.a, s.b);
    for (let i = 1; i < chain.length; i++) if (chain[i].n !== chain[i - 1].n) edge(chain[i - 1].n, chain[i].n, (chain[i].t - chain[i - 1].t) * len, s.route);
  });
  for (const [u, v, w] of extra) edge(u, v, w);
  const cache = new Map<number, { dist: number[]; prev: number[]; via: (Id | undefined)[] }>();
  const dijkstra = (src: number) => {
    let c = cache.get(src); if (c) return c;
    const n = nodes.length, dist = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), via = new Array<Id | undefined>(n).fill(undefined), done = new Array<boolean>(n).fill(false);
    dist[src] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      for (const e of adj[u] ?? []) if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; via[e.to] = e.route; }
    }
    c = { dist, prev, via }; cache.set(src, c); return c;
  };
  return {
    attach: (q) => attachments.get(key(p3(q))) ?? null,
    path(a, b) {
      const r = dijkstra(a); if (r.dist[b] === Infinity) return null;
      const used = new Set<Id>(), pts: Pt3[] = [nodes[b]]; for (let v = b; v !== a; v = r.prev[v]) { const rt = r.via[v]; if (rt) used.add(rt); pts.push(nodes[r.prev[v]]); }
      return { length: r.dist[b], routes: [...used], points: pts.reverse() };
    },
  };
}
