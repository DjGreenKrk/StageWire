import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { routeCmd, routesOf, routeLength } from '../src/routes.ts';
import { estimateLengths, applyEstimates } from '../src/lengths.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  for (const [k, id] of [['camera_sdi', 'eqi_k1'], ['camera_sdi', 'eqi_k2'], ['camera_sdi', 'eqi_k3'], ['video_switcher', 'eqi_m']] as const) s.dispatch('a', addFromCatalog(k, id, id));
  s.dispatch('s', plan.addSpace('spc_a', 'A', 20000, 10000));
  const c = (from: string, port: string) => s.dispatch('c', cmd.connect({ instanceId: from, portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: port }, 'std/sdi-3g'));
  c('eqi_k1', 'prt_sdiin1'); c('eqi_k2', 'prt_sdiin2'); c('eqi_k3', 'prt_sdiin3');
  s.dispatch('p', plan.place('eqi_m', 'spc_a', 10000, 5000)); s.dispatch('p', plan.place('eqi_k1', 'spc_a', 2000, 1000)); s.dispatch('p', plan.place('eqi_k2', 'spc_a', 10000, 5000));
  return s;
};
const cableOf = (s: Store, from: string) => s.state.cables[Object.values(s.state.connections).find((c) => c.from.instanceId === from)!.cableId!];

describe('długości kabli z planu', () => {
  it('Manhattan + zapas, w górę do 100 mm; brak rozmieszczenia = pominięty; ręczne nietknięte', () => {
    const s = mk();
    const r = estimateLengths(s.state, 1000);
    expect(r.estimates.length).toBe(2); expect(r.noPlacement).toBe(1);
    s.dispatch('man', cmd.setCableLengths(Object.values(s.state.connections).find((c) => c.from.instanceId === 'eqi_k2')!.cableId!, { lengthMm: 7777 }));
    s.dispatch('est', applyEstimates(1050));
    expect(cableOf(s, 'eqi_k1')).toMatchObject({ lengthMm: 13100, lengthSource: 'estimated' }); // 8000 + 4000 + 1050 = 13050, w górę do 100 mm
    expect(cableOf(s, 'eqi_k2')).toMatchObject({ lengthMm: 7777, lengthSource: 'manual' });
    expect(cableOf(s, 'eqi_k3').lengthSource).toBe('unknown');
    expect(s.state.settings.defaultCableSlackMm).toBe(1050);
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    s.undo(); expect(cableOf(s, 'eqi_k1').lengthSource).toBe('unknown');
  });
  it('ponowne liczenie nadpisuje tylko oszacowane; zły zapas odrzucony', () => {
    const s = mk(); s.dispatch('e', applyEstimates(1000));
    s.dispatch('mv', plan.place('eqi_k1', 'spc_a', 9000, 5000)); s.dispatch('e', applyEstimates(1000));
    expect(cableOf(s, 'eqi_k1').lengthMm).toBe(2000);
    expect(() => s.dispatch('x', applyEstimates(-1))).toThrow();
  });
});

describe('długości po trasach kablowych', () => {
  const withRoutes = () => {
    const s = mk();
    s.dispatch('r1', routeCmd.addRoute('spc_a', 'rte_1', 'Główna', [[0, 500], [10000, 500], [10000, 5000]]));
    return s;
  };
  it('kabel idzie trasą (dojście + trasa + zapas), a nie prosto; metoda zapisana w estimateBasis', () => {
    const s = withRoutes();
    const r = estimateLengths(s.state, 1000);
    const e = r.estimates.find((x) => x.method === 'route')!;
    expect(e.lengthMm).toBe(14000); // 500 (dojście) + 8000 + 4500 + 0 + 1000
    expect(r.viaRoute).toBe(2); // k1 i k2 (k2 stoi w punkcie miksera)
    s.dispatch('est', applyEstimates(1000));
    expect(cableOf(s, 'eqi_k1').estimateBasis).toEqual({ method: 'route', routes: ['rte_1'] });
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
  });
  it('trasy łączą się, gdy koniec jednej leży blisko drugiej (do 200 mm); rozłączne = awaryjnie linia prosta', () => {
    const s = withRoutes();
    s.dispatch('mv', plan.place('eqi_k2', 'spc_a', 6000, 3000));
    s.dispatch('r2', routeCmd.addRoute('spc_a', 'rte_2', 'Odnoga', [[6000, 520], [6000, 3000]]));
    const via = estimateLengths(s.state, 1000).estimates.find((x) => x.cableId === s.state.connections[Object.keys(s.state.connections)[1]].cableId)!;
    expect(via.method).toBe('route'); expect(via.lengthMm).toBe(12000); // 2480 + 20 + 4000 + 4500 + 1000
    s.dispatch('d', routeCmd.deleteRoute('spc_a', 'rte_2'));
    s.dispatch('r3', routeCmd.addRoute('spc_a', 'rte_3', 'Osobna', [[6000, 5000], [6000, 3000]])); // daleko od rte_1 (4,5 m)
    const alone = estimateLengths(s.state, 1000).estimates.find((x) => x.cableId === s.state.connections[Object.keys(s.state.connections)[1]].cableId)!;
    expect(alone.method).toBe('direct'); expect(alone.lengthMm).toBe(Math.ceil((4000 + 2000 + 1000) / 100) * 100);
  });
  it('polecenia tras: min. 2 punkty, nazwa, usuwanie, cofanie', () => {
    const s = withRoutes();
    expect(() => s.dispatch('x', routeCmd.addRoute('spc_a', 'rte_9', 'X', [[0, 0], [0, 0]]))).toThrow();
    s.dispatch('n', routeCmd.renameRoute('spc_a', 'rte_1', ' Korytko A ')); expect(routesOf(s.state, 'spc_a').rte_1.name).toBe('Korytko A');
    expect(routeLength(routesOf(s.state, 'spc_a').rte_1)).toBe(14500);
    s.dispatch('d', routeCmd.deleteRoute('spc_a', 'rte_1')); expect(Object.keys(routesOf(s.state, 'spc_a')).length).toBe(0);
    s.undo(); expect(Object.keys(routesOf(s.state, 'spc_a')).length).toBe(1);
  });
});
