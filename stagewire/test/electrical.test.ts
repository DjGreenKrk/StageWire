import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog, planInstall } from '../src/catalog/index.ts';
import { cabCmd, cabinetTotals } from '../src/cabinets.ts';
import { cmd } from '../src/commands.ts';
import { validate } from '../src/validation.ts';
import { checkInvariants } from '../src/invariants.ts';
import { electricalNets } from '../src/nets.ts';
import { busbarContacts } from '../src/busbar.ts';
import { schemaErrors, openProject, packProject } from '../src/format.ts';
import { validatePack, deviceToRevision, revisionToDevice, portIdOf } from '../src/pack.ts';
import { syntheticProject } from '../src/synthetic.ts';
import type { Project } from '../src/types.ts';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../src/format.ts';

const AC = 'std/power-ac', TERM = 'std/din-terminal', SLOT = 'std/din-comb-slot';
const port = (key: string, label: string, dir: string, extra: any = {}) => ({ key, label, connector: TERM, signals: [AC], direction: dir, ...extra });
const base = { manufacturer: 'Fikcyjny', category: 'zasilanie', source: { kind: 'custom' } };
const dev = (key: string, model: string, mods: number, ports: any[], extra: any = {}) => ({ ...base, key, model, dinModules: mods, dimensionsMm: { width: 17.5 * mods, depth: 60, height: 90 }, ports, ...extra });
const teeth = (n: number, tracks: string[], fits = ['pitch1']) => Array.from({ length: n }, (_, i) => port(`t${i + 1}`, tracks[i % tracks.length], 'io', { connector: SLOT, terminal: { track: tracks[i % tracks.length], at: i, side: 'top', kind: 'comb-slot', fits } }));
const bar = (n: number, track: string, cap = 2) => Array.from({ length: n }, (_, i) => port(`p${i + 1}`, `${track}${i + 1}`, 'io', { capacity: cap, terminal: { track, at: Math.floor(i / 3), side: 'top', kind: 'screw' } }));
const members = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

const PACK = { format: 'stagewire-pack/1', id: 'el-test', name: 'Elektryka', version: '1.0.0', license: 'własne', devices: [
  dev('mcb', 'Wyłącznik 1P', 1, [
    port('in', 'IN', 'in', { terminal: { at: 0, side: 'top', kind: 'screw' } }),
    port('incomb', 'IN (grzebień)', 'in', { connector: SLOT, terminal: { at: 0, side: 'top', kind: 'comb-slot', fits: ['pitch1'] } }),
    port('out', 'OUT', 'out', { terminal: { at: 0, side: 'bottom', kind: 'screw' } }),
  ], { internalLinks: [{ kind: 'bridge', members: ['in', 'incomb'] }, { kind: 'switched', a: 'in', b: 'out', contact: 'Q' }] }),
  dev('comb', 'Grzebień 3P, 6 mod.', 6, teeth(6, ['L1', 'L2', 'L3']), { placementLayer: 'busbar', phaseOrder: ['L1', 'L2', 'L3'], internalLinks: [{ kind: 'bridge', members: ['t1', 't4'] }, { kind: 'bridge', members: ['t2', 't5'] }, { kind: 'bridge', members: ['t3', 't6'] }] }),
  dev('comb2', 'Grzebień 3P, rozstaw 2', 6, teeth(6, ['L1', 'L2', 'L3'], ['pitch2']), { placementLayer: 'busbar', internalLinks: [{ kind: 'bridge', members: ['t1', 't4'] }, { kind: 'bridge', members: ['t2', 't5'] }, { kind: 'bridge', members: ['t3', 't6'] }] }),
  dev('barn', 'Listwa N, 10 zacisków', 4, bar(10, 'N'), { internalLinks: [{ kind: 'bridge', members: members(10) }] }),
  dev('barpe', 'Listwa PE, 6 zacisków', 3, bar(6, 'PE'), { internalLinks: [{ kind: 'bridge', members: members(6) }] }),
  dev('block', 'Blok rozdzielczy 3F', 6, [...['L1', 'L2', 'L3', 'N'].flatMap((t) => [port(`${t.toLowerCase()}in`, `${t} IN`, 'in', { terminal: { track: t } }), port(`${t.toLowerCase()}o1`, `${t} OUT1`, 'out', { terminal: { track: t } }), port(`${t.toLowerCase()}o2`, `${t} OUT2`, 'out', { terminal: { track: t } })])],
    { internalLinks: ['l1', 'l2', 'l3', 'n'].map((t) => ({ kind: 'bridge', members: [`${t}in`, `${t}o1`, `${t}o2`] })) }),
  dev('tb', 'Złączka z mostkiem', 1, [port('a', 'A', 'io'), port('b', 'B', 'io'), port('c', 'C (mostek)', 'io')], { internalLinks: [{ kind: 'bridge', a: 'a', b: 'b' }, { kind: 'jumper', a: 'b', b: 'c' }] }),
  dev('cont', 'Stycznik', 2, [port('in', 'IN', 'in'), port('out', 'OUT', 'out')], { internalLinks: [{ kind: 'switched', a: 'in', b: 'out', contact: 'K1' }] }),
  dev('src', 'Źródło 3F', 4, [port('l1', 'L1', 'out', { terminal: { track: 'L1' } }), port('l2', 'L2', 'out', { terminal: { track: 'L2' } }), port('l3', 'L3', 'out', { terminal: { track: 'L3' } }), port('n', 'N', 'out', { terminal: { track: 'N' } }), port('pe', 'PE', 'out', { terminal: { track: 'PE' } })]),
  dev('load', 'Odbiornik', 2, [port('l', 'L', 'in'), port('n', 'N', 'in')]),
] };
beforeAll(() => { const r = installPack(PACK); expect(r.errors).toEqual([]); });
afterAll(() => unloadPack('el-test'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p); s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Szafa', widthMm: 400, heightMm: 500, depthMm: 150, rows: 3, modules: 18 }));
  return s;
};
const I = (id: string) => (id.startsWith('eqi_') ? id : 'eqi_' + id);
const add = (s: Store, key: string, id: string) => s.dispatch('a', addFromCatalog('el-test/' + key, I(id), I(id)));
const at = (s: Store, id: string, row: number, a: number) => s.dispatch('m', cabCmd.mount(I(id), { cabinetId: 'cab_a', row, at: a }));
const P = (_s: Store, id: string, key: string) => ({ instanceId: I(id), portId: portIdOf(key) });
let seq = 0;
const wire = (s: Store, a: [string, string], b: [string, string]) => s.dispatch('w', cmd.connect(P(s, ...a), P(s, ...b), AC, { id: `cnx_${++seq}` }));
const net = (s: Store, id: string, key: string) => electricalNets(s.state).netOf(P(s, id, key));
const codes = (p: Project) => validate(p).map((i) => i.ruleId);

describe('E1: format pakietu i projektu', () => {
  it('pakiet z terminal, internalLinks, placementLayer i phaseOrder przechodzi walidację', () => { expect(validatePack(PACK, { [TERM]: { kind: 'connector', name: 'x' }, [SLOT]: { kind: 'connector', name: 'x' }, [AC]: { kind: 'signal', name: 'x' } }).errors).toEqual([]); });
  it('zły terminal, zła grupa mostków i nieistniejący port są błędami', () => {
    const bad: any = JSON.parse(JSON.stringify(PACK)); const d = bad.devices[1];
    d.ports[0].terminal = { at: -1, side: 'left', kind: 'x', wires: { minMm2: 5, maxMm2: 1 } };
    d.internalLinks = [{ kind: 'bridge', members: ['t1'] }, { kind: 'bridge', a: 't1', b: 'nie-ma' }, { kind: 'zły' }, { kind: 'switched', members: ['t1', 't2'] }];
    const e = validatePack(bad, { [TERM]: { kind: 'connector', name: 'x' }, [SLOT]: { kind: 'connector', name: 'x' }, [AC]: { kind: 'signal', name: 'x' } }).errors.join('\n');
    for (const f of ['terminal.at', 'terminal.side', 'terminal.kind', 'minMm2 większe', 'co najmniej dwa porty', 'nie ma portu „nie-ma”', 'internalLinks[2].kind', 'switched']) expect(e, f).toContain(f);
  });
  it('pakiet samych obudów jest poprawny; obudowa z błędnymi wymiarami nie', () => {
    const ok = { format: 'stagewire-pack/1', id: 'obudowy', name: 'O', version: '1.0.0', license: 'własne', devices: [], enclosures: [{ key: 've212', manufacturer: 'F', model: 'M', widthMm: 300, heightMm: 400, depthMm: 120, rows: 2, modules: 12, ip: 'IP65', mounting: 'surface', source: { kind: 'custom' } }] };
    expect(validatePack(ok).errors).toEqual([]);
    const bad = JSON.parse(JSON.stringify(ok)); bad.enclosures[0].rows = 0; bad.enclosures[0].widthMm = 1;
    expect(validatePack(bad).errors.join('\n')).toMatch(/rows.*widthMm|widthMm.*rows/s);
  });
  it('urządzenie → rewizja → urządzenie zachowuje terminal, połączenia, warstwę i kolejność faz', () => {
    const d = PACK.devices[1] as any, rev = deviceToRevision({ ...PACK, devices: [d] } as any, d);
    expect(rev.placementLayer).toBe('busbar'); expect(rev.ports[portIdOf('t2')].terminal).toEqual(d.ports[1].terminal); expect(rev.internalLinks![1]).toEqual({ kind: 'bridge', members: [portIdOf('t2'), portIdOf('t5')] });
    const back = revisionToDevice(rev, 'comb'); expect(back.internalLinks).toEqual(d.internalLinks); expect(back.placementLayer).toBe('busbar'); expect(back.phaseOrder).toEqual(['L1', 'L2', 'L3']); expect(back.ports[1].terminal).toEqual(d.ports[1].terminal);
  });
  it('projekt z nowymi polami jest zgodny ze schematem i przeżywa zapis', () => {
    const s = mk(); add(s, 'mcb', '1'); add(s, 'comb', 'c'); at(s, '1', 1, 1); at(s, 'c', 1, 1);
    expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]); expect(checkInvariants(s.state)).toEqual([]);
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok');
    if (back.status === 'ok') { expect((back.project.equipment.eqi_c.din as any).layer).toBe('busbar'); expect(Object.values(back.project.definitions).some((d) => d.revisions['1'].internalLinks)).toBe(true); }
  });
  it('usunięcie portu z definicji porządkuje połączenia wewnętrzne (bez wiszących odwołań)', async () => {
    const { saveDefinition } = await import('../src/definitions.ts');
    const s = mk(); add(s, 'barn', 'n'); const defId = s.state.equipment.eqi_n.definitionId, rev = s.state.definitions[defId].revisions['1'];
    const drafts = Object.entries(rev.ports).filter(([k]) => k !== portIdOf('p10')).map(([id, q]) => ({ id, ...(q as any) }));
    s.dispatch('d', saveDefinition(defId, { ports: drafts as any }, 'all'));
    const r2 = s.state.definitions[defId].revisions[String(s.state.definitions[defId].latestRevision)];
    expect(r2.internalLinks![0].members).toHaveLength(9); expect(r2.internalLinks![0].members).not.toContain(portIdOf('p10'));
  });
});

describe('E2–E4: węzły, grzebienie, walidacja', () => {
  it('1. trzy wyłączniki 1P pod grzebieniem 3P: trzy rozłączne węzły L1, L2, L3', () => {
    const s = mk(); for (const [k, id] of [['mcb', 'm1'], ['mcb', 'm2'], ['mcb', 'm3'], ['comb', 'cb']] as const) add(s, k, id);
    at(s, 'm1', 1, 1); at(s, 'm2', 1, 2); at(s, 'm3', 1, 3); at(s, 'cb', 1, 1);
    const n1 = net(s, 'm1', 'in')!, n2 = net(s, 'm2', 'in')!, n3 = net(s, 'm3', 'in')!;
    expect([n1.tracks, n2.tracks, n3.tracks]).toEqual([['L1'], ['L2'], ['L3']]); expect(new Set([n1.id, n2.id, n3.id]).size).toBe(3);
    expect(codes(s.state).filter((c) => /^V-04|V-05[01]/.test(c)).sort()).toEqual(['V-050', 'V-050', 'V-050']); // trzy zęby bez aparatu pod spodem (informacja)
  });
  it('2. sześć wyłączników: powtarzana sekwencja, aparaty 1 i 4 w jednym węźle L1; brak uwag', () => {
    const s = mk(); add(s, 'comb', 'cb'); for (let i = 1; i <= 6; i++) { add(s, 'mcb', 'm' + i); at(s, 'm' + i, 1, i); } at(s, 'cb', 1, 1);
    expect(net(s, 'm1', 'in')!.id).toBe(net(s, 'm4', 'in')!.id); expect(net(s, 'm2', 'in')!.id).toBe(net(s, 'm5', 'in')!.id); expect(net(s, 'm1', 'in')!.id).not.toBe(net(s, 'm2', 'in')!.id);
    expect(codes(s.state).filter((c) => /^V-04|V-05[01]/.test(c))).toEqual([]);
  });
  it('3. listwa N: jeden węzeł; pojemność zacisku pilnuje V-002', () => {
    const s = mk(); add(s, 'barn', 'bn'); add(s, 'src', 's1'); add(s, 'load', 'ld1'); add(s, 'load', 'ld2'); add(s, 'load', 'ld3');
    wire(s, ['ld1', 'n'], ['bn', 'p1']); wire(s, ['ld2', 'n'], ['bn', 'p2']);
    expect(net(s, 'ld1', 'n')!.id).toBe(net(s, 'ld2', 'n')!.id); expect(net(s, 'bn', 'p10')!.ports.length).toBeGreaterThanOrEqual(10);
    expect(codes(s.state)).not.toContain('V-002'); wire(s, ['ld3', 'n'], ['bn', 'p1']); wire(s, ['s1', 'n'], ['bn', 'p1']);
    expect(codes(s.state)).toContain('V-002');
  });
  it('4. dwie listwy N dla dwóch grup RCD: niezależne węzły', () => {
    const s = mk(); add(s, 'barn', 'bn1'); add(s, 'barn', 'bn2'); add(s, 'load', 'a'); add(s, 'load', 'b'); wire(s, ['a', 'n'], ['bn1', 'p1']); wire(s, ['b', 'n'], ['bn2', 'p1']);
    expect(net(s, 'bn1', 'p5')!.id).not.toBe(net(s, 'bn2', 'p5')!.id); expect(codes(s.state).filter((c) => /^V-04/.test(c))).toEqual([]);
  });
  it('5. PE połączone z N: V-041 (błąd)', () => {
    const s = mk(); add(s, 'barn', 'bn'); add(s, 'barpe', 'bp'); wire(s, ['bn', 'p1'], ['bp', 'p1']);
    const v = validate(s.state).filter((i) => i.ruleId === 'V-041'); expect(v).toHaveLength(1); expect(v[0].level).toBe('error');
  });
  it('6. blok rozdzielczy 3F: cztery niezależne węzły; L1 na wejście L2 = V-040', () => {
    const s = mk(); add(s, 'block', 'bl'); add(s, 'src', 'sr');
    expect(new Set(['l1in', 'l2in', 'l3in', 'nin'].map((k) => net(s, 'bl', k)?.id ?? k)).size).toBe(4);
    wire(s, ['sr', 'l1'], ['bl', 'l1in']); expect(codes(s.state)).not.toContain('V-040');
    wire(s, ['sr', 'l1'], ['bl', 'l2in']); const v = validate(s.state).filter((i) => i.ruleId === 'V-040'); expect(v).toHaveLength(1); expect(v[0].message).toMatch(/L1 i L2/);
  });
  it('7. złączka: stały mostek scala; mostek konfigurowalny dopiero po włączeniu', () => {
    const s = mk(); add(s, 'tb', 't'); add(s, 'load', 'x'); add(s, 'load', 'y'); wire(s, ['x', 'l'], ['t', 'a']); wire(s, ['y', 'l'], ['t', 'c']);
    expect(net(s, 't', 'a')!.id).toBe(net(s, 't', 'b')!.id); expect(net(s, 't', 'c')!.id).not.toBe(net(s, 't', 'a')!.id);
    s.dispatch('j', (d) => { d.equipment.eqi_t.jumpers = [1]; }); expect(net(s, 't', 'c')!.id).toBe(net(s, 't', 'a')!.id);
  });
  it('8. grzebień o innym rozstawie: brak styku i ostrzeżenie V-046', () => {
    const s = mk(); add(s, 'comb2', 'cb'); add(s, 'mcb', 'm1'); at(s, 'm1', 1, 1); at(s, 'cb', 1, 1);
    expect(busbarContacts(s.state).contacts).toHaveLength(0); expect(codes(s.state)).toContain('V-046'); expect(net(s, 'm1', 'in')?.tracks ?? []).toEqual([]);
  });
  it('9. przesunięcie aparatu zmienia styki i walidację; cofnięcie przywraca', () => {
    const s = mk(); add(s, 'comb', 'cb'); add(s, 'mcb', 'm1'); at(s, 'm1', 1, 1); at(s, 'cb', 1, 1);
    expect(net(s, 'm1', 'in')!.tracks).toEqual(['L1']);
    s.dispatch('mv', cabCmd.mount('eqi_m1', { cabinetId: 'cab_a', row: 2, at: 1 })); expect(net(s, 'm1', 'in')?.tracks ?? []).toEqual([]);
    s.undo(); expect(net(s, 'm1', 'in')!.tracks).toEqual(['L1']);
  });
  it('10. dwa sposoby podłączenia do tego samego toru: jeden węzeł, bez błędów', () => {
    const s = mk(); add(s, 'comb', 'cb'); add(s, 'mcb', 'm1'); add(s, 'src', 'sr'); at(s, 'm1', 1, 1); at(s, 'cb', 1, 1);
    wire(s, ['sr', 'l1'], ['m1', 'in']); expect(net(s, 'sr', 'l1')!.id).toBe(net(s, 'm1', 'incomb')!.id);
    expect(validate(s.state).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('11. stycznik: styk zależny od stanu nie scala węzłów', () => {
    const s = mk(); add(s, 'cont', 'k'); add(s, 'src', 'sr'); add(s, 'load', 'ld'); wire(s, ['sr', 'l1'], ['k', 'in']); wire(s, ['k', 'out'], ['ld', 'l']);
    expect(net(s, 'k', 'in')!.id).not.toBe(net(s, 'k', 'out')!.id);
    const mcbNet = (() => { const t = mk(); add(t, 'mcb', 'm'); add(t, 'src', 'sr'); add(t, 'load', 'ld'); wire(t, ['sr', 'l1'], ['m', 'in']); wire(t, ['m', 'out'], ['ld', 'l']); return electricalNets(t.state).netOf(P(t, 'm', 'in'))!.id !== electricalNets(t.state).netOf(P(t, 'm', 'out'))!.id; })();
    expect(mcbNet).toBe(true);
  });
  it('12. starszy projekt bez nowych mechanizmów: brak węzłów i brak nowych uwag, identyczny zapis', () => {
    for (const f of ['conference-mini', 'dmx-mini', 'lengths', 'revisions-two', 'medium-variants']) {
      const json = JSON.parse(readFileSync(`fixtures/${f}.json`, 'utf8')), body = canonicalStringify(json);
      const r = openProject(zipSync({ 'manifest.json': strToU8(canonicalStringify({ formatVersion: json.formatVersion, appVersion: 't', sha256: createHash('sha256').update(body).digest('hex') })), 'project.json': strToU8(body) }));
      expect(r.status, f).toBe('ok'); if (r.status !== 'ok') continue;
      expect(codes(r.project).filter((c) => /^V-04[0-9]|^V-05[0-2]/.test(c)), f).toEqual([]);
      expect(electricalNets(r.project).nets.every((n) => n.tracks.length === 0), f).toBe(true);
    }
  });
  it('grzebień nad aparatami nie koliduje na szynie i nie zajmuje modułów szafy', () => {
    const s = mk(); add(s, 'comb', 'cb'); add(s, 'mcb', 'm1'); add(s, 'mcb', 'm2'); at(s, 'm1', 1, 1); at(s, 'cb', 1, 1);
    expect(cabinetTotals(s.state, 'cab_a').usedModules).toBe(1); expect(() => at(s, 'm2', 1, 1)).toThrow(/zajęte/);
    add(s, 'comb', 'cb2'); expect(() => at(s, 'cb2', 1, 3)).toThrow(/zajęte/); // dwa grzebienie na tych samych modułach już tak
    expect(validate(s.state).filter((i) => i.ruleId === 'V-028')).toEqual([]);
  });
});

describe('E5: płyta montażowa i obudowy', () => {
  it('element bez DIN można zamontować na płycie; wyklucza się z szyną; wychodzenie poza płytę to V-052', () => {
    const s = mk(); add(s, 'src', 'sr'); s.dispatch('p', cabCmd.mountPlate('eqi_sr', { cabinetId: 'cab_a', x: 10, y: 20 }));
    expect(s.state.equipment.eqi_sr.plate).toEqual({ cabinetId: 'cab_a', x: 10, y: 20 }); expect(checkInvariants(s.state)).toEqual([]);
    at(s, 'sr', 1, 1); expect(s.state.equipment.eqi_sr.plate).toBeUndefined(); expect(s.state.equipment.eqi_sr.din).toBeDefined();
    s.dispatch('p', cabCmd.mountPlate('eqi_sr', { cabinetId: 'cab_a', x: 380, y: 480 })); expect(s.state.equipment.eqi_sr.din).toBeUndefined(); expect(codes(s.state)).toContain('V-052');
    expect(() => s.dispatch('p', cabCmd.mountPlate('eqi_sr', { cabinetId: 'nie-ma', x: 0, y: 0 }))).toThrow(/Brak szafy/);
    s.dispatch('u', cabCmd.unmount('eqi_sr')); expect(s.state.equipment.eqi_sr.plate).toBeUndefined();
  });
  it('usunięcie szafy zdejmuje elementy z płyty', () => {
    const s = mk(); add(s, 'src', 'sr'); s.dispatch('p', cabCmd.mountPlate('eqi_sr', { cabinetId: 'cab_a', x: 0, y: 0 })); s.dispatch('x', cabCmd.removeCabinet('cab_a'));
    expect(s.state.equipment.eqi_sr.plate).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
  });
  it('pakiet obudów instaluje się w katalogu', () => {
    const r = planInstall({ format: 'stagewire-pack/1', id: 'obud-test', name: 'O', version: '1.0.0', license: 'własne', devices: [], enclosures: [{ key: 'e1', manufacturer: 'F', model: 'E1', widthMm: 300, heightMm: 300, rows: 1, modules: 12, source: { kind: 'custom' } }] });
    expect(r.errors).toEqual([]);
  });
});
