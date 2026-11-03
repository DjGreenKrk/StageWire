import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

describe('etykieta i numer kabla', () => {
  it('etykieta, numer i długość przechodzą schemat i zapis/odczyt; duplikat numeru odrzucony; cofanie działa', () => {
    const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {};
    const s = new Store(p);
    s.dispatch('a', addFromCatalog('camera_sdi', 'K1', 'eqi_k1')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_m'));
    s.dispatch('c', cmd.connect({ instanceId: 'eqi_k1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
    s.dispatch('d', cmd.connect({ instanceId: 'eqi_k1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin2' }, 'std/sdi-3g'));
    const [c1, c2] = Object.keys(s.state.connections), [k1, k2] = [c1, c2].map((c) => s.state.connections[c].cableId!);
    s.dispatch('l', cmd.setConnectionLabel(c1, '  PGM ')); s.dispatch('n', cmd.setCableNumber(k1, 'K-01')); s.dispatch('m', cmd.setCableLengths(k1, { lengthMm: 25000 }));
    expect(s.state.connections[c1].label).toBe('PGM');
    expect(() => s.dispatch('x', cmd.setCableNumber(k2, 'K-01'))).toThrow();
    expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok');
    if (back.status === 'ok') { expect(back.project.connections[c1].label).toBe('PGM'); expect(back.project.cables[k1].number).toBe('K-01'); }
    s.dispatch('e', cmd.setConnectionLabel(c1, '')); expect(s.state.connections[c1].label).toBeUndefined();
    s.undo(); expect(s.state.connections[c1].label).toBe('PGM');
  });
});
