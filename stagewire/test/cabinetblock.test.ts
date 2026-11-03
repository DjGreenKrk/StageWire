import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd } from '../src/cabinets.ts';
import { cmd } from '../src/commands.ts';
import { diagramDrawList, portAnchor, portsOf, innerRef, outerRef, gridLayout } from '../src/render/drawlist.ts';
import { syncLayout, setNodePositions } from '../src/layout.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const T = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const dev = (key: string, model: string, mod: number, ports: any[]) => ({ key, manufacturer: 'F', model, category: 'zasilanie', dinModules: mod, ports, source: { kind: 'custom' } });
beforeAll(() => {
  expect(installPack({ format: 'stagewire-pack/1', id: 'cabblk', name: 'T', version: '1.0.0', license: 'własne', devices: [
    dev('psu', 'Zasilacz', 2, [T('in', 'L/N', 'std/power-ac', 'in'), T('out', '+24 V', 'std/power-dc', 'out')]),
    dev('led', 'Sterownik', 4, [T('in', '+24 V', 'std/power-dc', 'in'), T('dmx', 'DMX', 'std/dmx', 'in')]),
    dev('nblk', 'Blok N', 1, [T('n', 'N', 'std/power-ac', 'in')]), dev('pe', 'Szyna PE', 1, [T('pe', 'PE', 'std/power-ac', 'in')]),
    dev('px', 'PX340', 6, [T('a', 'A', 'std/dmx', 'in'), T('b', 'B', 'std/dmx', 'in'), T('g', 'GND', 'std/dmx', 'in')]),
    { key: 'mains', manufacturer: 'F', model: 'Zasilanie sieciowe', category: 'zasilanie', ports: [{ key: 'out', label: 'AC', connector: 'std/din-terminal', signals: ['std/power-ac'], direction: 'out' }], source: { kind: 'custom' } },
  ] }).errors).toEqual([]);
});
afterAll(() => unloadPack('cabblk'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.views = {};
  const s = new Store(p);
  s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Rozdzielnica', widthMm: 400, heightMm: 500, rows: 2, modules: 12 }));
  for (const [k, id] of [['psu', 'eqi_p'], ['led', 'eqi_l'], ['mains', 'eqi_m']] as const) s.dispatch('a', addFromCatalog('cabblk/' + k, id, id));
  s.dispatch('m', cabCmd.mount('eqi_p', { cabinetId: 'cab_a', row: 1, at: 1 })); s.dispatch('m', cabCmd.mount('eqi_l', { cabinetId: 'cab_a', row: 1, at: 4 }));
  const port = (id: string, label: string) => Object.entries(s.state.definitions[s.state.equipment[id].definitionId].revisions['1'].ports).find(([, q]: any) => q.label === label)![0];
  s.dispatch('1', cmd.connect({ instanceId: 'eqi_m', portId: port('eqi_m', 'AC') }, { instanceId: 'eqi_p', portId: port('eqi_p', 'L/N') }, 'std/power-ac'));
  s.dispatch('2', cmd.connect({ instanceId: 'eqi_p', portId: port('eqi_p', '+24 V') }, { instanceId: 'eqi_l', portId: port('eqi_l', '+24 V') }, 'std/power-dc'));
  return { s, port };
};
const view = (s: Store) => { const v = gridLayout(s.state); syncLayout(s.state, v, () => gridLayout(s.state)); return v; };

describe('szafa jako blok na schemacie', () => {
  it('domyślnie schemat bez zmian; po włączeniu bloku osprzęt znika, a blok pokazuje tylko terminale', () => {
    const { s, port } = mk();
    const ids = (blk: boolean) => { const v = view(s); return diagramDrawList(s.state, v).prims.filter((q) => q.t === 'rect').map((q) => q.id).sort(); };
    expect(ids(false)).toEqual(['eqi_l', 'eqi_m', 'eqi_p']);
    s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_p', portId: port('eqi_p', 'L/N') }, true));
    s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_l', portId: port('eqi_l', 'DMX') }, true));
    s.dispatch('b', cabCmd.setBlock('cab_a', true));
    expect(ids(true)).toEqual(['cab_a', 'eqi_m']);
    const { left, right } = portsOf(s.state, 'cab_a'); expect(left.map(([, q]) => q.label)).toEqual(['eqi_p · L/N', 'eqi_l · DMX']); expect(right).toEqual([]);
  });
  it('krawędź z zewnątrz do terminala idzie do bloku; połączenie wewnętrzne i wchodzące w nieoznaczony port nie są rysowane', () => {
    const { s, port } = mk();
    s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_p', portId: port('eqi_p', 'L/N') }, true)); s.dispatch('b', cabCmd.setBlock('cab_a', true));
    const v = view(s), dl = diagramDrawList(s.state, v), lines = dl.prims.filter((q) => q.t === 'line');
    expect(lines).toHaveLength(1); // zasilanie sieciowe → terminal; zasilacz → sterownik jest wewnątrz
    const ref = { instanceId: 'eqi_p', portId: port('eqi_p', 'L/N') };
    expect(outerRef(s.state, ref)).toEqual({ instanceId: 'cab_a', portId: `eqi_p|${ref.portId}` }); expect(innerRef(s.state, outerRef(s.state, ref)!)).toEqual(ref);
    expect(outerRef(s.state, { instanceId: 'eqi_l', portId: port('eqi_l', '+24 V') })).toBeUndefined();
    expect(portAnchor(s.state, v, 'eqi_p', ref.portId)).toBeDefined(); expect(portAnchor(s.state, v, 'eqi_l', port('eqi_l', '+24 V'))).toBeUndefined();
    const [ax] = portAnchor(s.state, v, 'eqi_p', ref.portId)!; expect(ax).toBe(v.nodes.cab_a.x);
  });
  it('pozycja bloku zapisuje się w projekcie, schemat i niezmienniki są poprawne, usunięcie szafy czyści węzeł', () => {
    const { s } = mk(); s.dispatch('b', cabCmd.setBlock('cab_a', true)); const v = view(s); expect(v.nodes.cab_a).toBeDefined();
    s.dispatch('mv', setNodePositions({ cab_a: { x: 640, y: 120 } })); const v2 = view(s); expect(v2.nodes.cab_a).toEqual({ x: 640, y: 120 });
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(s.state)).toEqual([]);
    s.dispatch('rm', cabCmd.removeCabinet('cab_a')); expect(Object.keys(s.state.views!.viw_main.nodes).some((k) => s.state.views!.viw_main.nodes[k].instanceId === 'cab_a')).toBe(false); expect(checkInvariants(s.state)).toEqual([]);
    expect(Object.keys(view(s).nodes)).not.toContain('cab_a');
  });

  it('grupa terminali: 230 V z trzech różnych urządzeń i DMX z trzech zacisków jednego urządzenia to po jednym porcie bloku', () => {
    const { s, port } = mk();
    for (const [k, id, row, at] of [['nblk', 'eqi_n', 2, 1], ['pe', 'eqi_e', 2, 2], ['px', 'eqi_x', 2, 3]] as const) { s.dispatch('a', addFromCatalog('cabblk/' + k, id, id)); s.dispatch('m', cabCmd.mount(id, { cabinetId: 'cab_a', row, at })); }
    const pid = (id: string, l: string) => Object.entries(s.state.definitions[s.state.equipment[id].definitionId].revisions['1'].ports).find(([, q]: any) => q.label === l)![0];
    const T2 = (id: string, l: string, g: string) => s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: id, portId: pid(id, l) }, true, g));
    T2('eqi_p', 'L/N', '230 V'); T2('eqi_n', 'N', '230 V'); T2('eqi_e', 'PE', '230 V'); T2('eqi_x', 'A', 'DMX'); T2('eqi_x', 'B', 'DMX'); T2('eqi_x', 'GND', 'DMX');
    s.dispatch('b', cabCmd.setBlock('cab_a', true));
    const { left } = portsOf(s.state, 'cab_a'); expect(left.map(([k, q]) => [k, q.label])).toEqual([['grp|230 V', '230 V (L/N, N, PE)'], ['grp|DMX', 'DMX (A, B, GND)']]);
    for (const [id, l] of [['eqi_p', 'L/N'], ['eqi_n', 'N'], ['eqi_e', 'PE']] as const) expect(outerRef(s.state, { instanceId: id, portId: pid(id, l) })).toEqual({ instanceId: 'cab_a', portId: 'grp|230 V' });
    expect(innerRef(s.state, { instanceId: 'cab_a', portId: 'grp|DMX' })).toEqual({ instanceId: 'eqi_x', portId: pid('eqi_x', 'A') });
    // trzy przewody od jednego źródła do biegunów grupy to jedna kreska na schemacie
    s.dispatch('c1', cmd.connect({ instanceId: 'eqi_m', portId: port('eqi_m', 'AC') }, { instanceId: 'eqi_p', portId: pid('eqi_p', 'L/N') }, 'std/power-ac'));
    s.dispatch('c2', cmd.connect({ instanceId: 'eqi_m', portId: port('eqi_m', 'AC') }, { instanceId: 'eqi_n', portId: pid('eqi_n', 'N') }, 'std/power-ac'));
    s.dispatch('c3', cmd.connect({ instanceId: 'eqi_m', portId: port('eqi_m', 'AC') }, { instanceId: 'eqi_e', portId: pid('eqi_e', 'PE') }, 'std/power-ac'));
    expect(diagramDrawList(s.state, view(s)).prims.filter((q) => q.t === 'line')).toHaveLength(1);
    // zmiana grupy i zdjęcie grupy; walidacja długości nazwy; schemat i niezmienniki
    s.dispatch('g', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_n', portId: pid('eqi_n', 'N') }, true, null)); expect(s.state.cabinets!.cab_a.terminals!.find((t: any) => t.instanceId === 'eqi_n')!.group).toBeUndefined();
    expect(() => s.dispatch('x', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_n', portId: pid('eqi_n', 'N') }, true, 'x'.repeat(41)))).toThrow(/40 znaków/);
    expect(schemaErrors(s.state)).toEqual([]); expect(checkInvariants(s.state)).toEqual([]);
  });
});
