import type { DrawList, Prim } from '../src/render/drawlist.ts';
import { bboxOf } from '../src/render/drawlist.ts';
import type { Camera, Backend } from './types.ts';

const NS = 'http://www.w3.org/2000/svg';
const pts = (a: number[]) => { let s = ''; for (let i = 0; i < a.length; i += 2) s += a[i] + ',' + a[i + 1] + ' '; return s; };

function make(p: Prim): SVGElement {
  switch (p.t) {
    case 'rect': {
      const e = document.createElementNS(NS, p.round ? 'ellipse' : 'rect');
      if (p.round) { e.setAttribute('cx', '0'); e.setAttribute('cy', '0'); e.setAttribute('rx', String(p.w / 2)); e.setAttribute('ry', String(p.h / 2)); }
      else { e.setAttribute('x', String(-p.w / 2)); e.setAttribute('y', String(-p.h / 2)); e.setAttribute('width', String(p.w)); e.setAttribute('height', String(p.h)); }
      e.setAttribute('fill', p.fill); e.setAttribute('stroke', p.stroke); e.setAttribute('stroke-width', String(p.lw));
      e.setAttribute('vector-effect', 'non-scaling-stroke');
      e.setAttribute('transform', `translate(${p.x} ${p.y})${p.rot ? ` rotate(${-p.rot})` : ''}`);
      return e;
    }
    case 'line': {
      const e = document.createElementNS(NS, 'polyline');
      e.setAttribute('points', pts(p.pts)); e.setAttribute('fill', 'none'); e.setAttribute('stroke', p.stroke);
      e.setAttribute('stroke-width', String(p.lw)); e.setAttribute('vector-effect', 'non-scaling-stroke');
      return e;
    }
    case 'dot': {
      const e = document.createElementNS(NS, 'circle');
      e.setAttribute('cx', String(p.x)); e.setAttribute('cy', String(p.y)); e.setAttribute('r', String(p.r)); e.setAttribute('fill', p.fill);
      return e;
    }
    case 'text': {
      const e = document.createElementNS(NS, 'text');
      e.setAttribute('x', String(p.x)); e.setAttribute('y', String(p.y)); e.setAttribute('font-size', String(p.size));
      e.setAttribute('fill', p.color); e.setAttribute('font-family', 'Roboto, sans-serif'); e.textContent = p.s;
      return e;
    }
  }
}

/**
 * SVG w dwóch wariantach:
 *  - naiwny: wszystkie elementy w DOM, kamera = transform na <g> (DOM+SVG);
 *  - z wirtualizacją: w DOM tylko okno 1,6x widoku; przebudowa po wyjściu z okna lub zmianie zoomu o więcej niż 2x.
 */
export class SvgBackend implements Backend {
  name: string;
  drawn = 0;
  #g: SVGGElement;
  #dl!: DrawList;
  #w: number;
  #h: number;
  #culled: boolean;
  #els: (SVGElement | null)[] = [];
  #bbox: number[][] = [];
  #win: [number, number, number, number] | null = null;
  #winZoom = 0;

  constructor(host: HTMLElement, w: number, h: number, culled: boolean) {
    this.#w = w; this.#h = h; this.#culled = culled; this.name = culled ? 'svg-culled' : 'svg-naive';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
    svg.style.cssText = 'background:#000;display:block';
    this.#g = document.createElementNS(NS, 'g');
    svg.appendChild(this.#g);
    host.appendChild(svg);
  }

  load(dl: DrawList) {
    this.#dl = dl; this.#bbox = dl.prims.map(bboxOf);
    if (!this.#culled) {
      const frag = document.createDocumentFragment();
      this.#els = dl.prims.map((p) => { const e = make(p); frag.appendChild(e); return e; });
      this.#g.appendChild(frag);
      this.drawn = dl.prims.length;
    } else {
      this.#els = new Array(dl.prims.length).fill(null);
    }
  }

  #rebuild(cam: Camera) {
    const z = cam.zoom, hw = (this.#w / 2 / z) * 1.6, hh = (this.#h / 2 / z) * 1.6;
    this.#win = [cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh];
    this.#winZoom = z;
    this.#g.replaceChildren();
    const frag = document.createDocumentFragment();
    let n = 0;
    const b = this.#bbox, [x0, y0, x1, y1] = this.#win;
    for (let i = 0; i < b.length; i++) {
      if (b[i][2] < x0 || b[i][0] > x1 || b[i][3] < y0 || b[i][1] > y1) continue;
      const p = this.#dl.prims[i];
      if (p.t === 'text' && p.size * z < 5) continue; // ten sam LOD co w canvas
      const e = this.#els[i] ?? (this.#els[i] = make(p));
      frag.appendChild(e); n++;
    }
    this.#g.appendChild(frag);
    this.drawn = n;
  }

  render(cam: Camera) {
    const z = cam.zoom, flip = cam.flipY ? -1 : 1;
    if (this.#culled) {
      const hw = this.#w / 2 / z, hh = this.#h / 2 / z, w = this.#win;
      if (!w || cam.x - hw < w[0] || cam.x + hw > w[2] || cam.y - hh < w[1] || cam.y + hh > w[3] || z / this.#winZoom > 2 || z / this.#winZoom < 0.5) this.#rebuild(cam);
    }
    this.#g.setAttribute('transform', `translate(${this.#w / 2 - cam.x * z} ${this.#h / 2 - flip * cam.y * z}) scale(${z} ${flip * z})`);
  }

  move(ids: number[], dx: number, dy: number) {
    for (const i of ids) {
      const p = this.#dl.prims[i];
      if (p.t === 'line') for (let k = 0; k < p.pts.length; k += 2) { p.pts[k] += dx; p.pts[k + 1] += dy; } else { p.x += dx; p.y += dy; }
      this.#bbox[i] = bboxOf(p);
      const e = this.#els[i];
      if (!e) continue;
      if (p.t === 'rect') e.setAttribute('transform', `translate(${p.x} ${p.y})${p.rot ? ` rotate(${-p.rot})` : ''}`);
      else if (p.t === 'text') { e.setAttribute('x', String(p.x)); e.setAttribute('y', String(p.y)); }
      else if (p.t === 'dot') { e.setAttribute('cx', String(p.x)); e.setAttribute('cy', String(p.y)); }
      else e.setAttribute('points', pts(p.pts));
    }
  }
}
