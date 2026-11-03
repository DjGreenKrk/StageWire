import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { groupCmd, groupsOf, autoLayout, groupFrames } from '../src/groups.ts';
import { setNodePositions } from '../src/layout.ts';
import { gridLayout } from '../src/render/drawlist.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'Kamera 1', 'eqi_k')); s.dispatch('b', addFromCatalog('video_switcher', 'Mikser', 'eqi_m')); s.dispatch('c', addFromCatalog('camera_sdi', 'Kamera 2', 'eqi_k2')); s.dispatch('d', addFromCatalog('camera_sdi', 'Luzem', 'eqi_l'));
  s.dispatch('e', cmd.connect({ instanceId: 'eqi_k', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('f', cmd.connect({ instanceId: 'eqi_k2', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin2' }, 'std/sdi-3g'));
  s.dispatch('s', plan.addSpace('spc_a', 'Scena', 10000, 8000)); s.dispatch('t', plan.addSpace('spc_b', 'FOH', 6000, 5000));
  s.dispatch('p', plan.place('eqi_k', 'spc_a', 1000, 1000)); s.dispatch('q', plan.place('eqi_k2', 'spc_a', 3000, 1000)); s.dispatch('r', plan.place('eqi_m', 'spc_b', 1000, 1000));
  return s;
};

describe('grupy i porządkowanie schematu', () => {
  it('urządzenie jest w jednej grupie; zmiana składu przenosi je z poprzedniej', () => {
    const s = mk();
    s.dispatch('g', groupCmd.add('grp_a', 'Scena', ['eqi_k', 'eqi_k2']));
    s.dispatch('g', groupCmd.add('grp_b', 'FOH', ['eqi_k2', 'eqi_m']));
    const g = Object.fromEntries(groupsOf(s.state)); expect(g.grp_a.members).toEqual(['eqi_k']); expect(g.grp_b.members).toEqual(['eqi_k2', 'eqi_m']);
    expect(() => s.dispatch('g', groupCmd.add('grp_c', 'FOH', []))).toThrow(/już istnieje/);
    expect(schemaErrors(s.state)).toEqual([]);
  });
  it('„Grupy wg sal” tworzy grupę na salę i zastępuje poprzednie automatyczne', () => {
    const s = mk(); let n = 0;
    const ids = (k: number) => Array.from({ length: k }, () => `grp_${++n}`);
    s.dispatch('g', groupCmd.fromRooms(ids)); s.dispatch('g', groupCmd.fromRooms(ids));
    const gs = groupsOf(s.state); expect(gs.map(([, g]) => g.name).sort()).toEqual(['FOH', 'Scena']); expect([...gs.find(([, g]) => g.name === 'Scena')![1].members].sort()).toEqual(['eqi_k', 'eqi_k2']);
  });
  it('porządkowanie: źródła po lewej, odbiornik z prawej, bez połączeń pod spodem; grupy w osobnych pasach', () => {
    const s = mk(); const pos = autoLayout(s.state);
    expect(pos.eqi_k.x).toBeLessThan(pos.eqi_m.x); expect(pos.eqi_k2.x).toBe(pos.eqi_k.x); expect(pos.eqi_l.y).toBeGreaterThan(pos.eqi_m.y);
    s.dispatch('g', groupCmd.add('grp_a', 'Scena', ['eqi_k'])); s.dispatch('g', groupCmd.add('grp_b', 'Reszta', ['eqi_k2', 'eqi_m']));
    const p2 = autoLayout(s.state); expect(p2.eqi_k.y).toBeLessThan(p2.eqi_k2.y);
    s.dispatch('l', setNodePositions(p2));
    const v = gridLayout(s.state); for (const [k, n] of Object.entries(p2)) v.nodes[k] = n;
    expect(groupFrames(s.state, v).filter((x) => x.t === 'rect').length).toBe(2);
  });
});
