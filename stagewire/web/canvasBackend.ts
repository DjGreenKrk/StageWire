import { SpatialIndex } from '../src/render/spatial.ts';
import type { DrawList } from '../src/render/drawlist.ts';
import type { Camera, Backend } from './types.ts';

/** Canvas 2D + R-drzewo + LOD. Rysuje tylko prymitywy z okna widoku. */
export class CanvasBackend implements Backend {
  name = 'canvas';
  drawn = 0;
  #ctx: CanvasRenderingContext2D;
  #idx!: SpatialIndex;
  #w: number;
  #h: number;
  #canvas: HTMLCanvasElement;
  /** Rysowanie pod prymitywami, w układzie świata (np. podkład z pliku). */
  underlay?: (ctx: CanvasRenderingContext2D) => void;

  constructor(host: HTMLElement, w: number, h: number) {
    this.#w = w; this.#h = h;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.style.cssText = `width:${w}px;height:${h}px;display:block`;
    host.appendChild(canvas); this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d', { alpha: false })!;
  }

  /** Zmiana rozmiaru (np. okno powiększone na pełny ekran). */
  resize(w: number, h: number) { this.#w = w; this.#h = h; this.#canvas.width = w; this.#canvas.height = h; this.#canvas.style.width = w + 'px'; this.#canvas.style.height = h + 'px'; }
  load(dl: DrawList) { this.#idx = new SpatialIndex(dl.prims); }
  index() { return this.#idx; }

  render(cam: Camera) {
    const ctx = this.#ctx, z = cam.zoom, flip = cam.flipY ? -1 : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.#w, this.#h);
    // świat → ekran: sx = (wx - cx) * z + w/2 ; sy = flip * (wy - cy) * z + h/2
    ctx.setTransform(z, 0, 0, flip * z, this.#w / 2 - cam.x * z, this.#h / 2 - flip * cam.y * z);
    this.underlay?.(ctx);
    const hw = this.#w / 2 / z, hh = this.#h / 2 / z;
    const idx = this.#idx.query(cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh);
    this.drawn = idx.length;
    const prims = this.#idx.prims, px = 1 / z;
    for (let k = 0; k < idx.length; k++) {
      const p = prims[idx[k]];
      switch (p.t) {
        case 'rect': {
          if (p.w * z < 1.5 && p.h * z < 1.5) { ctx.fillStyle = p.stroke; ctx.fillRect(p.x, p.y, px * 1.5, px * 1.5); break; }
          ctx.save();
          ctx.translate(p.x, p.y);
          if (p.rot) ctx.rotate(flip * -(p.rot * Math.PI) / 180);
          if (p.round) { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fillStyle = p.fill; ctx.fill(); ctx.lineWidth = Math.max(p.lw * px, px); ctx.strokeStyle = p.stroke; ctx.stroke(); ctx.restore(); break; }
          ctx.fillStyle = p.fill; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.lineWidth = Math.max(p.lw * px, px); ctx.strokeStyle = p.stroke; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
          break;
        }
        case 'line': {
          ctx.beginPath(); ctx.moveTo(p.pts[0], p.pts[1]);
          for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
          ctx.lineWidth = Math.max(p.lw * px, px); ctx.strokeStyle = p.stroke; ctx.stroke();
          break;
        }
        case 'dot': {
          if (p.r * z < 0.7) break;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fillStyle = p.fill; ctx.fill();
          break;
        }
        case 'text': {
          if (p.size * z < 5) break; // LOD: nieczytelny tekst pomijamy
          ctx.font = `${p.size}px Roboto, sans-serif`; ctx.fillStyle = p.color;
          if (flip < 0) { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, -1); ctx.fillText(p.s, 0, 0); ctx.restore(); }
          else ctx.fillText(p.s, p.x, p.y);
          break;
        }
      }
    }
  }

  move(ids: number[], dx: number, dy: number) { this.#idx.move(ids, dx, dy); }
}
