import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { bboxOf, type DrawList, type Prim } from './drawlist.ts';

export interface PdfFonts { latin: Uint8Array; latinExt: Uint8Array }
export interface PdfOptions {
  scale: number;
  paperWidthMm: number;
  paperHeightMm: number;
  marginMm?: number;
  origin?: [number, number];
  fonts: PdfFonts;
  title?: string;
  /** Linie opisu w tabliczce (np. polskie znaki). */
  titleBlock?: string[];
  /** Kolorowy eksport: kolory kabli, obrysów i napisów z rysunku (przyciemnione pod biały papier) zamiast samej czerni. */
  color?: boolean;
  /** Legenda kolorów kabli w tabliczce (tylko eksport kolorowy). */
  cableLegend?: { label: string; color: string }[];
  /** Spis elementów na dodatkowych stronach (tabela: nagłówki, szerokości kolumn w mm, wiersze). */
  legend?: { title: string; headers: string[]; widths: number[]; rows: string[][] };
}

const PT = 72 / 25.4; // punkty na mm

/**
 * Wektorowy eksport planu do PDF w skali (1 mm na papierze = 1 mm w PDF). Tekst jest prawdziwym tekstem z osadzoną czcionką
 * (Roboto, podzbiory latin i latin-ext, licencja Apache-2.0), więc polskie znaki są zaznaczalne i wyszukiwalne.
 * Ten sam kod działa w Node (testy) i w widoku przeglądarki/Tauri.
 */
export async function exportPlanPdf(dl: DrawList, o: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (o.title) doc.setTitle(o.title);
  const latin = await doc.embedFont(o.fonts.latin, { subset: true });
  const ext = await doc.embedFont(o.fonts.latinExt, { subset: true });
  const sets = new Map<PDFFont, Set<number>>([[latin, new Set(latin.getCharacterSet())], [ext, new Set(ext.getCharacterSet())]]);
  const page = doc.addPage([o.paperWidthMm * PT, o.paperHeightMm * PT]);
  const m = o.marginMm ?? 10;
  let x0 = Infinity, y0 = Infinity;
  for (const p of dl.prims) { const b = bboxOf(p); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); }
  const [ox, oy] = o.origin ?? [x0, y0];
  const X = (x: number) => (m + (x - ox) / o.scale) * PT;
  const Y = (y: number) => (m + (y - oy) / o.scale) * PT; // model: Y w górę = PDF: Y w górę
  const black = rgb(0, 0, 0);
  // kolor na biały papier: jasne kolory ekranu (pod czarne tło) są przyciemniane, biały tekst staje się czarny
  const parse = (hex: string): [number, number, number, number] | undefined => { const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? ''); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1] : undefined; };
  const paper = (hex: string, k = 0.72, fallback = black) => { if (!o.color) return fallback; const c = parse(hex); if (!c) return fallback; const lum = (c[0] + c[1] + c[2]) / 765; if (lum > 0.94) return black; return rgb((c[0] * k) / 255, (c[1] * k) / 255, (c[2] * k) / 255); };
  const NEUTRAL = new Set(['#121212', '#1e1e1e', '#000000', '#0b0b0b', '#2a2a2a']);

  const paperH = o.paperHeightMm * PT;
  const text = (s: string, x: number, y: number, sizePt: number, pg = page, col = black) => {
    let cx = x;
    let run = ''; let runFont: PDFFont | null = null;
    const flush = () => { if (run && runFont) { pg.drawText(run, { x: cx, y, size: sizePt, font: runFont, color: col }); cx += runFont.widthOfTextAtSize(run, sizePt); } run = ''; };
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const f = sets.get(latin)!.has(cp) ? latin : sets.get(ext)!.has(cp) ? ext : null;
      const use = f ?? latin;
      const c = f ? ch : '?';
      if (runFont !== use) { flush(); runFont = use; }
      run += c;
    }
    flush();
  };

  const poly = (pts: number[], close: boolean, col = black, thick = 0.25) => {
    const n = pts.length / 2;
    for (let i = 0; i < n - (close ? 0 : 1); i++) {
      const a = i * 2, b = ((i + 1) % n) * 2;
      page.drawLine({ start: { x: X(pts[a]), y: Y(pts[a + 1]) }, end: { x: X(pts[b]), y: Y(pts[b + 1]) }, thickness: thick * PT, color: col });
    }
  };
  const rectPts = (p: Extract<Prim, { t: 'rect' }>): number[] => {
    const a = (p.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = p.w / 2, hh = p.h / 2;
    const unit = p.round ? Array.from({ length: 32 }, (_, k) => [Math.cos((2 * Math.PI * k) / 32) * hw, Math.sin((2 * Math.PI * k) / 32) * hh]) : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    return unit.flatMap(([dx, dy]) => [p.x + dx * c - dy * s, p.y + dx * s + dy * c]);
  };

  for (const p of dl.prims) {
    if (p.t === 'rect') {
      const pts = rectPts(p);
      if (o.color && p.fill && !NEUTRAL.has(p.fill.toLowerCase()) && parse(p.fill)) { // wypełnienie jako jasny odcień (bryły sceniczne, ramki grup)
        const f = parse(p.fill)!, d = Array.from({ length: pts.length / 2 }, (_, k) => `${k ? 'L' : 'M'} ${X(pts[2 * k])} ${paperH - Y(pts[2 * k + 1])}`).join(' ') + ' Z';
        page.drawSvgPath(d, { x: 0, y: paperH, color: paper(p.fill, 1), opacity: Math.min(0.35, f[3] < 1 ? 0.12 : 0.3), borderWidth: 0 });
      }
      poly(pts, true, paper(p.stroke, 0.72), o.color ? 0.35 : 0.25);
    } else if (p.t === 'line') poly(p.pts, false, paper(p.stroke, 0.72), o.color ? 0.4 : 0.25);
    else if (p.t === 'dot') page.drawCircle({ x: X(p.x), y: Y(p.y), size: Math.max((p.r / o.scale) * PT, 0.4 * PT), color: paper(p.fill, 0.72) });
    else if (p.t === 'text') text(p.s, X(p.x), Y(p.y), Math.max((p.size / o.scale) * PT, 5), page, paper(p.color, 0.6));
  }
  // tabliczka
  (o.titleBlock ?? []).forEach((line, i) => text(line, m * PT, (o.paperHeightMm - m - 4 - i * 5) * PT, 9));
  if (o.color && o.cableLegend?.length) { // legenda kolorów kabli: pasek koloru + nazwa, w jednym rzędzie pod opisem
    let lx = m; const ly = o.paperHeightMm - m - 4 - (o.titleBlock?.length ?? 0) * 5;
    text('Kable:', lx * PT, ly * PT, 9); lx += 13;
    for (const l of o.cableLegend) {
      page.drawLine({ start: { x: lx * PT, y: (ly + 1.2) * PT }, end: { x: (lx + 9) * PT, y: (ly + 1.2) * PT }, thickness: 1.2 * PT, color: paper(l.color, 0.72) });
      text(l.label, (lx + 11) * PT, ly * PT, 9); lx += 14 + l.label.length * 1.9;
    }
  }
  if (o.legend) {
    const L = o.legend, rowH = 5.2, top = o.paperHeightMm - m - 12, perPage = Math.max(1, Math.floor((top - m - 6) / rowH)) - 1;
    const fit = (s: string, w: number, size: number) => { const f = latin; let t = s; while (t.length > 1 && f.widthOfTextAtSize(t, size) > w * PT - 2) t = t.slice(0, -2); return t === s ? s : t.trimEnd() + '…'; };
    for (let from = 0; from < Math.max(L.rows.length, 1); from += perPage) {
      const pg = doc.addPage([o.paperWidthMm * PT, o.paperHeightMm * PT]);
      text(`${L.title}${L.rows.length > perPage ? ` (${Math.floor(from / perPage) + 1}/${Math.ceil(L.rows.length / perPage)})` : ''}`, m * PT, (o.paperHeightMm - m - 4) * PT, 11, pg);
      let x = m; const yh = top;
      L.headers.forEach((h, i) => { text(h, x * PT, (yh - 3.6) * PT, 8, pg); x += L.widths[i]; });
      pg.drawLine({ start: { x: m * PT, y: (yh - 4.6) * PT }, end: { x: (o.paperWidthMm - m) * PT, y: (yh - 4.6) * PT }, thickness: 0.4, color: black });
      L.rows.slice(from, from + perPage).forEach((r, k) => {
        let cx = m; const y = (yh - 4.6 - (k + 1) * rowH + 1.4) * PT;
        r.forEach((cell, i) => { text(fit(cell, L.widths[i] - 1, 8), cx * PT, y, 8, pg); cx += L.widths[i]; });
        pg.drawLine({ start: { x: m * PT, y: y - 1.2 * PT }, end: { x: (o.paperWidthMm - m) * PT, y: y - 1.2 * PT }, thickness: 0.1, color: rgb(0.7, 0.7, 0.7) });
      });
    }
  }
  return doc.save();
}
