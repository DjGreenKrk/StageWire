import { describe, it, expect } from 'vitest';
import { catalogEntries, starterRegistries, revisionOf, definitionId, addFromCatalog, searchCatalog, uniqueName } from '../src/catalog/index.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { checkInvariants } from '../src/invariants.ts';
import { schemaErrors, packProject, openProject } from '../src/format.ts';
import { validate } from '../src/validation.ts';
import { planConnection, usageOf } from '../src/editor/connect.ts';
import { syntheticProject } from '../src/synthetic.ts';
import type { Project } from '../src/types.ts';

const empty = (): Project => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; return p; };

describe('katalog startowy: spójność danych', () => {
  it('klucze wpisów są unikalne, a każdy wpis ma wejście lub wyjście', () => {
    const keys = catalogEntries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of catalogEntries) expect(e.ports.length, e.key).toBeGreaterThan(0);
  });
  it('identyfikatory portów są unikalne w obrębie urządzenia', () => {
    for (const e of catalogEntries) { const ids = Object.keys(revisionOf(e).ports); expect(new Set(ids).size, e.key).toBe(ids.length); expect(ids.length).toBe(e.ports.length); }
  });
  it('każde złącze i sygnał portu jest w rejestrze, a sygnał ma kabel z końcówkami pasującymi do złącza', () => {
    for (const e of catalogEntries) for (const [pid, port] of Object.entries(revisionOf(e).ports)) {
      expect(starterRegistries[port.connectorKey]?.kind, `${e.key}/${pid} złącze`).toBe('connector');
      for (const s of port.signalKeys) {
        expect(starterRegistries[s]?.kind, `${e.key}/${pid} sygnał`).toBe('signal');
        if (e.packId !== 'stagewire-starter') continue; // kabel o tych samych końcówkach wymagamy tylko od pakietu startowego
        const ok = Object.values(starterRegistries).some((r) => r.kind === 'cable' && r.carriesSignals?.includes(s) && r.endPairs?.some(([a, b]) => a === port.connectorKey && b === port.connectorKey));
        expect(ok, `${e.key}/${pid}: brak kabla dla ${s} na ${port.connectorKey}`).toBe(true);
      }
    }
  });
  it('higiena IP (ADR-020): producent „Generic”, pochodzenie własne', () => {
    for (const e of catalogEntries.filter((x) => x.packId === 'stagewire-starter')) { const r = revisionOf(e); expect(r.manufacturer).toBe('Generic'); expect(r.origin?.custom).toBe(true); expect(r.origin?.packId).toBe('stagewire-starter'); }
  });
});

describe('dodawanie z katalogu', () => {
  it('projekt ze wszystkimi urządzeniami spełnia schemat i niezmienniki', () => {
    const s = new Store(empty());
    for (const e of catalogEntries) s.dispatch('d', addFromCatalog(e.key, uniqueName(e.model, Object.values(s.state.equipment).map((x) => x.name))));
    expect(checkInvariants(s.state)).toEqual([]);
    expect(schemaErrors(JSON.parse(JSON.stringify(s.state)))).toEqual([]);
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok');
    expect(validate(s.state).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('dodanie to jeden krok cofania; druga instancja nie duplikuje definicji', () => {
    const s = new Store(empty());
    s.dispatch('1', addFromCatalog('camera_sdi', 'Kamera SDI 1')); s.dispatch('2', addFromCatalog('camera_sdi', 'Kamera SDI 2'));
    expect(Object.keys(s.state.definitions)).toEqual([definitionId('camera_sdi')]);
    expect(Object.keys(s.state.equipment).length).toBe(2);
    s.undo(); expect(Object.keys(s.state.equipment).length).toBe(1);
    s.undo(); expect(Object.keys(s.state.definitions).length).toBe(0); expect(Object.keys(s.state.registries).length).toBe(0);
  });
  it('istniejących wpisów rejestru nie nadpisuje', () => {
    const p = empty(); p.registries['std/bnc-75'] = { kind: 'connector', name: 'BNC (moja nazwa)' };
    const s = new Store(p); s.dispatch('d', addFromCatalog('camera_sdi', 'K'));
    expect(s.state.registries['std/bnc-75'].name).toBe('BNC (moja nazwa)');
  });
  it('kamera → mikser: gest daje plan ok, a polecenie wybiera kabel SDI', () => {
    const s = new Store(empty());
    s.dispatch('a', addFromCatalog('camera_sdi', 'K', 'eqi_cam')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_mix'));
    const plan = planConnection(s.state, { instanceId: 'eqi_cam', portId: 'prt_sdiout' }, { instanceId: 'eqi_mix', portId: 'prt_sdiin3' }, usageOf(s.state));
    expect(plan.level).toBe('ok');
    s.dispatch('c', cmd.connect(plan.from, plan.to, plan.signalKey));
    const cab = Object.values(s.state.cables)[0]; expect(cab.cableTypeKey).toBe('std/cable-sdi');
    expect(validate(s.state).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('HDMI → wejście SDI: plan z uwagą o sygnale (V-010), nie blokada', () => {
    const s = new Store(empty());
    s.dispatch('a', addFromCatalog('laptop', 'L', 'eqi_l')); s.dispatch('b', addFromCatalog('video_switcher', 'M', 'eqi_m'));
    const plan = planConnection(s.state, { instanceId: 'eqi_l', portId: 'prt_hdmiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, usageOf(s.state));
    expect(plan.level).toBe('warn'); expect(plan.reasons.join()).toContain('V-010');
  });
});

describe('wyszukiwanie', () => {
  it('bez rozróżniania wielkości liter i polskich znaków; wszystkie słowa muszą pasować', () => {
    expect(searchCatalog('oswietlenie').map((e) => e.key).sort()).toEqual(['dmx_fixture', 'light_console']);
    expect(searchCatalog('KAMERA ptz').map((e) => e.key)).toEqual(['camera_ptz']);
    expect(searchCatalog('konwerter hdmi').filter((e) => e.packId === 'stagewire-starter').length).toBe(2);
    expect(searchCatalog('zzz')).toEqual([]);
    expect(searchCatalog('').length).toBe(catalogEntries.length);
    expect(catalogEntries.some((e) => e.packId === 'greencrew-blackmagic-design')).toBe(true);
  });
  it('uniqueName omija zajęte nazwy', () => expect(uniqueName('Kamera', ['Kamera 1', 'Kamera 2', 'Kamera 4'])).toBe('Kamera 3'));
});

describe('format identyfikatorów', () => {
  it('ID definicji i portów spełniają wzorzec formatu i są unikalne', async () => {
    const { ID_PATTERN } = await import('../src/ids.ts');
    const defIds = catalogEntries.map((e) => definitionId(e.key));
    expect(new Set(defIds).size).toBe(defIds.length);
    for (const id of defIds) expect(id).toMatch(ID_PATTERN);
    for (const e of catalogEntries) for (const pid of Object.keys(revisionOf(e).ports)) expect(pid).toMatch(ID_PATTERN);
  });
});
