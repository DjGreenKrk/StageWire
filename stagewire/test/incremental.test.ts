import { describe, it, expect } from 'vitest';
import { fixture } from './helpers.ts';
import { Store, InvariantViolation } from '../src/store.ts';
import { checkInvariants, checkInvariantsIncremental } from '../src/invariants.ts';
import { produceWithPatches, enablePatches } from 'immer';
import type { Project } from '../src/types.ts';
enablePatches();

/** Celowo wadliwe transakcje: przyrostowe sprawdzanie MUSI je wykryć (tak samo jak pełne). */
const BAD: [string, (d: Project) => void][] = [
  ['usunięcie instancji bez kaskady (wiszące połączenia i węzły)', (d) => { delete d.equipment.eqi_mix1; }],
  ['usunięcie kabla w użyciu', (d) => { delete d.cables.cbl_1; }],
  ['osierocony kabel po usunięciu połączenia', (d) => { delete d.connections.cnx_1; }],
  ['port usunięty z przypiętej rewizji', (d) => { delete d.definitions.eqd_mixer.revisions['1'].ports.prt_in1; }],
  ['usunięcie definicji w użyciu', (d) => { delete d.definitions.eqd_cam; }],
  ['przypięcie do nieistniejącej rewizji', (d) => { d.equipment.eqi_cam1.definitionRevision = 9; }],
  ['wireless z kablem', (d) => { d.connections.cnx_1.medium = 'wireless'; }],
  ['połączenie z nieistniejącym portem', (d) => { d.connections.cnx_1.to.portId = 'prt_zly'; }],
  ['usunięcie wpisu rejestru w użyciu', (d) => { delete d.registries['std/sdi-3g']; }],
  ['usunięcie typu kabla w użyciu', (d) => { delete d.registries['std/cable-sdi']; }],
  ['placement na usuniętą instancję', (d) => { d.placements!.plc_cam1.targetId = 'eqi_nie_ma'; }],
  ['zły format ID', (d) => { d.equipment['ZLY ID'] = d.equipment.eqi_cam1; }],
  ['ID w dwóch kolekcjach', (d) => { d.zones!.eqi_cam1 = d.zones!.zon_foh; }],
  ['latestRevision wskazuje brak rewizji', (d) => { d.definitions.eqd_cam.latestRevision = 5; }],
  ['layout krawędzi dla usuniętego połączenia', (d) => { delete d.connections.cnx_4; delete d.cables.cbl_4; }],
];

describe('niezmienniki przyrostowe wykrywają naruszenia (jak pełne)', () => {
  for (const [name, mutate] of BAD) {
    it(name, () => {
      const prev = fixture('conference-mini.json');
      const [next, patches] = produceWithPatches(prev, mutate);
      const full = checkInvariants(next);
      expect(full.length, 'pełne musi widzieć naruszenie').toBeGreaterThan(0);
      expect(checkInvariantsIncremental(prev, next, patches).length, 'przyrostowe musi widzieć naruszenie').toBeGreaterThan(0);
      const s = new Store(fixture('conference-mini.json'));
      const before = s.state;
      expect(() => s.dispatch('zły', mutate)).toThrow(InvariantViolation);
      expect(s.state).toBe(before);
    });
  }
});
