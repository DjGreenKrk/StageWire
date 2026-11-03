import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from './types.ts';
import { patchList, type CableRow } from './reports.ts';
import type { PdfFonts } from './render/pdfExport.ts';

const PT = 72 / 25.4;
const W = 297, H = 210, M = 10, ROW = 5.6, FS = 8;
/** Kolumny: [nagłówek, szerokość mm]. Suma = W − 2·M. */
const COLS: [string, number][] = [['Numer', 20], ['Typ kabla', 38], ['Z (urządzenie · port)', 68], ['Do (urządzenie · port)', 68], ['Sygnał', 30], ['Długość [m]', 25], ['Uwagi', 28]];

export interface CableListPdf { bytes: Uint8Array; pages: number; rows: number }

/** Lista kabli do PDF (A4 poziomo, wiele stron, nagłówek tabeli powtarzany) + podsumowanie długości wg typów kabla. */
export async function cableListPdf(p: Project, o: { fonts: PdfFonts; projectName: string; date?: string }): Promise<CableListPdf> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); doc.setTitle(`${o.projectName} — lista kabli`);
  const latin = await doc.embedFont(o.fonts.latin, { subset: true }), ext = await doc.embedFont(o.fonts.latinExt, { subset: true });
  const sets = new Map<PDFFont, Set<number>>([[latin, new Set(latin.getCharacterSet())], [ext, new Set(ext.getCharacterSet())]]);
  const black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45);
  const fontFor = (cp: number): PDFFont | null => (sets.get(latin)!.has(cp) ? latin : sets.get(ext)!.has(cp) ? ext : null);
  const width = (s: string, size: number) => { let w = 0; for (const ch of s) w += (fontFor(ch.codePointAt(0)!) ?? latin).widthOfTextAtSize(fontFor(ch.codePointAt(0)!) ? ch : '?', size); return w; };
  const draw = (page: PDFPage, s: string, xMm: number, yMm: number, size = FS, _bold = false, color = black) => { // brak pogrubienia: podwójne rysowanie dublowałoby tekst przy kopiowaniu/wyszukiwaniu
    let x = xMm * PT, run = '', rf: PDFFont | null = null;
    const flush = () => { if (run && rf) { page.drawText(run, { x, y: yMm * PT, size, font: rf, color }); x += rf.widthOfTextAtSize(run, size); } run = ''; };
    for (const ch of s) { const f = fontFor(ch.codePointAt(0)!); const use = f ?? latin; if (rf !== use) { flush(); rf = use; } run += f ? ch : '?'; }
    flush();
  };
  const fit = (s: string, mm: number, size = FS) => { if (width(s, size) <= mm * PT - 2) return s; let t = s; while (t.length > 1 && width(t + '…', size) > mm * PT - 2) t = t.slice(0, -1); return t + '…'; };

  const rows = patchList(p);
  const meters = (mm?: number) => (mm === undefined ? '' : String(Math.round(mm / 10) / 100).replace('.', ','));
  const cableName = (k: string) => (p.registries[k]?.name as string | undefined) ?? k;
  const note = (r: CableRow) => (r.medium !== 'physical' ? r.medium : !r.cableId ? 'brak kabla' : r.lengthSource === 'estimated' ? '~ z planu' : r.lengthSource === 'manual' ? 'ręcznie' : 'brak długości');

  let pageNo = 0, page!: PDFPage, y = 0;
  const header = (first: boolean) => {
    page = doc.addPage([W * PT, H * PT]); pageNo++;
    draw(page, `${o.projectName} — lista kabli`, M, H - M - 3, 13, true);
    draw(page, `${rows.length} połączeń${o.date ? ' · ' + o.date : ''} · strona ${pageNo}`, M, H - M - 9, 8, false, grey);
    y = H - M - 17;
    let x = M;
    for (const [h, w] of COLS) { draw(page, h, x + 0.8, y, FS, true); x += w; }
    page.drawLine({ start: { x: M * PT, y: (y - 1.6) * PT }, end: { x: (W - M) * PT, y: (y - 1.6) * PT }, thickness: 0.6, color: black });
    y -= ROW + 1.2; void first;
  };
  header(true);
  for (const r of rows) {
    if (y < M + 6) header(false);
    const cells = [r.number, r.cableType ? cableName(r.cableType) : '', `${r.fromDevice} · ${r.fromPort}`, `${r.toDevice} · ${r.toPort}`, p.registries[r.signal]?.name ?? r.signal, `${r.lengthSource === 'estimated' ? '~' : ''}${meters(r.lengthMm)}`, note(r)];
    let x = M;
    cells.forEach((c, i) => { draw(page, fit(String(c), COLS[i][1]), x + 0.8, y, FS); x += COLS[i][1]; });
    page.drawLine({ start: { x: M * PT, y: (y - 1.4) * PT }, end: { x: (W - M) * PT, y: (y - 1.4) * PT }, thickness: 0.15, color: grey });
    y -= ROW;
  }
  // podsumowanie wg typu kabla
  const byType = new Map<string, { n: number; mm: number; unknown: number }>();
  for (const r of rows) { if (!r.cableType) continue; const e = byType.get(r.cableType) ?? { n: 0, mm: 0, unknown: 0 }; e.n++; if (r.lengthMm !== undefined) e.mm += r.lengthMm; else e.unknown++; byType.set(r.cableType, e); }
  if (y < M + 14 + byType.size * ROW) header(false);
  y -= 4; draw(page, 'Podsumowanie wg typu kabla', M, y, 10, true); y -= ROW + 1;
  let tn = 0, tmm = 0;
  for (const [k, e] of byType) { draw(page, `${cableName(k)}: ${e.n} szt., razem ${meters(e.mm)} m${e.unknown ? ` (bez długości: ${e.unknown})` : ''}`, M + 1, y, FS); y -= ROW; tn += e.n; tmm += e.mm; }
  draw(page, `Razem kabli: ${tn} · łączna znana długość: ${meters(tmm)} m (długości „~” są oszacowane z planu)`, M + 1, y - 1, FS, true);
  return { bytes: await doc.save(), pages: pageNo, rows: rows.length };
}
