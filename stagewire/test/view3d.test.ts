import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { rackCmd } from '../src/racks.ts';
import { cabCmd } from '../src/cabinets.ts';
import { routeCmd } from '../src/routes.ts';
import { cmd } from '../src/commands.ts';
import { buildScene, defaultCam, fitCam, project, groundPoint, baseCorners, visibleFaces, sortedFaces, pickBox, basis, type Box3 } from '../src/view3d.ts';
import { syntheticProject } from '../src/synthetic.ts';

beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'v3d', name: 'T', version: '1.0.0', license: 'własne', devices: [
  { key: 'sw', manufacturer: 'F', model: 'Switch', category: 'sieć', rackUnits: { heightU: 1, widthFraction: 1 }, dimensionsMm: { width: 440, depth: 300, height: 44 }, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } },
  { key: 'box', manufacturer: 'F', model: 'Skrzynia', category: 'wideo', dimensionsMm: { width: 1000, depth: 500, height: 800 }, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } },
] }).errors).toEqual([]); });
afterAll(() => unloadPack('v3d'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.spaces = {};
  const s = new Store(p); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000, 8000));
  s.dispatch('a', addFromCatalog('v3d/box', 'Skrzynia', 'eqi_b')); s.dispatch('a', addFromCatalog('v3d/sw', 'Switch', 'eqi_s')); s.dispatch('a', addFromCatalog('v3d/box', 'Skrzynia 2', 'eqi_b2'));
  s.dispatch('p', plan.place('eqi_b', 'spc_h', 5000, 4000, 0, 1200));
  s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack', units: 10, depthMm: 800 })); s.dispatch('m', rackCmd.mount('eqi_s', { rackId: 'rck_a', uStart: 2, face: 'front', slot: 'full' }));
  s.dispatch('pr', plan.placeRack('rck_a', 'spc_h', 12000, 5000, 90, 0));
  s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Szafa', widthMm: 600, heightMm: 900, depthMm: 250, rows: 2, modules: 12 })); s.dispatch('pc', plan.placeRack('cab_a', 'spc_h', 3000, 8000, 0, 300));
  return s;
};

describe('widok 3D: scena', () => {
  it('bryły z wymiarów i położeń: urządzenie z wysokością podstawy, rack (U × 44,45 + ramka), szafa; osprzęt w racku nie jest osobną bryłą', () => {
    const sc = buildScene(mk().state); expect(sc).toMatchObject({ w: 20000, d: 10000, ceiling: 8000, spaceName: 'Hala' });
    const by = Object.fromEntries(sc.boxes.map((b) => [b.id, b]));
    expect(Object.keys(by).sort()).toEqual(['cab_a', 'eqi_b', 'rck_a']); // switch w racku, Skrzynia 2 bez położenia
    expect(by.eqi_b).toMatchObject({ kind: 'equipment', w: 1000, d: 500, h: 800, z0: 1200, cx: 5000, cy: 4000 });
    expect(by.rck_a).toMatchObject({ kind: 'rack', w: 600, d: 800, rotDeg: 90, h: Math.round(10 * 44.45 + 60) });
    expect(by.cab_a).toMatchObject({ kind: 'cabinet', w: 600, d: 250, h: 900, z0: 300 });
  });
  it('trasy kablowe w 3D i połączenia jako proste linie między położeniami (rack liczy się w swoim miejscu)', () => {
    const s = mk(); s.dispatch('t', routeCmd.addRoute('spc_h', 'rte_1', 'Trasa', [[0, 0, 3000], [5000, 0, 3000], [5000, 0, 5000]]));
    s.dispatch('p2', plan.place('eqi_b2', 'spc_h', 8000, 2000, 0, 0));
    s.dispatch('w', cmd.connect({ instanceId: 'eqi_s', portId: 'prt_lan' }, { instanceId: 'eqi_b2', portId: 'prt_lan' }, 'std/ethernet'));
    const sc = buildScene(s.state); expect(sc.routes[0].pts).toEqual([[0, 0, 3000], [5000, 0, 3000], [5000, 0, 5000]]);
    expect(sc.links).toHaveLength(1); expect(sc.links[0].a.slice(0, 2)).toEqual([12000, 5000]);
  });
  it('połączenia w 3D idą po trasie: dojście poziome do trasy, pion do jej wysokości, trasa, zejście do drugiego urządzenia; bez trasy prosta linia', () => {
    const s = mk(); s.dispatch('p2', plan.place('eqi_b2', 'spc_h', 8000, 2000, 0, 0));
    s.dispatch('w', cmd.connect({ instanceId: 'eqi_b', portId: 'prt_lan' }, { instanceId: 'eqi_b2', portId: 'prt_lan' }, 'std/ethernet'));
    const direct = buildScene(s.state).links[0]; expect(direct.method).toBe('direct'); expect(direct.pts).toEqual([[5000, 4000, 1200], [8000, 2000, 0]]);
    s.dispatch('t', routeCmd.addRoute('spc_h', 'rte_1', 'Trasa', [[0, 3000, 3000], [10000, 3000, 3000]]));
    const l = buildScene(s.state).links[0]; expect(l.method).toBe('route');
    expect(l.pts[0]).toEqual([5000, 4000, 1200]); expect(l.pts.at(-1)).toEqual([8000, 2000, 0]);
    expect(l.pts[1]).toEqual([5000, 3000, 1200]); expect(l.pts[2]).toEqual([5000, 3000, 3000]); // poziomo do trasy, potem pion
    expect(l.pts.at(-2)).toEqual([8000, 3000, 0]); // punkt na trasie, potem poziomo do urządzenia
  });
  it('projekt bez sali daje pustą scenę 10 × 10 m', () => {
    const p = syntheticProject(0, 0, 1, true); p.spaces = {}; p.placements = {}; const sc = buildScene(p);
    expect(sc.boxes).toEqual([]); expect(sc.w).toBe(10000);
  });
});

describe('widok 3D: kamera i rzutowanie', () => {
  const W = 1000, H = 700;
  it('punkt, na który patrzy kamera, jest w środku ekranu; punkt za kamerą nie jest rzutowany; dalej = mniejszy', () => {
    const cam = { yaw: 0.7, pitch: 0.6, dist: 20000, tx: 5000, ty: 4000, tz: 0 };
    const c = project(cam, W, H, [5000, 4000, 0])!; expect(c.x).toBeCloseTo(500, 3); expect(c.y).toBeCloseTo(350, 3); expect(c.depth).toBeCloseTo(20000, 3);
    const b = basis(cam); expect(project(cam, W, H, [b.pos[0] - b.fw[0] * 1000, b.pos[1] - b.fw[1] * 1000, b.pos[2] - b.fw[2] * 1000])).toBeNull();
    const near = project(cam, W, H, [5500, 4000, 0])!, far = project({ ...cam, dist: 40000 }, W, H, [5500, 4000, 0])!; expect(Math.abs(near.x - 500)).toBeGreaterThan(Math.abs(far.x - 500));
  });
  it('groundPoint odwraca rzutowanie na podłodze', () => {
    const cam = { yaw: -0.8, pitch: 0.7, dist: 18000, tx: 6000, ty: 3000, tz: 0 }; const pr = project(cam, W, H, [7000, 2500, 0])!;
    const g = groundPoint(cam, W, H, pr.x, pr.y)!; expect(g[0]).toBeCloseTo(7000, 1); expect(g[1]).toBeCloseTo(2500, 1);
  });
  it('narożniki podstawy po obrocie o 90° zamieniają szerokość z głębokością; z góry widać górę i dwa boki', () => {
    const box: Box3 = { id: 'x', kind: 'equipment', name: 'x', detail: '', cx: 0, cy: 0, z0: 0, w: 1000, d: 400, h: 500, rotDeg: 90, color: '#fff' };
    const xs = baseCorners(box).map((q) => q[0]); expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(400, 6);
    const cam = { yaw: 0.8, pitch: 0.9, dist: 9000, tx: 0, ty: 0, tz: 0 }; expect(visibleFaces({ ...box, rotDeg: 0 }, basis(cam).pos)).toHaveLength(3);
  });
  it('sortowanie od najdalszej i wybór bryły: bliższa przesłania dalszą', () => {
    const sc = buildScene(mk().state), cam = fitCam(sc, defaultCam(sc)), W2 = 1200, H2 = 800;
    const faces = sortedFaces(sc, cam, W2, H2); for (let i = 1; i < faces.length; i++) expect(faces[i - 1].depth).toBeGreaterThanOrEqual(faces[i].depth);
    const top = project(cam, W2, H2, [5000, 4000, 1200 + 800])!; expect(pickBox(sc, cam, W2, H2, top.x, top.y)).toBe('eqi_b');
    expect(pickBox(sc, cam, W2, H2, 2, 2)).toBeUndefined();
  });
});
