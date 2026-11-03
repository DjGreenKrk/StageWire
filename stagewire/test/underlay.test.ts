import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { underlayCmd, underlaysOf, imageToWorld, worldToImage, parseDxf, type Underlay } from '../src/underlay.ts';
import { packProject, openProject } from '../src/format.ts';
import { checkInvariants } from '../src/invariants.ts';
import { syntheticProject } from '../src/synthetic.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const U: Underlay = { name: 'Parter', kind: 'image', source: 'parter.png', mime: 'image/png', image: PNG, widthPx: 1000, heightPx: 500, x: 0, y: 0, mmPerPx: 50, rotationDeg: 0, opacity: 0.5, invert: true, visible: true, locked: false, scaleKnown: false };
const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {}; p.spaces = {}; return new Store(p); };

describe('podkład: model i polecenia', () => {
  it('dodanie, zmiana, usunięcie; walidacja; format pliku zachowuje podkład (zapis i odczyt)', () => {
    const s = mk(); s.dispatch('a', underlayCmd.add('und_a', U)); expect(underlaysOf(s.state)).toHaveLength(1);
    s.dispatch('u', underlayCmd.update('und_a', { x: 1234.6, opacity: 0.8, locked: true, name: ' Parter 1 ' }));
    expect((s.state as any).underlays.und_a).toMatchObject({ x: 1235, opacity: 0.8, locked: true, name: 'Parter 1' });
    expect(() => s.dispatch('x', underlayCmd.update('und_a', { opacity: 0 }))).toThrow(/Przezroczystość/);
    expect(() => s.dispatch('x', underlayCmd.update('und_a', { mmPerPx: -1 }))).toThrow(/Skala/);
    expect(() => s.dispatch('x', underlayCmd.add('und_b', { ...U, image: 'http://x/y.png' }))).toThrow(/obrazem/);
    const r = openProject(packProject(s.state)); expect(r.status).toBe('ok'); expect((r as any).project.underlays.und_a.image).toBe(PNG);
    expect(checkInvariants(s.state)).toEqual([]);
    s.dispatch('r', underlayCmd.remove('und_a')); expect(underlaysOf(s.state)).toHaveLength(0); s.undo(); expect(underlaysOf(s.state)).toHaveLength(1);
  });
  it('skalowanie dwoma punktami: odległość zostaje równa rzeczywistej, pierwszy punkt na miejscu', () => {
    const s = mk(); s.dispatch('a', underlayCmd.add('und_a', { ...U, x: 1000, y: 2000 }));
    // na obrazie dwa punkty w odległości 400 px → 20 000 mm; użytkownik mówi, że to 10 000 mm
    const p1 = imageToWorld(U, 100, 100).map((v, i) => v + [1000, 2000][i]), p2 = [p1[0] + 20000, p1[1]];
    s.dispatch('s', underlayCmd.scaleByPoints('und_a', p1, p2, 10000));
    const u = (s.state as any).underlays.und_a; expect(u.mmPerPx).toBeCloseTo(25, 6); expect(u.scaleKnown).toBe(true);
    expect(imageToWorld(u, 100, 100)[0]).toBeCloseTo(p1[0], 0); expect(imageToWorld(u, 100, 100)[1]).toBeCloseTo(p1[1], 0); // punkt 1 nie ruszył się
    const q2 = imageToWorld(u, 500, 100); expect(Math.hypot(q2[0] - p1[0], q2[1] - p1[1])).toBeCloseTo(10000, 0);
    expect(() => s.dispatch('x', underlayCmd.scaleByPoints('und_a', p1, p1, 10))).toThrow(/dwa różne/);
  });
  it('obrót wokół punktu i przeliczenia obraz ↔ świat są odwrotne', () => {
    const u = { x: 500, y: -200, mmPerPx: 20, rotationDeg: 30 };
    for (const [px, py] of [[0, 0], [100, 40], [731, 512]]) { const w = imageToWorld(u, px, py), b = worldToImage(u, w[0], w[1]); expect(b[0]).toBeCloseTo(px, 6); expect(b[1]).toBeCloseTo(py, 6); }
    const s = mk(); s.dispatch('a', underlayCmd.add('und_a', U)); const pivot = [10000, 0], w0 = imageToWorld(U, 300, 200);
    s.dispatch('r', underlayCmd.rotateAbout('und_a', pivot, 90)); const u2 = (s.state as any).underlays.und_a, w1 = imageToWorld(u2, 300, 200);
    expect(u2.rotationDeg).toBe(90); expect(Math.hypot(w1[0] - pivot[0], w1[1] - pivot[1])).toBeCloseTo(Math.hypot(w0[0] - pivot[0], w0[1] - pivot[1]), 0);
    expect(w1[0]).toBeCloseTo(pivot[0] - (w0[1] - pivot[1]), 0); expect(w1[1]).toBeCloseTo(pivot[1] + (w0[0] - pivot[0]), 0);
  });
});

const dxf = (body: string, units = 4) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
describe('podkład: DXF', () => {
  it('LINE, LWPOLYLINE (zamknięta), POLYLINE z VERTEX, CIRCLE i ARC; granice i jednostki', () => {
    const body = ['0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1000\n21\n0\n',
      '0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n2000\n20\n0\n10\n2000\n20\n3000\n10\n0\n20\n3000\n',
      '0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n100\n20\n100\n0\nVERTEX\n10\n200\n20\n300\n0\nSEQEND\n',
      '0\nCIRCLE\n10\n5000\n20\n5000\n40\n500\n', '0\nARC\n10\n0\n20\n0\n40\n1000\n50\n0\n51\n90\n', '0\nTEXT\n10\n0\n20\n0\n1\nA\n'].join('');
    const r = parseDxf(dxf(body)); expect(r.entities).toBe(6); expect(r.skipped).toEqual({ TEXT: 1 });
    expect(r.polylines).toHaveLength(5); expect(r.polylines[0]).toEqual([[0, 0], [1000, 0]]);
    expect(r.polylines[1]).toHaveLength(5); expect(r.polylines[1][4]).toEqual([0, 0]); // domknięta
    expect(r.polylines[2]).toEqual([[100, 100], [200, 300]]);
    const circle = r.polylines[3]; expect(circle[0][0]).toBeCloseTo(5500, 3); expect(circle.at(-1)![0]).toBeCloseTo(5500, 3);
    const arc = r.polylines[4]; expect(arc[0]).toEqual([1000, 0]); expect(arc.at(-1)![0]).toBeCloseTo(0, 3); expect(arc.at(-1)![1]).toBeCloseTo(1000, 3);
    expect([r.minX, r.minY, r.maxX, r.maxY]).toEqual([0, 0, 5500, 5500]); expect(r.mmPerUnit).toBe(1); expect(r.units).toBe('mm');
  });
  it('jednostki z nagłówka: metry i cale; brak nagłówka = mm', () => {
    expect(parseDxf(dxf('0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n', 6))).toMatchObject({ mmPerUnit: 1000, units: 'm' });
    expect(parseDxf(dxf('0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n', 1))).toMatchObject({ mmPerUnit: 25.4, units: 'cale' });
    expect(parseDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n5\n21\n5\n0\nENDSEC\n0\nEOF\n')).toMatchObject({ mmPerUnit: 1, entities: 1 });
  });
  it('pusty lub uszkodzony plik nie wywala parsera', () => { expect(parseDxf('').polylines).toEqual([]); expect(parseDxf('śmieci\nbez sensu').entities).toBe(0); });
});
