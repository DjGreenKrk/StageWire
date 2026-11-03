import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixture } from './helpers.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { exportPlanPdf } from '../src/render/pdfExport.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const PL = 'Zażółć gęślą jaźń — ĄĆĘŁŃÓŚŹŻ';

async function textOf(bytes: Uint8Array): Promise<{ text: string; w: number; h: number; nPages: number }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return { text: tc.items.map((i: any) => i.str).join(''), w: vp.width, h: vp.height, nPages: doc.numPages };
}

describe('eksport PDF (TS-14, TS-07)', () => {
  it('polskie znaki są prawdziwym, wyszukiwalnym tekstem z osadzoną czcionką; arkusz A3 w skali 1:100', async () => {
    const dl = planDrawList(fixture('conference-mini.json'), { cables: true });
    const bytes = await exportPlanPdf(dl, { scale: 100, paperWidthMm: 420, paperHeightMm: 297, origin: [0, 0], fonts, title: 'Plan', titleBlock: [PL, 'Skala 1:100'] });
    const r = await textOf(bytes);
    expect(r.nPages).toBe(1);
    expect(r.w).toBeCloseTo((420 * 72) / 25.4, 1); // 1190,55 pt
    expect(r.h).toBeCloseTo((297 * 72) / 25.4, 1);
    const norm = (s: string) => s.replace(/\s+/g, '');
    expect(norm(r.text)).toContain(norm(PL));
    expect(r.text).toContain('CAM1');
    expect(r.text).toContain('CAM2');
    // czcionka osadzona (podzbiór), brak bitmapy: w PDF są nazwy czcionek Roboto
    const parsed = await PDFDocument.load(bytes);
    const names: string[] = [];
    const subtypes: string[] = [];
    for (const [, obj] of parsed.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const fn = obj.get(PDFName.of('FontName'));
        if (fn) names.push(fn.toString());
        const st = obj.get(PDFName.of('Subtype'));
        if (st) subtypes.push(st.toString());
      }
    }
    expect(names.some((n) => /Roboto/.test(n))).toBe(true); // czcionka osadzona (podzbiór)
    expect(names.length).toBeGreaterThanOrEqual(2); // latin + latin-ext
    expect(subtypes).not.toContain('/Image'); // wektor, nie bitmapa
  });
  it('znak spoza obu podzbiorów zastępowany „?” zamiast zepsucia dokumentu', async () => {
    const dl = planDrawList(fixture('conference-mini.json'));
    const bytes = await exportPlanPdf(dl, { scale: 100, paperWidthMm: 420, paperHeightMm: 297, fonts, titleBlock: ['Test 漢字 ok'] });
    const r = await textOf(bytes);
    expect(r.text.replace(/\s+/g, '')).toContain('Test??ok');
  });
});
