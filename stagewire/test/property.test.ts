import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fixture, clone } from './helpers.ts';
import { Store, CommandError } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject, canonicalStringify } from '../src/format.ts';
import { validate } from '../src/validation.ts';

type Op = { k: number; a: number; b: number; c: number };
const opArb = fc.record({ k: fc.integer({ min: 0, max: 9 }), a: fc.nat(1000), b: fc.nat(1000), c: fc.nat(1000) });

const pick = <T>(arr: T[], i: number): T | undefined => (arr.length ? arr[i % arr.length] : undefined);

function apply(s: Store, op: Op): void {
  const p = s.state;
  const inst = Object.keys(p.equipment);
  const defs = Object.keys(p.definitions);
  const cnx = Object.keys(p.connections);
  const cabs = Object.keys(p.cables);
  const portsOf = (iid: string) => Object.keys(p.definitions[p.equipment[iid].definitionId].revisions[String(p.equipment[iid].definitionRevision)].ports);
  try {
    switch (op.k) {
      case 0: { const d = pick(defs, op.a); if (d) s.dispatch('add', cmd.addInstance(d, `N${op.b}`)); break; }
      case 1: { const i = pick(inst, op.a); if (i) s.dispatch('rm', cmd.removeInstance(i)); break; }
      case 2: case 3: {
        const a = pick(inst, op.a), b = pick(inst, op.b);
        if (!a || !b) break;
        const pa = pick(portsOf(a), op.c), pb = pick(portsOf(b), op.c + 1);
        if (!pa || !pb || (a === b && pa === pb)) break;
        const sig = p.definitions[p.equipment[a].definitionId].revisions[String(p.equipment[a].definitionRevision)].ports[pa].signalKeys[0];
        s.dispatch('connect', cmd.connect({ instanceId: a, portId: pa }, { instanceId: b, portId: pb }, sig, { medium: op.c % 5 === 0 ? 'wireless' : 'physical' }));
        break;
      }
      case 4: { const c = pick(cnx, op.a); if (c) s.dispatch('disc', cmd.disconnect(c)); break; }
      case 5: { const c = pick(cabs, op.a); if (c) s.dispatch('rmcable', cmd.removeCable(c)); break; }
      case 6: { // etykieta (kosmetyczna) lub usunięcie portu (strukturalna)
        const d = pick(defs, op.a); if (!d) break;
        s.dispatch('edit', cmd.editDefinition(d, (rev) => {
          const ids = Object.keys(rev.ports);
          const pid = pick(ids, op.b);
          if (!pid) return;
          if (op.c % 2 === 0) rev.ports[pid].label += '*'; else delete rev.ports[pid];
        }));
        break;
      }
      case 7: { const i = pick(inst, op.a); if (i) { const def = p.definitions[p.equipment[i].definitionId]; s.dispatch('up', cmd.upgradeInstance(i, def.latestRevision, op.b % 2 ? 'delete' : 'cancel')); } break; }
      case 8: s.dispatch('num', cmd.numberMissingCables()); break;
      case 9: { const c = pick(cabs, op.a); if (c) s.dispatch('len', cmd.setCableLengths(c, { lengthMm: 1 + op.b, stockLengthMm: 1 + op.c })); break; }
    }
  } catch (e) {
    if (!(e instanceof CommandError)) throw e; // InvariantViolation i inne = błąd krytyczny
  }
}

describe('własności (TS-02)', () => {
  for (const name of ['conference-mini.json', 'revisions-two.json', 'medium-variants.json']) {
    it(`${name}: losowe sekwencje zachowują niezmienniki, schemat i round-trip; cofnięcie wszystkiego = stan początkowy`, () => {
      fc.assert(
        fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
          const initial = fixture(name);
          const snapshot = clone(initial);
          const s = new Store(initial, { invariants: 'both' });
          for (const op of ops) apply(s, op);
          // niezmienniki (Store już je sprawdza; tu jawnie na stanie końcowym)
          expect(checkInvariants(s.state)).toEqual([]);
          // plik: schemat + round-trip kanoniczny po przycięciu rewizji
          const r = openProject(packProject(s.state));
          expect(r.status).toBe('ok');
          if (r.status === 'ok') {
            expect(schemaErrors(r.project)).toEqual([]);
            expect(checkInvariants(r.project)).toEqual([]);
            expect(canonicalStringify(r.project)).toBe(canonicalStringify(openProjectPruned(s.state)));
          }
          validate(s.state); // nie może rzucać
          // cofnij wszystko
          while (s.undo()) { /* */ }
          expect(s.state).toEqual(snapshot);
          // ponów wszystko i cofnij ponownie
          while (s.redo()) { /* */ }
          expect(checkInvariants(s.state)).toEqual([]);
        }),
        { numRuns: 300 },
      );
    });
  }
});

import { pruneForFile } from '../src/format.ts';
function openProjectPruned(p: Parameters<typeof pruneForFile>[0]) { return pruneForFile(p); }
