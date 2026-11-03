import type { Project } from './types.ts';
import { diagramDrawList, bboxOf, signalLegend, type DiagramView, type Prim } from './render/drawlist.ts';
import { groupFrames } from './groups.ts';
import { exportPlanPdf, type PdfFonts } from './render/pdfExport.ts';
import { PAPERS } from './planPdf.ts';

const MARGIN = 10, TITLE_H = 20;
/** Jednostek diagramu na 1 mm papieru: przy 4,6 nazwa urządzenia (13 jedn.) ma ok. 8 pt, a blok urządzenia ok. 37 mm szerokości. */
export const BASE_UNITS_PER_MM = 4.6;

export interface DiagramPdfResult { bytes: Uint8Array; paper: string; unitsPerMm: number }

/**
 * Schemat blokowy do PDF: wektorowo, na najmniejszym papierze A4…A1 (poziomo), na którym mieści się cały schemat przy skali bazowej;
 * gdy nie mieści się nawet na A1, skala jest zmniejszana (tekst staje się mniejszy). Oś Y diagramu (w dół) jest odwracana do układu PDF.
 */
export async function diagramPdf(p: Project, view: DiagramView, o: { fonts: PdfFonts; projectName: string; date?: string; paper?: string; color?: boolean }): Promise<DiagramPdfResult> {
  const dl0 = diagramDrawList(p, view);
  const legend: Prim[] = [];
  if (o.color) { // legenda kolorów kabli nad schematem
    let bx = Infinity, by = Infinity; for (const pr of dl0.prims) { const b = bboxOf(pr); bx = Math.min(bx, b[0]); by = Math.min(by, b[1]); }
    let cx = isFinite(bx) ? bx : 0; const y = (isFinite(by) ? by : 0) - 44;
    for (const l of signalLegend(p)) { legend.push({ t: 'rect', id: 'legenda', x: cx + 14, y, w: 28, h: 5, rot: 0, fill: l.color, stroke: l.color, lw: 1 }, { t: 'text', id: 'legenda', x: cx + 34, y: y + 4, s: l.label, size: 12, color: '#000000' }); cx += 44 + l.label.length * 6.8; }
  }
  const dl = { ...dl0, prims: [...groupFrames(p, view), ...legend, ...dl0.prims] };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const flip = (pr: Prim): Prim => {
    switch (pr.t) {
      case 'rect': return { ...pr, y: -pr.y };
      case 'line': return { ...pr, pts: pr.pts.map((v, i) => (i % 2 ? -v : v)) };
      case 'dot': return { ...pr, y: -pr.y };
      case 'text': return { ...pr, y: -pr.y };
    }
  };
  const prims = dl.prims.map(flip);
  for (const pr of dl.prims) {
    const pts = pr.t === 'line' ? pr.pts : pr.t === 'rect' ? [pr.x - pr.w / 2, pr.y - pr.h / 2, pr.x + pr.w / 2, pr.y + pr.h / 2] : [pr.x, pr.y];
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  }
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 100; }
  const w = x1 - x0, h = y1 - y0;
  const names = o.paper ? [o.paper] : Object.keys(PAPERS);
  let paper = names.at(-1)!, upm = BASE_UNITS_PER_MM;
  for (const n of names) { const [pw, ph] = PAPERS[n]; if (w / upm <= pw - 2 * MARGIN && h / upm <= ph - 2 * MARGIN - TITLE_H) { paper = n; break; } }
  const [pw, ph] = PAPERS[paper];
  if (w / upm > pw - 2 * MARGIN || h / upm > ph - 2 * MARGIN - TITLE_H) upm = Math.max(w / (pw - 2 * MARGIN), h / (ph - 2 * MARGIN - TITLE_H));
  const title = [`${o.projectName} — schemat blokowy`, `Urządzeń: ${Object.keys(p.equipment).length} · połączeń: ${Object.keys(p.connections).length} · papier ${paper} poziomo${o.date ? ' · ' + o.date : ''}`];
  const bytes = await exportPlanPdf({ prims, unit: 'u' }, { scale: upm, paperWidthMm: pw, paperHeightMm: ph, marginMm: MARGIN, origin: [x0, -y1], fonts: o.fonts, title: `${o.projectName} — schemat`, titleBlock: title, color: o.color });
  return { bytes, paper, unitsPerMm: upm };
}
