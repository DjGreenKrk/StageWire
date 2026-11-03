import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { plan } from '../src/plan.ts';
import { stageCmd } from '../src/stage.ts';
import { buildScene } from '../src/view3d.ts';
import { topAt, followSurface, routeZAt, insideBox } from '../src/surface.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.spaces = {}; p.stageObjects = {}; const s = new Store(p); s.dispatch('s', plan.addSpace('spc_h', 'Hala', 20000, 10000, 8000)); return s; };
const add = (s: Store, id: string, o: any, x: number, y: number, rot = 0, z = 0) => { s.dispatch('o', stageCmd.addObject(id, { name: id, ...o })); s.dispatch('p', plan.placeRack(id, 'spc_h', x, y, rot, z)); };

describe('trasa po bryle', () => {
  it('górna powierzchnia: kostka, walec (elipsa), obrót; poza bryłą undefined; wyższa bryła wygrywa', () => {
    const s = mk(); add(s, 'sob_a', { widthMm: 1000, depthMm: 1000, heightMm: 800 }, 5000, 5000); add(s, 'sob_c', { widthMm: 1000, depthMm: 1000, heightMm: 3000, shape: 'cylinder' }, 10000, 5000);
    add(s, 'sob_d', { widthMm: 2000, depthMm: 400, heightMm: 500 }, 15000, 5000, 90);
    const bx = buildScene(s.state, 'spc_h').boxes;
    expect(topAt(bx, 5400, 5400)).toBe(800); expect(topAt(bx, 5600, 5000)).toBeUndefined();
    expect(topAt(bx, 10000, 5000)).toBe(3000); expect(topAt(bx, 10450, 5450)).toBeUndefined(); // róg kwadratu poza kołem
    expect(topAt(bx, 15000, 5900)).toBe(500); expect(topAt(bx, 15900, 5000)).toBeUndefined(); // obrót o 90°: długi bok wzdłuż Y
    add(s, 'sob_e', { widthMm: 500, depthMm: 500, heightMm: 1200 }, 5000, 5000, 0, 800); // kostka na kostce
    expect(topAt(buildScene(s.state, 'spc_h').boxes, 5000, 5000)).toBe(2000);
    expect(routeZAt(bx, 5400, 5400, 1000)).toBe(1000); expect(routeZAt(bx, 5400, 5400, 100)).toBe(800); expect(routeZAt(bx, 100, 100, 50)).toBe(50);
  });
  it('po płaskim terenie trasa to jeden punkt końcowy; wejście na kostkę i zejście dają piony na krawędziach', () => {
    const s = mk(); add(s, 'sob_a', { widthMm: 2000, depthMm: 2000, heightMm: 800 }, 5000, 5000); const bx = buildScene(s.state, 'spc_h').boxes;
    expect(followSurface(bx, [1000, 1000, 0], 3000, 1000, 0)).toEqual([[3000, 1000, 0]]);
    const over = followSurface(bx, [2000, 5000, 0], 8000, 5000, 0);
    expect(over).toEqual([[4000, 5000, 0], [4000, 5000, 800], [6000, 5000, 800], [6000, 5000, 0], [8000, 5000, 0]]);
  });
  it('schody: kabel wchodzi po stopniach (pion na każdej krawędzi stopnia), wysokości rosną co h/N', () => {
    const s = mk(); add(s, 'sob_s', { widthMm: 4000, depthMm: 2000, heightMm: 1000, shape: 'stairs', steps: 4 }, 5000, 5000); const bx = buildScene(s.state, 'spc_h').boxes;
    // schody: y od 4000 do 6000, stopnie po 500 mm; wysokości 250/500/750/1000
    const up = followSurface(bx, [5000, 3000, 0], 5000, 5800, 0);
    expect(up).toEqual([[5000, 4000, 0], [5000, 4000, 250], [5000, 4500, 250], [5000, 4500, 500], [5000, 5000, 500], [5000, 5000, 750], [5000, 5500, 750], [5000, 5500, 1000], [5000, 5800, 1000]]);
    const len = [[5000, 3000, 0], ...up].slice(1).reduce((a, q, i, arr) => a + Math.hypot(q[0] - (i ? arr[i - 1][0] : 5000), q[1] - (i ? arr[i - 1][1] : 3000), q[2] - (i ? arr[i - 1][2] : 0)), 0);
    expect(Math.round(len)).toBe(2800 + 1000); // poziomo 2,8 m + 4 × 0,25 m w pionie
  });
  it('wysokość podłogi trasy (floorZ) wyżej niż bryły: trasa nie schodzi', () => {
    const s = mk(); add(s, 'sob_a', { widthMm: 2000, depthMm: 2000, heightMm: 800 }, 5000, 5000); const bx = buildScene(s.state, 'spc_h').boxes;
    expect(followSurface(bx, [2000, 5000, 3000], 8000, 5000, 3000)).toEqual([[8000, 5000, 3000]]);
  });
  it('insideBox dla schodów obróconych o 90°', () => {
    const s = mk(); add(s, 'sob_s', { widthMm: 4000, depthMm: 2000, heightMm: 1000, shape: 'stairs', steps: 4 }, 5000, 5000, 90); const bx = buildScene(s.state, 'spc_h').boxes;
    expect(bx.some((b) => insideBox(b, 5000, 3200))).toBe(true); expect(topAt(bx, 4100, 5000)).toBe(1000); expect(topAt(bx, 5900, 5000)).toBe(250); // obrót 90°: strona wysoka w stronę -X
  });
});
