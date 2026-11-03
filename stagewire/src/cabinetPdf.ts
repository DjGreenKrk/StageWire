import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from './types.ts';
import type { PdfFonts } from './render/pdfExport.ts';
import { cabinetContents, cabinetTotals, cabinetWiring, type Cabinet, type PortRef } from './cabinets.ts';

const PT = 72 / 25.4;
const W = 297, H = 210, M = 12, ROW = 5.2, FS = 8;

export interface CabinetPdf { bytes: Uint8Array; pages: number; cabinets: number }

/**
 * Szafy i rozdzielnice DIN do PDF (A4 poziomo): na każdą szafę strona z elewacją (szyny, osprzęt w modułach), sumami, a pod nią tabele:
 * osprzęt, terminale (wejścia/wyjścia szafy) i okablowanie (od → do, sygnał, kabel). Długie tabele przechodzą na kolejne strony.
 * Tekst jest prawdziwym tekstem z osadzoną czcionką.
 */
export async function cabinetPdf(p: Project, o: { fonts: PdfFonts; projectName: string; date?: string; onlyCabinetId?: string }): Promise<CabinetPdf> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); doc.setTitle(`${o.projectName} — szafy`);
  const latin = await doc.embedFont(o.fonts.latin, { subset: true }), ext = await doc.embedFont(o.fonts.latinExt, { subset: true });
  const sets = new Map<PDFFont, Set<number>>([[latin, new Set(latin.getCharacterSet())], [ext, new Set(ext.getCharacterSet())]]);
  const black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45), light = rgb(0.88, 0.88, 0.88);
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

  const ids = Object.keys(p.cabinets ?? {}).filter((id) => !o.onlyCabinetId || id === o.onlyCabinetId);
  let pageNo = 0;
  const newPage = (title: string, sub: string) => { const page = doc.addPage([W * PT, H * PT]); pageNo++; draw(page, title, M, H - M - 3, 14); draw(page, sub, M, H - M - 9, 8, grey); return page; };
  if (!ids.length) { const page = newPage(`${o.projectName} — szafy`, o.date ?? ''); draw(page, 'Projekt nie zawiera szaf.', M, H - M - 22, 10); return { bytes: await doc.save(), pages: pageNo, cabinets: 0 }; }

  const nameOf = (id: string) => p.equipment[id]?.name ?? id;
  const portLabel = (r: PortRef) => { const i = p.equipment[r.instanceId]; return i ? p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]?.ports[r.portId]?.label ?? r.portId : r.portId; };
  const sigName = (k: string) => p.registries[k]?.name ?? k;
  const cableOf = (cid: string) => { const c = p.connections[cid], cab = c.cableId ? p.cables[c.cableId] : undefined; return cab ? `${cab.number ? cab.number + ' · ' : ''}${p.registries[cab.cableTypeKey]?.name ?? cab.cableTypeKey}` : '—'; };

  /** Tabela z powtarzanym nagłówkiem i przejściem na nowe strony; zwraca stronę i pozycję y po ostatnim wierszu. */
  const table = (pg0: PDFPage, y0: number, title: string, cols: [string, number][], rows: string[][], contTitle: string) => {
    let pg = pg0, y = y0;
    const head = () => { draw(pg, title, M, y, 9); y -= ROW; let x = M; for (const [h, w] of cols) { draw(pg, h, x + 0.8, y, FS); x += w; } pg.drawLine({ start: { x: M * PT, y: (y - 1.6) * PT }, end: { x: (W - M) * PT, y: (y - 1.6) * PT }, thickness: 0.6, color: black }); y -= ROW + 1; };
    if (y < M + 22) { pg = newPage(contTitle, `${o.projectName} · strona ${pageNo + 1}`); y = H - M - 18; }
    head();
    if (!rows.length) { draw(pg, 'Brak.', M, y, FS, grey); y -= ROW; }
    for (const r of rows) {
      if (y < M + 6) { pg = newPage(contTitle, `${o.projectName} · strona ${pageNo + 1}`); y = H - M - 18; head(); }
      let cx = M; r.forEach((c, i) => { draw(pg, fit(c, cols[i][1]), cx + 0.8, y, FS); cx += cols[i][1]; });
      pg.drawLine({ start: { x: M * PT, y: (y - 1.4) * PT }, end: { x: (W - M) * PT, y: (y - 1.4) * PT }, thickness: 0.15, color: grey });
      y -= ROW;
    }
    return { pg, y: y - 3 };
  };

  for (const cid of ids) {
    const c = p.cabinets![cid] as Cabinet, t = cabinetTotals(p, cid), items = cabinetContents(p, cid), w = cabinetWiring(p, cid);
    const page = newPage(`${c.name} — ${c.widthMm} × ${c.heightMm}${c.depthMm ? ' × ' + c.depthMm : ''} mm`, `${o.projectName}${o.date ? ' · ' + o.date : ''} · ${c.rows} szyn × ${c.modules} mod. · zajęte ${t.usedModules} z ${c.rows * c.modules}, wolne ${t.freeModules}`);
    // elewacja: stała skala dopasowana do szerokości i wysokości obszaru
    const availW = W - 2 * M - 10, availH = 62, rowH = Math.min(14, availH / c.rows), mod = Math.min(7, availW / c.modules), x0 = M + 5, top = H - M - 16;
    page.drawRectangle({ x: (x0 - 2) * PT, y: (top - c.rows * rowH - 2) * PT, width: (c.modules * mod + 4) * PT, height: (c.rows * rowH + 4) * PT, borderColor: black, borderWidth: 0.8 });
    for (let r = 1; r <= c.rows; r++) {
      const yRow = top - (r - 1) * rowH, yc = yRow - rowH / 2;
      page.drawRectangle({ x: x0 * PT, y: (yc - 1) * PT, width: c.modules * mod * PT, height: 2 * PT, color: light });
      draw(page, String(r), x0 - 4.5, yc - 1, 6, grey);
    }
    for (const it of items) {
      const yc = top - (it.din.row - 0.5) * rowH, h = Math.min(rowH * 0.7, 9), x = x0 + (it.din.at - 1) * mod, wd = it.modules * mod;
      page.drawRectangle({ x: (x + 0.2) * PT, y: (yc - h / 2) * PT, width: (wd - 0.4) * PT, height: h * PT, color: rgb(0.85, 0.9, 0.96), borderColor: black, borderWidth: 0.4 });
      const fs = Math.max(4.5, Math.min(7, mod * 1.1));
      if (wd >= 12) draw(page, fit(nameOf(it.id), wd - 1, fs), x + 0.8, yc - fs * 0.15, fs);
    }
    // terminale zaznaczone na elewacji (żółta kropka nad blokiem)
    for (const tr of c.terminals ?? []) { const it = items.find((o2) => o2.id === tr.instanceId); if (!it) continue; page.drawCircle({ x: (x0 + (it.din.at - 1) * mod + (it.modules * mod) / 2) * PT, y: (top - (it.din.row - 0.5) * rowH + Math.min(rowH * 0.7, 9) / 2 + 1) * PT, size: 1.1 * PT, color: rgb(1, 0.83, 0.2), borderColor: black, borderWidth: 0.3 }); }
    let y = top - c.rows * rowH - 8;
    draw(page, `Osprzęt: ${t.devices} · masa: ${num(t.weightKg)} kg${t.weightUnknown ? ` (bez danych: ${t.weightUnknown})` : ''} · pobór: ${num(t.powerW)} W${t.powerUnknown ? ` (bez danych: ${t.powerUnknown})` : ''} · przewody: ${w.internal.length} wewnętrznych, ${w.external.length} wychodzących · terminali: ${c.terminals?.length ?? 0}`, M, y, 9); y -= ROW + 3;
    let pg: PDFPage = page;
    ({ pg, y } = table(pg, y, 'Osprzęt', [['Szyna', 14], ['Pozycja', 20], ['Moduły', 16], ['Nazwa', 70], ['Urządzenie', 80], ['Masa [kg]', 24], ['Moc [W]', 24]],
      items.map((it) => { const rev = p.definitions[p.equipment[it.id].definitionId]?.revisions[String(p.equipment[it.id].definitionRevision)]; return [String(it.din.row), it.modules > 1 ? `${it.din.at}–${it.din.at + it.modules - 1}` : String(it.din.at), String(it.modules), nameOf(it.id), rev ? `${rev.manufacturer} ${rev.model}` : '?', rev?.weightKg === undefined ? '' : num(rev.weightKg), rev?.powerW === undefined ? '' : num(rev.powerW)]; }), `${c.name} — osprzęt (ciąg dalszy)`));
    ({ pg, y } = table(pg, y, 'Terminale szafy (wejścia i wyjścia)', [['Urządzenie', 70], ['Port', 60], ['Kierunek', 24], ['Sygnał', 70], ['Podłączono do', 50]],
      [...(c.terminals ?? [])].sort((a, b) => (a.group ?? '\uffff').localeCompare(b.group ?? '\uffff', 'pl')).map((tr) => {
        const port = p.definitions[p.equipment[tr.instanceId]?.definitionId]?.revisions[String(p.equipment[tr.instanceId]?.definitionRevision)]?.ports[tr.portId];
        const other = Object.values(p.connections).find((cn) => (cn.from.instanceId === tr.instanceId && cn.from.portId === tr.portId) || (cn.to.instanceId === tr.instanceId && cn.to.portId === tr.portId));
        const peer = other ? (other.from.instanceId === tr.instanceId && other.from.portId === tr.portId ? other.to : other.from) : undefined;
        return [nameOf(tr.instanceId), `${tr.group ? tr.group + ': ' : ''}${port?.label ?? tr.portId}`, ({ in: 'wejście', out: 'wyjście', io: 'wej./wyj.', loop: 'przelot' } as Record<string, string>)[port?.direction ?? ''] ?? '', (port?.signalKeys ?? []).map(sigName).join(', '), peer ? `${nameOf(peer.instanceId)} · ${portLabel(peer)}` : 'niepodłączony'];
      }), `${c.name} — terminale (ciąg dalszy)`));
    table(pg, y, 'Okablowanie wewnątrz szafy', [['Od', 70], ['Do', 70], ['Sygnał', 56], ['Przewód', 70]],
      w.internal.map((id) => { const cn = p.connections[id]; return [`${nameOf(cn.from.instanceId)} · ${portLabel(cn.from)}`, `${nameOf(cn.to.instanceId)} · ${portLabel(cn.to)}`, sigName(cn.signalKey), cableOf(id)]; }), `${c.name} — okablowanie (ciąg dalszy)`);
  }
  return { bytes: await doc.save(), pages: pageNo, cabinets: ids.length };
}
