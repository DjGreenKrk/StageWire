import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { routeCmd } from '../src/routes.ts';
import { passageCmd, passagesOf, passageLength } from '../src/passage.ts';
import { estimateLengths, applyEstimates, cablePaths } from '../src/lengths.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

// FOH (spc_a) i scena (spc_b): kamera na scenie, mikser na FOH
const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  for (const [k, id] of [['camera_sdi', 'eqi_k1'], ['video_switcher', 'eqi_m']] as const) s.dispatch('a', addFromCatalog(k, id, id));
  s.dispatch('s', plan.addSpace('spc_a', 'FOH', 20000, 10000));
  s.dispatch('s', plan.addSpace('spc_b', 'Scena', 15000, 8000)); // origin automatycznie: x = 22000
  s.dispatch('c', cmd.connect({ instanceId: 'eqi_k1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('p', plan.place('eqi_m', 'spc_a', 10000, 5000)); s.dispatch('p', plan.place('eqi_k1', 'spc_b', 2000, 1000));
  return s;
};
const ps = (z = 2500) => ({ name: 'Multicore', a: { spaceId: 'spc_a', x: 18000, y: 5000, z }, b: { spaceId: 'spc_b', x: 500, y: 1000, z } });

describe('przejścia kablowe między salami (FOH ↔ scena)', () => {
  it('bez przejścia kabel między salami jest pominięty i policzony jako brak przejścia', () => {
    const s = mk(); const r = estimateLengths(s.state, 1000);
    expect(r.estimates.length).toBe(0); expect(r.otherSpace).toBe(1); expect(r.viaPassage).toBe(0);
    expect(cablePaths(s.state)).toEqual([]);
  });
  it('długość = dojście w FOH + przejście + dojście na scenie + zapas', () => {
    const s = mk(); s.dispatch('pas', passageCmd.add('pas_1', ps()));
    expect(passagesOf(s.state).length).toBe(1);
    // przejście: (18000,5000) → (22500,1000) w budynku: 4500 + 4000 = 8500
    expect(passageLength(s.state, (s.state as any).passages.pas_1)).toBe(8500);
    const r = estimateLengths(s.state, 1000);
    expect(r.viaPassage).toBe(1); expect(r.otherSpace).toBe(0);
    // FOH: |10000-18000| + 0 + 2500 = 10500; scena: |500-2000| + 0 + 2500 = 4000; razem 23000 + 1000
    expect(r.estimates[0]).toMatchObject({ lengthMm: 24000, method: 'direct', passage: 'pas_1' });
    s.dispatch('est', applyEstimates(1000));
    const cab = s.state.cables[Object.values(s.state.connections)[0].cableId!];
    expect(cab).toMatchObject({ lengthMm: 24000, lengthSource: 'estimated' }); expect(cab.estimateBasis).toEqual({ method: 'direct', passage: 'pas_1' });
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
  });
  it('ręczna długość przejścia (korytarz) zastępuje odległość z planu; null wraca do planu', () => {
    const s = mk(); s.dispatch('pas', passageCmd.add('pas_1', { ...ps(), lengthMm: 30000 }));
    expect(estimateLengths(s.state, 1000).estimates[0].lengthMm).toBe(45500); // 30000 + 10500 + 4000 + 1000
    s.dispatch('u', passageCmd.update('pas_1', { lengthMm: null }));
    expect(estimateLengths(s.state, 1000).estimates[0].lengthMm).toBe(24000);
  });
  it('wybiera krótsze z dwóch przejść; trasy w salach skracają dojścia', () => {
    const s = mk(); s.dispatch('p1', passageCmd.add('pas_1', { ...ps(), lengthMm: 50000 }));
    s.dispatch('p2', passageCmd.add('pas_2', { name: 'Przepust', a: { spaceId: 'spc_b', x: 14000, y: 7000, z: 0 }, b: { spaceId: 'spc_a', x: 19500, y: 9500, z: 0 }, lengthMm: 3000 }));
    const e = estimateLengths(s.state, 0).estimates[0]; expect(e.passage).toBe('pas_2'); // orientacja przejścia nie ma znaczenia
    s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'Trasa FOH', [[10000, 5000, 2500], [19500, 5000, 2500], [19500, 9500, 2500]]));
    expect(estimateLengths(s.state, 0).estimates.length).toBe(1);
  });
  it('kable rysują się jako dwa odcinki, każdy w swojej sali; przejście jest na planie budynku', () => {
    const s = mk(); s.dispatch('pas', passageCmd.add('pas_1', ps()));
    const cps = cablePaths(s.state); expect(cps.map((c) => c.spaceId)).toEqual(['spc_b', 'spc_a']); // kamera (początek połączenia) na scenie
    const dl = planDrawList(s.state, { cables: true, relativeTo: 'spc_a' });
    const line = dl.prims.find((x) => x.t === 'line' && x.id === 'pas_1') as any; expect(line.pts).toEqual([18000, 5000, 22500, 1000]);
    expect(dl.prims.some((x) => x.t === 'text' && x.id === 'pas_1' && x.s.includes('Multicore') && x.s.includes('8,5 m'))).toBe(true);
    expect(planDrawList(s.state, { spaceId: 'spc_a' }).prims.some((x) => x.id === 'pas_1')).toBe(false); // PDF jednej sali bez przejść
  });
  it('walidacja: tylko istniejące, różne sale; zmiana obrysu przesuwa końce; usunięcie sali kasuje przejście; cofanie', () => {
    const s = mk();
    expect(() => s.dispatch('x', passageCmd.add('pas_1', { ...ps(), b: { spaceId: 'spc_a', x: 1, y: 1, z: 0 } }))).toThrow();
    expect(() => s.dispatch('x', passageCmd.add('pas_1', { ...ps(), b: { spaceId: 'spc_zz', x: 1, y: 1, z: 0 } }))).toThrow();
    expect(() => s.dispatch('x', passageCmd.add('pas_1', { ...ps(), name: ' ' }))).toThrow();
    s.dispatch('pas', passageCmd.add('pas_1', ps()));
    s.dispatch('sh', plan.setSpaceShape('spc_b', [[1000, 1000], [16000, 1000], [16000, 9000], [1000, 9000]])); // obrys przesunięty do 0,0 → zawartość o −1000
    expect((s.state as any).passages.pas_1.b).toMatchObject({ x: -500, y: 0 });
    s.dispatch('rm', plan.removeSpace('spc_b')); expect(passagesOf(s.state).length).toBe(0);
    expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); expect(passagesOf(s.state).length).toBe(1);
  });
});

describe('poziom podłogi sali', () => {
  it('przejście liczy różnicę poziomów: FOH 2,6 m wyżej wydłuża kabel o 2,6 m', () => {
    const s = (() => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {}; return new Store(p); })();
    s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 10000, undefined, [0, 0]));
    s.dispatch('b', plan.addSpace('spc_b', 'FOH', 10000, 10000, undefined, [0, 0]));
    s.dispatch('p', passageCmd.add('pas_1', { name: 'P', a: { spaceId: 'spc_a', x: 0, y: 0, z: 2500 }, b: { spaceId: 'spc_b', x: 0, y: 0, z: 2500 } }));
    const before = passageLength(s.state, (s.state as any).passages.pas_1);
    s.dispatch('f', plan.setFloorLevel('spc_b', 2600));
    expect(passageLength(s.state, (s.state as any).passages.pas_1) - before).toBe(2600);
  });
});
