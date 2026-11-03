import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog, definitionId } from '../src/catalog/index.ts';
import { saveDefinition, forkDefinition, impactOf, portDrafts, newPortId, renameInstance, type PortDraft } from '../src/definitions.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';
import type { Project } from '../src/types.ts';

const empty = (): Project => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; return p; };
const DEF = definitionId('video_switcher');

/** Projekt: dwie kamery SDI połączone z wejściami 1 i 2 miksera, oraz drugi mikser bez połączeń. */
function setup() {
  const s = new Store(empty());
  s.dispatch('k1', addFromCatalog('camera_sdi', 'K1', 'eqi_k1')); s.dispatch('k2', addFromCatalog('camera_sdi', 'K2', 'eqi_k2'));
  s.dispatch('m1', addFromCatalog('video_switcher', 'M1', 'eqi_m1')); s.dispatch('m2', addFromCatalog('video_switcher', 'M2', 'eqi_m2'));
  s.dispatch('c1', cmd.connect({ instanceId: 'eqi_k1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m1', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('c2', cmd.connect({ instanceId: 'eqi_k2', portId: 'prt_sdiout' }, { instanceId: 'eqi_m1', portId: 'prt_sdiin2' }, 'std/sdi-3g'));
  return s;
}
const ports = (s: Store) => portDrafts(s.state.definitions[DEF].revisions[String(s.state.definitions[DEF].latestRevision)]);

describe('edycja definicji z rewizjami', () => {
  it('dodanie portu = nowa rewizja strukturalna; instancje zostają na starej, dopóki ich nie przepniemy', () => {
    const s = setup(); const before = ports(s);
    const added: PortDraft = { id: newPortId(before.map((p) => p.id), 'SDI IN 9'), label: 'SDI IN 9', order: 99, connectorKey: 'std/bnc-75', signalKeys: ['std/sdi-3g'], direction: 'in', capacity: 1 };
    s.dispatch('def', saveDefinition(DEF, { ports: [...before, added] }, 'none'));
    const def = s.state.definitions[DEF];
    expect(def.latestRevision).toBe(2); expect(def.revisions['2'].changeClass).toBe('structural');
    expect(s.state.equipment['eqi_m1'].definitionRevision).toBe(1);
    expect(Object.keys(def.revisions['1'].ports).length).toBe(13); // rewizja 1 niezmienna
    expect(Object.keys(def.revisions['2'].ports).length).toBe(14);
    expect(impactOf(s.state, DEF, ports(s).map((p) => p.id))).toMatchObject({ instances: 2, outdated: 2, lostConnections: 0 });
  });

  it('zmiana samej nazwy portu = rewizja kosmetyczna', () => {
    const s = setup(); const ps = ports(s).map((p) => (p.id === 'prt_sdiin1' ? { ...p, label: 'CAM 1' } : p));
    s.dispatch('def', saveDefinition(DEF, { ports: ps }, 'none'));
    expect(s.state.definitions[DEF].revisions['2'].changeClass).toBe('cosmetic');
  });

  it('usunięcie połączonego portu: wpływ policzony z góry, upgrade usuwa połączenia i kabel, wszystko w jednym kroku cofania', () => {
    const s = setup(); const keep = ports(s).filter((p) => p.id !== 'prt_sdiin1');
    const imp = impactOf(s.state, DEF, keep.map((p) => p.id));
    expect(imp).toMatchObject({ lostConnections: 1, removedPorts: ['prt_sdiin1'] });
    s.dispatch('def', saveDefinition(DEF, { ports: keep }, 'all'));
    expect(Object.keys(s.state.connections).length).toBe(1);
    expect(Object.keys(s.state.cables).length).toBe(1); // kabel zerwanego połączenia usunięty
    expect(s.state.equipment['eqi_m1'].definitionRevision).toBe(2); expect(s.state.equipment['eqi_m2'].definitionRevision).toBe(2);
    expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); // jeden krok
    expect(Object.keys(s.state.connections).length).toBe(2); expect(s.state.definitions[DEF].latestRevision).toBe(1);
    expect(s.state.equipment['eqi_m1'].definitionRevision).toBe(1);
  });

  it('zmiana złącza portu dodaje wpisy rejestru i nadal spełnia schemat', () => {
    const s = setup(); const ps = ports(s).map((p) => (p.id === 'prt_lan' ? { ...p, connectorKey: 'std/hdmi-a', signalKeys: ['std/hdmi'] } : p));
    s.dispatch('def', saveDefinition(DEF, { ports: ps }, 'all'));
    expect(s.state.registries['std/hdmi-a']).toBeDefined(); expect(s.state.registries['std/hdmi']).toBeDefined();
    expect(s.state.registries['std/cable-hdmi']).toBeDefined(); // typ kabla dla nowego złącza
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
  });

  it('walidacja wejścia: port bez nazwy, bez sygnału lub z pojemnością 0 odrzuca całą transakcję', () => {
    const s = setup(); const base = ports(s); const rev = s.state.definitions[DEF].latestRevision;
    for (const bad of [{ label: ' ' }, { signalKeys: [] as string[] }, { capacity: 0 }]) {
      expect(() => s.dispatch('x', saveDefinition(DEF, { ports: base.map((p, i) => (i === 0 ? { ...p, ...bad } : p)) }, 'all'))).toThrow();
      expect(s.state.definitions[DEF].latestRevision).toBe(rev);
    }
  });

  it('zmiana kolejności zachowuje identyfikatory portów (i tym samym połączenia)', () => {
    const s = setup(); const rev = [...ports(s)].reverse();
    s.dispatch('def', saveDefinition(DEF, { ports: rev }, 'all'));
    expect(Object.keys(s.state.connections).length).toBe(2);
    expect(portDrafts(s.state.definitions[DEF].revisions['2'])[0].id).toBe('prt_lan');
  });
});

describe('pomocnicze', () => {
  it('newPortId: wzorzec formatu i unikalność', () => {
    expect(newPortId([], 'SDI IN 9')).toBe('prt_sdiin9');
    expect(newPortId(['prt_sdiin9'], 'SDI IN 9')).toBe('prt_sdiin92');
    expect(newPortId([], '***')).toBe('prt_port');
  });
  it('zmiana nazwy instancji; pusta nazwa odrzucona', () => {
    const s = setup(); s.dispatch('n', renameInstance('eqi_m1', '  Mikser główny ')); expect(s.state.equipment['eqi_m1'].name).toBe('Mikser główny');
    expect(() => s.dispatch('n', renameInstance('eqi_m1', ' '))).toThrow();
  });
});

describe('dane opisowe urządzenia i fork', () => {
  it('edycja producenta, kategorii, tagów, wymiarów, masy, mocy, racka i źródła = rewizja kosmetyczna; null usuwa pole', () => {
    const s = setup();
    s.dispatch('m', saveDefinition(DEF, { ports: ports(s), meta: { manufacturer: 'Acme', category: 'wideo / miksery', tags: ['a', ' b ', 'a'], notes: 'Opis', dimensionsMm: { width: 480, depth: 300, height: 88 }, weightKg: 4.2, powerW: 60, rackUnits: { heightU: 2, widthFraction: 1 }, source: { kind: 'datasheet', ref: 'Karta rev. C', verified: '2026-11-02' } } }, 'all'));
    const rev = s.state.definitions[DEF].revisions['2'];
    expect(rev.changeClass).toBe('cosmetic'); expect(rev).toMatchObject({ manufacturer: 'Acme', tags: ['a', 'b'], weightKg: 4.2, powerW: 60, sourceKind: 'datasheet', sourceVerified: '2026-11-02', rackUnits: { heightU: 2 } });
    expect(rev.origin).toMatchObject({ source: 'Karta rev. C' }); expect(rev.origin?.custom).toBeUndefined();
    s.dispatch('m', saveDefinition(DEF, { ports: ports(s), meta: { weightKg: null, tags: [], dimensionsMm: null } }, 'none'));
    const r3 = s.state.definitions[DEF].revisions['3']; expect(r3.weightKg).toBeUndefined(); expect(r3.tags).toBeUndefined(); expect(r3.dimensionsMm).toBeUndefined();
    expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
  });
  it('walidacja danych opisowych odrzuca całą transakcję', () => {
    const s = setup(); const v = (meta: any) => () => s.dispatch('x', saveDefinition(DEF, { ports: ports(s), meta }, 'all'));
    expect(v({ manufacturer: ' ' })).toThrow(); expect(v({ dimensionsMm: { width: 0, depth: 1, height: 1 } })).toThrow(); expect(v({ weightKg: -1 })).toThrow();
    expect(v({ rackUnits: { heightU: 1, widthFraction: 0.7 } })).toThrow(); expect(v({ source: { kind: 'datasheet' } })).toThrow(); expect(v({ notes: 'x'.repeat(401) })).toThrow();
    expect(s.state.definitions[DEF].latestRevision).toBe(1);
  });
  it('fork: nowa definicja z pochodzeniem, instancja przepięta, połączenia zachowane; usunięte porty zrywają tylko swoje połączenia; cofnięcie w jednym kroku', () => {
    const s = setup(); const keep = ports(s);
    s.dispatch('f', forkDefinition(DEF, { ports: keep, meta: {} }, 'eqi_m1', 'eqd_kopia1'));
    expect(s.state.equipment['eqi_m1'].definitionId).toBe('eqd_kopia1'); expect(s.state.equipment['eqi_m2'].definitionId).toBe(DEF);
    const r = s.state.definitions['eqd_kopia1'].revisions['1']; expect(r.model).toBe('Mikser wizji (kopia)'); expect(r.origin).toMatchObject({ custom: true, derivedFrom: { definitionId: DEF, revision: 1 } }); expect(r.key).toBeUndefined();
    expect(Object.keys(s.state.connections).length).toBe(2); expect(checkInvariants(s.state)).toEqual([]);
    s.undo(); expect(s.state.definitions['eqd_kopia1']).toBeUndefined(); expect(s.state.equipment['eqi_m1'].definitionId).toBe(DEF);
    s.dispatch('f', forkDefinition(DEF, { ports: keep.filter((p) => p.id !== 'prt_sdiin1'), meta: { model: 'Mikser 7 wejść' } }, 'eqi_m1', 'eqd_kopia2'));
    expect(Object.keys(s.state.connections).length).toBe(1); expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    expect(() => s.dispatch('f', forkDefinition(DEF, { ports: keep, meta: {} }, 'eqi_k1', 'eqd_kopia3'))).toThrow();
  });
});

