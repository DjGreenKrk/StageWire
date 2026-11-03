import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd } from '../src/cabinets.ts';
import { cmd } from '../src/commands.ts';
import { cabinetPdf } from '../src/cabinetPdf.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const textOf = async (bytes: Uint8Array) => { const d = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise; let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(' '); return { pages: d.numPages, flat: t.replace(/\s+/g, '') }; };
const T = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'cabpdf', name: 'T', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'Fikcyjny', model: 'Zasilacz żółć', category: 'zasilanie', dinModules: 3, weightKg: 0.3, powerW: 12, ports: [T('in', 'L/N', 'std/power-ac', 'in'), T('out', '+24 V', 'std/power-dc', 'out')], source: { kind: 'custom' } },
  { key: 'led', manufacturer: 'Fikcyjny', model: 'Sterownik', category: 'oświetlenie', dinModules: 4, ports: [T('in', '+24 V', 'std/power-dc', 'in'), T('dmx', 'DMX', 'std/dmx', 'in')], source: { kind: 'custom' } },
] }).errors).toEqual([]); });
afterAll(() => unloadPack('cabpdf'));

const mk = (n = 2) => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p); s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Szafa żółta', widthMm: 400, heightMm: 500, depthMm: 150, rows: 3, modules: 24 }));
  for (let i = 0; i < n; i++) { s.dispatch('a', addFromCatalog('cabpdf/psu', `Zasilacz ${i + 1}`, `eqi_p${i}`)); s.dispatch('m', cabCmd.mount(`eqi_p${i}`, { cabinetId: 'cab_a', row: 1 + Math.floor(i / 6), at: 1 + (i % 6) * 4 })); }
  return s;
};
describe('eksport szaf DIN do PDF', () => {
  it('strona na szafę: nazwa, wymiary, osprzęt, terminale i okablowanie z polskimi znakami', async () => {
    const s = mk(2); s.dispatch('a', addFromCatalog('cabpdf/led', 'Sterownik LED', 'eqi_l')); s.dispatch('m', cabCmd.mount('eqi_l', { cabinetId: 'cab_a', row: 2, at: 1 }));
    const port = (id: string, l: string) => Object.entries(s.state.definitions[s.state.equipment[id].definitionId].revisions['1'].ports).find(([, q]: any) => q.label === l)![0];
    s.dispatch('w', cmd.connect({ instanceId: 'eqi_p0', portId: port('eqi_p0', '+24 V') }, { instanceId: 'eqi_l', portId: port('eqi_l', '+24 V') }, 'std/power-dc'));
    s.dispatch('t', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_p0', portId: port('eqi_p0', 'L/N') }, true));
    const r = await cabinetPdf(s.state, { fonts, projectName: 'Próba', date: '2026-11-02' }); const t = await textOf(r.bytes);
    if (process.env.SAMPLE_OUT) writeFileSync(process.env.SAMPLE_OUT, r.bytes);
    expect(r.cabinets).toBe(1); expect(t.pages).toBe(1);
    for (const f of ['Szafażółta', '400×500×150mm', 'Zasilacz1', 'SterownikLED', 'Fikcyjny', 'Zasilaczżółć', 'Terminaleszafy', 'Okablowaniewewnątrzszafy', 'wejście', '+24V', 'niepodłączony']) expect(t.flat, f).toContain(f);
  });
  it('długa lista osprzętu dzieli tabelę na strony; brak szaf nie psuje eksportu; onlyCabinetId', async () => {
    const big = await cabinetPdf(mk(18).state, { fonts, projectName: 'P' }); expect(big.pages).toBeGreaterThan(1);
    const e = new Store(syntheticProject(0, 0, 1, true)); const none = await cabinetPdf(e.state, { fonts, projectName: 'P' }); expect(none.cabinets).toBe(0); expect((await textOf(none.bytes)).flat).toContain('niezawieraszaf');
    const s = mk(1); s.dispatch('r', cabCmd.addCabinet('cab_b', { name: 'Druga', widthMm: 300, heightMm: 300, rows: 1, modules: 12 }));
    expect((await cabinetPdf(s.state, { fonts, projectName: 'P' })).cabinets).toBe(2); expect((await cabinetPdf(s.state, { fonts, projectName: 'P', onlyCabinetId: 'cab_b' })).cabinets).toBe(1);
  });
});
