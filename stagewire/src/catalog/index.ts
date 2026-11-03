import type { Id, DefinitionRevision, RegistryEntry } from '../types.ts';
import { CommandError, type Mutator } from '../store.ts';
import { newId } from '../ids.ts';
import { validatePack, deviceToRevision, definitionIdOf, type Pack, type PackDevice, type PackPort, type PackReport } from '../pack.ts';
import starterJson from './stagewire-starter.pack.json' with { type: 'json' };
import registriesJson from './stagewire-registries.pack.json' with { type: 'json' };
import blackmagicJson from './greencrew-blackmagic-design.swpack.json' with { type: 'json' };

/**
 * Katalog urządzeń = suma wczytanych pakietów (ADR-049). Pakiet startowy jest wbudowany; pakiety użytkownika
 * wczytuje aplikacja z folderu biblioteki. Wpisy rejestrów (złącza, sygnały, kable) są wspólne dla wszystkich pakietów.
 */
export const STARTER_ID = 'stagewire-starter';
/** Pakiety wbudowane: nie można ich usunąć ani nadpisać plikiem z biblioteki. */
export const BUILTIN_IDS = new Set([STARTER_ID, 'stagewire-registries', 'greencrew-blackmagic-design']);
export interface CatalogEntry {
  /** Klucz w interfejsie i poleceniach: dla pakietu startowego sam klucz urządzenia (zgodność wsteczna), dla innych `pakiet/urządzenie`. */
  key: string; packId: string; packName: string; packVersion: string; devKey: string;
  manufacturer: string; model: string; category: string; tags: string[]; description: string;
  ports: PackPort[]; device: PackDevice; pack: Pack;
}

const packs = new Map<string, Pack>();
/** Wszystkie znane wpisy rejestrów (z wczytanych pakietów); obiekt jest uzupełniany na bieżąco. */
export const starterRegistries: Record<string, RegistryEntry> = {};
export let catalogEntries: CatalogEntry[] = [];

const entryKey = (packId: string, devKey: string) => (packId === STARTER_ID ? devKey : `${packId}/${devKey}`);

function rebuild() {
  for (const k of Object.keys(starterRegistries)) delete starterRegistries[k];
  const list: CatalogEntry[] = [];
  for (const pack of packs.values()) {
    for (const [k, r] of Object.entries(pack.registries ?? {})) if (!starterRegistries[k]) starterRegistries[k] = JSON.parse(JSON.stringify(r));
    for (const d of pack.devices) list.push({ key: entryKey(pack.id, d.key), packId: pack.id, packName: pack.name, packVersion: pack.version, devKey: d.key, manufacturer: d.manufacturer, model: d.model, category: d.category, tags: d.tags ?? [], description: d.description ?? '', ports: d.ports, device: d, pack });
  }
  catalogEntries = list;
}

// ---------- instalacja pakietów (ADR-050) ----------
export type InstallStatus = 'new' | 'identical' | 'upgrade' | 'downgrade' | 'changed-same-version';
export interface InstallPlan extends PackReport {
  status?: InstallStatus; previous?: Pack;
  /** Klucze urządzeń: dodane, usunięte, zmienione względem wczytanej wersji pakietu. */
  added: string[]; removed: string[]; changed: string[];
  /** Zmiany łamiące zgodność: urządzenia usunięte z pakietu i porty usunięte z urządzeń (projekty mają własne kopie definicji i nie są ruszane). */
  breaking: string[];
  newRegistries: string[]; reusedRegistries: string[];
}

const verParts = (v: string) => v.split('.').map(Number);
export function compareVersions(a: string, b: string): number { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; }
/** Porównanie głębokie niezależne od kolejności kluczy. */
function canon(v: unknown): string { return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)); }

/**
 * Sprawdza, co by się stało po wczytaniu pakietu, niczego nie zmieniając. Błędy blokują: niepoprawny pakiet, brakujące wpisy rejestrów,
 * konflikt wpisu rejestru z inną definicją o tym samym kluczu, kolizja identyfikatora urządzenia z innym pakietem.
 * Status wersji (nowy/ten sam/nowszy/starszy) jest informacją; decyzję o zastąpieniu podejmuje wywołujący.
 */
export function planInstall(raw: unknown): InstallPlan {
  const empty = { added: [] as string[], removed: [] as string[], changed: [] as string[], breaking: [] as string[], newRegistries: [] as string[], reusedRegistries: [] as string[] };
  const id = raw && typeof raw === 'object' ? (raw as any).id : undefined;
  const prev = typeof id === 'string' ? packs.get(id) : undefined;
  // rejestry i urządzenia pozostałych pakietów (pakiet o tym samym id jest zastępowany, więc go pomijamy)
  const known: Record<string, RegistryEntry> = {}, owner = new Map<string, string>(), defOwner = new Map<string, string>();
  for (const q of packs.values()) {
    if (q.id === id) continue;
    for (const [k, r] of Object.entries(q.registries ?? {})) if (!known[k]) { known[k] = r; owner.set(k, q.id); }
    for (const d of q.devices) defOwner.set(definitionIdOf(q.id, d.key), `${q.id}/${d.key}`);
  }
  const rep = validatePack(raw, known);
  if (!rep.pack) return { errors: rep.errors, warnings: rep.warnings, ...empty };
  const pack = rep.pack, errors = [...rep.errors], plan: InstallPlan = { errors, warnings: [...rep.warnings], pack, previous: prev, ...empty };
  for (const [k, r] of Object.entries(pack.registries ?? {})) {
    if (known[k]) {
      if (canon(known[k]) === canon(r)) plan.reusedRegistries.push(k);
      else errors.push(`registries["${k}"]: konflikt z pakietem „${owner.get(k)}”, który definiuje ten klucz inaczej (${known[k].kind} „${known[k].name}” zamiast ${r.kind} „${r.name}”). Zmień klucz (np. user/${pack.id}-…) albo użyj wpisu z pakietu źródłowego bez własnej definicji`);
    } else plan.newRegistries.push(k);
  }
  for (const d of pack.devices) { const other = defOwner.get(definitionIdOf(pack.id, d.key)); if (other) errors.push(`devices (${d.key}): identyfikator definicji koliduje z urządzeniem ${other} z innego pakietu; zmień id pakietu lub klucz urządzenia`); }
  if (!prev) plan.status = 'new';
  else {
    const c = compareVersions(pack.version, prev.version);
    plan.status = c > 0 ? 'upgrade' : c < 0 ? 'downgrade' : canon(pack) === canon(prev) ? 'identical' : 'changed-same-version';
    const oldD = new Map(prev.devices.map((d) => [d.key, d])), newD = new Map(pack.devices.map((d) => [d.key, d]));
    for (const [k, d] of newD) { const o = oldD.get(k); if (!o) plan.added.push(k); else if (canon(o) !== canon(d)) plan.changed.push(k); }
    for (const [k, o] of oldD) {
      const n = newD.get(k);
      if (!n) { plan.removed.push(k); plan.breaking.push(`urządzenie ${k} zostało usunięte z pakietu`); continue; }
      const gone = o.ports.filter((q) => !n.ports.some((x) => x.key === q.key)).map((q) => q.key);
      if (gone.length) plan.breaking.push(`urządzenie ${k}: usunięte porty ${gone.join(', ')}`);
    }
  }
  return plan;
}

/** Wczytuje pakiet atomowo: najpierw pełne sprawdzenie, dopiero potem zmiana katalogu. Przy błędach katalog pozostaje bez zmian. */
export function installPack(raw: unknown): InstallPlan {
  const plan = planInstall(raw);
  if (plan.pack && !plan.errors.length && plan.status !== 'identical') { packs.set(plan.pack.id, plan.pack); rebuild(); }
  return plan;
}
/** Zgodność wsteczna: wczytanie pakietu (pakiet o tym samym id zastępuje poprzedni). */
export const loadPack = (raw: unknown): InstallPlan => installPack(raw);
export const unloadPack = (id: string) => { if (!BUILTIN_IDS.has(id) && packs.delete(id)) rebuild(); };
export const loadedPacks = (): Pack[] => [...packs.values()];

for (const json of [starterJson, registriesJson, blackmagicJson]) {
  const rep = installPack(json); if (!rep.pack || rep.errors.length) throw new Error('Pakiet wbudowany jest niepoprawny: ' + rep.errors.slice(0, 3).join('; '));
}

export const findEntry = (key: string): CatalogEntry | undefined => catalogEntries.find((e) => e.key === key);
export const revisionOf = (e: CatalogEntry): DefinitionRevision => deviceToRevision(e.pack, e.device);
export const definitionId = (key: string): string => { const e = findEntry(key); return e ? definitionIdOf(e.packId, e.devKey) : definitionIdOf(STARTER_ID, key); };

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Wyszukiwanie po producencie, modelu, kategorii, tagach, opisie i nazwie pakietu; bez rozróżniania wielkości liter i polskich znaków; wszystkie słowa muszą pasować. */
export function searchCatalog(query: string): CatalogEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return catalogEntries;
  return catalogEntries.filter((e) => { const hay = fold(`${e.manufacturer} ${e.model} ${e.category} ${e.tags.join(' ')} ${e.description} ${e.packName}`); return words.every((w) => hay.includes(w)); });
}

/** Dopisuje do rejestrów projektu brakujące wpisy (złącza, sygnały) i typy kabli, których końcówki są już obecne. Nie nadpisuje istniejących. */
export function ensureRegistries(d: { registries: Record<string, any> }, keys: Iterable<string>): void {
  for (const k of keys) if (!d.registries[k] && starterRegistries[k]) d.registries[k] = JSON.parse(JSON.stringify(starterRegistries[k]));
  for (const [k, r] of Object.entries(starterRegistries)) if (r.kind === 'cable' && !d.registries[k] && r.endPairs?.some(([a, b]) => d.registries[a] && d.registries[b])) d.registries[k] = JSON.parse(JSON.stringify(r));
}

/**
 * Dodanie urządzenia z katalogu w jednej transakcji (jeden krok cofania): brakujące wpisy rejestrów,
 * definicja (jeśli jeszcze jej nie ma w projekcie) i instancja przypięta do jej najnowszej rewizji.
 * Wpisów rejestrów i definicji już obecnych w projekcie nie nadpisujemy (użytkownik mógł je zmienić).
 */
export function addFromCatalog(key: string, name: string, instanceId: Id = newId('eqi')): Mutator {
  const e = findEntry(key);
  if (!e) throw new CommandError(`Brak wpisu katalogu ${key}`);
  return (d) => {
    const rev = revisionOf(e);
    ensureRegistries(d, Object.values(rev.ports).flatMap((p) => [p.connectorKey, ...p.signalKeys]));
    const defId = definitionIdOf(e.packId, e.devKey);
    const existing = d.definitions[defId];
    const exKey = existing && (existing.revisions[String(existing.latestRevision)] as any)?.key;
    if (exKey && exKey !== rev.key) throw new CommandError(`Identyfikator definicji ${defId} jest już użyty w projekcie przez inne urządzenie (${exKey})`);
    if (!existing) d.definitions[defId] = { latestRevision: 1, revisions: { '1': rev } };
    d.equipment[instanceId] = { definitionId: defId, definitionRevision: d.definitions[defId].latestRevision, name, supply: 'unknown', portOverrides: {} };
  };
}

/** Nazwa instancji unikalna w projekcie (V-012): „Model 1”, „Model 2”… */
export function uniqueName(model: string, existing: Iterable<string>): string {
  const used = new Set(existing); let n = 1;
  while (used.has(`${model} ${n}`)) n++;
  return `${model} ${n}`;
}
