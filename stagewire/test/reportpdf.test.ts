import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { cableListPdf } from '../src/reportPdf.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const textOf = async (bytes: Uint8Array) => { const d = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise; let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(' '); return { pages: d.numPages, flat: t.replace(/\s+/g, '') }; };

const mk = (n: number) => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {};
  const s = new Store(p);
  s.dispatch('m', addFromCatalog('video_switcher', 'Mikser', 'eqi_m'));
  for (let i = 0; i < n; i++) {
    s.dispatch('k', addFromCatalog('camera_sdi', `Kamera żółta ${i}`, `eqi_k${i}`));
    s.dispatch('c', cmd.connect({ instanceId: `eqi_k${i}`, portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: `prt_sdiin${(i % 8) + 1}` }, 'std/sdi-3g'));
  }
  return s;
};

describe('lista kabli do PDF', () => {
  it('jedna strona dla małej listy; polskie znaki, nagłówki, podsumowanie wg typu', async () => {
    const s = mk(3); s.dispatch('n', cmd.numberMissingCables());
    const r = await cableListPdf(s.state, { fonts, projectName: 'Próba', date: '2026-11-02' }); const t = await textOf(r.bytes);
    expect(r.rows).toBe(3); expect(t.pages).toBe(1);
    for (const w of ['Próba—listakabli', 'Numer', 'Typkabla', 'Kamerażółta0', 'V001', 'Podsumowaniewgtypukabla', 'Razemkabli:3']) expect(t.flat).toContain(w);
  });
  it('długa lista dzieli się na strony z powtórzonym nagłówkiem', async () => {
    const s = mk(80); const r = await cableListPdf(s.state, { fonts, projectName: 'Duży' }); const t = await textOf(r.bytes);
    expect(r.rows).toBe(80); expect(t.pages).toBeGreaterThan(1); expect((t.flat.match(/Typkabla/g) ?? []).length).toBe(t.pages);
    expect(t.flat).toContain('Razemkabli:80');
  });
  it('długość oszacowana oznaczona „~”, brak kabla i brak długości opisane w uwagach', async () => {
    const s = mk(2); const ids = Object.keys(s.state.cables);
    s.dispatch('e', (d) => { d.cables[ids[0]].lengthMm = 12500; d.cables[ids[0]].lengthSource = 'estimated'; });
    s.dispatch('m', cmd.setCableLengths(ids[1], { lengthMm: 3000 }));
    const t = await textOf((await cableListPdf(s.state, { fonts, projectName: 'X' })).bytes);
    expect(t.flat).toContain('~12,5'); expect(t.flat).toContain('~zplanu'); expect(t.flat).toContain('ręcznie'); expect(t.flat).toContain('3');
  });
});
