import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from './types.ts';
import type { PdfFonts } from './render/pdfExport.ts';
import { rackContents, rackTotals, rackReport, itemInfo, slotRange, type Rack, type Face } from './racks.ts';

const PT = 72 / 25.4;
const W = 210, H = 297, M = 12, ROW = 5.4, FS = 8;
const COLS: [string, number][] = [['Strona', 14], ['U', 14], ['Miejsce', 16], ['Nazwa', 50], ['Urządzenie', 52], ['Masa [kg]', 20], ['Moc [W]', 20]];

export interface RackPdf { bytes: Uint8Array; pages: number; racks: number }

/**
 * Elewacje racków do PDF (A4 pionowo): na każdy rack strona z przodem i tyłem w stałej skali, sumami (zajęte/wolne U, masa, pobór)
 * i tabelą zawartości; długa tabela przechodzi na kolejne strony. Tekst jest prawdziwym tekstem z osadzoną czcionką.
 */
export async function rackPdf(p: Project, o: { fonts: PdfFonts; projectName: string; date?: string; onlyRackId?: string }): Promise<RackPdf> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); doc.setTitle(`${o.projectName} — racki`);
  const latin = await doc.embedFont(o.fonts.latin, { subset: true }), ext = await doc.embedFont(o.fonts.latinExt, { subset: true });
  const sets = new Map<PDFFont, Set<number>>([[latin, new Set(latin.getCharacterSet())], [ext, new Set(ext.getCharacterSet())]]);
  const black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45), light = rgb(0.9, 0.9, 0.9);
  const fontFor = (cp: number): PDFFont | null => (sets.get(latin)!.has(cp) ? latin : sets.get(ext)!.has(cp) ? ext : null);
  const width = (s: string, size: number) => { let w = 0; for (const ch of s) { const f = fontFor(ch.codePointAt(0)!); w += (f ?? latin).widthOfTextAtSize(f ? ch : '?', size); } return w; };
  const draw = (page: PDFPage, s: string, xMm: number, yMm: number, size = FS, color = black) => {
    let x = xMm * PT, run = '', rf: PDFFont | null = null;
    const flush = () => { if (run && rf) { page.drawText(run, { x, y: yMm * PT, size, font: rf, color }); x += rf.widthOfTextAtSize(run, size); } run = ''; };
    for (const ch of s) { const f = fontFor(ch.codePointAt(0)!); const use = f ?? latin; if (rf !== use) { flush(); rf = use; } run += f ? ch : '?'; }
    flush();
  };
  const fit = (s: string, mm: number, size = FS) => { if (width(s, size) <= mm * PT - 2) return s; let t = s; while (t.length > 1 && width(t + '…', size) > mm * PT - 2) t = t.slice(0, -1); return t + '…'; };
  const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

  const ids = Object.keys(p.racks ?? {}).filter((id) => !o.onlyRackId || id === o.onlyRackId);
  const rows = rackReport(p);
  let pageNo = 0;
  const newPage = (title: string, sub: string) => {
    const page = doc.addPage([W * PT, H * PT]); pageNo++;
    draw(page, title, M, H - M - 3, 14); draw(page, sub, M, H - M - 9, 8, grey);
    return page;
  };
  if (!ids.length) { const page = newPage(`${o.projectName} — racki`, o.date ?? ''); draw(page, 'Projekt nie zawiera racków.', M, H - M - 22, 10); return { bytes: await doc.save(), pages: pageNo, racks: 0 }; }

  for (const rid of ids) {
    const r = p.racks![rid] as Rack, t = rackTotals(p, rid), items = rackContents(p, rid);
    const page = newPage(`${r.name} — ${r.units} U${r.depthMm ? `, głębokość ${r.depthMm} mm` : ''}`, `${o.projectName}${o.date ? ' · ' + o.date : ''} · zajęte ${t.usedU} z ${r.units} U, wolne ${t.freeU}`);
    // elewacje: stała skala dobrana do wysokości racka
    const u = Math.min(7, 150 / r.units), rw = 78, top = H - M - 22 - 6;
    const drawFace = (face: Face, x0: number) => {
      draw(page, face === 'front' ? 'PRZÓD' : 'TYŁ', x0 + rw / 2 - 5, top + 3, 9);
      page.drawRectangle({ x: x0 * PT, y: (top - r.units * u) * PT, width: rw * PT, height: r.units * u * PT, borderColor: black, borderWidth: 0.8 });
      for (let k = 1; k <= r.units; k++) {
        const yU = top - k * u; // dolna krawędź U k
        page.drawLine({ start: { x: x0 * PT, y: yU * PT }, end: { x: (x0 + rw) * PT, y: yU * PT }, thickness: 0.1, color: light });
        if (u >= 3.2 || k % 5 === 0 || k === 1) draw(page, String(r.units - k + 1), x0 - 5.5, yU + u / 2 - 1, Math.min(6, u * 1.6), grey);
      }
      for (const it of items) {
        const [a, b] = slotRange(it.mount.slot, it.fit.widthFraction), w = (b - a) * rw, x = x0 + a * rw;
        const yTopDev = top - (r.units - (it.mount.uStart + it.fit.heightU - 1)) * u, h = it.fit.heightU * u;
        if (it.mount.face !== face) { page.drawRectangle({ x: x * PT, y: (yTopDev - h) * PT, width: w * PT, height: h * PT, color: rgb(0.96, 0.96, 0.96) }); continue; }
        page.drawRectangle({ x: x * PT, y: (yTopDev - h) * PT, width: w * PT, height: h * PT, color: rgb(0.85, 0.9, 0.96), borderColor: black, borderWidth: 0.5 });
        const fs = Math.max(4.5, Math.min(8, u * 1.5));
        draw(page, fit(itemInfo(p, it.id).name, w - 1.5, fs), x + 0.8, yTopDev - h / 2 - fs * 0.15, fs);
      }
    };
    drawFace('front', M + 8); drawFace('rear', M + 8 + rw + 14);
    // sumy
    let y = top - r.units * u - 9;
    draw(page, `Zajęte ${t.usedU} z ${r.units} U · wolne ${t.freeU} U · urządzeń ${t.devices}`, M, y, 9); y -= ROW + 0.8;
    draw(page, `Masa: ${num(t.weightKg)} kg${t.weightUnknown ? ` (bez danych o masie: ${t.weightUnknown})` : ''} · pobór: ${num(t.powerW)} W, maks. ${num(t.powerMaxW)} W${t.powerUnknown ? ` (bez danych o mocy: ${t.powerUnknown})` : ''}`, M, y, 9); y -= ROW + 3;
    // tabela zawartości (od góry racka)
    const mine = rows.filter((x) => x.rack === r.name);
    const head = (pg: PDFPage, yy: number) => { let x = M; for (const [h, w] of COLS) { draw(pg, h, x + 0.8, yy, FS); x += w; } pg.drawLine({ start: { x: M * PT, y: (yy - 1.6) * PT }, end: { x: (W - M) * PT, y: (yy - 1.6) * PT }, thickness: 0.6, color: black }); return yy - ROW - 1.2; };
    let pg = page; y = head(pg, y);
    for (const x of mine) {
      if (y < M + 8) { pg = newPage(`${r.name} — zawartość (ciąg dalszy)`, `${o.projectName} · strona ${pageNo + 1}`); y = head(pg, H - M - 18); }
      const cells = [x.face, x.uStart === x.uEnd ? String(x.uStart) : `${x.uStart}–${x.uEnd}`, x.slot, x.name, x.device, x.weightKg === undefined ? '' : num(x.weightKg), x.powerW === undefined ? '' : num(x.powerW)];
      let cx = M; cells.forEach((c, i) => { draw(pg, fit(c, COLS[i][1]), cx + 0.8, y, FS); cx += COLS[i][1]; });
      pg.drawLine({ start: { x: M * PT, y: (y - 1.4) * PT }, end: { x: (W - M) * PT, y: (y - 1.4) * PT }, thickness: 0.15, color: grey });
      y -= ROW;
    }
    if (!mine.length) draw(pg, 'Rack jest pusty.', M, y, FS, grey);
  }
  return { bytes: await doc.save(), pages: pageNo, racks: ids.length };
}
