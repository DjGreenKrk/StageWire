import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd, cabinetContents, cabinetTotals, cabinetWiring, firstFreeDin, dinProblem } from '../src/cabinets.ts';
import { rackCmd } from '../src/racks.ts';
import { cmd } from '../src/commands.ts';
import { validate } from '../src/validation.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const term = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const dev = (key: string, model: string, dinModules: number | undefined, ports: any[], extra: any = {}) => ({ key, manufacturer: 'Fikcyjny', model, category: 'zasilanie', dimensionsMm: { width: 17.5 * (dinModules ?? 4), depth: 60, height: 90 }, ...(dinModules ? { dinModules } : {}), weightKg: 0.2, powerW: 3, ports, source: { kind: 'custom' }, ...extra });
beforeAll(() => {
  const r = installPack({ format: 'stagewire-pack/1', id: 'cab-test', name: 'T', version: '1.0.0', license: 'własne', devices: [
    dev('mcb', 'Bezpiecznik 1P', 1, [term('in', 'Wejście', 'std/power-ac', 'in'), term('out', 'Wyjście', 'std/power-ac', 'out')]),
    dev('psu', 'Zasilacz 24 V', 2, [term('in', 'L/N', 'std/power-ac', 'in'), term('out', '+24 V', 'std/power-dc', 'out')]),
    dev('led', 'Sterownik LED', 4, [term('in', '+24 V', 'std/power-dc', 'in'), term('dmx', 'DMX', 'std/dmx', 'in')]),
    dev('nodin', 'Bez DIN', undefined, [term('in', 'In', 'std/power-ac', 'in')]),
  ] });
  expect(r.errors).toEqual([]);
});
afterAll(() => unloadPack('cab-test'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p);
  s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Szafa A', widthMm: 300, heightMm: 350, depthMm: 120, rows: 2, modules: 12 }));
  for (const [k, id] of [['mcb', 'eqi_f1'], ['mcb', 'eqi_f2'], ['psu', 'eqi_p1'], ['psu', 'eqi_p2'], ['led', 'eqi_l1'], ['nodin', 'eqi_x']] as const) s.dispatch('a', addFromCatalog('cab-test/' + k, id, id));
  return s;
};
const at = (id: string, row: number, a: number) => cabCmd.mount(id, { cabinetId: 'cab_a', row, at: a });

describe('szafa DIN: model', () => {
  it('walidacja szafy: nazwa unikalna, zakresy, zmniejszenie poniżej zajętego odrzucone', () => {
    const s = mk();
    expect(() => s.dispatch('x', cabCmd.addCabinet('cab_b', { name: 'szafa a ', widthMm: 300, heightMm: 300, rows: 1, modules: 12 }))).not.toThrow(); // inna wielkość liter = inna nazwa
    expect(() => s.dispatch('x', cabCmd.addCabinet('cab_c', { name: 'Szafa A', widthMm: 300, heightMm: 300, rows: 1, modules: 12 }))).toThrow(/już istnieje/);
    expect(() => s.dispatch('x', cabCmd.addCabinet('cab_d', { name: 'Z', widthMm: 300, heightMm: 300, rows: 0, modules: 12 }))).toThrow();
    s.dispatch('m', at('eqi_l1', 2, 9));
    expect(() => s.dispatch('x', cabCmd.updateCabinet('cab_a', { modules: 10 }))).toThrow(/mniej niż 12/);
    expect(() => s.dispatch('x', cabCmd.updateCabinet('cab_a', { rows: 1 }))).toThrow(/mniej niż 2/);
  });
  it('montaż: kolizje w rzędzie, wyjście poza szynę, urządzenie bez modułów, drugi rząd jest wolny', () => {
    const s = mk();
    s.dispatch('m', at('eqi_p1', 1, 1));
    expect(() => s.dispatch('x', at('eqi_f1', 1, 2))).toThrow(/zajęte przez/);
    expect(() => s.dispatch('x', at('eqi_l1', 1, 10))).toThrow(/nie mieści/);
    expect(() => s.dispatch('x', at('eqi_x', 1, 5))).toThrow(/nie ma szerokości/);
    expect(() => s.dispatch('x', at('eqi_f1', 3, 1))).toThrow(/Rząd/);
    s.dispatch('m', at('eqi_f1', 2, 2)); expect(cabinetContents(s.state, 'cab_a').map((o) => o.id)).toEqual(['eqi_p1', 'eqi_f1']);
    expect(firstFreeDin(s.state, 'eqi_l1', 'cab_a')).toEqual({ cabinetId: 'cab_a', row: 1, at: 3 });
    expect(dinProblem(s.state, 'eqi_f2', { cabinetId: 'cab_a', row: 2, at: 2 })).toMatch(/zajęte/);
  });
  it('rack i szyna wykluczają się; sumy modułów, masy i mocy', () => {
    const s = mk(); s.dispatch('m', at('eqi_p1', 1, 1)); s.dispatch('m', at('eqi_l1', 1, 3));
    expect(cabinetTotals(s.state, 'cab_a')).toMatchObject({ usedModules: 6, freeModules: 18, devices: 2, weightKg: 0.4, powerW: 6 });
    s.dispatch('r', rackCmd.addRack('rck_a', { name: 'R', units: 4 }));
    expect(() => s.dispatch('x', rackCmd.mount('eqi_p1', { rackId: 'rck_a', uStart: 1, face: 'front', slot: 'full' }))).toThrow(/nie jest rackowe|nie ma wysokości/); // brak rackUnits
  });
});

describe('szafa DIN: opinanie i terminale', () => {
  it('okablowanie: bezpiecznik → zasilacz → sterownik, kabel „przewód w szafie”; wewnętrzne vs wychodzące', () => {
    const s = mk(); for (const [id, row, a] of [['eqi_f1', 1, 1], ['eqi_p1', 1, 2], ['eqi_l1', 1, 5]] as const) s.dispatch('m', at(id, row, a));
    const port = (id: string, key: string) => { const rev = s.state.definitions[s.state.equipment[id].definitionId].revisions['1']; return Object.entries(rev.ports).find(([, p]: any) => p.label === key)![0]; };
    s.dispatch('c1', cmd.connect({ instanceId: 'eqi_f1', portId: port('eqi_f1', 'Wyjście') }, { instanceId: 'eqi_p1', portId: port('eqi_p1', 'L/N') }, 'std/power-ac'));
    s.dispatch('c2', cmd.connect({ instanceId: 'eqi_p1', portId: port('eqi_p1', '+24 V') }, { instanceId: 'eqi_l1', portId: port('eqi_l1', '+24 V') }, 'std/power-dc'));
    expect(Object.values(s.state.cables).map((c) => c.cableTypeKey)).toEqual(['std/cable-wire', 'std/cable-wire']);
    s.dispatch('c3', cmd.connect({ instanceId: 'eqi_f2', portId: port('eqi_f2', 'Wyjście') }, { instanceId: 'eqi_f1', portId: port('eqi_f1', 'Wejście') }, 'std/power-ac'));
    const w = cabinetWiring(s.state, 'cab_a'); expect(w.internal.length).toBe(2); expect(w.external.length).toBe(1);
    expect(validate(s.state).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('terminale: tylko porty osprzętu z tej szafy; zdjęcie lub usunięcie osprzętu zdejmuje oznaczenie; cofanie działa', () => {
    const s = mk(); s.dispatch('m', at('eqi_f1', 1, 1));
    const pin = Object.keys(s.state.definitions[s.state.equipment.eqi_f1.definitionId].revisions['1'].ports)[0];
    expect(() => s.dispatch('x', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_f2', portId: pin }, true))).toThrow(/zamontowanego/);
    s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_f1', portId: pin }, true)); s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_f1', portId: pin }, true));
    expect(s.state.cabinets!.cab_a.terminals).toHaveLength(1);
    s.dispatch('u', cabCmd.unmount('eqi_f1')); expect(s.state.cabinets!.cab_a.terminals).toBeUndefined();
    s.undo(); expect(s.state.cabinets!.cab_a.terminals).toHaveLength(1);
    s.dispatch('rm', cmd.removeInstance('eqi_f1')); expect(s.state.cabinets!.cab_a.terminals).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
  });
  it('walidacja V-028 po ręcznej edycji (nakładanie) i zgodność ze schematem; usunięcie szafy zdejmuje osprzęt', () => {
    const s = mk(); s.dispatch('m', at('eqi_p1', 1, 1)); s.dispatch('m', at('eqi_p2', 1, 4));
    s.dispatch('hack', (d) => { d.equipment.eqi_p2.din = { cabinetId: 'cab_a', row: 1, at: 2 }; });
    expect(validate(s.state).some((i) => i.ruleId === 'V-028' && i.level === 'error')).toBe(true);
    expect(schemaErrors(s.state)).toEqual([]);
    s.dispatch('rm', cabCmd.removeCabinet('cab_a')); expect(s.state.equipment.eqi_p1.din).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
  });
});
