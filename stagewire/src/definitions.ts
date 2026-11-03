import type { Id, Project, PortDefinition, DefinitionRevision } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { cmd } from './commands.ts';
import { ensureRegistries, catalogEntries, revisionOf } from './catalog/index.ts';
import { SOURCE_KINDS, type SourceKind } from './pack.ts';
import { newId } from './ids.ts';

/** Edycja definicji urządzenia z rewizjami (F-04, ADR-004/-029). Czyste funkcje i polecenia; interfejs w web/editor.ts. */

export type PortDraft = PortDefinition & { id: Id };

export const portDrafts = (rev: DefinitionRevision): PortDraft[] =>
  Object.entries(rev.ports).map(([id, p]) => ({ id, ...p })).sort((a, b) => a.order - b.order);

/** Nowy stabilny identyfikator portu (wzorzec formatu: prefiks_alfanumeryczne), unikalny względem `taken`. */
export function newPortId(taken: Iterable<string>, label: string): string {
  const used = new Set(taken); const base = 'prt' + '_' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'port');
  let id = base, n = 2; while (used.has(id)) id = base + n++;
  return id;
}

export interface Impact { instances: number; outdated: number; lostConnections: number; removedPorts: string[] }

/**
 * Skutki zapisu nowej rewizji z podanym zbiorem portów: ile instancji jest przypiętych do definicji,
 * ile połączeń zerwie aktualizacja ich wszystkich do nowej rewizji oraz które porty znikają.
 */
export function impactOf(p: Project, defId: Id, newPortIds: Iterable<string>): Impact {
  const keep = new Set(newPortIds);
  const def = p.definitions[defId];
  const latest = def.revisions[String(def.latestRevision)];
  const removedPorts = Object.keys(latest.ports).filter((id) => !keep.has(id));
  const mine = Object.entries(p.equipment).filter(([, e]) => e.definitionId === defId).map(([id]) => id);
  const set = new Set(mine);
  let lost = 0;
  if (removedPorts.length) {
    const gone = new Set(removedPorts);
    for (const c of Object.values(p.connections)) for (const r of [c.from, c.to]) if (set.has(r.instanceId) && gone.has(r.portId)) lost++;
  }
  return { instances: mine.length, outdated: mine.filter((id) => p.equipment[id].definitionRevision < def.latestRevision).length, lostConnections: lost, removedPorts };
}

/** Dane opisowe urządzenia edytowane w oknie definicji; `null` usuwa pole opcjonalne. Zmiany opisowe nie zmieniają klasy rewizji (kosmetyczna). */
export interface DefinitionMeta {
  manufacturer?: string; model?: string; category?: string; tags?: string[]; notes?: string; kind?: 'physical' | 'virtual';
  dimensionsMm?: { width: number; depth: number; height: number } | null; weightKg?: number | null; powerW?: number | null;
  rackUnits?: { heightU: number; widthFraction: number } | null;
  dinModules?: number | null;
  powerMaxW?: number | null;
  source?: { kind: SourceKind; ref?: string; verified?: string; url?: string; hardwareRevision?: string; generated?: boolean };
}

function applyMeta(rev: DefinitionRevision, m: DefinitionMeta) {
  const need = (v: string | undefined, what: string) => { if (v !== undefined && !v.trim()) throw new CommandError(`${what}: wartość wymagana`); };
  need(m.manufacturer, 'Producent'); need(m.model, 'Model'); need(m.category, 'Kategoria');
  if (m.manufacturer !== undefined) rev.manufacturer = m.manufacturer.trim();
  if (m.model !== undefined) rev.model = m.model.trim();
  if (m.category !== undefined) rev.category = m.category.trim();
  if (m.kind !== undefined) rev.kind = m.kind;
  if (m.tags !== undefined) { const t = m.tags.map((x) => x.trim()).filter(Boolean); if (t.length) rev.tags = [...new Set(t)]; else delete rev.tags; }
  if (m.notes !== undefined) { const n = m.notes.trim(); if (n.length > 400) throw new CommandError('Opis: najwyżej 400 znaków'); if (n) rev.notes = n; else delete rev.notes; }
  if (m.dimensionsMm !== undefined) {
    if (m.dimensionsMm === null) delete rev.dimensionsMm;
    else { for (const k of ['width', 'depth', 'height'] as const) if (!(m.dimensionsMm[k] > 0 && m.dimensionsMm[k] <= 20000)) throw new CommandError('Wymiary: liczby w mm, 1–20000'); rev.dimensionsMm = { ...m.dimensionsMm }; }
  }
  for (const [k, max, label] of [['weightKg', 5000, 'Masa'], ['powerW', 200000, 'Moc']] as const) {
    const v = m[k]; if (v === undefined) continue;
    if (v === null) delete rev[k]; else { if (!(v >= 0 && v <= max)) throw new CommandError(`${label}: liczba 0–${max}`); rev[k] = v; }
  }
  if (m.rackUnits !== undefined) {
    if (m.rackUnits === null) delete rev.rackUnits;
    else { if (!Number.isInteger(m.rackUnits.heightU) || m.rackUnits.heightU < 1 || m.rackUnits.heightU > 60 || ![1, 0.5, 0.33].includes(m.rackUnits.widthFraction)) throw new CommandError('Rack: wysokość 1–60 U, szerokość 1, 0,5 lub 0,33'); rev.rackUnits = { ...m.rackUnits }; }
  }
  if (m.powerMaxW !== undefined) {
    if (m.powerMaxW === null) delete rev.powerMaxW;
    else { if (!(m.powerMaxW >= 0 && m.powerMaxW <= 200000)) throw new CommandError('Pobór maksymalny: liczba 0–200000 W'); rev.powerMaxW = m.powerMaxW; }
  }
  if (typeof rev.powerMaxW === 'number' && typeof rev.powerW === 'number' && rev.powerMaxW < rev.powerW) throw new CommandError('Pobór maksymalny nie może być mniejszy od typowego');
  if (m.dinModules !== undefined) {
    if (m.dinModules === null) delete rev.dinModules;
    else { if (!Number.isInteger(m.dinModules) || m.dinModules < 1 || m.dinModules > 72) throw new CommandError('Szerokość na szynie DIN: całkowita liczba modułów 1–72'); rev.dinModules = m.dinModules; }
  }
  if (m.source) {
    if (!SOURCE_KINDS.includes(m.source.kind)) throw new CommandError('Nieznany rodzaj źródła danych');
    if ((m.source.kind === 'datasheet' || m.source.kind === 'manual') && !m.source.ref?.trim()) throw new CommandError('Dla karty katalogowej lub instrukcji podaj odnośnik do dokumentu');
    rev.sourceKind = m.source.kind; if (m.source.verified) rev.sourceVerified = m.source.verified; else delete rev.sourceVerified;
    rev.origin = { ...(rev.origin ?? {}), source: m.source.ref?.trim() || m.source.kind, ...(m.source.kind === 'generic' || m.source.kind === 'custom' ? { custom: true } : {}) };
    if (!(m.source.kind === 'generic' || m.source.kind === 'custom')) delete rev.origin.custom;
    if (m.source.url !== undefined) { const u = m.source.url.trim(); if (u && !/^https?:\/\/\S+$/.test(u)) throw new CommandError('Adres źródła musi zaczynać się od http:// lub https://'); if (u) rev.sourceUrl = u; else delete rev.sourceUrl; }
    if (m.source.hardwareRevision !== undefined) { const h = m.source.hardwareRevision.trim(); if (h) rev.hardwareRevision = h; else delete rev.hardwareRevision; }
    if (m.source.generated !== undefined) { if (m.source.generated) rev.sourceGenerated = true; else delete rev.sourceGenerated; }
  }
}

/**
 * Zapis nowej rewizji definicji (jedna transakcja = jeden krok cofania). `upgrade: 'all'` przepina też wszystkie instancje
 * (połączenia z usuniętymi portami są usuwane razem z osieroconymi kablami); 'none' zostawia je na starej rewizji.
 */
export function saveDefinition(defId: Id, v: { model?: string; ports: PortDraft[]; meta?: DefinitionMeta }, upgrade: 'none' | 'all'): Mutator {
  return (d) => {
    const order = new Map(v.ports.map((p, i) => [p.id, i + 1]));
    if (new Set(v.ports.map((p) => p.id)).size !== v.ports.length) throw new CommandError('Powtórzony identyfikator portu');
    for (const p of v.ports) {
      if (!p.label.trim()) throw new CommandError('Port bez nazwy');
      if (!p.signalKeys.length) throw new CommandError(`Port „${p.label}" bez sygnału`);
      if (!(p.capacity >= 1)) throw new CommandError(`Port „${p.label}": pojemność musi być ≥ 1`);
      if (new Set(p.signalKeys).size !== p.signalKeys.length) throw new CommandError(`Port „${p.label}": powtórzony sygnał`);
      if (p.group !== undefined && (typeof p.group !== 'string' || !p.group.trim() || p.group.length > 40)) throw new CommandError(`Port „${p.label}": grupa to tekst do 40 znaków`);
      const el = (p as any).electrical as { voltageMinV?: number; voltageMaxV?: number; maxW?: number } | undefined;
      if (el) {
        for (const f of ['voltageMinV', 'voltageMaxV', 'maxW'] as const) if (el[f] !== undefined && !(el[f]! >= 0 && el[f]! <= 100000)) throw new CommandError(`Port „${p.label}": ${f === 'maxW' ? 'moc' : 'napięcie'} to liczba 0–100000`);
        if (el.voltageMinV !== undefined && el.voltageMaxV !== undefined && el.voltageMinV > el.voltageMaxV) throw new CommandError(`Port „${p.label}": napięcie minimalne większe od maksymalnego`);
      }
    }
    ensureRegistries(d, v.ports.flatMap((p) => [p.connectorKey, ...p.signalKeys]));
    cmd.editDefinition(defId, (rev) => {
      if (v.model !== undefined) rev.model = v.model.trim() || rev.model;
      if (v.meta) applyMeta(rev, v.meta);
      const next: Record<string, PortDefinition> = {};
      for (const p of v.ports) { const { id, ...rest } = p; next[id] = { ...rest, label: p.label.trim(), order: order.get(id)! }; }
      rev.ports = next;
      // połączenia wewnętrzne wskazujące usunięte porty są usuwane (grupy zostają, jeśli zostały co najmniej dwa porty)
      if (rev.internalLinks) {
        const keep = (id?: string) => !!id && !!next[id];
        rev.internalLinks = rev.internalLinks.flatMap((l) => {
          if (l.members) { const m = l.members.filter(keep); return m.length >= 2 ? [{ ...l, members: m }] : []; }
          return keep(l.a) && keep(l.b) ? [l] : [];
        });
        if (!rev.internalLinks.length) delete rev.internalLinks;
      }
    })(d);
    if (upgrade === 'all') {
      const def = d.definitions[defId];
      for (const [id, e] of Object.entries(d.equipment)) if (e.definitionId === defId) cmd.upgradeInstance(id, def.latestRevision, 'delete')(d);
    }
  };
}

export function renameInstance(instanceId: Id, name: string): Mutator {
  return (d) => {
    const e = d.equipment[instanceId];
    if (!e) throw new CommandError(`Brak instancji ${instanceId}`);
    if (!name.trim()) throw new CommandError('Pusta nazwa');
    e.name = name.trim();
  };
}

/**
 * Kopia definicji jako nowe urządzenie (fork, DOMAIN-MODEL §5.3 pkt 5): nowy identyfikator, rewizja 1, te same identyfikatory portów
 * (połączenia przepięte instancji zostają), pochodzenie `derivedFrom`. `repin` przepina wskazaną instancję na kopię.
 */
export function forkDefinition(defId: Id, v: { ports: PortDraft[]; meta: DefinitionMeta }, repin?: Id, newDefId: Id = newId('eqd')): Mutator {
  return (d) => {
    const def = d.definitions[defId]; if (!def) throw new CommandError(`Brak definicji ${defId}`);
    const prev = def.revisions[String(def.latestRevision)];
    const order = new Map(v.ports.map((p, i) => [p.id, i + 1]));
    if (new Set(v.ports.map((p) => p.id)).size !== v.ports.length) throw new CommandError('Powtórzony identyfikator portu');
    for (const p of v.ports) { if (!p.label.trim()) throw new CommandError('Port bez nazwy'); if (!p.signalKeys.length) throw new CommandError(`Port „${p.label}" bez sygnału`); if (!(p.capacity >= 1)) throw new CommandError(`Port „${p.label}": pojemność musi być ≥ 1`); }
    ensureRegistries(d, v.ports.flatMap((p) => [p.connectorKey, ...p.signalKeys]));
    const next: DefinitionRevision = JSON.parse(JSON.stringify(prev));
    delete next.key; delete next.changeClass; delete next.sourceVerified;
    next.ports = {}; for (const p of v.ports) { const { id, ...rest } = p; next.ports[id] = { ...rest, label: p.label.trim(), order: order.get(id)! }; }
    next.origin = { custom: true, derivedFrom: { definitionId: defId, revision: def.latestRevision }, source: 'kopia edytowana w projekcie' }; next.sourceKind = 'custom';
    applyMeta(next, v.meta);
    if (next.model === prev.model && next.manufacturer === prev.manufacturer) next.model = `${next.model} (kopia)`;
    d.definitions[newDefId] = { latestRevision: 1, revisions: { '1': next } };
    if (repin) { const inst = d.equipment[repin]; if (!inst || inst.definitionId !== defId) throw new CommandError('Instancja nie należy do tej definicji'); inst.definitionId = newDefId; cmd.upgradeInstance(repin, 1, 'delete')(d); }
  };
}

/** Rewizja po zastosowaniu zmian (bez zapisu do projektu): do podglądu i eksportu do biblioteki. */
export function draftRevision(rev: DefinitionRevision, v: { ports: PortDraft[]; meta: DefinitionMeta }): DefinitionRevision {
  const next: DefinitionRevision = JSON.parse(JSON.stringify(rev));
  applyMeta(next, v.meta);
  next.ports = {}; v.ports.forEach((p, i) => { const { id, ...rest } = p; next.ports[id] = { ...rest, label: p.label.trim(), order: i + 1 }; });
  return next;
}

// ---------- aktualizacja definicji z biblioteki (ADR-050) ----------
/** Pola urządzenia porównywane przy wykrywaniu zmian względem pakietu (bez pochodzenia i symbolu). */
const comparable = (r: DefinitionRevision) => JSON.stringify({
  m: [r.manufacturer, r.model, r.category, r.kind], dim: r.dimensionsMm, rack: r.rackUnits, din: r.dinModules, tags: r.tags, w: r.weightKg, p: r.powerW, pm: r.powerMaxW, n: r.notes,
  s: [r.sourceKind, r.sourceVerified, r.sourceUrl, r.hardwareRevision, r.sourceGenerated],
  ports: Object.keys(r.ports).sort().map((k) => [k, r.ports[k].label, r.ports[k].connectorKey, r.ports[k].signalKeys, r.ports[k].direction, r.ports[k].capacity, r.ports[k].group, r.ports[k].electrical, r.ports[k].notes, r.ports[k].side, r.ports[k].terminal]),
  links: r.internalLinks, layer: r.placementLayer, phases: r.phaseOrder,
});

export interface LibraryUpdate {
  defId: Id; key: string; entryKey: string; model: string; fromVersion: string; toVersion: string;
  added: string[]; removed: string[]; changed: string[]; descriptive: boolean;
  instances: number; pinnedOld: number; lostConnections: number;
}

/**
 * Definicje projektu, dla których wczytany pakiet ma nowszą wersję o innej treści. Samo wykrycie niczego nie zmienia:
 * rewizje są niezmienne, instancje zostają przypięte do swoich rewizji, a nową rewizję tworzy dopiero `updateFromCatalog`.
 */
export function libraryUpdates(p: Project): LibraryUpdate[] {
  const out: LibraryUpdate[] = [];
  for (const [defId, def] of Object.entries(p.definitions)) {
    const cur = def.revisions[String(def.latestRevision)], key = cur.key;
    if (!key || !cur.origin?.packId) continue;
    const e = catalogEntries.find((x) => `${x.packId}/${x.devKey}` === key);
    if (!e) continue;
    const next = revisionOf(e);
    if (cur.origin.packVersion === e.packVersion || comparable(cur) === comparable(next)) continue;
    const added = Object.keys(next.ports).filter((id) => !cur.ports[id]).map((id) => next.ports[id].label);
    const removed = Object.keys(cur.ports).filter((id) => !next.ports[id]).map((id) => cur.ports[id].label);
    const changed = Object.keys(next.ports).filter((id) => cur.ports[id] && JSON.stringify([cur.ports[id].connectorKey, cur.ports[id].signalKeys, cur.ports[id].direction, cur.ports[id].capacity]) !== JSON.stringify([next.ports[id].connectorKey, next.ports[id].signalKeys, next.ports[id].direction, next.ports[id].capacity])).map((id) => next.ports[id].label);
    const imp = impactOf(p, defId, Object.keys(next.ports));
    out.push({ defId, key, entryKey: e.key, model: `${next.manufacturer} ${next.model}`, fromVersion: cur.origin.packVersion ?? '?', toVersion: e.packVersion, added, removed, changed, descriptive: !added.length && !removed.length && !changed.length, instances: imp.instances, pinnedOld: imp.outdated, lostConnections: imp.lostConnections });
  }
  return out;
}

/**
 * Nowa rewizja definicji z aktualnego wpisu biblioteki (jedna transakcja). Domyślnie `none`: istniejące instancje zostają na swoich rewizjach
 * (żaden port ani połączenie nie znika), a użytkownik przepina je świadomie. `all` przepina wszystkie i usuwa połączenia z portów, których nowa wersja już nie ma.
 */
export function updateFromCatalog(defId: Id, upgrade: 'none' | 'all' = 'none'): Mutator {
  return (d) => {
    const def = d.definitions[defId]; if (!def) throw new CommandError(`Brak definicji ${defId}`);
    const key = def.revisions[String(def.latestRevision)].key;
    const e = key ? catalogEntries.find((x) => `${x.packId}/${x.devKey}` === key) : undefined;
    if (!e) throw new CommandError('Ta definicja nie pochodzi z wczytanego pakietu biblioteki');
    const fresh = revisionOf(e);
    ensureRegistries(d, Object.values(fresh.ports).flatMap((q) => [q.connectorKey, ...q.signalKeys]));
    cmd.editDefinition(defId, (rev) => { for (const k of Object.keys(rev)) delete (rev as Record<string, unknown>)[k]; Object.assign(rev, fresh); })(d);
    if (upgrade === 'all') for (const [id, inst] of Object.entries(d.equipment)) if (inst.definitionId === defId) cmd.upgradeInstance(id, d.definitions[defId].latestRevision, 'delete')(d);
  };
}
