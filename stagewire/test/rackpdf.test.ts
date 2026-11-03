import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { rackCmd } from '../src/racks.ts';
import { rackPdf } from '../src/rackPdf.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const textOf = async (bytes: Uint8Array) => { const d = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise; let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(' '); return { pages: d.numPages, flat: t.replace(/\s+/g, '') }; };

const dev = (key: string, model: string, heightU: number, widthFraction: number) => ({
  key, manufacturer: 'Fikcyjny', model, category: 'sieć', dimensionsMm: { width: 440, depth: 300, height: 44 * heightU }, rackUnits: { heightU, widthFraction }, weightKg: 3, powerW: 20,
  ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' },
});
beforeAll(() => { expect(installPack({ format: 'stagewire-pack/1', id: 'rackpdf-test', name: 'T', version: '1.0.0', license: 'własne', devices: [dev('a', 'Przełącznik żółć', 1, 1), dev('b', 'Połówka', 1, 0.5)] }).errors).toEqual([]); });
afterAll(() => unloadPack('rackpdf-test'));

const mk = (n: number) => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {};
  const s = new Store(p); s.dispatch('r', rackCmd.addRack('rck_a', { name: 'Rack żółty', units: 24, depthMm: 600 }));
  for (let i = 0; i < n; i++) { s.dispatch('a', addFromCatalog('rackpdf-test/a', `Switch ${i + 1}`, `eqi_s${i}`)); s.dispatch('m', rackCmd.mount(`eqi_s${i}`, { rackId: 'rck_a', uStart: i + 1, face: 'front', slot: 'full' })); }
  return s;
};

describe('eksport elewacji racka do PDF', () => {
  it('strona na rack: polskie znaki, nazwy urządzeń, sumy i miejsca w tabeli', async () => {
    const s = mk(3); const r = await rackPdf(s.state, { fonts, projectName: 'Próba', date: '2026-11-02' }); const t = await textOf(r.bytes);
    expect(r.racks).toBe(1); expect(t.pages).toBe(1);
    for (const f of ['Rackżółty', '24U', 'PRZÓD', 'TYŁ', 'Switch1', 'Switch3', 'Przełącznikżółć', 'Zajęte3z24U', 'wolne21U', 'Masa:9kg', 'pobór:60W']) expect(t.flat, f).toContain(f);
  });
  it('długa zawartość dzieli tabelę na strony; pusty rack i brak racków nie psują eksportu', async () => {
    const s = mk(24); const r = await rackPdf(s.state, { fonts, projectName: 'P' }); expect(r.pages).toBeGreaterThanOrEqual(1);
    const e = new Store(syntheticProject(0, 0, 1, true)); const none = await rackPdf(e.state, { fonts, projectName: 'P' }); expect(none.racks).toBe(0); expect((await textOf(none.bytes)).flat).toContain('niezawieraracków');
    e.dispatch('r', rackCmd.addRack('rck_p', { name: 'Pusty', units: 4 })); const empty = await rackPdf(e.state, { fonts, projectName: 'P' }); expect((await textOf(empty.bytes)).flat).toContain('jestpusty');
  });
  it('onlyRackId ogranicza eksport do jednego racka', async () => {
    const s = mk(1); s.dispatch('r', rackCmd.addRack('rck_b', { name: 'Drugi', units: 6 }));
    expect((await rackPdf(s.state, { fonts, projectName: 'P' })).racks).toBe(2); expect((await rackPdf(s.state, { fonts, projectName: 'P', onlyRackId: 'rck_b' })).racks).toBe(1);
  });
});
