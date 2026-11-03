import type { Project, Id } from './types.ts';
import type { Mutator } from './store.ts';

/**
 * Wersjonowanie formatu projektu i migracje (ADR-065).
 *
 * Zasady (obowiązują każdą przyszłą wersję programu):
 *  1. Zmiana w obrębie MAJOR jest **addytywna** (nowe pola opcjonalne). Dodanie funkcji podnosi MINOR i dopisuje migrację (zwykle tylko uzupełnia domyślne wartości).
 *  2. Zmiana łamiąca podnosi MAJOR i **musi** mieć migrację ze wszystkich wcześniejszych wersji. Użytkownik nigdy nie musi budować projektu od nowa, żeby użyć nowszej wersji programu.
 *  3. Migracje są czystymi funkcjami JSON → JSON, wołanymi łańcuchowo po wersji formatu; są testowane na korpusie plików z każdej wersji (`fixtures/format/`).
 *  4. Plik z nowszym MINOR otwiera się (nieznane pola są zachowywane przy zapisie); plik z nowszym MAJOR tylko do odczytu metadanych.
 *  5. Zmiany zachowania istniejących danych (np. domyślne ukrywanie osprzętu na schemacie) nie są migracjami formatu, tylko **ulepszeniami do włączenia** (`UPGRADES`): w starym projekcie użytkownik decyduje, w nowym są włączone od początku.
 */
export interface Migration {
  id: string;
  title: string;
  /** Czy migracja dotyczy pliku w tej wersji formatu. */
  applies(version: string): boolean;
  /** Wersja formatu po migracji. */
  to: string;
  up(json: any): any;
}

/** [major, minor, patch, wydanie]; wydanie 0 = wersja robocza (`-draft`), 1 = wydanie (robocza jest starsza od wydania o tych samych liczbach). */
export function parseFormat(v: string): [number, number, number, number] {
  const [core, pre] = String(v).split('-'); const [a = 0, b = 0, c = 0] = core.split('.').map((x) => Number(x) || 0);
  return [a, b, c, pre ? 0 : 1];
}
export function compareFormat(a: string, b: string): number {
  const x = parseFormat(a), y = parseFormat(b);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export const majorOf = (v: string): number => parseFormat(v)[0];

/** v0 → 1.0.0-draft: tablice → mapy, brak medium → physical. */
export function migrate0to1(j: any): any {
  const toMap = (arr: any[] | undefined) => Object.fromEntries((arr ?? []).map(({ id, ...rest }: any) => [id, rest]));
  const connections = toMap(j.connections);
  for (const c of Object.values<any>(connections)) { c.medium ??= 'physical'; c.cableId ??= null; }
  return { ...j, formatVersion: '1.0.0-draft', equipment: toMap(j.equipment), connections, cables: toMap(j.cables) };
}

/** Lista migracji w kolejności wykonywania. Dopisuj na końcu; nie zmieniaj i nie usuwaj istniejących. */
export const MIGRATIONS: Migration[] = [
  { id: 'v0-to-v1', title: 'Format 0.x → 1.0 (kolekcje jako mapy, medium połączeń)', applies: (v) => majorOf(v) === 0, to: '1.0.0-draft', up: migrate0to1 },
];

export interface MigrationResult { json: any; applied: string[]; from: string; to: string }
/** Podnosi JSON projektu do najnowszej wersji, jaką zna ta kopia programu. */
export function migrateProject(input: any, registry: Migration[] = MIGRATIONS): MigrationResult {
  let json = input; const from = String(input?.formatVersion ?? '0'), applied: string[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const v = String(json?.formatVersion ?? '0'), m = registry.find((x) => x.applies(v) && !applied.includes(x.id));
    if (!m) break;
    json = m.up(json); json.formatVersion = m.to; applied.push(m.id);
  }
  return { json, applied, from, to: String(json?.formatVersion ?? from) };
}

// ---------- ulepszenia do włączenia (zmiany zachowania istniejących danych) ----------
export interface Upgrade {
  id: string;
  title: string;
  description: string;
  /** Czy ulepszenie ma sens dla tego projektu (np. są elementy, których dotyczy). */
  applies(p: Project): boolean;
  apply: Mutator;
}
/** Ulepszenia dostępne w tej wersji programu. Nowe projekty mają je oznaczone jako zastosowane; starsze: użytkownik decyduje. */
export const UPGRADES: Upgrade[] = [];

interface UpgradeState { applied?: string[]; dismissed?: string[] }
const stateOf = (p: { ext?: Record<string, unknown> }): UpgradeState => ((p.ext?.upgrades ?? {}) as UpgradeState);

export function pendingUpgrades(p: Project, registry: Upgrade[] = UPGRADES): Upgrade[] {
  const s = stateOf(p);
  return registry.filter((u) => !s.applied?.includes(u.id) && !s.dismissed?.includes(u.id) && u.applies(p));
}
export function dismissedUpgrades(p: Project, registry: Upgrade[] = UPGRADES): Upgrade[] {
  const s = stateOf(p);
  return registry.filter((u) => s.dismissed?.includes(u.id) && !s.applied?.includes(u.id));
}

const touch = (d: { ext?: Record<string, unknown> }): UpgradeState => { d.ext ??= {}; return ((d.ext.upgrades ??= {}) as UpgradeState); };
export const upgradeCmd = {
  /** Stosuje wybrane ulepszenia jedną transakcją (cofanie przywraca stan sprzed). */
  apply(ids: Id[], registry: Upgrade[] = UPGRADES): Mutator {
    return (d) => {
      const st = touch(d);
      for (const id of ids) { const u = registry.find((x) => x.id === id); if (!u) continue; u.apply(d); st.applied = [...new Set([...(st.applied ?? []), id])]; st.dismissed = (st.dismissed ?? []).filter((x) => x !== id); }
    };
  },
  /** „Nie teraz”: ulepszenie przestaje się przypominać, ale zostaje dostępne w oknie aktualizacji. */
  dismiss(ids: Id[]): Mutator { return (d) => { const st = touch(d); st.dismissed = [...new Set([...(st.dismissed ?? []), ...ids])]; }; },
  /** Nowy projekt: wszystkie ulepszenia tej wersji są od początku częścią projektu. */
  markAllApplied(registry: Upgrade[] = UPGRADES): Mutator { return (d) => { const st = touch(d); st.applied = registry.map((u) => u.id); delete st.dismissed; }; },
};
