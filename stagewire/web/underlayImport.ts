// Import podkładu: PDF (pdf.js, lokalnie), SVG, DXF (własny parser) i obrazy; wszystko zamieniane na raster (data URL) do wyskalowania na planie. Bez sieci.
import { parseDxf, type UnderlayKind } from '../src/underlay.ts';

export interface ImportOptions { maxSide: number; page: number; scaleDenominator?: number }
export interface Imported { kind: UnderlayKind; mime: string; image: string; widthPx: number; heightPx: number; mmPerPx: number; scaleKnown: boolean; invert: boolean; x: number; y: number; pages?: number; note: string }

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
const DEFAULT_WIDTH_MM = 30_000; // gdy skala nieznana: obraz szeroki na 30 m, użytkownik wyskaluje go dwoma punktami
const MM_PER_PT = 25.4 / 72, MM_PER_CSS_PX = 25.4 / 96;

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');
const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Nie udało się odczytać obrazu')); i.src = src; });
const readDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Nie udało się wczytać pliku')); r.readAsDataURL(f); });

/** Raster do data URL: PNG, a gdy zbyt duży (zdjęcia, skany) JPEG. */
function encode(c: HTMLCanvasElement, preferPng = true): { image: string; mime: string } {
  if (preferPng) { const png = c.toDataURL('image/png'); if (png.length < 10 * 1024 * 1024) return { image: png, mime: 'image/png' }; }
  return { image: c.toDataURL('image/jpeg', 0.88), mime: 'image/jpeg' };
}
const fitSide = (w: number, h: number, maxSide: number) => { const k = Math.min(1, maxSide / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k), k }; };

export async function importUnderlayFile(file: File, o: ImportOptions): Promise<Imported> {
  const ext = extOf(file.name);
  if (ext === 'dwg') throw new Error('Format DWG jest zamknięty i nie da się go wczytać offline. W programie CAD (AutoCAD, Vectorworks, LibreCAD, darmowy ODA File Converter) zapisz rysunek jako DXF albo PDF i zaimportuj ten plik.');
  if (!['pdf', 'svg', 'dxf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('Obsługiwane formaty: PDF, SVG, DXF, PNG, JPG (DWG: zapisz jako DXF lub PDF).');
  if (file.size > MAX_FILE_BYTES) throw new Error('Plik jest za duży (limit 60 MB)');
  const denom = o.scaleDenominator && o.scaleDenominator > 0 ? o.scaleDenominator : undefined;

  if (ext === 'dxf') {
    const r = parseDxf(await file.text());
    if (!r.polylines.length || !Number.isFinite(r.minX)) throw new Error('W pliku DXF nie znaleziono linii ani polilinii (obsługiwane: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC). Plik binarny DXF nie jest obsługiwany.');
    const bw = r.maxX - r.minX || 1, bh = r.maxY - r.minY || 1, k = o.maxSide / Math.max(bw, bh), pad = 8, c = canvasOf(bw * k + 2 * pad, bh * k + 2 * pad), g = c.getContext('2d')!;
    g.strokeStyle = '#d0d6dc'; g.lineWidth = 1.4; g.lineJoin = 'round'; g.beginPath();
    for (const pl of r.polylines) pl.forEach(([x, y], i) => { const px = pad + (x - r.minX) * k, py = c.height - pad - (y - r.minY) * k; i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
    const e = encode(c), skipped = Object.entries(r.skipped).map(([t, n]) => `${t}: ${n}`).join(', ');
    return { kind: 'dxf', ...e, widthPx: c.width, heightPx: c.height, mmPerPx: r.mmPerUnit / k, scaleKnown: true, invert: false, x: Math.round((r.minX - pad / k) * r.mmPerUnit), y: Math.round((r.minY - pad / k) * r.mmPerUnit),
      note: `DXF: ${r.polylines.length} linii, jednostki: ${r.units}, rozmiar ${Math.round((bw * r.mmPerUnit) / 10) / 100} × ${Math.round((bh * r.mmPerUnit) / 10) / 100} m${skipped ? `; pominięto obiekty: ${skipped}` : ''}` };
  }

  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default as string;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: false }), doc = await task.promise;
    const pageNo = Math.min(Math.max(1, Math.round(o.page || 1)), doc.numPages), page = await doc.getPage(pageNo), base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: o.maxSide / Math.max(base.width, base.height) }); // strona na pełną rozdzielczość importu
    const c = canvasOf(vp.width, vp.height), g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp, canvas: c } as any).promise;
    const paperMmPerPx = (base.width * MM_PER_PT) / c.width, e = encode(c, false);
    const pages = doc.numPages; await task.destroy();
    return { kind: 'pdf', ...e, widthPx: c.width, heightPx: c.height, invert: true, x: 0, y: 0, pages,
      mmPerPx: denom ? paperMmPerPx * denom : DEFAULT_WIDTH_MM / c.width, scaleKnown: !!denom,
      note: `PDF, strona ${pageNo}/${pages} (${Math.round(base.width * MM_PER_PT)} × ${Math.round(base.height * MM_PER_PT)} mm)${denom ? `, skala 1:${denom}` : ': skala rysunku nieznana, wyskaluj podkład dwoma punktami'}` };
  }

  if (ext === 'svg') {
    const text = await file.text();
    if (/<script[\s>]/i.test(text)) throw new Error('SVG zawiera skrypty: nie importuję takich plików');
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const img = await loadImg(url), nw = img.naturalWidth || 1000, nh = img.naturalHeight || 1000, ks = o.maxSide / Math.max(nw, nh), c = canvasOf(nw * ks, nh * ks), g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const e = encode(c), docMmPerPx = (nw * MM_PER_CSS_PX) / c.width;
      return { kind: 'svg', ...e, widthPx: c.width, heightPx: c.height, invert: true, x: 0, y: 0, mmPerPx: denom ? docMmPerPx * denom : DEFAULT_WIDTH_MM / c.width, scaleKnown: !!denom,
        note: `SVG ${Math.round(nw)} × ${Math.round(nh)} px${denom ? `, skala 1:${denom}` : ': skala rysunku nieznana, wyskaluj podkład dwoma punktami'}` };
    } finally { URL.revokeObjectURL(url); }
  }

  // obrazy rastrowe
  const src = await readDataUrl(file), img = await loadImg(src), fs = fitSide(img.naturalWidth, img.naturalHeight, o.maxSide);
  let image = src, mime = file.type || 'image/png', w = img.naturalWidth, h = img.naturalHeight;
  if (fs.k < 1) { const c = canvasOf(fs.w, fs.h); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); ({ image, mime } = encode(c, ext === 'png')); w = c.width; h = c.height; }
  return { kind: 'image', image, mime, widthPx: w, heightPx: h, invert: true, x: 0, y: 0, mmPerPx: DEFAULT_WIDTH_MM / w, scaleKnown: false, note: `Obraz ${w} × ${h} px: skala nieznana, wyskaluj podkład dwoma punktami` };
}
