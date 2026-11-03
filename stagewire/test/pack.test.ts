import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { alnum, validatePack, deviceToRevision, revisionToDevice, definitionIdOf, portIdOf, deviceKeyFor, type Pack } from '../src/pack.ts';
import { catalogEntries, revisionOf, definitionId, loadPack, unloadPack, loadedPacks, starterRegistries, addFromCatalog, searchCatalog } from '../src/catalog/index.ts';
import { Store } from '../src/store.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const snap = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/starter-v1.snapshot.json', import.meta.url)), 'utf8'));
const good = (): Pack => ({
  format: 'stagewire-pack/1', id: 'test-pack', name: 'Pakiet testowy', version: '1.0.0', license: 'własne',
  registries: { 'user/xlr-4': { kind: 'connector', name: 'XLR 4-pin' }, 'user/intercom': { kind: 'signal', name: 'Intercom', domain: 'audio', color: '#aa00aa', prefix: 'I' } },
  devices: [{
    key: 'beltpack-1', manufacturer: 'Acme', model: 'Beltpack 1', category: 'audio / intercom', tags: ['intercom', 'beltpack'], description: 'Pas do interkomu',
    dimensionsMm: { width: 100, depth: 30, height: 70 }, weightKg: 0.3, powerW: 2,
    ports: [{ key: 'line-1', label: 'LINE 1', connector: 'user/xlr-4', signals: ['user/intercom'], direction: 'io' }, { key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io', capacity: 2 }],
    source: { kind: 'datasheet', ref: 'Acme Beltpack 1 Datasheet rev. B', verified: '2026-11-02' },
  }],
});

describe('pakiet startowy jest zgodny z poprzednią wersją wbudowaną (migawka)', () => {
  it('te same identyfikatory definicji i portów, etykiety, złącza, sygnały, kierunki i wymiary', () => {
    for (const [key, old] of Object.entries<any>(snap.devices)) {
      expect(definitionId(key)).toBe(old.definitionId);
      const e = catalogEntries.find((x) => x.key === key)!; expect(e, key).toBeDefined();
      const rev = revisionOf(e);
      expect(Object.keys(rev.ports)).toEqual(Object.keys(old.revision.ports));
      for (const [pid, p] of Object.entries<any>(old.revision.ports)) expect(rev.ports[pid], `${key}/${pid}`).toMatchObject({ label: p.label, order: p.order, connectorKey: p.connectorKey, signalKeys: p.signalKeys, direction: p.direction, capacity: p.capacity });
      expect(rev.dimensionsMm).toEqual(old.revision.dimensionsMm); expect(rev.rackUnits).toEqual(old.revision.rackUnits);
      expect(rev.model).toBe(old.model); expect(rev.manufacturer).toBe('Generic');
    }
    expect(starterRegistries['std/cable-sdi']).toEqual(snap.registries['std/cable-sdi']);
  });
});

describe('walidacja pakietu', () => {
  it('poprawny pakiet przechodzi bez błędów', () => { const r = validatePack(good(), starterRegistries); expect(r.errors).toEqual([]); expect(r.pack).toBeDefined(); });
  it.each([
    ['zły format', (p: any) => { p.format = 'x'; }, 'format'],
    ['zły id pakietu', (p: any) => { p.id = 'A B'; }, 'id:'],
    ['brak licencji', (p: any) => { delete p.license; }, 'license'],
    ['nieznane złącze', (p: any) => { p.devices[0].ports[0].connector = 'std/nie-ma'; }, 'nie jest znanym złączem'],
    ['nieznany sygnał', (p: any) => { p.devices[0].ports[1].signals = ['std/nie-ma']; }, 'nie jest znanym sygnałem'],
    ['zły kierunek', (p: any) => { p.devices[0].ports[0].direction = 'wejscie'; }, 'direction'],
    ['pojemność 0', (p: any) => { p.devices[0].ports[0].capacity = 0; }, 'capacity'],
    ['duplikat klucza portu', (p: any) => { p.devices[0].ports[1].key = 'line-1'; }, 'duplikat'],
    ['kolizja identyfikatorów portów', (p: any) => { p.devices[0].ports[1].key = 'line_1'; }, 'koliduje'],
    ['duplikat urządzenia', (p: any) => { p.devices.push(structuredClone(p.devices[0])); }, 'duplikat'],
    ['datasheet bez odnośnika', (p: any) => { delete p.devices[0].source.ref; }, 'source.ref'],
    ['brak źródła', (p: any) => { delete p.devices[0].source; }, 'source'],
    ['generic dla cudzego producenta', (p: any) => { p.devices[0].source = { kind: 'generic' }; }, 'generic'],
    ['ujemny wymiar', (p: any) => { p.devices[0].dimensionsMm.width = -1; }, 'dimensionsMm.width'],
    ['zły ułamek racka', (p: any) => { p.devices[0].rackUnits = { heightU: 1, widthFraction: 0.7 }; }, 'widthFraction'],
    ['zła data', (p: any) => { p.devices[0].source.verified = '02.11.2026'; }, 'verified'],
    ['zbyt długi opis', (p: any) => { p.devices[0].description = 'x'.repeat(401); }, 'description'],
    ['kabel ze złączem spoza rejestru', (p: any) => { p.registries['user/kabel'] = { kind: 'cable', name: 'K', endPairs: [['user/nie-ma', 'user/nie-ma']], carriesSignals: ['user/intercom'] }; }, 'endPairs'],
  ])('błąd: %s', (_n, mut, frag) => { const p = good(); mut(p); const r = validatePack(p, starterRegistries); expect(r.pack).toBeUndefined(); expect(r.errors.join('\n')).toContain(frag); });
  it('ostrzeżenia: brak wymiarów, dane szacunkowe', () => { const p: any = good(); delete p.devices[0].dimensionsMm; p.devices[0].source = { kind: 'estimated', note: 'na oko' }; const r = validatePack(p, starterRegistries); expect(r.errors).toEqual([]); expect(r.warnings.join()).toContain('dimensionsMm'); expect(r.warnings.join()).toContain('szacunkowe'); });
  it('nie-obiekt i brak urządzeń', () => { expect(validatePack(null).errors.length).toBe(1); expect(validatePack({ ...good(), registries: undefined, devices: [] }, starterRegistries).errors.join()).toContain('devices'); });
  it('pakiet samych rejestrów (devices = []) jest dozwolony i udostępnia złącza innym pakietom', () => {
    const regs: any = { format: 'stagewire-pack/1', id: 'wspolne-zlacza', name: 'Wspólne', version: '1.0.0', license: 'własne', registries: { 'user/speakon': { kind: 'connector', name: 'Speakon' } }, devices: [] };
    expect(validatePack(regs, starterRegistries).errors).toEqual([]);
    const dev: any = good(); dev.registries = {}; dev.devices[0].ports[0].connector = 'user/speakon'; dev.devices[0].ports[0].signals = ['std/ethernet'];
    expect(validatePack(dev, { ...starterRegistries, ...regs.registries }).errors).toEqual([]); expect(validatePack(dev, starterRegistries).errors.join()).toContain('speakon');
  });
});

describe('wczytanie pakietu do katalogu i projektu', () => {
  it('urządzenie z pakietu: wyszukiwanie po producencie i tagu, dodanie do projektu, schemat, niezmienniki, zapis/odczyt, pochodzenie', () => {
    const before = catalogEntries.length; const rep = loadPack(good()); expect(rep.errors).toEqual([]);
    try {
      expect(catalogEntries.length).toBe(before + 1);
      expect(searchCatalog('acme').map((e) => e.key)).toEqual(['test-pack/beltpack-1']); expect(searchCatalog('intercom beltpack').length).toBe(1);
      const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {};
      const s = new Store(p); s.dispatch('a', addFromCatalog('test-pack/beltpack-1', 'BP 1', 'eqi_bp'));
      const def = s.state.definitions[definitionIdOf('test-pack', 'beltpack-1')]; const rev = def.revisions['1'];
      expect(rev.key).toBe('test-pack/beltpack-1'); expect(rev.origin).toMatchObject({ packId: 'test-pack', packVersion: '1.0.0', license: 'własne', source: 'Acme Beltpack 1 Datasheet rev. B' }); expect(rev.tags).toEqual(['intercom', 'beltpack']); expect(rev.weightKg).toBe(0.3);
      expect(rev.ports[portIdOf('line-1')].capacity).toBe(1); expect(rev.ports[portIdOf('lan')].capacity).toBe(2);
      expect(s.state.registries['user/xlr-4']).toBeDefined(); expect(s.state.registries['std/rj45']).toBeDefined();
      expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
      expect(openProject(packProject(s.state)).status).toBe('ok');
    } finally { unloadPack('test-pack'); }
    expect(catalogEntries.length).toBe(before); expect(loadedPacks().some((x) => x.id === 'test-pack')).toBe(false);
  });
  it('pakiet z błędami nie zostaje wczytany; pakiet o tym samym id zastępuje poprzedni; startowego nie da się usunąć', () => {
    const bad: any = good(); bad.devices[0].ports[0].connector = 'x'; const before = catalogEntries.length;
    expect(loadPack(bad).errors.length).toBeGreaterThan(0); expect(catalogEntries.length).toBe(before);
    loadPack(good()); const v2: any = good(); v2.version = '1.1.0'; v2.devices[0].model = 'Beltpack 2'; loadPack(v2);
    expect(catalogEntries.filter((e) => e.packId === 'test-pack').map((e) => e.model)).toEqual(['Beltpack 2']); unloadPack('test-pack'); unloadPack('stagewire-starter');
    expect(loadedPacks().some((x) => x.id === 'stagewire-starter')).toBe(true);
  });
  it('rewizja → urządzenie pakietu → rewizja zachowuje dane (eksport/import)', () => {
    const pk = good(); const rev = deviceToRevision(pk, pk.devices[0]); const back = revisionToDevice(rev, 'beltpack-1');
    expect(back.ports.map((q) => [alnum(q.key), q.label, q.connector, q.signals, q.direction, q.capacity ?? 1])).toEqual(pk.devices[0].ports.map((q) => [alnum(q.key), q.label, q.connector, q.signals, q.direction, q.capacity ?? 1]));
    expect(back).toMatchObject({ manufacturer: 'Acme', model: 'Beltpack 1', tags: ['intercom', 'beltpack'], weightKg: 0.3, powerW: 2, dimensionsMm: { width: 100, depth: 30, height: 70 }, source: { kind: 'datasheet' } });
    const again = { ...pk, devices: [back] }; expect(validatePack(again, starterRegistries).errors).toEqual([]);
  });
  it('klucz urządzenia z modelu: bez polskich znaków, unikalny', () => { expect(deviceKeyFor('Mikser wizji Łódź 8', [])).toBe('mikser-wizji-lodz-8'); expect(deviceKeyFor('X', ['x', 'x-2'])).toBe('x-3'); expect(deviceKeyFor('***', [])).toBe('urzadzenie'); });
});
