import { describe, it, expect } from 'vitest';
import { fixture } from './helpers.ts';
import { planDrawList, diagramDrawList, gridLayout, routeOrthogonal, portAnchor, bboxOf, STUB, type DrawList } from '../src/render/drawlist.ts';
import { SpatialIndex } from '../src/render/spatial.ts';
import { exportPlanSvg } from '../src/render/svgExport.ts';
import { syntheticProject } from '../src/synthetic.ts';

const isOrthogonal = (pts: number[]) => {
  for (let i = 0; i + 3 < pts.length; i += 2) if (pts[i] !== pts[i + 2] && pts[i + 1] !== pts[i + 3]) return false;
  return true;
};

describe('DrawList — plan (TS-07: dokładność skali)', () => {
  it('podest 8000×4000 mm w skali 1:100 ma w SVG 80×40 mm; salę 20×15 m obejmuje 200×150 mm', () => {
    const p = fixture('conference-mini.json');
    const dl = planDrawList(p);
    const stage = dl.prims.find((x) => x.t === 'rect' && x.id === 'stg_stage')!;
    expect(stage.t === 'rect' && [stage.w, stage.h]).toEqual([8000, 4000]);
    const svg = exportPlanSvg(dl, { scale: 100, paperWidthMm: 420, paperHeightMm: 297, origin: [0, 0] });
    const m = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*data-id="stg_stage"/)!;
    expect(Number(m[3])).toBeCloseTo(80, 3); // tolerancja z wymagań: 0,5 mm
    expect(Number(m[4])).toBeCloseTo(40, 3);
    // granica sali: polilinia 0..20000 × 0..15000 mm → 200×150 mm
    const poly = svg.match(/<polyline points="([^"]+)"[^>]*data-id="spc_hall"/)!;
    const xs = poly[1].trim().split(' ').map((s) => Number(s.split(',')[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 3);
    expect(svg).toContain('width="420mm"');
  });
  it('przesunięcie obiektu o 1000 mm w świecie = 10 mm na papierze (oś Y odwrócona)', () => {
    const p = fixture('conference-mini.json');
    const dl = planDrawList(p);
    const a = exportPlanSvg(dl, { scale: 100, paperWidthMm: 420, paperHeightMm: 297, origin: [0, 0] });
    const moved: DrawList = { ...dl, prims: dl.prims.map((x) => (x.t === 'rect' && x.id === 'eqi_cam1' ? { ...x, x: x.x + 1000, y: x.y + 1000 } : x)) };
    const b = exportPlanSvg(moved, { scale: 100, paperWidthMm: 420, paperHeightMm: 297, origin: [0, 0] });
    const get = (s: string) => { const r = s.match(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="[\d.]+"[^>]*data-id="eqi_cam1"/)!; return [Number(r[1]), Number(r[2])]; };
    const [ax, ay] = get(a), [bx, by] = get(b);
    expect(bx - ax).toBeCloseTo(10, 3);
    expect(ay - by).toBeCloseTo(10, 3); // Y w górę → mniejsze y na papierze
  });
  it('bbox obróconego prostokąta 400×300 o 90° ma 300×400', () => {
    const b = bboxOf({ t: 'rect', id: 'x', x: 0, y: 0, w: 400, h: 300, rot: 90, fill: '', stroke: '', lw: 1 });
    expect(b[2] - b[0]).toBeCloseTo(300, 6);
    expect(b[3] - b[1]).toBeCloseTo(400, 6);
  });
});

describe('DrawList — diagram', () => {
  const p = fixture('conference-mini.json');
  const v = {
    nodes: { eqi_cam1: { x: 0, y: 0 }, eqi_cam2: { x: 0, y: 160 }, eqi_mix1: { x: 320, y: 60 }, eqi_led1: { x: 680, y: 0 }, eqi_net1: { x: 680, y: 200 } },
  };
  it('krawędź jest rysowana tylko gdy oba końce mają węzły w widoku (pochodna, bez wiszących krawędzi)', () => {
    const full = diagramDrawList(p, v).prims.filter((x) => x.t === 'line').length;
    expect(full).toBe(5);
    const { eqi_net1, ...rest } = v.nodes;
    const part = diagramDrawList(p, { nodes: rest }).prims.filter((x) => x.t === 'line').map((x) => x.id);
    expect(part).not.toContain('cnx_4');
    expect(part).not.toContain('cnx_5');
    expect(part.length).toBe(3);
  });
  it('wszystkie krawędzie są ortogonalne, także gdy cel jest za źródłem (obejście)', () => {
    for (const x of diagramDrawList(p, v).prims) if (x.t === 'line') expect(isOrthogonal(x.pts), x.id).toBe(true);
    const back = routeOrthogonal([300, 100, 'r'], [100, 40, 'l']);
    expect(isOrthogonal(back)).toBe(true);
    expect(back.length / 2).toBeGreaterThan(4); // zygzak z obejściem
    const same = routeOrthogonal([100, 50, 'r'], [400, 50, 'l']);
    expect(isOrthogonal(same)).toBe(true);
  });
  it('kotwice portów: wejścia na lewej, wyjścia na prawej krawędzi węzła; wyjście prostopadle o STUB', () => {
    const a = portAnchor(p, v, 'eqi_cam1', 'prt_sdiout')!;
    const b = portAnchor(p, v, 'eqi_mix1', 'prt_in1')!;
    expect(a[2]).toBe('r');
    expect(b[2]).toBe('l');
    expect(b[0]).toBe(v.nodes.eqi_mix1.x);
    const route = routeOrthogonal(a, b);
    expect(route.slice(0, 2)).toEqual([a[0], a[1]]);
    expect(route.slice(-2)).toEqual([b[0], b[1]]);
    expect(STUB).toBeGreaterThan(0);
  });
  it('zmiana etykiety portu w modelu nie zmienia geometrii krawędzi (tożsamość po ID)', () => {
    const before = diagramDrawList(p, v).prims.filter((x) => x.t === 'line');
    const q = JSON.parse(JSON.stringify(p));
    q.definitions.eqd_mixer.revisions['1'].ports.prt_in1.label = 'INNA ETYKIETA';
    const after = diagramDrawList(q, v).prims.filter((x) => x.t === 'line');
    expect(after).toEqual(before);
  });
});

describe('indeks przestrzenny (R-drzewo)', () => {
  const dl = planDrawList(syntheticProject(2000, 5000, 1, true), { cables: true });
  const idx = new SpatialIndex(dl.prims);
  it('zapytanie o okno zwraca dokładnie prymitywy przecinające okno, w kolejności rysowania', () => {
    const win: [number, number, number, number] = [5000, 5000, 12000, 9000];
    const got = idx.query(...win);
    const expected = dl.prims.map((p, i) => ({ b: bboxOf(p), i })).filter(({ b }) => !(b[2] < win[0] || b[0] > win[2] || b[3] < win[1] || b[1] > win[3])).map((x) => x.i);
    expect(got).toEqual(expected);
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });
  it('trafienie: środek obróconego prostokąta trafia w niego, puste miejsce w nic', () => {
    const rects = dl.prims.map((p, i) => ({ p, i })).filter((x) => x.p.t === 'rect' && x.p.id.startsWith('eqi_'));
    const { p, i } = rects[7];
    if (p.t !== 'rect') throw new Error();
    expect(idx.hit(p.x, p.y, 1)).toBe(i);
    expect(idx.hit(-50000, -50000, 10)).toBe(-1);
  });
  it('przesunięcie aktualizuje indeks: stare miejsce puste, nowe trafia', () => {
    const rects = dl.prims.map((p, i) => ({ p, i })).filter((x) => x.p.t === 'rect');
    const { p, i } = rects[3];
    if (p.t !== 'rect') throw new Error();
    const ox = p.x, oy = p.y;
    idx.move([i], 90000, 90000);
    expect(idx.hit(p.x, p.y, 1)).toBe(i);
    expect(idx.hit(ox, oy, 1)).not.toBe(i);
    idx.move([i], -90000, -90000);
    expect(idx.hit(ox, oy, 1)).toBe(i);
  });
});
