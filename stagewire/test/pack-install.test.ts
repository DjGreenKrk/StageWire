import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePack, sourceTrust, definitionIdOf, portIdOf, deviceToRevision, revisionToDevice, type Pack } from '../src/pack.ts';
import { planInstall, installPack, unloadPack, loadedPacks, catalogEntries, starterRegistries, addFromCatalog, compareVersions } from '../src/catalog/index.ts';
import { libraryUpdates, updateFromCatalog } from '../src/definitions.ts';
import { cmd } from '../src/commands.ts';
import { Store } from '../src/store.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

const IDS = ['inst-a', 'inst-b', 'inst-c', 'inst-d'];
afterEach(() => { for (const id of IDS) unloadPack(id); });

const pack = (id = 'inst-a', over: Partial<Pack> = {}): Pack => ({
  format: 'stagewire-pack/1', id, name: 'Pakiet ' + id, version: '1.0.0', license: 'własne',
  registries: { 'user/inst-link': { kind: 'connector', name: 'Złącze testowe' }, 'user/inst-sig': { kind: 'signal', name: 'Sygnał testowy', domain: 'control', color: '#aa00aa', prefix: 'C' } },
  devices: [{
    key: 'konwerter', manufacturer: 'Fikcyjny', model: 'K-1', category: 'wideo / konwertery', dimensionsMm: { width: 100, depth: 80, height: 25 },
    ports: [
      { key: 'sdi-in', label: 'SDI IN', connector: 'std/bnc-75', signals: ['std/sdi-3g'], direction: 'in' },
      { key: 'hdmi-out', label: 'HDMI OUT', connector: 'std/hdmi-a', signals: ['std/hdmi'], direction: 'out' },
    ],
    source: { kind: 'datasheet', ref: 'Dokument testowy rev. A', verified: '2026-11-02' },
  }],
  ...over,
});
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('instalacja pakietów (1–4): poprawny, ponowny, nowszy, kolizje', () => {
  it('1. poprawny pakiet: status new, urządzenie w katalogu; plan niczego nie zmienia', () => {
    const before = catalogEntries.length;
    const plan = planInstall(pack()); expect(plan.errors).toEqual([]); expect(plan.status).toBe('new'); expect(catalogEntries.length).toBe(before);
    expect(plan.newRegistries.sort()).toEqual(['user/inst-link', 'user/inst-sig']);
    installPack(pack()); expect(catalogEntries.length).toBe(before + 1);
  });
  it('2. ponowny import tej samej wersji i treści: identical, bez zmian w katalogu', () => {
    installPack(pack()); const n = catalogEntries.length;
    const again = installPack(pack()); expect(again.status).toBe('identical'); expect(again.errors).toEqual([]); expect(catalogEntries.length).toBe(n);
    expect(loadedPacks().filter((p) => p.id === 'inst-a').length).toBe(1);
  });
  it('2b. ta sama wersja, inna treść: changed-same-version; starsza wersja: downgrade (informacyjnie, decyzja po stronie wywołującego)', () => {
    installPack(pack());
    const edited = pack(); edited.devices[0].model = 'K-1b'; expect(planInstall(edited).status).toBe('changed-same-version');
    const older = pack('inst-a', { version: '0.9.0' }); expect(planInstall(older).status).toBe('downgrade');
  });
  it('3. nowsza wersja: upgrade, lista dodanych/zmienionych/usuniętych i zmiany łamiące zgodność', () => {
    const v1 = pack(); v1.devices.push({ ...clone(v1.devices[0]), key: 'drugi', model: 'K-2' }); installPack(v1);
    const v2 = pack('inst-a', { version: '1.1.0' }); v2.devices[0].ports.pop(); v2.devices.push({ ...clone(v2.devices[0]), key: 'trzeci', model: 'K-3' });
    const plan = planInstall(v2);
    expect(plan.status).toBe('upgrade'); expect(plan.added).toEqual(['trzeci']); expect(plan.changed).toEqual(['konwerter']); expect(plan.removed).toEqual(['drugi']);
    expect(plan.breaking.join('\n')).toContain('usunięte porty hdmi-out'); expect(plan.breaking.join('\n')).toContain('drugi');
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });
  it('4. kolizja kluczy urządzeń między pakietami: ten sam klucz w różnych pakietach nie koliduje, kolidują tylko identyfikatory po usunięciu znaków', () => {
    installPack(pack('inst-a')); const b = installPack(pack('inst-b')); expect(b.errors).toEqual([]);
    expect(definitionIdOf('inst-a', 'konwerter')).not.toBe(definitionIdOf('inst-b', 'konwerter'));
    // „inst-a”+„xb” i „inst-ax”+„b” dają ten sam identyfikator definicji
    const p1 = pack('inst-a'); p1.devices[0].key = 'xb'; installPack(p1);
    const p2 = pack('inst-ax'); p2.devices[0].key = 'b';
    const plan = planInstall(p2); expect(plan.errors.join('\n')).toContain('koliduje z urządzeniem inst-a/xb'); unloadPack('inst-ax');
  });
});

describe('rejestry (5–6)', () => {
  it('5. konflikt wpisu rejestru z innym pakietem jest błędem; identyczny wpis jest współdzielony, bez duplikatu', () => {
    installPack(pack('inst-a'));
    const same = planInstall(pack('inst-b')); expect(same.errors).toEqual([]); expect(same.reusedRegistries.sort()).toEqual(['user/inst-link', 'user/inst-sig']); expect(same.newRegistries).toEqual([]);
    const clash = pack('inst-b'); clash.registries!['user/inst-link'] = { kind: 'connector', name: 'Zupełnie inne złącze' };
    const plan = planInstall(clash); expect(plan.errors.join('\n')).toContain('konflikt z pakietem „inst-a”');
    const sameKeyOtherKind = pack('inst-b'); sameKeyOtherKind.registries!['user/inst-link'] = { kind: 'signal', name: 'Złącze testowe', domain: 'control' };
    expect(planInstall(sameKeyOtherKind).errors.join('\n')).toContain('konflikt');
    installPack(clash); expect(loadedPacks().some((p) => p.id === 'inst-b')).toBe(false); // atomowo: nic nie zostało wczytane
    expect(starterRegistries['user/inst-link'].name).toBe('Złącze testowe'); // nie nadpisano po cichu
  });
  it('5b. standardowe wpisy std/… nie mogą być redefiniowane przez pakiet', () => {
    const p = pack('inst-c'); p.registries!['std/rj45'] = { kind: 'connector', name: 'Inny RJ45' };
    expect(planInstall(p).errors.join('\n')).toContain('std/rj45');
    const dup = pack('inst-c'); dup.registries!['std/rj45'] = clone(starterRegistries['std/rj45']); expect(planInstall(dup).errors).toEqual([]); // identyczna kopia jest dozwolona
  });
  it('6. brakujące złącze lub sygnał: jedna zbiorcza lista i atomowe odrzucenie', () => {
    const p = pack('inst-d'); p.devices[0].ports[0].connector = 'user/brak-zlacza'; p.devices[0].ports[1].signals = ['user/brak-sygnalu'];
    const before = catalogEntries.length, plan = installPack(p);
    expect(plan.errors[0]).toContain('Brakujące wpisy rejestrów (2)'); expect(plan.errors[0]).toContain('user/brak-zlacza'); expect(plan.errors[0]).toContain('user/brak-sygnalu');
    expect(catalogEntries.length).toBe(before);
  });
});

describe('niezmienność projektu po aktualizacji biblioteki (7)', () => {
  it('7. aktualizacja pakietu nie rusza projektu; nowa rewizja powstaje tylko na polecenie, instancje zostają przypięte, porty są stabilne', () => {
    installPack(pack());
    const proj = syntheticProject(0, 0, 1, true); proj.definitions = {}; proj.registries = {}; proj.equipment = {}; proj.connections = {}; proj.cables = {};
    const s = new Store(proj); s.dispatch('a', addFromCatalog('inst-a/konwerter', 'K 1', 'eqi_k1')); s.dispatch('b', addFromCatalog('inst-a/konwerter', 'K 2', 'eqi_k2'));
    const defId = definitionIdOf('inst-a', 'konwerter');
    s.dispatch('c', cmd.connect({ instanceId: 'eqi_k1', portId: portIdOf('hdmi-out') }, { instanceId: 'eqi_k2', portId: portIdOf('sdi-in') }, 'std/hdmi'));
    expect(libraryUpdates(s.state)).toEqual([]);
    const snapshot = JSON.stringify(s.state);

    // nowa wersja: dodany port USB, zmieniony opis i zasilanie, usunięty port HDMI OUT
    const v2 = pack('inst-a', { version: '1.1.0' }); const d = v2.devices[0];
    d.ports = [d.ports[0], { key: 'usb', label: 'USB', connector: 'std/usb-b', signals: ['std/usb'], direction: 'io' }]; d.powerW = 6; d.model = 'K-1 rev2';
    expect(installPack(v2).status).toBe('upgrade');
    expect(JSON.stringify(s.state)).toBe(snapshot); // sam import nie zmienia projektu

    const up = libraryUpdates(s.state); expect(up.length).toBe(1);
    expect(up[0]).toMatchObject({ defId, fromVersion: '1.0.0', toVersion: '1.1.0', added: ['USB'], removed: ['HDMI OUT'], instances: 2, lostConnections: 1, descriptive: false });
    expect(JSON.stringify(s.state)).toBe(snapshot); // wykrycie też niczego nie zmienia

    s.dispatch('Aktualizuj z biblioteki', updateFromCatalog(defId, 'none'));
    const def = s.state.definitions[defId]; expect(def.latestRevision).toBe(2);
    expect(def.revisions['1']).toEqual(JSON.parse(snapshot).definitions[defId].revisions['1']); // stara rewizja niezmienna
    expect(def.revisions['2'].origin?.packVersion).toBe('1.1.0'); expect(def.revisions['2'].changeClass).toBe('structural'); expect(def.revisions['2'].powerW).toBe(6);
    expect(Object.values(s.state.equipment).every((e) => e.definitionRevision === 1)).toBe(true); // instancje nadal na rewizji 1
    expect(Object.keys(s.state.connections).length).toBe(1); // port HDMI OUT nadal istnieje w rewizji 1
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    expect(libraryUpdates(s.state)).toEqual([]); // po aktualizacji nie ma już oczekujących zmian

    s.undo(); expect(s.state.definitions[defId].latestRevision).toBe(1);
    s.dispatch('Aktualizuj i przepnij', updateFromCatalog(defId, 'all'));
    expect(Object.values(s.state.equipment).every((e) => e.definitionRevision === 2)).toBe(true); expect(Object.keys(s.state.connections).length).toBe(0); // połączenie z usuniętym portem zniknęło jawnie
    expect(checkInvariants(s.state)).toEqual([]);
  });
  it('7b. brak aktualizacji dla definicji własnych i dla pakietu o tej samej wersji', () => {
    installPack(pack());
    const proj = syntheticProject(0, 0, 1, true); const s = new Store(proj);
    expect(libraryUpdates(s.state)).toEqual([]);
    expect(() => s.dispatch('x', updateFromCatalog(Object.keys(s.state.definitions)[0], 'none'))).toThrow();
  });
});

describe('różne układy urządzeń (8–9)', () => {
  it('8. urządzenie z wieloma rodzajami portów: wiele sygnałów, grupy, zasilanie z zakresem napięć, PoE i redundantne wejścia', () => {
    const p = pack('inst-b');
    p.devices[0] = {
      key: 'switch-poe', manufacturer: 'Fikcyjny', model: 'SW-8P', category: 'sieć', description: 'Fikcyjny przełącznik PoE', dimensionsMm: { width: 440, depth: 200, height: 44 }, rackUnits: { heightU: 1, widthFraction: 1 },
      powerW: 40, powerMaxW: 150, weightKg: 2.5,
      ports: [
        { key: 'psu-a', label: 'AC A', connector: 'std/iec-c14', signals: ['std/power-ac'], direction: 'in', group: 'Zasilanie', electrical: { voltageMinV: 100, voltageMaxV: 240, maxW: 150 } },
        { key: 'psu-b', label: 'AC B', connector: 'std/iec-c14', signals: ['std/power-ac'], direction: 'in', group: 'Zasilanie', electrical: { voltageMinV: 100, voltageMaxV: 240, maxW: 150 }, note: 'Wejście redundantne' },
        { key: 'dc', label: 'DC IN', connector: 'std/dc-barrel', signals: ['std/power-dc'], direction: 'in', electrical: { voltageMinV: 12, voltageMaxV: 24 } },
        { key: 'lan-1', label: 'LAN 1', connector: 'std/rj45', signals: ['std/ethernet', 'std/poe'], direction: 'io', group: 'LAN', electrical: { maxW: 30 } },
        { key: 'sfp-1', label: 'SFP 1', connector: 'std/sfp', signals: ['std/ethernet', 'std/fiber'], direction: 'io', group: 'Uplink' },
      ],
      source: { kind: 'manual', ref: 'Instrukcja testowa v1', url: 'https://example.invalid/manual.pdf', hardwareRevision: 'rev B', verified: '2026-11-02' },
    };
    const plan = installPack(p); expect(plan.errors).toEqual([]);
    const proj = syntheticProject(0, 0, 1, true); proj.definitions = {}; proj.registries = {}; proj.equipment = {}; proj.connections = {}; proj.cables = {};
    const s = new Store(proj); s.dispatch('a', addFromCatalog('inst-b/switch-poe', 'SW 1', 'eqi_sw'));
    const rev = s.state.definitions[definitionIdOf('inst-b', 'switch-poe')].revisions['1'];
    expect(rev.ports[portIdOf('psu-a')]).toMatchObject({ group: 'Zasilanie', electrical: { voltageMinV: 100, voltageMaxV: 240, maxW: 150 }, signalKeys: ['std/power-ac'] });
    expect(rev.ports[portIdOf('lan-1')].signalKeys).toEqual(['std/ethernet', 'std/poe']);
    expect(rev).toMatchObject({ powerW: 40, powerMaxW: 150, sourceUrl: 'https://example.invalid/manual.pdf', hardwareRevision: 'rev B', rackUnits: { heightU: 1, widthFraction: 1 } });
    for (const k of ['std/power-ac', 'std/power-dc', 'std/poe', 'std/iec-c14', 'std/dc-barrel']) expect(s.state.registries[k], k).toBeDefined();
    expect(checkInvariants(s.state)).toEqual([]); expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    // zasilanie to zwykłe połączenie portów: kabel IEC C14–C13
    const back = revisionToDevice(rev, 'switch-poe'); expect(back.ports.find((q) => q.key === 'psua')).toMatchObject({ group: 'Zasilanie', electrical: { maxW: 150 } }); expect(back.source).toMatchObject({ url: 'https://example.invalid/manual.pdf', hardwareRevision: 'rev B' }); expect(back.powerMaxW).toBe(150);
    expect(deviceToRevision(plan.pack!, plan.pack!.devices[0]).origin?.packVersion).toBe('1.0.0');
  });
  it('9. urządzenie bez danych opcjonalnych (tylko pola wymagane) jest poprawne; ostrzeżenia, nie błędy', () => {
    const p = pack('inst-c'); p.devices[0] = { key: 'min', manufacturer: 'X', model: 'Y', category: 'inne', ports: [{ key: 'p1', label: 'P1', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } };
    delete (p as Partial<Pack>).registries;
    const plan = installPack(p); expect(plan.errors).toEqual([]); expect(plan.warnings.join()).toContain('dimensionsMm');
    expect(sourceTrust(plan.pack!.devices[0].source)).toBe('unverified');
  });
});

describe('niepoprawne pakiety i bezpieczeństwo (10)', () => {
  it('10. niepoprawny pakiet jest odrzucany w całości; katalog bez zmian', () => {
    const before = catalogEntries.map((e) => e.key).join();
    const cases: any[] = [null, 'tekst', [], {}, { ...pack(), format: 'stagewire-pack/2' }, { ...pack(), devices: [{ ...pack().devices[0], ports: [] }] }, { ...pack(), id: 'ZŁE ID' }, { ...pack(), version: '1.0' }];
    for (const c of cases) { const r = installPack(c); expect(r.pack === undefined || r.errors.length > 0, JSON.stringify(c)?.slice(0, 40)).toBe(true); }
    const part = pack('inst-a'); part.devices.push({ ...clone(part.devices[0]), key: 'zly', ports: [{ key: 'a', label: 'A', connector: 'nie-ma', signals: ['std/hdmi'], direction: 'in' }] });
    expect(installPack(part).errors.length).toBeGreaterThan(0); expect(loadedPacks().some((p) => p.id === 'inst-a')).toBe(false); // żadne z dwóch urządzeń nie zostało wczytane
    expect(catalogEntries.map((e) => e.key).join()).toBe(before);
  });
  it('nieznane pola dają ostrzeżenia (literówki), a $schema jest ignorowane i nie wpływa na import', () => {
    const p: any = pack(); p.$schema = '../dowolna/sciezka/pack.schema.json'; p.devices[0].powerw = 5; p.devices[0].ports[0].grupa = 'x'; p.devices[0].source.link = 'y'; p.dodatek = 1;
    const r = validatePack(p, starterRegistries); expect(r.errors).toEqual([]);
    const w = r.warnings.join('\n'); for (const f of ['powerw', 'grupa', 'link', 'dodatek']) expect(w).toContain(f); expect(w).not.toContain('$schema');
    const noSchema = pack(); expect(validatePack(noSchema, starterRegistries).errors).toEqual([]);
  });
  it('walidacja nowych pól: adres źródła, moc maksymalna, zakres napięć, grupa', () => {
    const bad = (mut: (p: any) => void, frag: string) => { const p: any = pack(); mut(p); const r = validatePack(p, starterRegistries); expect(r.pack).toBeUndefined(); expect(r.errors.join('\n')).toContain(frag); };
    bad((p) => { p.devices[0].source.url = 'ftp://x'; }, 'source.url');
    bad((p) => { p.devices[0].source.generated = 'tak'; }, 'source.generated');
    bad((p) => { p.devices[0].powerW = 10; p.devices[0].powerMaxW = 5; }, 'powerMaxW');
    bad((p) => { p.devices[0].ports[0].electrical = { voltageMinV: 240, voltageMaxV: 100 }; }, 'voltageMinV');
    bad((p) => { p.devices[0].ports[0].electrical = { maxW: -1 }; }, 'electrical.maxW');
    bad((p) => { p.devices[0].ports[0].group = ''; }, 'group');
  });
});

describe('wiarygodność danych', () => {
  it('sourceTrust: zweryfikowane tylko z datą weryfikacji; dane wygenerowane nigdy same z siebie', () => {
    expect(sourceTrust({ kind: 'datasheet', verified: '2026-11-02' })).toBe('verified');
    expect(sourceTrust({ kind: 'datasheet' })).toBe('unverified');
    expect(sourceTrust({ kind: 'manual', verified: '2026-11-02', generated: true })).toBe('verified'); // data weryfikacji oznacza, że człowiek sprawdził
    expect(sourceTrust({ kind: 'custom', verified: '2026-11-02', generated: true })).toBe('unverified');
    expect(sourceTrust({ kind: 'estimated' })).toBe('approximate'); expect(sourceTrust({ kind: 'generic' })).toBe('generic'); expect(sourceTrust(undefined)).toBe('unverified');
  });
  it('generated bez weryfikacji i źródło bez daty dają ostrzeżenia', () => {
    const p = pack(); p.devices[0].source = { kind: 'datasheet', ref: 'Karta', generated: true };
    const r = validatePack(p, starterRegistries); expect(r.errors).toEqual([]); expect(r.warnings.join('\n')).toContain('wygenerowane automatycznie i niezweryfikowane');
    const q = pack(); q.devices[0].source = { kind: 'manual', ref: 'Instrukcja' }; expect(validatePack(q, starterRegistries).warnings.join('\n')).toContain('niezweryfikowane');
  });
});

describe('pakiety w repozytorium', () => {
  it('przykład fikcyjny i pakiet rejestrów przechodzą walidację i instalację przez kod aplikacji', () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../packs/PRZYKLAD-fikcyjny.swpack.json', import.meta.url)), 'utf8'));
    const plan = installPack(raw); try { expect(plan.errors).toEqual([]); expect(plan.pack!.devices.length).toBeGreaterThanOrEqual(4); expect(planInstall(raw).status).toBe('identical'); } finally { unloadPack(raw.id); }
  });
});
