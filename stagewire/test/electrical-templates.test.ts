import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog, starterRegistries } from '../src/catalog/index.ts';
import { cabCmd } from '../src/cabinets.ts';
import { cmd } from '../src/commands.ts';
import { validate } from '../src/validation.ts';
import { electricalNets } from '../src/nets.ts';
import { portIdOf, validatePack, type PackDevice, type PackSource } from '../src/pack.ts';
import { checkDevice, mergeEnclosureIntoMine, MY_PACK_ID } from '../src/deviceBuild.ts';
import { syntheticProject } from '../src/synthetic.ts';
import { generateBar, generateComb, generateBlock, generateTerminal, generateApparatus, deviceFromGenerated, buildEnclosure, combTracks, type Generated } from '../src/electricalTemplates.ts';

const src: PackSource = { kind: 'custom' };
const mkDev = (key: string, g: Generated): PackDevice => deviceFromGenerated(g, { key, manufacturer: 'Własne', model: key, source: src });
const DEVICES: Record<string, PackDevice> = {
  bar: mkDev('bar', generateBar({ track: 'N', count: 10, capacity: 2 })),
  pe: mkDev('pe', generateBar({ track: 'PE', count: 6, capacity: 1 })),
  comb: mkDev('comb', generateComb({ poles: 3, teeth: 6, fits: 'x1' })),
  combwide: mkDev('combwide', generateComb({ poles: 3, teeth: 3, fits: 'x2' })),
  block: mkDev('block', generateBlock({ tracks: ['L1', 'L2', 'L3', 'N'], outputs: 4 })),
  tb: mkDev('tb', generateTerminal({ levels: 2, track: undefined, jumpers: true })),
  mcb: mkDev('mcb', generateApparatus({ kind: 'mcb', poles: 1, fits: 'x1' })),
  mcb3: mkDev('mcb3', generateApparatus({ kind: 'mcb', poles: 3, fits: 'x1' })),
  rcd: mkDev('rcd', generateApparatus({ kind: 'rcd', poles: 4, modulesPerPole: 1, fits: 'x1' })),
  k: mkDev('k', generateApparatus({ kind: 'contactor', poles: 2, coil: true })),
};
const PACK = { format: 'stagewire-pack/1', id: 'tpl-test', name: 'Szablony', version: '1.0.0', license: 'własne', devices: Object.values(DEVICES) };
beforeAll(() => { expect(installPack(PACK).errors).toEqual([]); });
afterAll(() => unloadPack('tpl-test'));

const I = (id: string) => 'eqi_' + id;
const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; const s = new Store(p); s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'S', widthMm: 400, heightMm: 500, rows: 2, modules: 18 })); return s; };
const add = (s: Store, k: string, id: string) => s.dispatch('a', addFromCatalog('tpl-test/' + k, I(id), I(id)));
const at = (s: Store, id: string, row: number, a: number) => s.dispatch('m', cabCmd.mount(I(id), { cabinetId: 'cab_a', row, at: a }));
const net = (s: Store, id: string, key: string) => electricalNets(s.state).netOf({ instanceId: I(id), portId: portIdOf(key) });

describe('szablony elementów elektrycznych: poprawność definicji', () => {
  it('każdy wygenerowany element przechodzi walidator pakietów bez błędów', () => {
    for (const [k, d] of Object.entries(DEVICES)) expect(checkDevice(d, { ...starterRegistries }).errors, k).toEqual([]);
  });
  it('listwa: jeden węzeł, pojemność i szerokość z liczby zacisków', () => {
    const d = DEVICES.bar; expect(d.ports).toHaveLength(10); expect(d.ports[0].capacity).toBe(2); expect(d.dinModules).toBe(4); expect(d.internalLinks![0].members).toHaveLength(10);
    expect(d.dimensionsMm!.width).toBe(70);
  });
  it('grzebień: tory na przemian, mostki per tor, warstwa busbar, kolejność faz', () => {
    const d = DEVICES.comb; expect(d.placementLayer).toBe('busbar'); expect(d.phaseOrder).toEqual(['L1', 'L2', 'L3']);
    expect(d.ports.map((p) => p.terminal!.track)).toEqual(['L1', 'L2', 'L3', 'L1', 'L2', 'L3']); expect(d.internalLinks).toHaveLength(3); expect(d.ports[5].terminal!.at).toBe(5);
    expect(combTracks(1)).toEqual(['L1']); expect(combTracks(4)).toEqual(['L1', 'L2', 'L3', 'N']);
  });
  it('blok rozdzielczy: osobna grupa mostków na każdy tor', () => { const d = DEVICES.block; expect(d.ports).toHaveLength(20); expect(d.internalLinks).toHaveLength(4); });
  it('aparat: IN, OUT, wejście pod grzebień na biegun; styk zależny od stanu; stycznik z cewką', () => {
    const d = DEVICES.mcb3; expect(d.ports.map((p) => p.key)).toEqual(['in-p1', 'cb-p1', 'out-p1', 'in-p2', 'cb-p2', 'out-p2', 'in-p3', 'cb-p3', 'out-p3']); expect(d.dinModules).toBe(3);
    expect(d.internalLinks!.filter((l) => l.kind === 'switched')).toHaveLength(3); expect(DEVICES.k.ports.some((p) => p.key === 'a1')).toBe(true);
    expect(DEVICES.mcb.ports.find((p) => p.key === 'in-p1')!.label).toBe('IN');
  });
  it('błędne parametry dają czytelny błąd', () => {
    expect(() => generateBar({ track: '', count: 5, capacity: 1 })).toThrow(/Tor/); expect(() => generateBar({ track: 'N', count: 1, capacity: 1 })).toThrow(/Liczba zacisków/);
    expect(() => generateComb({ poles: 3, teeth: 6, fits: '' })).toThrow(/Zgodność/); expect(() => generateBlock({ tracks: ['L1', 'L1'], outputs: 2 })).toThrow(/różne/);
    expect(() => generateApparatus({ kind: 'mcb', poles: 5 })).toThrow(/Bieguny/);
  });
});

describe('szablony elementów elektrycznych: zachowanie w projekcie', () => {
  it('listwa N: wszystkie zaciski w jednym węźle toru N; PE osobno', () => {
    const s = mk(); add(s, 'bar', 'n'); add(s, 'pe', 'p');
    expect(net(s, 'n', 'z1')!.id).toBe(net(s, 'n', 'z10')!.id); expect(net(s, 'n', 'z1')!.tracks).toEqual(['N']); expect(net(s, 'n', 'z1')!.id).not.toBe(net(s, 'p', 'z1')!.id);
  });
  it('trzy aparaty 1P pod grzebieniem 3P dostają tory L1, L2, L3', () => {
    const s = mk(); add(s, 'comb', 'c'); for (const i of [1, 2, 3]) { add(s, 'mcb', 'm' + i); at(s, 'm' + i, 1, i); } at(s, 'c', 1, 1);
    expect([1, 2, 3].map((i) => net(s, 'm' + i, 'in-p1')!.tracks[0])).toEqual(['L1', 'L2', 'L3']); expect(validate(s.state).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('aparat 3P (3 moduły) pod grzebieniem 3P: bieguny na torach L1/L2/L3', () => {
    const s = mk(); add(s, 'comb', 'c'); add(s, 'mcb3', 'm'); at(s, 'm', 1, 1); at(s, 'c', 1, 1);
    expect(['in-p1', 'in-p2', 'in-p3'].map((k) => net(s, 'm', k)!.tracks[0])).toEqual(['L1', 'L2', 'L3']);
  });
  it('grzebień o innym tagu zgodności nie styka się z aparatem i daje ostrzeżenie', () => {
    const s = mk(); add(s, 'combwide', 'c'); add(s, 'mcb', 'm'); at(s, 'm', 1, 1); at(s, 'c', 1, 1);
    expect(net(s, 'm', 'in-p1')?.tracks ?? []).toEqual([]); expect(validate(s.state).map((i) => i.ruleId)).toContain('V-046');
  });
  it('blok rozdzielczy: cztery niezależne tory', () => {
    const s = mk(); add(s, 'block', 'b'); const ids = ['l1', 'l2', 'l3', 'n'].map((t) => net(s, 'b', `${t}-in`)!.id); expect(new Set(ids).size).toBe(4);
  });
  it('złączka dwupoziomowa: poziomy niezależne, mostek konfigurowalny scala po włączeniu', () => {
    const s = mk(); add(s, 'tb', 't');
    expect(net(s, 't', 'l1-a')!.id).toBe(net(s, 't', 'l1-b')!.id); expect(net(s, 't', 'l1-a')!.id).not.toBe(net(s, 't', 'l2-a')!.id);
    s.dispatch('j', (d) => { d.equipment.eqi_t.jumpers = [2]; }); expect(net(s, 't', 'l1-a')!.id).toBe(net(s, 't', 'l2-a')!.id);
  });
  it('stycznik: wejście i wyjście w różnych węzłach (styk zależny od stanu)', () => {
    const s = mk(); add(s, 'k', 'k'); add(s, 'bar', 'n'); const pa = (k: string) => ({ instanceId: I('k'), portId: portIdOf(k) });
    s.dispatch('w', cmd.connect(pa('out-p1'), { instanceId: I('n'), portId: portIdOf('z1') }, 'std/power-ac', { id: 'cnx_1' }));
    expect(net(s, 'k', 'in-p1')).toBeUndefined(); expect(net(s, 'k', 'out-p1')!.id).toBe(net(s, 'n', 'z5')!.id);
  });
});

describe('obudowa', () => {
  const enc = buildEnclosure({ key: 'moja', manufacturer: 'F', model: 'Obudowa 2x12', widthMm: 320, heightMm: 410, depthMm: 120, rows: 2, modules: 12, ip: 'IP65', source: src });
  it('poprawna obudowa tworzy pakiet samych obudów, który przechodzi walidację', () => {
    const { pack, replaced } = mergeEnclosureIntoMine(undefined, enc, {}); expect(replaced).toBe(false); expect(pack.id).toBe(MY_PACK_ID); expect(pack.enclosures).toHaveLength(1);
    expect(validatePack(pack, { ...starterRegistries }).errors).toEqual([]);
  });
  it('ten sam klucz podmienia obudowę, a urządzenia w pakiecie zostają', () => {
    const base = { format: 'stagewire-pack/1', id: MY_PACK_ID, name: 'M', version: '1.0.0', license: 'własne', devices: [DEVICES.bar] } as any;
    const r1 = mergeEnclosureIntoMine(base, enc, { ...starterRegistries }), r2 = mergeEnclosureIntoMine(r1.pack, { ...enc, modules: 18 }, {});
    expect(r2.replaced).toBe(true); expect(r2.pack.enclosures).toHaveLength(1); expect(r2.pack.enclosures![0].modules).toBe(18); expect(r2.pack.devices).toHaveLength(1);
  });
  it('złe wymiary i liczby szyn są odrzucane', () => {
    expect(() => buildEnclosure({ ...enc, rows: 0 })).toThrow(/Szyny/); expect(() => buildEnclosure({ ...enc, modules: 100 })).toThrow(/Moduły/); expect(() => buildEnclosure({ ...enc, widthMm: 10 })).toThrow(/Szerokość/);
  });
});
