import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { addFromCatalog, definitionId } from '../src/catalog/index.ts';
import { saveDefinition, portDrafts } from '../src/definitions.ts';
import { revisionToDevice, validatePack } from '../src/pack.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const DEF = definitionId('video_switcher');
const mk = () => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; const s = new Store(p); s.dispatch('a', addFromCatalog('video_switcher', 'M1', 'eqi_m1')); return s; };
const rev = (s: Store) => s.state.definitions[DEF].revisions[String(s.state.definitions[DEF].latestRevision)];

describe('okno definicji: pola z pakietów', () => {
  it('moc maksymalna, adres źródła, rewizja sprzętu i flaga „wygenerowane” zapisują się i wracają do pakietu', () => {
    const s = mk(); const ports = portDrafts(rev(s));
    s.dispatch('e', saveDefinition(DEF, { ports, meta: { powerW: 20, powerMaxW: 45, source: { kind: 'datasheet', ref: 'karta, s. 3', url: 'https://example.com/x', hardwareRevision: 'rev B', generated: true } } }, 'all'));
    const r = rev(s); expect(r).toMatchObject({ powerW: 20, powerMaxW: 45, sourceUrl: 'https://example.com/x', hardwareRevision: 'rev B', sourceGenerated: true });
    const dev = revisionToDevice(r, 'x'); expect(dev).toMatchObject({ powerMaxW: 45, source: { url: 'https://example.com/x', hardwareRevision: 'rev B', generated: true } });
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(s.state)).toEqual([]);
    s.dispatch('e2', saveDefinition(DEF, { ports: portDrafts(rev(s)), meta: { powerMaxW: null, source: { kind: 'datasheet', ref: 'karta, s. 3', url: '', hardwareRevision: '', generated: false } } }, 'all'));
    expect(rev(s)).not.toHaveProperty('powerMaxW'); expect(rev(s)).not.toHaveProperty('sourceUrl'); expect(rev(s)).not.toHaveProperty('sourceGenerated');
  });
  it('walidacja: moc maksymalna mniejsza od typowej i zły adres są odrzucane', () => {
    const s = mk(); const ports = portDrafts(rev(s));
    expect(() => s.dispatch('x', saveDefinition(DEF, { ports, meta: { powerW: 50, powerMaxW: 10 } }, 'all'))).toThrow(/mniejszy/);
    expect(() => s.dispatch('x', saveDefinition(DEF, { ports, meta: { source: { kind: 'custom', url: 'ftp://x' } } }, 'all'))).toThrow(/http/);
    expect(() => s.dispatch('x', saveDefinition(DEF, { ports, meta: { powerMaxW: -1 } }, 'all'))).toThrow(/0–200000/);
  });
  it('grupa portu i drugi sygnał przechodzą przez zapis; porty z pakietu nie tracą pól (group, electrical)', () => {
    const s = mk(); const ports = portDrafts(rev(s)).map((p, i) => (i === 0 ? { ...p, group: 'SDI wejścia', signalKeys: [...p.signalKeys, 'std/sdi-6g'], electrical: { voltageMinV: 5, voltageMaxV: 12 } } : p));
    s.dispatch('e', saveDefinition(DEF, { ports }, 'all'));
    const p0 = portDrafts(rev(s))[0]; expect(p0).toMatchObject({ group: 'SDI wejścia', electrical: { voltageMinV: 5, voltageMaxV: 12 } }); expect(p0.signalKeys).toHaveLength(2);
    s.dispatch('e2', saveDefinition(DEF, { ports: portDrafts(rev(s)), meta: { notes: 'tylko opis' } }, 'all')); // zapis bez dotykania portów nie gubi pól
    expect(portDrafts(rev(s))[0]).toMatchObject({ group: 'SDI wejścia', electrical: { voltageMinV: 5, voltageMaxV: 12 } });
    void validatePack;
  });
  it('napięcia i moc portu oraz wiele sygnałów: walidacja zakresów, duplikatów i kolejności napięć', () => {
    const s = mk(); const base = portDrafts(rev(s));
    const w = (el: unknown, sig?: string[]) => saveDefinition(DEF, { ports: base.map((p, i) => (i === 0 ? { ...p, electrical: el, ...(sig ? { signalKeys: sig } : {}) } : p)) as any }, 'all');
    expect(() => s.dispatch('x', w({ voltageMinV: 20, voltageMaxV: 10 }))).toThrow(/minimalne większe/);
    expect(() => s.dispatch('x', w({ maxW: -5 }))).toThrow(/moc/);
    expect(() => s.dispatch('x', w({}, ['std/sdi-3g', 'std/sdi-3g']))).toThrow(/powtórzony sygnał/);
    s.dispatch('ok', w({ voltageMinV: 5, voltageMaxV: 12, maxW: 15.4 }, ['std/sdi-3g', 'std/sdi-6g', 'std/sdi-12g']));
    expect(portDrafts(rev(s))[0]).toMatchObject({ electrical: { voltageMinV: 5, voltageMaxV: 12, maxW: 15.4 } }); expect(portDrafts(rev(s))[0].signalKeys).toHaveLength(3);
    expect(schemaErrors(s.state)).toEqual([]); expect(checkInvariants(s.state)).toEqual([]);
  });
});
