import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { setNodePositions, syncLayout, nodeKey, VIEW_ID } from '../src/layout.ts';
import { gridLayout } from '../src/render/drawlist.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'K1', 'eqi_k1')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_m')); return s; };

describe('układ diagramu w projekcie (Q-28)', () => {
  it('przesunięcie to krok cofania; zapis/odczyt zachowuje pozycje; schemat i niezmienniki OK', () => {
    const s = mk();
    s.dispatch('m', setNodePositions({ eqi_k1: { x: 10.4, y: 20 } }));
    expect(s.state.views![VIEW_ID].nodes[nodeKey('eqi_k1')]).toEqual({ instanceId: 'eqi_k1', x: 10, y: 20 });
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok');
    const v = { nodes: {} as any }; if (back.status === 'ok') { syncLayout(back.project, v, () => gridLayout(back.project)); expect(v.nodes.eqi_k1).toEqual({ x: 10, y: 20 }); expect(v.nodes.eqi_m).toBeDefined(); }
    s.undo(); expect(s.state.views?.[VIEW_ID]?.nodes?.[nodeKey('eqi_k1')]).toBeUndefined();
    s.redo(); expect(s.state.views![VIEW_ID].nodes[nodeKey('eqi_k1')].x).toBe(10);
  });
  it('bez zmiany pozycji brak wpisu w historii; usunięcie urządzenia czyści węzeł', () => {
    const s = mk(); s.dispatch('m', setNodePositions({ eqi_k1: { x: 1, y: 2 } }));
    expect(s.dispatch('m2', setNodePositions({ eqi_k1: { x: 1, y: 2 } }))).toBe(0);
    s.dispatch('d', cmd.removeInstance('eqi_k1'));
    expect(s.state.views![VIEW_ID].nodes[nodeKey('eqi_k1')]).toBeUndefined(); expect(checkInvariants(s.state)).toEqual([]);
    const v = { nodes: { eqi_k1: { x: 1, y: 2 } } as any }; syncLayout(s.state, v, () => gridLayout(s.state)); expect(v.nodes.eqi_k1).toBeUndefined();
  });
});
