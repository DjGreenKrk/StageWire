import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { planPdf } from '../src/planPdf.ts';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd } from '../src/cabinets.ts';
import { rackCmd } from '../src/racks.ts';
import { cmd } from '../src/commands.ts';
import { plan, effectivePosition, cabinetPosition, rackPlacementKey, rackFootprint } from '../src/plan.ts';
import { estimateLengths } from '../src/lengths.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const T = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'cabplan', name: 'T', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'F', model: 'Zasilacz', category: 'zasilanie', dinModules: 3, ports: [T('in', 'L/N', 'std/power-ac', 'in'), T('out', '+24 V', 'std/power-dc', 'out')], source: { kind: 'custom' } },
  { key: 'led', manufacturer: 'F', model: 'Sterownik', category: 'oświetlenie', dinModules: 4, ports: [T('in', '+24 V', 'std/power-dc', 'in')], source: { kind: 'custom' } },
] }).errors).toEqual([]); });
afterAll(() => unloadPack('cabplan'));

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p);
  s.dispatch('s', plan.addSpace('spc_h', 'Hala', 30000, 20000));
  s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Rozdzielnica', widthMm: 400, heightMm: 500, depthMm: 150, rows: 2, modules: 12 }));
  s.dispatch('c', cabCmd.addCabinet('cab_m', { name: 'Moduł 3U', widthMm: 482, heightMm: 133, depthMm: 120, rows: 1, modules: 24, rackUnits: { heightU: 3 } }));
  for (const [k, id] of [['psu', 'eqi_p'], ['led', 'eqi_l'], ['led', 'eqi_far']] as const) s.dispatch('a', addFromCatalog('cabplan/' + k, id, id));
  s.dispatch('m', cabCmd.mount('eqi_p', { cabinetId: 'cab_a', row: 1, at: 1 })); s.dispatch('m', cabCmd.mount('eqi_l', { cabinetId: 'cab_a', row: 2, at: 1 }));
  return s;
};

describe('szafa DIN na planie sali', () => {
  it('placeCabinet: położenie, obrys z wymiarów szafy, odrzucenie brakującej szafy; obrót i zdjęcie', () => {
    const s = mk();
    expect(() => s.dispatch('x', plan.placeRack('cab_zz', 'spc_h', 0, 0))).toThrow(/Brak szafy/);
    s.dispatch('p', plan.placeRack('cab_a', 'spc_h', 5000, 4000, 0, 0));
    expect(s.state.placements![rackPlacementKey('cab_a')]).toMatchObject({ targetKind: 'cabinet', targetId: 'cab_a', position: { x: 5000, y: 4000 } });
    expect(rackFootprint(s.state, 'cab_a')).toEqual({ w: 400, d: 150 });
    s.dispatch('r', plan.rotateRack('cab_a', 90)); expect(s.state.placements![rackPlacementKey('cab_a')].rotationDeg).toBe(90);
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(s.state)).toEqual([]);
    s.dispatch('u', plan.unplaceRack('cab_a')); expect(s.state.placements![rackPlacementKey('cab_a')]).toBeUndefined();
  });
  it('osprzęt na szynach stoi w miejscu szafy; wysokość z numeru szyny (szyna 1 u góry); bez szafy na planie własne położenie', () => {
    const s = mk(); s.dispatch('d', plan.place('eqi_p', 'spc_h', 100, 100));
    expect(effectivePosition(s.state, 'eqi_p')).toMatchObject({ x: 100, y: 100 });
    s.dispatch('p', plan.placeRack('cab_a', 'spc_h', 5000, 4000, 0, 200));
    expect(effectivePosition(s.state, 'eqi_p')).toEqual({ spaceId: 'spc_h', x: 5000, y: 4000, z: 200 + Math.round(500 - 0.5 * 250) }); // szyna 1 z 2: 375 mm nad podstawą
    expect(effectivePosition(s.state, 'eqi_l')!.z).toBe(200 + Math.round(500 - 1.5 * 250));
  });
  it('szafa w racku: położenia nie ustawia się osobno, a osprzęt idzie za rackiem (wysokość z U modułu)', () => {
    const s = mk(); s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack', units: 8 }));
    s.dispatch('mm', cabCmd.mount('eqi_far', { cabinetId: 'cab_m', row: 1, at: 1 }));
    s.dispatch('rm', rackCmd.mount('cab_m', { rackId: 'rck_a', uStart: 3, face: 'front', slot: 'full' }));
    expect(() => s.dispatch('x', plan.placeRack('cab_m', 'spc_h', 0, 0))).toThrow(/stoi w racku/);
    s.dispatch('p', plan.placeRack('rck_a', 'spc_h', 8000, 2000, 0, 0));
    expect(cabinetPosition(s.state, 'cab_m')).toMatchObject({ x: 8000, y: 2000, z: Math.round((2 + 1.5) * 44.45) });
    expect(effectivePosition(s.state, 'eqi_far')).toMatchObject({ x: 8000, y: 2000, z: Math.round((2 + 1.5) * 44.45) });
  });
  it('estymata kabla między osprzętem w szafie a drugą szafą liczy od położeń szaf', () => {
    const s = mk(); s.dispatch('mm', cabCmd.mount('eqi_far', { cabinetId: 'cab_m', row: 1, at: 1 }));
    const port = (id: string, l: string) => Object.entries(s.state.definitions[s.state.equipment[id].definitionId].revisions['1'].ports).find(([, q]: any) => q.label === l)![0];
    s.dispatch('w', cmd.connect({ instanceId: 'eqi_p', portId: port('eqi_p', '+24 V') }, { instanceId: 'eqi_far', portId: port('eqi_far', '+24 V') }, 'std/power-dc'));
    expect(estimateLengths(s.state, 1000).noPlacement).toBe(1);
    s.dispatch('p1', plan.placeRack('cab_a', 'spc_h', 1000, 1000, 0, 0)); s.dispatch('p2', plan.placeRack('cab_m', 'spc_h', 6000, 3000, 0, 0));
    const r = estimateLengths(s.state, 1000); expect(r.noPlacement).toBe(0); expect(r.estimates[0].lengthMm).toBeGreaterThanOrEqual(1000 + 5000 + 2000);
  });
  it('rysunek planu pokazuje szafę, ukrywa jej osprzęt, a usunięcie szafy kasuje położenie', () => {
    const s = mk(); s.dispatch('d', plan.place('eqi_p', 'spc_h', 100, 100)); s.dispatch('p', plan.placeRack('cab_a', 'spc_h', 5000, 4000));
    const ids = planDrawList(s.state, { labels: false }).prims.filter((q) => q.t === 'rect').map((q) => q.id);
    expect(ids).toContain('cab_a'); expect(ids).not.toContain('eqi_p');
    s.dispatch('rm', cabCmd.removeCabinet('cab_a')); expect(Object.keys(s.state.placements!)).toEqual(['plc_p']); expect(checkInvariants(s.state)).toEqual([]); // zostaje tylko własne położenie urządzenia
  });

  it('PDF planu: szafa i rack mają etykiety i obrys, osprzęt w nich nie powtarza się osobnymi etykietami', async () => {
    const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
    const s = mk(); s.dispatch('d', plan.place('eqi_p', 'spc_h', 100, 100)); s.dispatch('p', plan.placeRack('cab_a', 'spc_h', 5000, 4000));
    s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack żółty', units: 8 })); s.dispatch('q', plan.placeRack('rck_a', 'spc_h', 20000, 4000));
    const r = await planPdf(s.state, { paper: 'A3', cables: false, fonts: { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') }, projectName: 'P', date: '2026-11-02' });
    const d = await pdfjs.getDocument({ data: r.bytes.slice(), useSystemFonts: false }).promise; const t = (await (await d.getPage(1)).getTextContent()).items.map((x: any) => x.str).join(' ').replace(/\s+/g, '');
    expect(t).toContain('Rozdzielnica'); expect(t).toContain('Rackżółty'); expect(t).toContain('rackówiszaf:2');
  });
});
