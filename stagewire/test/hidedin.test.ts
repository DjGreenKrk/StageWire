import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/store.ts';
import { installPack, unloadPack, addFromCatalog } from '../src/catalog/index.ts';
import { cabCmd, setHideMountedDin } from '../src/cabinets.ts';
import { cmd } from '../src/commands.ts';
import { syntheticProject } from '../src/synthetic.ts';
import { diagramDrawList, hiddenOnDiagram, gridLayout } from '../src/render/drawlist.ts';
import { schemaErrors } from '../src/format.ts';
import { UPGRADES, pendingUpgrades, upgradeCmd } from '../src/migrations.ts';
import { autoLayout } from '../src/groups.ts';
import type { Project } from '../src/types.ts';

const term = (key: string, label: string, signal: string, direction: string) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const dev = (key: string, model: string, dinModules: number | undefined, ports: any[]) => ({ key, manufacturer: 'Fikcyjny', model, category: 'zasilanie', dimensionsMm: { width: 17.5 * (dinModules ?? 4), depth: 60, height: 90 }, ...(dinModules ? { dinModules } : {}), ports, source: { kind: 'custom' } });
beforeAll(() => {
  const r = installPack({ format: 'stagewire-pack/1', id: 'hide-test', name: 'T', version: '1.0.0', license: 'własne', devices: [
    dev('psu', 'Zasilacz', 2, [term('in', 'L/N', 'std/power-ac', 'in'), term('out', '+24 V', 'std/power-dc', 'out')]),
    dev('src', 'Zasilanie sieciowe', undefined, [term('out', 'L/N', 'std/power-ac', 'out')]),
    dev('led', 'Sterownik', 3, [term('in', '+24 V', 'std/power-dc', 'in')]),
  ] });
  expect(r.errors).toEqual([]);
});
afterAll(() => unloadPack('hide-test'));

// źródło (poza szafą) → zasilacz (w szafie) → sterownik (w szafie)
const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.equipment = {}; p.connections = {}; p.cables = {}; p.placements = {};
  const s = new Store(p);
  s.dispatch('c', cabCmd.addCabinet('cab_a', { name: 'Szafa A', widthMm: 300, heightMm: 350, depthMm: 120, rows: 2, modules: 12 }));
  for (const [k, id] of [['src', 'eqi_s'], ['psu', 'eqi_p'], ['led', 'eqi_l']] as const) s.dispatch('a', addFromCatalog('hide-test/' + k, id, id));
  s.dispatch('m', cabCmd.mount('eqi_p', { cabinetId: 'cab_a', row: 1, at: 1 })); s.dispatch('m', cabCmd.mount('eqi_l', { cabinetId: 'cab_a', row: 1, at: 4 }));
  const port = (i: string, label: string) => { const q = s.state.equipment[i], rev = s.state.definitions[q.definitionId].revisions[String(q.definitionRevision)]; return { instanceId: i, portId: Object.entries(rev.ports).find(([, x]) => x.label === label)![0] }; };
  s.dispatch('k', cmd.connect(port('eqi_s', 'L/N'), port('eqi_p', 'L/N'), 'std/power-ac', { id: 'cnx_1' }));
  s.dispatch('k', cmd.connect(port('eqi_p', '+24 V'), port('eqi_l', '+24 V'), 'std/power-dc', { id: 'cnx_2' }));
  return s;
};
const view = (p: Project) => ({ nodes: gridLayout(p).nodes });
const nodeIds = (p: Project) => new Set(diagramDrawList(p, view(p)).prims.filter((x) => x.t === 'rect').map((x) => x.id));
const edgeCount = (p: Project) => diagramDrawList(p, view(p)).prims.filter((x) => x.t === 'line').length;

describe('ukrywanie osprzętu z szaf na schemacie', () => {
  it('domyślnie (projekt bez ustawienia) wszystko jest widoczne, jak dotąd', () => {
    const p = mk().state; expect(nodeIds(p)).toEqual(new Set(['eqi_s', 'eqi_p', 'eqi_l'])); expect(edgeCount(p)).toBe(2);
  });
  it('z ustawieniem znika zamontowany osprzęt i jego krawędzie; niezamontowany zostaje', () => {
    const s = mk(); s.dispatch('h', setHideMountedDin(true));
    expect(nodeIds(s.state)).toEqual(new Set(['eqi_s'])); expect(edgeCount(s.state)).toBe(0);
    expect(hiddenOnDiagram(s.state, 'eqi_p')).toBe(true); expect(hiddenOnDiagram(s.state, 'eqi_s')).toBe(false);
  });
  it('zdjęcie z szyny przywraca widoczność; cofnięcie przywraca stan sprzed', () => {
    const s = mk(); s.dispatch('h', setHideMountedDin(true)); s.dispatch('u', cabCmd.unmount('eqi_p'));
    expect(nodeIds(s.state).has('eqi_p')).toBe(true); expect(edgeCount(s.state)).toBe(1);
    s.undo(); s.undo(); expect(nodeIds(s.state).size).toBe(3);
  });
  it('szafa jako blok nadal działa (osprzęt ukryty, terminale wchodzą w blok)', () => {
    const s = mk(); s.dispatch('b', cabCmd.setBlock('cab_a', true)); s.dispatch('h', setHideMountedDin(true));
    const v = view(s.state); v.nodes.cab_a = { x: 400, y: 0 };
    expect(new Set(diagramDrawList(s.state, v).prims.filter((x) => x.t === 'rect').map((x) => x.id))).toEqual(new Set(['eqi_s', 'cab_a']));
  });
  it('układanie automatyczne nie bierze ukrytych węzłów', () => {
    const s = mk(); s.dispatch('h', setHideMountedDin(true));
    const keys = Object.keys(autoLayout(s.state));
    expect(keys.includes('eqi_p')).toBe(false);
  });
  it('ustawienie jest zgodne ze schematem i przeżywa zapis', () => {
    const s = mk(); s.dispatch('h', setHideMountedDin(true)); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    expect((s.state.settings as any).hideMountedDin).toBe(true);
    s.dispatch('h', setHideMountedDin(false)); expect((s.state.settings as any).hideMountedDin).toBeUndefined();
  });
});

describe('ulepszenie „hide-mounted-din”', () => {
  it('jest zarejestrowane, dotyczy tylko projektów z osprzętem w szafie i nie dotyczy już zastosowanych', () => {
    expect(UPGRADES.some((u) => u.id === 'hide-mounted-din')).toBe(true);
    const s = mk(); expect(pendingUpgrades(s.state).map((u) => u.id)).toContain('hide-mounted-din');
    s.dispatch('a', upgradeCmd.apply(['hide-mounted-din'])); expect(pendingUpgrades(s.state).map((u) => u.id)).not.toContain('hide-mounted-din');
    expect(nodeIds(s.state)).toEqual(new Set(['eqi_s']));
    s.undo(); expect(nodeIds(s.state).size).toBe(3);
    const empty = new Store(syntheticProject(0, 0, 1, true) as Project); expect(pendingUpgrades(empty.state).map((u) => u.id)).not.toContain('hide-mounted-din');
  });
});
