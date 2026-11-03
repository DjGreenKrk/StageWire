import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd, CABINET_PRESETS } from '../src/cabinets.ts';
import { rackCmd, rackContents, rackTotals, rackReport, mountProblem, firstFree, itemInfo } from '../src/racks.ts';
import { validate } from '../src/validation.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const T = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'cabrack', name: 'T', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'F', model: 'Zasilacz', category: 'zasilanie', dinModules: 3, weightKg: 0.3, powerW: 12, ports: [T('in', 'L/N', 'std/power-ac', 'in')], source: { kind: 'custom' } },
  { key: 'sw', manufacturer: 'F', model: 'Switch', category: 'sieć', rackUnits: { heightU: 1, widthFraction: 1 }, weightKg: 3, powerW: 20, dimensionsMm: { width: 440, depth: 300, height: 44 }, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } },
] }).errors).toEqual([]); });
afterAll(() => unloadPack('cabrack'));

const rack3u = CABINET_PRESETS.find((p) => p.key === 'rack3u')!.v;
const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p);
  s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack FOH', units: 6, depthMm: 100 }));
  s.dispatch('c', cabCmd.addCabinet('cab_m', { name: 'Moduł DIN 3U', widthMm: rack3u.widthMm, heightMm: rack3u.heightMm, depthMm: 120, rows: rack3u.rows, modules: rack3u.modules, rackUnits: rack3u.rackUnits }));
  s.dispatch('c', cabCmd.addCabinet('cab_x', { name: 'Zwykła szafa', widthMm: 400, heightMm: 500, rows: 2, modules: 12 }));
  s.dispatch('a', addFromCatalog('cabrack/psu', 'Zasilacz 1', 'eqi_p')); s.dispatch('m', cabCmd.mount('eqi_p', { cabinetId: 'cab_m', row: 1, at: 1 }));
  s.dispatch('a', addFromCatalog('cabrack/sw', 'Switch', 'eqi_s'));
  return s;
};
const at = (u: number, id = 'cab_m') => rackCmd.mount(id, { rackId: 'rck_a', uStart: u, face: 'front', slot: 'full' });

describe('moduł DIN 3U w racku', () => {
  it('szafa z wysokością w U da się zamontować, a bez niej nie; kolizje z urządzeniami liczone razem', () => {
    const s = mk();
    expect(mountProblem(s.state, 'cab_x', { rackId: 'rck_a', uStart: 1, face: 'front', slot: 'full' })).toMatch(/nie ma wysokości/);
    s.dispatch('m', at(2)); expect(s.state.cabinets!.cab_m.mount).toMatchObject({ rackId: 'rck_a', uStart: 2 });
    expect(rackContents(s.state, 'rck_a').map((o) => o.id)).toEqual(['cab_m']);
    expect(() => s.dispatch('x', rackCmd.mount('eqi_s', { rackId: 'rck_a', uStart: 4, face: 'front', slot: 'full' }))).toThrow(/zajęte przez Moduł DIN 3U/);
    s.dispatch('m', rackCmd.mount('eqi_s', { rackId: 'rck_a', uStart: 5, face: 'front', slot: 'full' }));
    expect(() => s.dispatch('x', at(4, 'cab_m'))).toThrow(/zajęte/);
    expect(firstFree(s.state, 'cab_m', 'rck_a')).toMatchObject({ uStart: 1 }); // pomija własne miejsce, więc 1–3 jest wolne
  });
  it('sumy racka: masa i pobór szafy to suma jej osprzętu; brak danych liczony osobno; raport i walidacja', () => {
    const s = mk(); s.dispatch('m', at(1)); s.dispatch('m', rackCmd.mount('eqi_s', { rackId: 'rck_a', uStart: 4, face: 'front', slot: 'full' }));
    expect(rackTotals(s.state, 'rck_a')).toMatchObject({ usedU: 4, freeU: 2, devices: 2, weightKg: 3.3, powerW: 32, weightUnknown: 0 });
    expect(itemInfo(s.state, 'cab_m')).toMatchObject({ name: 'Moduł DIN 3U', isCabinet: true, depthMm: 120 });
    expect(rackReport(s.state).map((r) => [r.name, r.uStart, r.uEnd, r.device])).toEqual([['Switch', 4, 4, 'F Switch'], ['Moduł DIN 3U', 1, 3, 'Szafa DIN 1 × 24 mod.']]);
    const w = validate(s.state).filter((i) => i.ruleId === 'V-027' && /Moduł/.test(i.message)); expect(w).toHaveLength(1); expect(w[0].message).toMatch(/Moduł DIN 3U.*120 mm.*100 mm/); // głębsza niż rack 100 mm
  });
  it('zdjęcie, usunięcie racka, przełączenie szafa↔rack, zmiany wysokości, niezmienniki i schemat', () => {
    const s = mk(); s.dispatch('m', at(1));
    expect(() => s.dispatch('x', cabCmd.updateCabinet('cab_m', { rackHeightU: null }))).toThrow(/zdejmij/);
    expect(() => s.dispatch('x', cabCmd.updateCabinet('cab_m', { rackHeightU: 7 }))).toThrow(/nie zmieści/);
    s.dispatch('u', cabCmd.updateCabinet('cab_m', { rackHeightU: 2 })); expect(rackContents(s.state, 'rck_a')[0].fit.heightU).toBe(2);
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(s.state)).toEqual([]);
    s.dispatch('uu', rackCmd.unmount('cab_m')); expect(s.state.cabinets!.cab_m.mount).toBeUndefined();
    s.dispatch('m', at(1)); s.dispatch('rm', rackCmd.removeRack('rck_a')); expect(s.state.cabinets!.cab_m.mount).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
    expect(() => s.dispatch('h', (d) => { d.cabinets!.cab_m.mount = { rackId: 'rck_zz', uStart: 1, face: 'front', slot: 'full' }; })).toThrow(/nieistniejącym racku/);
  });
});
