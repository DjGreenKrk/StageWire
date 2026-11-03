import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cmd } from '../src/commands.ts';
import { rackCmd } from '../src/racks.ts';
import { plan, effectivePosition, rackPlacementKey } from '../src/plan.ts';
import { estimateLengths, cablePaths } from '../src/lengths.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { syntheticProject } from '../src/synthetic.ts';

const dev = (key: string, model: string, h: number) => ({
  key, manufacturer: 'Fikcyjny', model, category: 'sieć', dimensionsMm: { width: 440, depth: 300, height: 44 * h }, rackUnits: { heightU: h, widthFraction: 1 }, weightKg: 3, powerW: 20,
  ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' },
});
beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'rackplan-test', name: 'T', version: '1.0.0', license: 'własne', devices: [dev('sw', 'Switch', 1)] }).errors).toEqual([]); });
afterAll(() => unloadPack('rackplan-test'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p);
  s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack A', units: 12, depthMm: 800 }));
  s.dispatch('s', plan.addSpace('spc_h', 'Hala', 30000, 20000));
  for (const [id, u] of [['eqi_a', 1], ['eqi_b', 10]] as const) { s.dispatch('a', addFromCatalog('rackplan-test/sw', id, id)); s.dispatch('m', rackCmd.mount(id, { rackId: 'rck_a', uStart: u, face: 'front', slot: 'full' })); }
  return s;
};

describe('rack na planie sali', () => {
  it('placeRack zapisuje położenie, odrzuca brak racka i sali, obrót i zdjęcie działają', () => {
    const s = mk();
    expect(() => s.dispatch('x', plan.placeRack('rck_zz', 'spc_h', 0, 0))).toThrow();
    expect(() => s.dispatch('x', plan.placeRack('rck_a', 'spc_zz', 0, 0))).toThrow();
    s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 5000, 4000));
    expect(s.state.placements![rackPlacementKey('rck_a')]).toMatchObject({ targetKind: 'rack', targetId: 'rck_a', position: { x: 5000, y: 4000, z: 0 } });
    s.dispatch('r', plan.rotateRack('rck_a', 90)); expect(s.state.placements![rackPlacementKey('rck_a')].rotationDeg).toBe(90);
    s.dispatch('u', plan.unplaceRack('rck_a')); expect(s.state.placements![rackPlacementKey('rck_a')]).toBeUndefined();
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('zamontowane urządzenie stoi tam, gdzie rack, na wysokości swojego U; bez racka na planie wraca do własnego położenia', () => {
    const s = mk(); s.dispatch('d', plan.place('eqi_a', 'spc_h', 100, 100));
    expect(effectivePosition(s.state, 'eqi_a')).toMatchObject({ x: 100, y: 100 });
    s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 5000, 4000, 0, 0));
    expect(effectivePosition(s.state, 'eqi_a')).toMatchObject({ x: 5000, y: 4000, z: Math.round(0.5 * 44.45) });
    expect(effectivePosition(s.state, 'eqi_b')!.z).toBe(Math.round((9 + 0.5) * 44.45));
  });
  it('estymata kabla liczy od racka, także gdy urządzenia nie mają własnych położeń', () => {
    const s = mk(); const port = (id: string) => Object.keys(s.state.definitions[s.state.equipment[id].definitionId].revisions['1'].ports)[0];
    s.dispatch('c', cmd.connect({ instanceId: 'eqi_a', portId: port('eqi_a') }, { instanceId: 'eqi_b', portId: port('eqi_b') }, 'std/ethernet'));
    expect(estimateLengths(s.state, 1000).noPlacement).toBe(1);
    s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 5000, 4000));
    const r = estimateLengths(s.state, 1000); expect(r.noPlacement).toBe(0); expect(r.estimates[0].lengthMm).toBe(1400); // 400 mm w pionie (9 U) + zapas 1 m
    expect(cablePaths(s.state).length).toBe(1);
  });
  it('rysunek planu pokazuje rack, a urządzenia w nim nie powtarzają się', () => {
    const s = mk(); s.dispatch('d', plan.place('eqi_a', 'spc_h', 100, 100)); s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 5000, 4000));
    const ids = planDrawList(s.state, { labels: false }).prims.filter((q) => q.t === 'rect').map((q) => q.id);
    expect(ids).toContain('rck_a'); expect(ids).not.toContain('eqi_a');
  });
  it('usunięcie racka kasuje jego położenie i niczego nie psuje', () => {
    const s = mk(); s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 5000, 4000)); s.dispatch('x', rackCmd.removeRack('rck_a'));
    expect(Object.keys(s.state.placements!)).toEqual([]); expect(checkInvariants(s.state)).toEqual([]);
  });
});
