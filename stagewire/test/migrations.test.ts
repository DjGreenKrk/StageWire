import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { packProject, openProject, canonicalStringify, CURRENT_FORMAT, schemaErrors } from '../src/format.ts';
import { validate } from '../src/validation.ts';
import { syntheticProject } from '../src/synthetic.ts';
import { compareFormat, migrateProject, pendingUpgrades, dismissedUpgrades, upgradeCmd, UPGRADES, type Migration, type Upgrade } from '../src/migrations.ts';
import type { Project } from '../src/types.ts';

/** Plik .sw z dowolnym JSON-em projektu (także z przyszłej lub przeszłej wersji formatu). */
function zipOf(json: any): Uint8Array {
  const body = canonicalStringify(json), manifest = { formatVersion: json.formatVersion, appVersion: 't', sha256: createHash('sha256').update(body).digest('hex') };
  return zipSync({ 'manifest.json': strToU8(canonicalStringify(manifest)), 'project.json': strToU8(body) });
}

describe('wersje formatu', () => {
  it('porządek: robocza < wydanie, drobne i większe rosną', () => {
    expect(compareFormat('1.0.0-draft', '1.0.0')).toBe(-1);
    expect(compareFormat('1.0.0', '1.1.0')).toBe(-1);
    expect(compareFormat('1.9.0', '2.0.0')).toBe(-1);
    expect(compareFormat('1.0.0-draft', '1.0.0-draft')).toBe(0);
    expect(compareFormat('2.0.0', '1.9.9')).toBe(1);
  });
});

describe('migracje', () => {
  const reg: Migration[] = [
    { id: 'a', title: 'a', applies: (v) => v === '1.0.0', to: '1.1.0', up: (j) => ({ ...j, extra: { n: 1 } }) },
    { id: 'b', title: 'b', applies: (v) => v === '1.1.0', to: '2.0.0', up: (j) => ({ ...j, extra: { n: j.extra.n + 1 } }) },
  ];
  it('wołane łańcuchowo po wersji, każda raz', () => {
    const r = migrateProject({ formatVersion: '1.0.0' }, reg);
    expect(r.applied).toEqual(['a', 'b']); expect(r.to).toBe('2.0.0'); expect(r.json.extra.n).toBe(2);
  });
  it('plik w aktualnej wersji nie jest ruszany; wejście nie jest mutowane', () => {
    const inp = { formatVersion: '2.0.0', x: 1 }, r = migrateProject(inp, reg);
    expect(r.applied).toEqual([]); expect(r.json).toBe(inp);
    const old = { formatVersion: '1.0.0' }; migrateProject(old, reg); expect(old).toEqual({ formatVersion: '1.0.0' });
  });
  it('każdy plik z korpusu fixtures/ otwiera się w aktualnej wersji, jest zgodny ze schematem i po zapisie daje ten sam wynik', () => {
    const files = readdirSync('fixtures').filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const raw = JSON.parse(readFileSync('fixtures/' + f, 'utf8')), r = openProject(zipOf(raw));
      expect(r.status, f).toBe('ok'); if (r.status !== 'ok') continue;
      expect(r.project.formatVersion, f).toBe(CURRENT_FORMAT); expect(schemaErrors(r.project), f).toEqual([]);
      expect(() => validate(r.project), f).not.toThrow();
      const again = openProject(packProject(r.project)); expect(again.status, f).toBe('ok');
      if (again.status === 'ok') expect(canonicalStringify(again.project), f).toBe(canonicalStringify(r.project));
    }
  });
  it('plik z formatu 0.x jest zgłaszany jako zmigrowany', () => {
    const r = openProject(zipOf(JSON.parse(readFileSync('fixtures/legacy-v0.json', 'utf8'))));
    expect(r.status).toBe('ok'); if (r.status === 'ok') { expect(r.migrations).toEqual(['v0-to-v1']); expect(r.migratedFrom).toBe('0.9.0'); }
  });
});

describe('zgodność w przód (plik z nowszą wersją drobną)', () => {
  it('otwiera się, a nieznane dane (ext, pola projektu) przeżywają zapis i odczyt', () => {
    const p = syntheticProject(2, 1, 1, true) as any;
    p.formatVersion = '1.7.0'; p.ext = { przyszlosc: { a: [1, 2, 3] }, upgrades: { applied: ['x'] } };
    const r = openProject(zipOf(p));
    expect(r.status).toBe('ok'); if (r.status !== 'ok') return;
    expect(r.newerMinor).toBe('1.7.0');
    const back = openProject(packProject(r.project)); expect(back.status).toBe('ok');
    if (back.status === 'ok') expect((back.project.ext as any).przyszlosc).toEqual({ a: [1, 2, 3] });
  });
  it('nieznane pola w korzeniu projektu i w obiektach przeżywają zapis', () => {
    const p = syntheticProject(2, 1, 1, true) as any; p.formatVersion = '1.7.0'; p.przyszlaKolekcja = { x: { a: 1 } };
    const first = Object.values(p.equipment)[0] as any; first.nowePole = { k: 1 };
    const r = openProject(zipOf(p)); expect(r.status).toBe('ok'); if (r.status !== 'ok') return;
    const back = openProject(packProject(r.project)); expect(back.status).toBe('ok');
    if (back.status === 'ok') { expect((back.project as any).przyszlaKolekcja).toEqual({ x: { a: 1 } }); expect((Object.values(back.project.equipment)[0] as any).nowePole).toEqual({ k: 1 }); }
  });
  it('nowszy MAJOR: tylko metadane, bez migracji', () => {
    const p = syntheticProject(1, 0, 1, true) as any; p.formatVersion = '9.0.0';
    expect(openProject(zipOf(p)).status).toBe('newer-major');
  });
});

describe('ulepszenia do włączenia', () => {
  const up = (id: string, ok = true): Upgrade => ({ id, title: id, description: id, applies: () => ok, apply: (d) => { (d.ext ??= {})[id] = true; } });
  const reg = [up('u1'), up('u2'), up('u3', false)];
  const fresh = (): Store => new Store(syntheticProject(1, 0, 1, true) as Project);
  it('stary projekt (bez zapisu) ma dostępne ulepszenia, które mają sens; nowy nie ma żadnych', () => {
    const s = fresh(); expect(pendingUpgrades(s.state, reg).map((u) => u.id)).toEqual(['u1', 'u2']);
    s.dispatch('nowy', upgradeCmd.markAllApplied(reg)); expect(pendingUpgrades(s.state, reg)).toEqual([]);
  });
  it('zastosowanie jest jedną transakcją i da się cofnąć', () => {
    const s = fresh(); s.dispatch('u', upgradeCmd.apply(['u1'], reg));
    expect((s.state.ext as any).u1).toBe(true); expect(pendingUpgrades(s.state, reg).map((u) => u.id)).toEqual(['u2']);
    s.undo(); expect((s.state.ext as any)?.u1).toBeUndefined(); expect(pendingUpgrades(s.state, reg).length).toBe(2);
  });
  it('„Nie teraz” przestaje przypominać, ale ulepszenie zostaje do późniejszego zastosowania', () => {
    const s = fresh(); s.dispatch('d', upgradeCmd.dismiss(['u1', 'u2']));
    expect(pendingUpgrades(s.state, reg)).toEqual([]); expect(dismissedUpgrades(s.state, reg).map((u) => u.id)).toEqual(['u1', 'u2']);
    s.dispatch('a', upgradeCmd.apply(['u2'], reg)); expect(dismissedUpgrades(s.state, reg).map((u) => u.id)).toEqual(['u1']);
  });
  it('stan ulepszeń jest zwykłym polem `ext` i przeżywa zapis pliku', () => {
    const s = fresh(); s.dispatch('a', upgradeCmd.apply(['u1'], reg));
    const back = openProject(packProject(s.state)); expect(back.status).toBe('ok');
    if (back.status === 'ok') expect(pendingUpgrades(back.project, reg).map((u) => u.id)).toEqual(['u2']);
  });
  it('rejestr produkcyjny jest spójny (unikalne identyfikatory)', () => { const ids = UPGRADES.map((u) => u.id); expect(new Set(ids).size).toBe(ids.length); });
});
