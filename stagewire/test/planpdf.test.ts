import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { routeCmd } from '../src/routes.ts';
import { planPdf, autoScale } from '../src/planPdf.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'Kamera żółta 1', 'eqi_k')); s.dispatch('b', addFromCatalog('video_switcher', 'Mikser', 'eqi_m'));
  s.dispatch('c', cmd.connect({ instanceId: 'eqi_k', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('s', plan.addSpace('spc_a', 'Sala główna', 20000, 12000));
  s.dispatch('p', plan.place('eqi_k', 'spc_a', 2000, 2000)); s.dispatch('p', plan.place('eqi_m', 'spc_a', 15000, 2000));
  s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'T', [[2000, 6000], [15000, 6000]]));
  return s;
};
const textOf = async (bytes: Uint8Array, page = 1) => { const d = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise; const pg = await d.getPage(page); const c = await pg.getTextContent(); return { pages: d.numPages, text: c.items.map((i: any) => i.str).join(' '), vp: pg.getViewport({ scale: 1 }) }; };

describe('eksport planu do PDF', () => {
  it('skala dobierana do papieru: standardowy mianownik, w którym sala się mieści', () => {
    expect(autoScale(20000, 12000, 'A3')).toBe(50); // 400 × 240 mm w obszarze A3 (400 × 253 mm)
    expect(autoScale(20000, 12000, 'A4')).toBeGreaterThan(autoScale(20000, 12000, 'A3'));
    expect(autoScale(200000, 120000, 'A4')).toBeLessThanOrEqual(2000);
  });
  it('PDF: plan w rozmiarze papieru + strona ze spisem, polskie znaki, nazwę projektu, skalę i kable', async () => {
    const s = mk();
    const r = await planPdf(s.state, { paper: 'A3', cables: true, fonts, projectName: 'Próba żółć', date: '2026-11-02' });
    const t = await textOf(r.bytes);
    expect(t.pages).toBe(2); expect(Math.round(t.vp.width / (72 / 25.4))).toBe(420); expect(Math.round(t.vp.height / (72 / 25.4))).toBe(297);
    const flat = t.text.replace(/\s+/g, ''); // pdf.js rozdziela fragmenty tekstu w różnych podzbiorach czcionki
    expect(flat).toContain('Próbażółć'); expect(flat).toContain('Salagłówna'); expect(flat).toContain(`Skala1:${r.scale}`); expect(flat).toContain('Kamerażółta1');
    expect(r.fits).toBe(true);
    expect(r.entries.map((e) => e.n)).toEqual([1, 2]);
    const leg = (await textOf(r.bytes, 2)).text.replace(/\s+/g, ''); // strona 2 = spis elementów z numerami
    expect(leg).toContain('Spiselementów'); expect(leg).toContain('Kamerażółta1'); expect(leg).toContain('Nr');
  });
  it('wymuszona zbyt duża skala daje fits = false; etykiety się nie nakładają (część pominięta)', async () => {
    const s = mk();
    const big = await planPdf(s.state, { paper: 'A4', scale: 20, cables: false, fonts, projectName: 'X' }); expect(big.fits).toBe(false);
    for (let i = 0; i < 6; i++) { s.dispatch('d', addFromCatalog('camera_sdi', `Kamera ${i}`, `eqi_x${i}`)); s.dispatch('p', plan.place(`eqi_x${i}`, 'spc_a', 8000, 8000)); }
    const r = await planPdf(s.state, { paper: 'A4', cables: false, fonts, projectName: 'X' }); expect(r.hiddenLabels).toBeGreaterThan(0);
  });
});
