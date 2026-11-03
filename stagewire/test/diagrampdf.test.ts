import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { diagramPdf } from '../src/diagramPdf.ts';
import { gridLayout } from '../src/render/drawlist.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const info = async (b: Uint8Array) => { const d = await pdfjs.getDocument({ data: b.slice(), useSystemFonts: false }).promise; const pg = await d.getPage(1); const vp = pg.getViewport({ scale: 1 }); return { pages: d.numPages, w: Math.round(vp.width / (72 / 25.4)), h: Math.round(vp.height / (72 / 25.4)), text: (await pg.getTextContent()).items.map((i: any) => i.str).join('').replace(/\s+/g, '') }; };
const mk = (n: number) => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; const s = new Store(p);
  s.dispatch('m', addFromCatalog('video_switcher', 'Mikser wizji', 'eqi_m'));
  for (let i = 0; i < n; i++) { s.dispatch('k', addFromCatalog('camera_sdi', `Kamera żółta ${i}`, `eqi_k${i}`)); s.dispatch('c', cmd.connect({ instanceId: `eqi_k${i}`, portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: `prt_sdiin${i + 1}` }, 'std/sdi-3g')); }
  return s;
};
describe('schemat blokowy do PDF', () => {
  it('mały schemat na A4, polskie znaki i nazwy portów w PDF', async () => {
    const s = mk(2), r = await diagramPdf(s.state, gridLayout(s.state), { fonts, projectName: 'Próba' }); const t = await info(r.bytes);
    expect(r.paper).toBe('A4'); expect(t.pages).toBe(1); expect(t.w).toBe(297);
    for (const w of ['Próba—schematblokowy', 'Mikserwizji', 'Kamerażółta0', 'SDIIN1']) expect(t.text).toContain(w);
  });
  it('duży schemat dobiera większy papier; zawsze jedna strona', async () => {
    const s = mk(8), small = await diagramPdf(s.state, gridLayout(s.state), { fonts, projectName: 'X', paper: 'A4' });
    const big = await diagramPdf(s.state, gridLayout(s.state, 3), { fonts, projectName: 'X' });
    expect(small.unitsPerMm).toBeGreaterThanOrEqual(big.unitsPerMm); expect((await info(big.bytes)).pages).toBe(1);
  });
  it('cały tekst schematu leży na stronie (po odwróceniu osi Y)', async () => {
    const s = mk(8), r = await diagramPdf(s.state, gridLayout(s.state, 3), { fonts, projectName: 'X' });
    const d = await pdfjs.getDocument({ data: r.bytes.slice(), useSystemFonts: false }).promise, pg = await d.getPage(1), vp = pg.getViewport({ scale: 1 });
    const items = (await pg.getTextContent()).items as any[]; expect(items.length).toBeGreaterThan(20);
    for (const it of items) { const [, , , , x, y] = it.transform; if (!it.str.trim()) continue; expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(vp.width); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(vp.height); }
    // trzy rzędy siatki dają co najmniej trzy różne wysokości nagłówków „Kamera…”
    const ys = new Set(items.filter((i) => i.str.startsWith('Kamera')).map((i) => Math.round(i.transform[5])));
    expect(ys.size).toBeGreaterThanOrEqual(3);
  });
  it('pusty projekt nie wywala eksportu', async () => {
    const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {};
    const r = await diagramPdf(p, { nodes: {} }, { fonts, projectName: 'Pusty' }); expect((await info(r.bytes)).pages).toBe(1);
  });
});
