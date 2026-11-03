import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { rackCmd, rackTotals, rackReport, rackContents, firstFree, mountProblem, conflicts, slotsFor, slotRange, newRackId, type Mount } from '../src/racks.ts';
import { validate } from '../src/validation.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { syntheticProject } from '../src/synthetic.ts';

const dev = (key: string, model: string, heightU: number, widthFraction: number, extra: object = {}) => ({
  key, manufacturer: 'Fikcyjny', model, category: 'sieć', dimensionsMm: { width: 440, depth: 300, height: 44 * heightU }, rackUnits: { heightU, widthFraction }, ...extra,
  ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' },
});
const pack = { format: 'stagewire-pack/1', id: 'rack-test', name: 'Rack test', version: '1.0.0', license: 'własne', devices: [
  dev('u1', 'Switch 1U', 1, 1, { weightKg: 4, powerW: 30, powerMaxW: 60 }), dev('u2', 'Serwer 2U', 2, 1, { weightKg: 12, powerW: 200 }),
  dev('h1', 'Połówka', 1, 0.5, { weightKg: 1, powerW: 10 }), dev('t1', 'Trzeci', 1, 0.33), dev('gl', 'Głęboki', 1, 1, { dimensionsMm: { width: 440, depth: 700, height: 44 } }),
] };
beforeAll(() => { const r = installPack(pack); expect(r.errors).toEqual([]); });
afterAll(() => unloadPack('rack-test'));

function setup() {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {};
  const s = new Store(p);
  const add = (key: string, id: string) => s.dispatch('a', addFromCatalog('rack-test/' + key, id, id));
  add('u1', 'eqi_a'); add('u1', 'eqi_b'); add('u2', 'eqi_s'); add('h1', 'eqi_h1'); add('h1', 'eqi_h2'); add('t1', 'eqi_t'); add('gl', 'eqi_g');
  s.dispatch('rack', rackCmd.addRack('rck_r1', { name: 'Rack FOH', units: 12, depthMm: 600 }));
  return s;
}
const M = (uStart: number, slot: Mount['slot'] = 'full', face: Mount['face'] = 'front'): Mount => ({ rackId: 'rck_r1', uStart, face, slot });

describe('geometria miejsc', () => {
  it('miejsca zależą od szerokości; zakresy się nie nakładają', () => {
    expect(slotsFor(1)).toEqual(['full']); expect(slotsFor(0.5)).toEqual(['left', 'right']); expect(slotsFor(0.33)).toEqual(['left', 'center', 'right']);
    expect(slotRange('left', 0.5)).toEqual([0, 0.5]); expect(slotRange('right', 0.33)[1]).toBe(1);
  });
});

describe('montaż w racku', () => {
  it('montaż, przeniesienie i zdjęcie; wynik zgodny ze schematem, niezmiennikami i zapisem', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_a', M(1))); s.dispatch('m', rackCmd.mount('eqi_s', M(2))); s.dispatch('m', rackCmd.mount('eqi_a', M(5)));
    expect(s.state.equipment.eqi_a.mount).toEqual(M(5)); expect(rackContents(s.state, 'rck_r1').map((o) => o.id)).toEqual(['eqi_s', 'eqi_a']);
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok'); if (back.status === 'ok') expect(back.project.equipment.eqi_s.mount).toEqual(M(2));
    s.dispatch('u', rackCmd.unmount('eqi_a')); expect(s.state.equipment.eqi_a.mount).toBeUndefined();
    s.undo(); expect(s.state.equipment.eqi_a.mount).toEqual(M(5));
  });
  it('odrzuca kolizję, wyjście poza rack, złą szerokość i urządzenie nierackowe', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_s', M(3))); // zajmuje U3–U4
    expect(() => s.dispatch('m', rackCmd.mount('eqi_a', M(4)))).toThrow(/zajęte/);
    expect(() => s.dispatch('m', rackCmd.mount('eqi_a', M(3)))).toThrow(/zajęte/);
    expect(() => s.dispatch('m', rackCmd.mount('eqi_s', M(12)))).toThrow(/nie mieści/);
    expect(() => s.dispatch('m', rackCmd.mount('eqi_a', M(0)))).toThrow();
    expect(() => s.dispatch('m', rackCmd.mount('eqi_a', M(1, 'left')))).toThrow(/szerokości/);
    s.dispatch('m', rackCmd.mount('eqi_a', M(5))); // wolne
    expect(mountProblem(s.state, 'eqi_a', M(5, 'full', 'rear'))).toBeUndefined(); // tył jest osobną stroną
    const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; const s2 = new Store(p); s2.dispatch('r', rackCmd.addRack('rck_x', { name: 'X', units: 4 })); s2.dispatch('c', addFromCatalog('camera_sdi', 'Kamera', 'eqi_cam'));
    expect(() => s2.dispatch('m', rackCmd.mount('eqi_cam', { rackId: 'rck_x', uStart: 1, face: 'front', slot: 'full' }))).toThrow(/nie jest rackowe|nie ma wysokości/);
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('połówki i trzecie: dwie połówki w jednym U, trzecia nie wejdzie na połówkę', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_h1', M(1, 'left'))); s.dispatch('m', rackCmd.mount('eqi_h2', M(1, 'right')));
    expect(() => s.dispatch('m', rackCmd.mount('eqi_a', M(1)))).toThrow(/zajęte/);
    expect(() => s.dispatch('m', rackCmd.mount('eqi_t', M(1, 'center')))).toThrow(/zajęte/); // środek trzeciej nakłada się na połówki
    s.dispatch('m', rackCmd.mount('eqi_t', M(2, 'center')));
    expect(conflicts(s.state, M(2, 'left'), { heightU: 1, widthFraction: 0.33 })).toEqual(['eqi_t'].filter(() => false)); // lewa trzecia nie koliduje ze środkową
  });
  it('firstFree znajduje pierwsze wolne miejsce od dołu; null gdy rack pełny', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_s', M(1)));
    expect(firstFree(s.state, 'eqi_a', 'rck_r1')).toEqual(M(3));
    s.dispatch('u', rackCmd.updateRack('rck_r1', { units: 3 }));
    s.dispatch('m', rackCmd.mount('eqi_a', M(3)));
    expect(firstFree(s.state, 'eqi_b', 'rck_r1')).toEqual(M(1, 'full', 'rear')); // przód pełny, wolny tył
  });
});

describe('rack jako obiekt', () => {
  it('nazwy unikalne, zakres U, zmniejszenie racka poniżej zajętego jest odrzucane, usunięcie zdejmuje urządzenia', () => {
    const s = setup();
    expect(() => s.dispatch('r', rackCmd.addRack(newRackId(), { name: 'Rack FOH', units: 4 }))).toThrow(/już istnieje/);
    expect(() => s.dispatch('r', rackCmd.addRack(newRackId(), { name: 'Z', units: 0 }))).toThrow(); expect(() => s.dispatch('r', rackCmd.addRack(newRackId(), { name: 'Z', units: 61 }))).toThrow();
    s.dispatch('m', rackCmd.mount('eqi_a', M(10)));
    expect(() => s.dispatch('r', rackCmd.updateRack('rck_r1', { units: 9 }))).toThrow(/mniej niż 10/);
    s.dispatch('r', rackCmd.updateRack('rck_r1', { name: 'Rack scena', units: 20 }));
    expect(s.state.racks!.rck_r1).toMatchObject({ name: 'Rack scena', units: 20 });
    s.dispatch('d', rackCmd.removeRack('rck_r1')); expect(s.state.equipment.eqi_a.mount).toBeUndefined(); expect(s.state.racks!.rck_r1).toBeUndefined();
    expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); expect(s.state.equipment.eqi_a.mount).toEqual(M(10));
  });
  it('usunięcie urządzenia z racka nie zostawia śladów; V-003 po obniżeniu wysokości racka w wyniku zmiany definicji', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_a', M(1))); s.dispatch('x', cmd.removeInstance('eqi_a'));
    expect(rackContents(s.state, 'rck_r1')).toEqual([]); expect(checkInvariants(s.state)).toEqual([]);
  });
});

describe('walidacja V-003 / V-027', () => {
  it('nakładanie wymuszone poza poleceniami (np. po ręcznej edycji pliku) jest błędem V-003; głębokość ostrzeżeniem V-027', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_a', M(1))); s.dispatch('m', rackCmd.mount('eqi_b', M(2)));
    expect(validate(s.state).filter((i) => i.ruleId === 'V-003')).toEqual([]);
    const p = JSON.parse(JSON.stringify(s.state)); p.equipment.eqi_b.mount.uStart = 1; // zepsuty plik
    const v = validate(p).filter((i) => i.ruleId === 'V-003'); expect(v.length).toBe(1); expect(v[0].level).toBe('error'); expect(v[0].message).toMatch(/nakłada/);
    p.equipment.eqi_b.mount.uStart = 12; p.equipment.eqi_s.mount = M(12); // wystaje poza rack
    s.dispatch('g', rackCmd.mount('eqi_g', M(6)));
    const w = validate(JSON.parse(JSON.stringify(s.state))).filter((i) => i.ruleId === 'V-027'); expect(w.length).toBe(1); expect(w[0].level).toBe('warning');
    p.equipment.eqi_s.mount = { rackId: 'rck_nie_ma', uStart: 1, face: 'front', slot: 'full' };
    expect(checkInvariants(p).join()).toContain('nieistniejącym racku');
  });
});

describe('sumy i raport', () => {
  it('masa, pobór (typowy i maksymalny), wolne U, brak danych liczony osobno; raport od góry racka', () => {
    const s = setup();
    s.dispatch('m', rackCmd.mount('eqi_a', M(1))); s.dispatch('m', rackCmd.mount('eqi_s', M(2))); s.dispatch('m', rackCmd.mount('eqi_t', M(4, 'left')));
    s.dispatch('m', rackCmd.mount('eqi_h1', M(5, 'left'))); s.dispatch('m', rackCmd.mount('eqi_b', M(6, 'full', 'rear')));
    const t = rackTotals(s.state, 'rck_r1');
    expect(t).toMatchObject({ devices: 5, usedU: 6, freeU: 6, weightKg: 4 + 12 + 1 + 4, weightUnknown: 1, powerW: 30 + 200 + 10 + 30, powerMaxW: 60 + 200 + 10 + 60, powerUnknown: 1 });
    const rows = rackReport(s.state); expect(rows.length).toBe(5);
    expect(rows.filter((r) => r.face === 'przód').map((r) => r.uStart)).toEqual([5, 4, 2, 1]); // od góry
    expect(rows.find((r) => r.name === 'eqi_s')).toMatchObject({ uStart: 2, uEnd: 3, device: 'Fikcyjny Serwer 2U', rack: 'Rack FOH' });
  });
});
