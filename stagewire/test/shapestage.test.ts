import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { plan, polygonProblem, polygonArea, pointInPolygon, normalizePolygon, isRectBoundary, rackFootprint } from '../src/plan.ts';
import { stageCmd, STAGE_PRESETS } from '../src/stage.ts';
import { routeCmd } from '../src/routes.ts';
import { buildScene, baseCorners, visibleFaces } from '../src/view3d.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { validate } from '../src/validation.ts';
import { checkInvariants } from '../src/invariants.ts';
import { syntheticProject } from '../src/synthetic.ts';

const L = [[0, 0], [10000, 0], [10000, 4000], [4000, 4000], [4000, 9000], [0, 9000]]; // sala w kształcie litery L
const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.spaces = {}; p.stageObjects = {}; return new Store(p); };

describe('kształt sali: wielokąt', () => {
  it('pole, punkt w wielokącie (wnętrze, brzeg, wklęsłość), prostokąt rozpoznawany', () => {
    expect(polygonArea(L)).toBe(10000 * 4000 + 4000 * 5000);
    expect(pointInPolygon([2000, 2000], L)).toBe(true); expect(pointInPolygon([2000, 8000], L)).toBe(true);
    expect(pointInPolygon([8000, 8000], L)).toBe(false); // we wcięciu litery L
    expect(pointInPolygon([10000, 2000], L)).toBe(true); // na brzegu
    expect(isRectBoundary([[0, 0], [5, 0], [5, 3], [0, 3]])).toBe(true); expect(isRectBoundary(L)).toBe(false);
  });
  it('poprawny obrys przechodzi; krzyżowanie, za mało punktów, powtórzenia, zawrócenie i za małe pole są odrzucane', () => {
    expect(polygonProblem(L)).toBeUndefined();
    expect(polygonProblem([[0, 0], [1000, 0]])).toMatch(/3 wierzchołków/);
    expect(polygonProblem([[0, 0], [4000, 4000], [4000, 0], [0, 4000]])).toMatch(/przecinają/); // „kokardka”
    expect(polygonProblem([[0, 0], [5000, 0], [5000, 0], [5000, 5000]])).toMatch(/pokrywać/);
    expect(polygonProblem([[0, 0], [5000, 0], [2000, 0], [0, 3000]])).toMatch(/zawraca/);
    expect(polygonProblem([[0, 0], [500, 0], [500, 500]])).toMatch(/1 m²/);
    expect(polygonProblem([[0, 0], [600000, 0], [600000, 5000], [0, 5000]])).toMatch(/500/);
  });
  it('addSpaceShape tworzy salę L (obrys przesunięty do 0,0); 3D i rysowanie planu używają tego obrysu', () => {
    const s = mk(); s.dispatch('s', plan.addSpaceShape('spc_l', 'Sala L', L.map(([x, y]) => [x + 3000, y + 2000]), 6000));
    expect(s.state.spaces!.spc_l.boundary).toEqual(L); expect(s.state.spaces!.spc_l.ceilingHeightMm).toBe(6000);
    expect(buildScene(s.state, 'spc_l')).toMatchObject({ w: 10000, d: 9000, boundary: L });
    const line = planDrawList(s.state).prims.find((p) => p.t === 'line' && p.id === 'spc_l') as any; expect(line.pts).toHaveLength(14); // 6 wierzchołków + domknięcie
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('setSpaceShape: zmiana kształtu istniejącej sali przesuwa urządzenia i trasy razem z obrysem; cofnięcie przywraca wszystko', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 10000, 8000));
    s.dispatch('t', routeCmd.addRoute('spc_h', 'rte_1', 'Trasa', [[1000, 1000, 3000], [5000, 1000, 3000]]));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 3000, 3000));
    const before = JSON.stringify(s.state);
    s.dispatch('sh', plan.setSpaceShape('spc_h', [[-2000, -1000], [8000, -1000], [8000, 7000], [-2000, 7000]], 'Hala 2'));
    expect(s.state.spaces!.spc_h.name).toBe('Hala 2'); expect(s.state.spaces!.spc_h.boundary).toEqual([[0, 0], [10000, 0], [10000, 8000], [0, 8000]]);
    expect(s.state.placements!.plc_soba.position).toMatchObject({ x: 5000, y: 4000 }); expect(s.state.spaces!.spc_h.cableRoutes.rte_1.points[0]).toEqual([3000, 2000, 3000]);
    s.undo(); expect(JSON.stringify(s.state)).toBe(before);
  });
  it('nieprawidłowy obrys nie zmienia projektu (błąd polecenia)', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 10000, 8000)); const before = JSON.stringify(s.state);
    expect(() => s.dispatch('x', plan.setSpaceShape('spc_h', [[0, 0], [4000, 4000], [4000, 0], [0, 4000]]))).toThrow(/przecinają/); expect(JSON.stringify(s.state)).toBe(before);
  });
  it('V-030: urządzenie lub obiekt poza obrysem (np. we wcięciu litery L) daje ostrzeżenie; w obrysie nie', () => {
    const s = mk(); s.dispatch('s', plan.addSpaceShape('spc_l', 'Sala L', L));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_a', 'spc_l', 8000, 8000));
    s.dispatch('o2', stageCmd.addObject('sob_b', { name: 'Podest', widthMm: 1000, depthMm: 1000, heightMm: 400 })); s.dispatch('p2', plan.placeRack('sob_b', 'spc_l', 2000, 2000));
    const v30 = validate(s.state).filter((i) => i.ruleId === 'V-030'); expect(v30).toHaveLength(1); expect(v30[0].message).toMatch(/Kostka/);
  });
});

describe('obiekty sceniczne (bryły)', () => {
  it('dodanie, położenie, wymiary w obrysie, kolor i widok 3D (kolor, wysokość podstawy)', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000, 8000));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Scena', widthMm: 8000, depthMm: 6000, heightMm: 1000, color: '#AA3300' }));
    s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 6000, 4000, 90, 0));
    s.dispatch('o2', stageCmd.addObject('sob_b', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p2', plan.placeRack('sob_b', 'spc_h', 6000, 4000, 0, 1000)); // kostka na scenie
    expect(rackFootprint(s.state, 'sob_a')).toEqual({ w: 8000, d: 6000 });
    const sc = buildScene(s.state), by = Object.fromEntries(sc.boxes.map((b) => [b.id, b]));
    expect(by.sob_a).toMatchObject({ kind: 'stage', w: 8000, d: 6000, h: 1000, color: '#aa3300', rotDeg: 90, z0: 0 }); expect(by.sob_b).toMatchObject({ z0: 1000, h: 1000 });
    expect(s.state.stageObjects!.sob_a.color).toBe('#aa3300');
    const rect = planDrawList(s.state).prims.find((p) => p.t === 'rect' && p.id === 'sob_a') as any; expect(rect).toMatchObject({ w: 8000, h: 6000, fill: '#aa3300', rot: 90 });
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('edycja wymiarów, koloru i nazwy; walidacja wejścia', () => {
    const s = mk(); s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 }));
    s.dispatch('u', stageCmd.updateObject('sob_a', { name: ' Podest ', widthMm: 2000, heightMm: 400, color: '#112233', notes: ' z dywanem ' }));
    expect(s.state.stageObjects!.sob_a).toEqual({ name: 'Podest', footprint: { widthMm: 2000, depthMm: 1000, heightMm: 400 }, color: '#112233', notes: 'z dywanem' });
    s.dispatch('u2', stageCmd.updateObject('sob_a', { color: null })); expect(s.state.stageObjects!.sob_a.color).toBeUndefined();
    expect(() => s.dispatch('x', stageCmd.updateObject('sob_a', { widthMm: 0 }))).toThrow(/zakresie/);
    expect(() => s.dispatch('x', stageCmd.updateObject('sob_a', { color: 'czerwony' }))).toThrow(/#rrggbb/);
    expect(() => s.dispatch('x', stageCmd.addObject('sob_z', { name: '  ', widthMm: 1000, depthMm: 1000, heightMm: 1000 }))).toThrow(/nazwę/);
  });
  it('usunięcie kasuje też położenie; powielenie robi kopię z przesunięciem; wszystko cofa się', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000, color: '#445566' })); s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 3000, 3000, 0, 500));
    s.dispatch('d', stageCmd.duplicateObject('sob_a', 'sob_b', 1000, 0));
    expect(s.state.stageObjects!.sob_b).toMatchObject({ name: 'Kostka (kopia)', color: '#445566' }); expect(s.state.placements!.plc_sobb.position).toEqual({ x: 4000, y: 3000, z: 500 });
    expect(checkInvariants(s.state)).toEqual([]);
    s.dispatch('r', stageCmd.removeObject('sob_a')); expect(s.state.stageObjects!.sob_a).toBeUndefined(); expect(s.state.placements!.plc_soba).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); expect(s.state.placements!.plc_soba).toBeDefined();
  });
  it('obiekt można obracać i zdejmować z planu tymi samymi poleceniami co rack', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kostka', widthMm: 1000, depthMm: 1000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 3000, 3000));
    s.dispatch('r', plan.rotateRack('sob_a', 90)); expect(s.state.placements!.plc_soba.rotationDeg).toBe(90);
    s.dispatch('u', plan.unplaceRack('sob_a')); expect(s.state.placements!.plc_soba).toBeUndefined(); expect(s.state.stageObjects!.sob_a).toBeDefined();
  });
  it('schody / widownia: N stopni rośnie w głąb, obrót przesuwa stopnie wokół środka; kreski i strzałka na planie', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000, 8000));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Widownia', widthMm: 8000, depthMm: 4000, heightMm: 2000, shape: 'stairs', steps: 4 })); s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 10000, 5000, 0, 0));
    let bx = buildScene(s.state).boxes.filter((b) => b.id === 'sob_a'); expect(bx).toHaveLength(4);
    expect(bx.map((b) => b.h)).toEqual([500, 1000, 1500, 2000]); expect(bx.map((b) => b.cy)).toEqual([3500, 4500, 5500, 6500]); expect(bx.every((b) => b.d === 1000 && b.w === 8000 && b.cx === 10000)).toBe(true);
    expect(bx[3].total).toMatchObject({ w: 8000, d: 4000, h: 2000, steps: 4, cx: 10000, cy: 5000 });
    s.dispatch('r', plan.rotateRack('sob_a', 90)); bx = buildScene(s.state).boxes.filter((b) => b.id === 'sob_a');
    expect(bx.map((b) => [b.cx, b.cy])).toEqual([[11500, 5000], [10500, 5000], [9500, 5000], [8500, 5000]]); // obrót o 90°: strona wysoka w stronę -X
    const dl = planDrawList(s.state).prims.filter((p) => p.id === 'sob_a'); expect(dl.filter((p) => p.t === 'line')).toHaveLength(3 + 2); // 3 kreski + strzałka (trzon i grot)
    expect(dl.find((p) => p.t === 'rect')).toMatchObject({ w: 8000, h: 4000, rot: 90 });
  });
  it('walec: obrys wielokątny w 3D (podstawa 28-kąt wpisany w elipsę) i elipsa na planie', () => {
    const s = mk(); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000));
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Kolumna', widthMm: 600, depthMm: 400, heightMm: 3000, shape: 'cylinder' })); s.dispatch('p', plan.placeRack('sob_a', 'spc_h', 5000, 5000, 0, 0));
    const b = buildScene(s.state).boxes[0]; expect(b).toMatchObject({ sides: 28, w: 600, d: 400, h: 3000 });
    const c = baseCorners(b); expect(c).toHaveLength(28); expect(Math.max(...c.map((q) => q[0])) - 5000).toBeCloseTo(300, 0); expect(Math.max(...c.map((q) => q[1])) - 5000).toBeLessThanOrEqual(200);
    expect(visibleFaces(b, [5000, -20000, 10000]).length).toBeGreaterThan(10); // góra i część boków
    expect(planDrawList(s.state).prims.find((p) => p.t === 'rect' && p.id === 'sob_a')).toMatchObject({ round: true, w: 600, h: 400 });
  });
  it('liczba stopni i kształt: walidacja, zmiana kształtu czyści pole steps', () => {
    const s = mk(); expect(() => s.dispatch('x', stageCmd.addObject('sob_a', { name: 'S', widthMm: 2000, depthMm: 2000, heightMm: 1000, shape: 'stairs', steps: 1 }))).toThrow(/stopni/);
    s.dispatch('o', stageCmd.addObject('sob_a', { name: 'S', widthMm: 2000, depthMm: 2000, heightMm: 1000, shape: 'stairs' })); expect(s.state.stageObjects!.sob_a).toMatchObject({ shape: 'stairs', steps: 6 });
    s.dispatch('u', stageCmd.updateObject('sob_a', { steps: 10 })); expect(s.state.stageObjects!.sob_a.steps).toBe(10);
    expect(() => s.dispatch('x', stageCmd.updateObject('sob_a', { steps: 100 }))).toThrow(/stopni/);
    s.dispatch('u2', stageCmd.updateObject('sob_a', { shape: 'cylinder' })); expect(s.state.stageObjects!.sob_a).toMatchObject({ shape: 'cylinder' }); expect(s.state.stageObjects!.sob_a.steps).toBeUndefined();
    s.dispatch('u3', stageCmd.updateObject('sob_a', { shape: 'box' })); expect(s.state.stageObjects!.sob_a.shape).toBeUndefined();
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('gotowe zestawy mają sensowne wymiary', () => { for (const p of STAGE_PRESETS) expect(p.widthMm * p.depthMm * p.heightMm).toBeGreaterThan(0); expect(STAGE_PRESETS.some((p) => p.key === 'cube')).toBe(true); });
  it('normalizePolygon zwraca przesunięcie', () => { expect(normalizePolygon([[1000, 2000], [3000, 2000], [3000, 4000]])).toEqual({ pts: [[0, 0], [2000, 0], [2000, 2000]], dx: 1000, dy: 2000 }); });
});
