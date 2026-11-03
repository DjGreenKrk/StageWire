import { bboxOf, type DrawList, type Prim } from './drawlist.ts';

export interface SvgExportOptions {
  /** Mianownik skali (100 = 1:100). Dla planu (jednostki mm). */
  scale: number;
  paperWidthMm: number;
  paperHeightMm: number;
  marginMm?: number;
  /** Lewy dolny róg wycinka świata (mm), który trafia w lewy dolny róg pola rysunku. Domyślnie: min bbox. */
  origin?: [number, number];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * Eksport SVG planu w skali. 1 jednostka SVG = 1 mm na papierze, więc obiekt 8000 mm w skali 1:100 ma 80 mm.
 * Oś Y odwrócona (model: Y w górę; papier: Y w dół). Linie w mm papieru (stała grubość niezależna od skali).
 */
export function exportPlanSvg(dl: DrawList, o: SvgExportOptions): string {
  const m = o.marginMm ?? 10;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of dl.prims) { const b = bboxOf(p); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const [ox, oy] = o.origin ?? [x0, y0];
  const maxY = oy + (o.paperHeightMm - 2 * m) * o.scale;
  const X = (x: number) => m + (x - ox) / o.scale;
  const Y = (y: number) => m + (maxY - y) / o.scale;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${o.paperWidthMm}mm" height="${o.paperHeightMm}mm" viewBox="0 0 ${o.paperWidthMm} ${o.paperHeightMm}" data-scale="1:${o.scale}">`);
  out.push(`<rect x="0" y="0" width="${o.paperWidthMm}" height="${o.paperHeightMm}" fill="#fff"/>`);
  const one = (p: Prim): string => {
    switch (p.t) {
      case 'rect': {
        const w = p.w / o.scale, h = p.h / o.scale, cx = X(p.x), cy = Y(p.y);
        const rot = p.rot ? ` transform="rotate(${f(-p.rot)} ${f(cx)} ${f(cy)})"` : '';
        if (p.round) return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w / 2)}" ry="${f(h / 2)}" fill="none" stroke="#000" stroke-width="0.25"${rot} data-id="${p.id}"/>`;
        return `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="#000" stroke-width="0.25"${rot} data-id="${p.id}"/>`;
      }
      case 'line': {
        const pts: string[] = [];
        for (let i = 0; i < p.pts.length; i += 2) pts.push(`${f(X(p.pts[i]))},${f(Y(p.pts[i + 1]))}`);
        return `<polyline points="${pts.join(' ')}" fill="none" stroke="#000" stroke-width="0.18" data-id="${p.id}"/>`;
      }
      case 'text': return `<text x="${f(X(p.x))}" y="${f(Y(p.y))}" font-size="${f(Math.max(p.size / o.scale, 1.8))}" font-family="Roboto, sans-serif">${esc(p.s)}</text>`;
      case 'dot': return `<circle cx="${f(X(p.x))}" cy="${f(Y(p.y))}" r="${f(Math.max(p.r / o.scale, 0.4))}" fill="#000"/>`;
    }
  };
  for (const p of dl.prims) out.push(one(p));
  out.push('</svg>');
  return out.join('\n');
}
