import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { plan, spaceOrigin, nextFreeOrigin } from '../src/plan.ts';
import { stageCmd } from '../src/stage.ts';
import { routeCmd } from '../src/routes.ts';
import { buildScene } from '../src/view3d.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.spaces = {}; p.stageObjects = {}; return new Store(p); };

describe('wiele sal', () => {
  it('pierwsza sala w 0,0; kolejne obok z odstępem; własne położenie można ustawić', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000));
    expect(spaceOrigin(s.state, 'spc_a')).toEqual([0, 0]); expect((s.state.spaces!.spc_a as any).origin).toBeUndefined();
    expect(nextFreeOrigin(s.state)).toEqual([12000, 0]);
    s.dispatch('b', plan.addSpace('spc_b', 'Foyer', 6000, 5000)); expect(spaceOrigin(s.state, 'spc_b')).toEqual([12000, 0]);
    s.dispatch('c', plan.addSpace('spc_c', 'Garderoba', 4000, 4000, undefined, [30000, 500])); expect(spaceOrigin(s.state, 'spc_c')).toEqual([30000, 500]);
    s.dispatch('o', plan.setSpaceOrigin('spc_c', 0, 0)); expect((s.state.spaces!.spc_c as any).origin).toBeUndefined();
    expect(() => s.dispatch('x', plan.setSpaceOrigin('spc_c', NaN, 0))).toThrow(/Położenie/);
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('rysunek planu: widok względem aktywnej sali przesuwa pozostałe; PDF jednej sali we własnych współrzędnych', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000)); s.dispatch('b', plan.addSpace('spc_b', 'Foyer', 6000, 5000));
    s.dispatch('o', stageCmd.addObject('sob_x', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_x', 'spc_b', 1000, 1000));
    const rectOf = (opts: any) => planDrawList(s.state, opts).prims.find((p) => p.t === 'rect' && p.id === 'sob_x') as any;
    expect(rectOf({ relativeTo: 'spc_a' })).toMatchObject({ x: 13000, y: 1000 }); // Foyer zaczyna się w 12000
    expect(rectOf({ relativeTo: 'spc_b' })).toMatchObject({ x: 1000, y: 1000 });
    expect(rectOf({ spaceId: 'spc_b' })).toMatchObject({ x: 1000, y: 1000 }); expect(rectOf({ spaceId: 'spc_a' })).toBeUndefined();
    const lines = planDrawList(s.state, { spaceId: 'spc_a' }).prims.filter((p) => p.t === 'line'); expect(lines).toHaveLength(1);
    const outline = (id: string, rel: string) => (planDrawList(s.state, { relativeTo: rel }).prims.find((p) => p.t === 'line' && p.id === id) as any).pts as number[];
    expect(outline('spc_b', 'spc_a').slice(0, 2)).toEqual([12000, 0]); expect(outline('spc_a', 'spc_b').slice(0, 2)).toEqual([-12000, 0]);
    const names = planDrawList(s.state, { relativeTo: 'spc_a', labels: false }).prims.filter((p) => p.t === 'text').map((p: any) => p.s); expect(names).toEqual(['Foyer']); // podpis nieaktywnej sali
  });
  it('zmiana kształtu sali zostawia zawartość w tym samym miejscu budynku (początek sali przesuwa się razem z obrysem)', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000)); s.dispatch('b', plan.addSpace('spc_b', 'Foyer', 6000, 5000));
    s.dispatch('o', stageCmd.addObject('sob_x', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_x', 'spc_b', 2000, 3000));
    s.dispatch('r', routeCmd.addRoute('spc_b', 'rte_1', 'T', [[1000, 1000, 2000], [4000, 1000, 2000]]));
    const world = () => { const o = spaceOrigin(s.state, 'spc_b'), pl = s.state.placements!.plc_sobx.position; return [o[0] + pl.x, o[1] + pl.y]; };
    const w0 = world(); s.dispatch('sh', plan.setSpaceShape('spc_b', [[-1000, -500], [6000, -500], [6000, 5000], [-1000, 5000]]));
    expect(world()).toEqual(w0); expect(spaceOrigin(s.state, 'spc_b')).toEqual([11000, -500]);
    expect(s.state.spaces!.spc_b.cableRoutes.rte_1.points[0]).toEqual([2000, 1500, 2000]);
    s.undo(); expect(spaceOrigin(s.state, 'spc_b')).toEqual([12000, 0]);
  });
  it('rysowanie nowej sali względem aktywnej: origin = układ odniesienia + przesunięcie obrysu', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000, undefined, [5000, 5000]));
    s.dispatch('b', plan.addSpaceShape('spc_b', 'Foyer', [[11000, 2000], [16000, 2000], [16000, 6000], [11000, 6000]], undefined, [5000, 5000]));
    expect(spaceOrigin(s.state, 'spc_b')).toEqual([16000, 7000]); expect(s.state.spaces!.spc_b.boundary[0]).toEqual([0, 0]);
  });
  it('usunięcie sali kasuje jej położenia, trasy i obiekty sceniczne; racki/urządzenia zostają bez położenia; wszystko cofalne', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000)); s.dispatch('b', plan.addSpace('spc_b', 'Foyer', 6000, 5000));
    s.dispatch('o', stageCmd.addObject('sob_x', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_x', 'spc_b', 1000, 1000));
    s.dispatch('o2', stageCmd.addObject('sob_y', { name: 'Podest', widthMm: 1000, depthMm: 1000, heightMm: 400 })); s.dispatch('p2', plan.placeRack('sob_y', 'spc_a', 1000, 1000));
    s.dispatch('rm', plan.removeSpace('spc_b'));
    expect(s.state.spaces!.spc_b).toBeUndefined(); expect(s.state.stageObjects!.sob_x).toBeUndefined(); expect(s.state.placements!.plc_sobx).toBeUndefined();
    expect(s.state.stageObjects!.sob_y).toBeDefined(); expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); expect(s.state.spaces!.spc_b).toBeDefined(); expect(s.state.stageObjects!.sob_x).toBeDefined();
  });
  it('scena 3D pokazuje tylko wskazaną salę', () => {
    const s = mk(); s.dispatch('a', plan.addSpace('spc_a', 'Scena', 10000, 8000)); s.dispatch('b', plan.addSpace('spc_b', 'Foyer', 6000, 5000));
    s.dispatch('o', stageCmd.addObject('sob_x', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_x', 'spc_b', 1000, 1000));
    expect(buildScene(s.state, 'spc_a').boxes).toEqual([]); expect(buildScene(s.state, 'spc_b').boxes.map((b) => b.id)).toEqual(['sob_x']);
  });
});
