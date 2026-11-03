import { describe, it, expect } from 'vitest';
import { catalogEntries, starterRegistries, installPack, unloadPack } from '../src/catalog/index.ts';
import { buildFacets, filterEntries, toggleSelection, facetValues, sortEntries } from '../src/libraryIndex.ts';
import { presetsAvailable, expandPreset, buildDevice, mergeIntoMine, singleDevicePack, checkDevice, registriesFor, removeFromPack, MY_PACK_ID } from '../src/deviceBuild.ts';

const dev = (model: string, extra: any = {}) => buildDevice({ manufacturer: 'Test', model, category: 'Testowa', ports: expandPreset(presetsAvailable(starterRegistries)[0], 2, []), source: { kind: 'estimated' }, ...extra });

describe('filtry biblioteki', () => {
  it('liczniki wartości uwzględniają pozostałe filtry; wybór zawęża listę; LUB w filtrze, I między filtrami', () => {
    const all = catalogEntries, f0 = buildFacets(all, '', {});
    const cats = f0.find((f) => f.id === 'category')!; expect(cats.values.reduce((a, v) => a + v.count, 0)).toBe(all.length);
    const some = cats.values[0], sel = toggleSelection({}, 'category', some.value);
    expect(filterEntries(all, '', sel).length).toBe(some.count);
    const mf = buildFacets(all, '', sel).find((f) => f.id === 'manufacturer')!; expect(mf.values.reduce((a, v) => a + v.count, 0)).toBe(some.count);
    // dwa filtry kategorii = LUB (więcej wyników niż jeden)
    const two = cats.values.slice(0, 2).reduce((s, v) => toggleSelection(s, 'category', v.value), {} as any);
    expect(filterEntries(all, '', two).length).toBe(cats.values[0].count + cats.values[1].count);
    expect(toggleSelection(sel, 'category', some.value)).toEqual({});
  });
  it('wejścia i wyjścia wg kierunku portów, tekst bez polskich znaków i wielkości liter', () => {
    const cam = catalogEntries.find((e) => e.key === 'camera_sdi')!, fv = facetValues(cam);
    expect(fv.outputs).toContain('std/sdi-3g'); expect(fv.inputs).not.toContain('std/sdi-3g');
    expect(filterEntries(catalogEntries, 'KAMERA sdi', {}).some((e) => e.key === 'camera_sdi')).toBe(true);
    expect(filterEntries(catalogEntries, '', { outputs: ['std/sdi-3g'] }).every((e) => facetValues(e).outputs.includes('std/sdi-3g'))).toBe(true);
    expect(sortEntries(catalogEntries)[0].manufacturer.localeCompare(sortEntries(catalogEntries).at(-1)!.manufacturer, 'pl')).toBeLessThanOrEqual(0);
  });
});

describe('budowanie i udostępnianie pojedynczych urządzeń', () => {
  it('zestawy portów: numeracja ciągnie dalej, klucze unikalne, tylko wpisy znane w rejestrach', () => {
    const pre = presetsAvailable(starterRegistries), xlr = pre.find((p) => p.id === 'xlr-in')!;
    expect(pre.length).toBeGreaterThan(8);
    const a = expandPreset(xlr, 4, []), b = expandPreset(xlr, 4, a);
    expect(a.map((p) => p.label)).toEqual(['XLR IN 1', 'XLR IN 2', 'XLR IN 3', 'XLR IN 4']); expect(b[0].label).toBe('XLR IN 5');
    expect(new Set([...a, ...b].map((p) => p.key)).size).toBe(8);
  });
  it('urządzenie z kreatora przechodzi walidację; brak wymaganych pól jest zgłaszany', () => {
    const ok = dev('Mikser X'); expect(checkDevice(ok, starterRegistries).errors).toEqual([]);
    const bad = buildDevice({ manufacturer: '', model: 'Y', category: 'k', ports: [], source: { kind: 'datasheet' } });
    expect(checkDevice(bad, starterRegistries).errors.length).toBeGreaterThan(0);
  });
  it('dopisanie jednego urządzenia nie rusza reszty pakietu; identyczne pomijane; konflikt: podmień / zachowaj oba / pomiń', () => {
    const regs = registriesFor([dev('A')], starterRegistries);
    const r1 = mergeIntoMine(undefined, [dev('A'), dev('B')], regs); expect(r1.pack.id).toBe(MY_PACK_ID); expect(r1.added).toEqual(['a', 'b']); expect(r1.pack.version).toBe('1.0.1');
    const r2 = mergeIntoMine(r1.pack, [dev('A')], regs); expect(r2.skipped).toEqual(['a']); expect(r2.pack.version).toBe('1.0.1'); // bez zmian: wersja nie rośnie
    const changed = dev('A', { weightKg: 9 });
    expect(mergeIntoMine(r1.pack, [changed], regs, () => 'replace').replaced).toEqual(['a']);
    const both = mergeIntoMine(r1.pack, [changed], regs, () => 'keep-both'); expect(both.pack.devices.map((d) => d.key)).toEqual(['a', 'b', 'a-2']); expect(both.renamed).toEqual([['a', 'a-2']]);
    expect(mergeIntoMine(r1.pack, [changed], regs, () => 'skip').pack.devices.length).toBe(2);
    expect(removeFromPack(r1.pack, 'a').devices.map((d) => d.key)).toEqual(['b']);
  });
  it('pakiet jednourządzeniowy jest samowystarczalny: waliduje się bez zewnętrznych rejestrów i da się wczytać', () => {
    const d = dev('Własny konwerter'), { pack, report } = singleDevicePack(d, starterRegistries, { author: 'Ja', license: 'CC0' });
    expect(report.errors).toEqual([]); expect(pack.devices).toHaveLength(1); expect(Object.keys(pack.registries!).length).toBeGreaterThan(0);
    const plan = installPack(pack); expect(plan.errors).toEqual([]); expect(catalogEntries.some((e) => e.packId === pack.id)).toBe(true);
    unloadPack(pack.id);
  });
});
