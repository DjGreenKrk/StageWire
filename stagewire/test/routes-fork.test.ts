import { describe, it, expect } from 'vitest';
import { buildNet } from '../src/routes.ts';

const net = (routes: Record<string, { name: string; points: [number, number][] }>, pts: [number, number][]) => buildNet(routes, pts);
const len = (n: ReturnType<typeof buildNet>, a: [number, number], b: [number, number]) => { const x = n.attach(a), y = n.attach(b); return x && y ? n.path(x.node, y.node) : null; };

describe('rozwidlenia tras', () => {
  // FOH (0,0) → pień do (20000,0); na scenie rozwidlenie Y: odnoga w górę (20000,0)→(26000,6000) i w dół (20000,0)→(26000,-6000)
  const foh: [number, number] = [0, 0], left: [number, number] = [26000, 6000], right: [number, number] = [26000, -6000];
  it('rozwidlenie Y jako trzy trasy zaczynające się w tym samym punkcie: wybiera odnogę do właściwego urządzenia', () => {
    const n = net({ a: { name: 'pień', points: [[0, 0], [20000, 0]] }, b: { name: 'L', points: [[20000, 0], [26000, 6000]] }, c: { name: 'P', points: [[20000, 0], [26000, -6000]] } }, [foh, left, right]);
    expect(len(n, foh, left)!.length).toBeCloseTo(20000 + Math.hypot(6000, 6000), 0);
    expect(len(n, foh, right)!.routes.sort()).toEqual(['a', 'c']);
    expect(len(n, left, right)!.length).toBeCloseTo(2 * Math.hypot(6000, 6000), 0); // lewa → prawa przez rozwidlenie
  });
  it('odnoga zaczynająca się w środku pnia (T/Y) łączy się, jeśli jej początek leży do 200 mm od pnia', () => {
    const n = net({ a: { name: 'pień', points: [[0, 0], [30000, 0]] }, b: { name: 'odnoga', points: [[20000, 100], [26000, 6000]] } }, [foh, left]);
    expect(len(n, foh, left)).not.toBeNull();
  });
  it('skrzyżowanie bez wierzchołka w punkcie przecięcia NIE łączy tras', () => {
    const n = net({ a: { name: 'poziomo', points: [[0, 0], [30000, 0]] }, b: { name: 'pionowo', points: [[15000, -5000], [15000, 5000]] } }, [foh, [15000, 5000]]);
    expect(len(n, foh, [15000, 5000])).toBeNull();
  });
});

import { Store } from '../src/store.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { routeCmd, routesOf } from '../src/routes.ts';
import { syntheticProject } from '../src/synthetic.ts';

describe('edycja punktów trasy', () => {
  const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {}; const s = new Store(p); s.dispatch('s', plan.addSpace('spc_a', 'A', 20000, 10000)); s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'T', [[0, 0], [5000, 0], [5000, 5000]], 3000)); return s; };
  it('przesunięcie, dodanie i usunięcie punktu jako jeden krok cofania; z zachowane', () => {
    const s = mk(); const pts = () => routesOf(s.state, 'spc_a').rte_1.points;
    s.dispatch('m', routeCmd.setRoutePoints('spc_a', 'rte_1', [[0, 0, 3000], [5000, 1000, 3000], [5000, 5000, 3000]])); expect(pts()[1]).toEqual([5000, 1000, 3000]);
    s.dispatch('i', routeCmd.setRoutePoints('spc_a', 'rte_1', [[0, 0, 3000], [2500, 500, 3000], [5000, 1000, 3000], [5000, 5000, 3000]])); expect(pts().length).toBe(4);
    s.dispatch('d', routeCmd.setRoutePoints('spc_a', 'rte_1', pts().filter((_, i) => i !== 1))); expect(pts().length).toBe(3);
    s.undo(); expect(pts().length).toBe(4); s.undo(); expect(pts()[1]).toEqual([5000, 1000, 3000]);
  });
  it('walidacja: min. 2 różne punkty, zakres wysokości, brak trasy', () => {
    const s = mk();
    expect(() => s.dispatch('x', routeCmd.setRoutePoints('spc_a', 'rte_1', [[0, 0, 0], [0, 0, 0]]))).toThrow();
    expect(() => s.dispatch('x', routeCmd.setRoutePoints('spc_a', 'rte_1', [[0, 0, -1], [1, 1, 0]]))).toThrow();
    expect(() => s.dispatch('x', routeCmd.setRoutePoints('spc_a', 'rte_9', [[0, 0], [1, 1]]))).toThrow();
    expect(routesOf(s.state, 'spc_a').rte_1.points.length).toBe(3);
  });
});
