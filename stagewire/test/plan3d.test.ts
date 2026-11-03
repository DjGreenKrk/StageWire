import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan, placementKey } from '../src/plan.ts';
import { routeCmd, routesOf, routeLength, routeHeight, buildNet } from '../src/routes.ts';
import { estimateLengths } from '../src/lengths.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';
import { planDrawList } from '../src/render/drawlist.ts';

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'K', 'eqi_k')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_m'));
  s.dispatch('c', cmd.connect({ instanceId: 'eqi_k', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('s', plan.addSpace('spc_a', 'A', 20000, 10000, 8000));
  return s;
};
const cab = (s: Store) => Object.values(s.state.cables)[0];

describe('trzeci wymiar (z)', () => {
  it('sala ma opcjonalną wysokość; zakres sprawdzany; zapis/odczyt i schemat', () => {
    const s = mk(); expect(s.state.spaces!.spc_a.ceilingHeightMm).toBe(8000);
    expect(() => s.dispatch('x', plan.addSpace('spc_b', 'B', 5000, 5000, 500))).toThrow();
    s.dispatch('e', plan.editSpace('spc_a', 'A', 20000, 10000)); expect(s.state.spaces!.spc_a.ceilingHeightMm).toBeUndefined();
    expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]); expect(openProject(packProject(s.state)).status).toBe('ok');
  });
  it('urządzenie ma z; przesunięcie w x/y zachowuje z; zakres sprawdzany; rysunek planu nie psuje się', () => {
    const s = mk(); s.dispatch('p', plan.place('eqi_m', 'spc_a', 1000, 1000, 0, 6000));
    s.dispatch('p', plan.place('eqi_m', 'spc_a', 3000, 1000)); expect(s.state.placements![placementKey('eqi_m')].position).toEqual({ x: 3000, y: 1000, z: 6000 });
    expect(() => s.dispatch('p', plan.place('eqi_m', 'spc_a', 0, 0, 0, 200_000))).toThrow();
    expect(planDrawList(s.state).prims.length).toBeGreaterThan(0);
  });
  it('trasa 3D: punkty z z, długość w 3D, zmiana wysokości, dane dwuwymiarowe czytane jako z = 0', () => {
    const s = mk(); s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'T', [[0, 0], [3000, 0], [3000, 4000, 4000]], 5000));
    const r = routesOf(s.state, 'spc_a').rte_1; expect(r.points).toEqual([[0, 0, 5000], [3000, 0, 5000], [3000, 4000, 4000]]);
    expect(routeLength(r)).toBeCloseTo(3000 + Math.hypot(4000, 1000), 0);
    s.dispatch('h', routeCmd.setRouteHeight('spc_a', 'rte_1', 6000)); expect(routeHeight(routesOf(s.state, 'spc_a').rte_1)).toEqual({ min: 6000, max: 6000 });
    expect(() => s.dispatch('h', routeCmd.setRouteHeight('spc_a', 'rte_1', -5))).toThrow();
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    const flat = buildNet({ a: { name: 'x', points: [[0, 0], [1000, 0]] } }, [[0, 0], [1000, 0]]); expect(flat.path(flat.attach([0, 0])!.node, flat.attach([1000, 0])!.node)!.length).toBe(1000);
  });
  it('długość kabla uwzględnia pion: dojście z podłogi do trasy na 5 m i z powrotem', () => {
    const s = mk();
    s.dispatch('p', plan.place('eqi_k', 'spc_a', 0, 0)); s.dispatch('p', plan.place('eqi_m', 'spc_a', 4000, 0));
    s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'Kratownica', [[0, 0], [4000, 0]], 5000));
    const e = estimateLengths(s.state, 1000).estimates[0];
    expect(e.method).toBe('route'); expect(e.lengthMm).toBe(5000 + 4000 + 5000 + 1000);
  });
  it('trasy na różnych wysokościach nie łączą się, nawet gdy się „krzyżują” w rzucie', () => {
    const net = buildNet({ a: { name: 'dół', points: [[0, 0, 0], [5000, 0, 0]] }, b: { name: 'góra', points: [[5000, 0, 6000], [5000, 5000, 6000]] } }, [[0, 0, 0], [5000, 5000, 6000]]);
    const x = net.attach([0, 0, 0])!, y = net.attach([5000, 5000, 6000])!; expect(net.path(x.node, y.node)).toBeNull();
    const net2 = buildNet({ a: { name: 'dół', points: [[0, 0, 0], [5000, 0, 0]] }, b: { name: 'pion', points: [[5000, 0, 0], [5000, 0, 6000], [5000, 5000, 6000]] } }, [[0, 0, 0], [5000, 5000, 6000]]);
    expect(net2.path(net2.attach([0, 0, 0])!.node, net2.attach([5000, 5000, 6000])!.node)!.length).toBeCloseTo(5000 + 6000 + 5000, 0);
  });
});
