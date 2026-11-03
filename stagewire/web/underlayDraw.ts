// Rysowanie podkładów pod planem (Canvas 2D, układ świata z odwróconym Y): obrazy z pamięcią podręczną, wersja z odwróconymi kolorami liczona raz.
import type { Project } from '../src/types.ts';
import { underlaysOf, type Underlay } from '../src/underlay.ts';

interface Entry { key: string; img: HTMLImageElement; ready: boolean; mips: Map<string, HTMLCanvasElement> }
const cache = new Map<string, Entry>();
const keyOf = (u: Underlay) => `${u.image.length}:${u.image.slice(-48)}`;

/** `ao` = początek aktywnej sali w budynku; `tmp` = przesunięcie przeciąganego podkładu (podgląd przed zapisem). Zwraca true, gdy któryś obraz jeszcze się ładuje. */
export function drawUnderlays(ctx: CanvasRenderingContext2D, p: Project, ao: number[], onLoad: () => void, tmp?: { id: string; dx: number; dy: number }): boolean {
  let pending = false;
  for (const [id, u] of underlaysOf(p)) {
    if (!u.visible) continue;
    let e = cache.get(id); const k = keyOf(u);
    if (!e || e.key !== k) { const img = new Image(); e = { key: k, img, ready: false, mips: new Map() }; const ent = e; img.onload = () => { ent.ready = true; onLoad(); }; img.src = u.image; cache.set(id, e); }
    if (!e.ready) { pending = true; continue; }
    // poziom mipmapy dobrany do bieżącego powiększenia: duży podkład nie jest skalowany w całości w każdej klatce
    const m = ctx.getTransform(), screenPerPx = Math.hypot(m.a, m.b) * u.mmPerPx;
    const lvl = (globalThis as any).__noMip ? 0 : Math.max(0, Math.min(6, Math.floor(Math.log2(1 / Math.max(screenPerPx, 1e-6)))));
    const src = mipOf(e, lvl, u.invert);
    const dx = tmp?.id === id ? tmp.dx : 0, dy = tmp?.id === id ? tmp.dy : 0;
    ctx.save(); ctx.globalAlpha = u.opacity; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.translate(u.x + dx - ao[0], u.y + dy - ao[1]); ctx.rotate((u.rotationDeg * Math.PI) / 180); ctx.scale(u.mmPerPx, -u.mmPerPx);
    ctx.drawImage(src, 0, -u.heightPx, u.widthPx, u.heightPx); ctx.restore();
  }
  for (const id of [...cache.keys()]) if (!(p as any).underlays?.[id]) cache.delete(id);
  return pending;
}

/** Poziom 0 = oryginał (lub jego negatyw); poziom n = połowa rozmiaru poziomu n-1, liczone raz i trzymane w pamięci podręcznej. */
function mipOf(e: Entry, lvl: number, invert: boolean): CanvasImageSource {
  const key = `${invert ? 'i' : 'n'}${lvl}`, hit = e.mips.get(key); if (hit) return hit;
  let c: HTMLCanvasElement;
  if (lvl === 0) {
    if (!invert) return e.img;
    c = document.createElement('canvas'); c.width = e.img.naturalWidth; c.height = e.img.naturalHeight;
    const g = c.getContext('2d')!; g.filter = 'invert(1)'; g.drawImage(e.img, 0, 0);
  } else {
    const prev = mipOf(e, lvl - 1, invert), pw = (prev as any).naturalWidth ?? (prev as HTMLCanvasElement).width, ph = (prev as any).naturalHeight ?? (prev as HTMLCanvasElement).height;
    c = document.createElement('canvas'); c.width = Math.max(1, Math.round(pw / 2)); c.height = Math.max(1, Math.round(ph / 2));
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(prev, 0, 0, c.width, c.height);
  }
  e.mips.set(key, c); return c;
}
