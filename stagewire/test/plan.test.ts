import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan, placementKey, spaceSize, snap } from '../src/plan.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'K1', 'eqi_k1')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_m')); s.dispatch('c', addFromCatalog('monitor_hdmi', 'Mon', 'eqi_mon'));
  s.dispatch('s', plan.addSpace('spc_hall', 'Sala główna', 20000, 12000));
  return s;
};

describe('plan sali', () => {
  it('sala prostokątna ma wymiary; walidacja rozmiaru i nazwy', () => {
    const s = mk(); expect(spaceSize(s.state, 'spc_hall')).toEqual({ widthMm: 20000, depthMm: 12000 });
    expect(() => s.dispatch('x', plan.addSpace('spc_x', 'Mała', 500, 500))).toThrow();
    expect(() => s.dispatch('x', plan.addSpace('spc_x', ' ', 5000, 5000))).toThrow();
    s.dispatch('e', plan.editSpace('spc_hall', 'Hala', 30000, 12000)); expect(spaceSize(s.state, 'spc_hall')!.widthMm).toBe(30000);
  });
  it('ustawienie, przesunięcie, obrót i zdjęcie z planu; rysowanie planu; cofanie', () => {
    const s = mk();
    s.dispatch('p', plan.place('eqi_k1', 'spc_hall', 1000, 2000));
    s.dispatch('p', plan.place('eqi_k1', 'spc_hall', 3000, 2000)); expect(Object.keys(s.state.placements!).length).toBe(1);
    s.dispatch('r', plan.rotate('eqi_k1', 90)); expect(s.state.placements![placementKey('eqi_k1')].rotationDeg).toBe(90);
    s.dispatch('r', plan.rotate('eqi_k1', -180)); expect(s.state.placements![placementKey('eqi_k1')].rotationDeg).toBe(270);
    const dl = planDrawList(s.state); expect(dl.prims.some((q) => q.t === 'rect' && q.id === 'eqi_k1' && q.x === 3000)).toBe(true);
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    s.undo(); s.undo(); expect(s.state.placements![placementKey('eqi_k1')].position.x).toBe(3000);
    s.undo(); expect(s.state.placements![placementKey('eqi_k1')].position.x).toBe(1000);
    s.dispatch('u', plan.unplace('eqi_k1')); expect(Object.keys(s.state.placements ?? {}).length).toBe(0);
    expect(() => s.dispatch('p', plan.place('eqi_zz', 'spc_hall', 0, 0))).toThrow();
    expect(() => s.dispatch('p', plan.place('eqi_k1', 'spc_no', 0, 0))).toThrow();
  });
  it('rozmieszczenie brakujących mieści się w sali i nie rusza ustawionych; usunięcie urządzenia kasuje rozmieszczenie; zapis/odczyt', () => {
    const s = mk(); s.dispatch('p', plan.place('eqi_k1', 'spc_hall', 5000, 5000));
    s.dispatch('m', plan.placeMissing('spc_hall'));
    expect(Object.keys(s.state.placements!).length).toBe(3); expect(s.state.placements![placementKey('eqi_k1')].position.x).toBe(5000);
    for (const pl of Object.values<any>(s.state.placements!)) { expect(pl.position.x).toBeGreaterThan(0); expect(pl.position.x).toBeLessThan(20000); }
    expect(s.dispatch('m', plan.placeMissing('spc_hall'))).toBe(0);
    s.dispatch('d', cmd.removeInstance('eqi_m')); expect(s.state.placements![placementKey('eqi_m')]).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
    expect(openProject(packProject(s.state)).status).toBe('ok');
  });
  it('przyciąganie do siatki', () => { expect(snap(149)).toBe(100); expect(snap(151)).toBe(200); expect(snap(-260)).toBe(-300); });
});
