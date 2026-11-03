import type { Patch } from 'immer';
import type { Project } from './types.ts';
import { ID_PATTERN } from './ids.ts';

/**
 * Niezmienniki strukturalne (DOMAIN-MODEL §6). Naruszenie = błąd programistyczny:
 * transakcja jest odrzucana i nigdy nie trafia do stanu.
 *
 * Dwie ścieżki: pełna (checkInvariants) i przyrostowa (checkInvariantsIncremental, tylko obiekty
 * dotknięte łatami i ich zależności). W testach Store porównuje obie (tryb 'both').
 */

const COLLECTIONS = ['definitions', 'equipment', 'connections', 'cables', 'spaces', 'zones', 'racks', 'cabinets', 'stageObjects', 'placements', 'views'] as const;
type Coll = (typeof COLLECTIONS)[number];
const coll = (p: Project, name: Coll): Record<string, unknown> | undefined => (p as any)[name];

// ---------- sprawdzenia pojedynczych obiektów ----------

function checkDefinition(p: Project, did: string, v: string[]): void {
  const def = p.definitions[did];
  if (!def) return;
  if (!def.revisions[String(def.latestRevision)]) v.push(`definicja ${did}: brak latestRevision ${def.latestRevision}`);
  for (const [rn, rev] of Object.entries(def.revisions)) {
    for (const [pid, port] of Object.entries(rev.ports)) {
      if (!p.registries[port.connectorKey]) v.push(`definicja ${did}@${rn} port ${pid}: brak złącza ${port.connectorKey} w rejestrze`);
      for (const s of port.signalKeys) if (!p.registries[s]) v.push(`definicja ${did}@${rn} port ${pid}: brak sygnału ${s} w rejestrze`);
    }
  }
}

function checkInstance(p: Project, iid: string, v: string[]): void {
  const inst = p.equipment[iid];
  if (!inst) return;
  const def = p.definitions[inst.definitionId];
  if (!def) { v.push(`instancja ${iid}: brak definicji ${inst.definitionId}`); return; }
  if (!def.revisions[String(inst.definitionRevision)]) v.push(`instancja ${iid}: brak rewizji ${inst.definitionRevision} definicji ${inst.definitionId}`);
  if (inst.mount && !p.racks?.[inst.mount.rackId]) v.push(`instancja ${iid}: pozycja w nieistniejącym racku ${inst.mount.rackId}`);
  if (inst.din && !p.cabinets?.[inst.din.cabinetId]) v.push(`instancja ${iid}: pozycja w nieistniejącej szafie ${inst.din.cabinetId}`);
  if (inst.din && inst.mount) v.push(`instancja ${iid}: jednocześnie w racku i na szynie DIN`);
  if (inst.plate && !p.cabinets?.[inst.plate.cabinetId]) v.push(`instancja ${iid}: płyta w nieistniejącej szafie ${inst.plate.cabinetId}`);
  if (inst.plate && (inst.din || inst.mount)) v.push(`instancja ${iid}: jednocześnie na płycie i na szynie albo w racku`);
}

function checkConnection(p: Project, cid: string, v: string[]): void {
  const c = p.connections[cid];
  if (!c) return;
  for (const end of [c.from, c.to]) {
    const inst = p.equipment[end.instanceId];
    if (!inst) { v.push(`połączenie ${cid}: brak instancji ${end.instanceId}`); continue; }
    const rev = p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)];
    if (!rev?.ports[end.portId]) v.push(`połączenie ${cid}: port ${end.portId} nie istnieje w przypiętej rewizji ${inst.definitionId}@${inst.definitionRevision}`);
  }
  if (c.from.instanceId === c.to.instanceId && c.from.portId === c.to.portId) v.push(`połączenie ${cid}: from == to`);
  if (!p.registries[c.signalKey]) v.push(`połączenie ${cid}: brak sygnału ${c.signalKey} w rejestrze`);
  if (c.cableId) {
    if (!p.cables[c.cableId]) v.push(`połączenie ${cid}: brak kabla ${c.cableId}`);
    if (c.medium !== 'physical') v.push(`połączenie ${cid}: medium ${c.medium} nie może mieć kabla`);
  }
}

function checkCableType(p: Project, kid: string, v: string[]): void {
  const cab = p.cables[kid];
  if (cab && !p.registries[cab.cableTypeKey]) v.push(`kabel ${kid}: brak typu ${cab.cableTypeKey} w rejestrze`);
}

/** Kable-kandydaci, do których nie prowadzi żadne połączenie (jedno przejście po połączeniach). */
function checkOrphans(p: Project, candidates: Iterable<string>, v: string[]): void {
  const cands = [...candidates].filter((k) => p.cables[k]);
  if (!cands.length) return;
  const used = new Set<string>();
  for (const c of Object.values(p.connections)) if (c.cableId) used.add(c.cableId);
  for (const k of cands) if (!used.has(k)) v.push(`kabel ${k}: osierocony (żadne połączenie na niego nie wskazuje)`);
}

function checkPlacement(p: Project, pid: string, v: string[]): void {
  const pl = p.placements?.[pid];
  if (!pl) return;
  const c = pl.targetKind === 'equipment' ? p.equipment : pl.targetKind === 'stageObject' ? p.stageObjects : pl.targetKind === 'cabinet' ? p.cabinets : p.racks;
  if (!c?.[pl.targetId]) v.push(`placement ${pid}: brak celu ${pl.targetId}`);
}

/** Szafy DIN: pozycja w racku (moduł 3U) wskazuje istniejący rack i wymaga zadeklarowanej wysokości w U. */
function checkCabinets(p: Project, v: string[]): void {
  for (const [id, c] of Object.entries<any>(p.cabinets ?? {})) {
    if (c.mount && !p.racks?.[c.mount.rackId]) v.push(`szafa ${id}: pozycja w nieistniejącym racku ${c.mount.rackId}`);
    if (c.mount && !c.rackUnits) v.push(`szafa ${id}: stoi w racku bez zadeklarowanej wysokości w U`);
  }
}

function checkView(p: Project, vid: string, v: string[]): void {
  const view = p.views?.[vid];
  if (!view) return;
  for (const n of Object.values<any>(view.nodes ?? {})) if (!p.equipment[n.instanceId] && !p.cabinets?.[n.instanceId]) v.push(`widok ${vid}: węzeł wskazuje brak instancji ${n.instanceId}`);
  for (const cid of Object.keys(view.edgeLayouts ?? {})) if (!p.connections[cid]) v.push(`widok ${vid}: layout krawędzi dla braku połączenia ${cid}`);
}

function checkIdAdded(p: Project, name: Coll, id: string, v: string[]): void {
  if (!ID_PATTERN.test(id)) v.push(`${name}: zły format ID ${id}`);
  for (const other of COLLECTIONS) if (other !== name && coll(p, other)?.[id] !== undefined) v.push(`${name}: ID użyty w dwóch kolekcjach ${id}`);
}

// ---------- pełne ----------

export function checkInvariants(p: Project): string[] {
  const v: string[] = [];
  const seen = new Set<string>();
  for (const name of COLLECTIONS) {
    const map = coll(p, name);
    if (!map) continue;
    for (const id of Object.keys(map)) {
      if (!ID_PATTERN.test(id)) v.push(`${name}: zły format ID ${id}`);
      if (seen.has(id)) v.push(`${name}: ID użyty w dwóch kolekcjach ${id}`);
      seen.add(id);
    }
  }
  for (const did of Object.keys(p.definitions)) checkDefinition(p, did, v);
  for (const iid of Object.keys(p.equipment)) checkInstance(p, iid, v);
  for (const cid of Object.keys(p.connections)) checkConnection(p, cid, v);
  for (const kid of Object.keys(p.cables)) checkCableType(p, kid, v);
  checkOrphans(p, Object.keys(p.cables), v);
  for (const pid of Object.keys(p.placements ?? {})) checkPlacement(p, pid, v);
  for (const vid of Object.keys(p.views ?? {})) checkView(p, vid, v);
  checkCabinets(p, v);
  return v;
}

// ---------- przyrostowe ----------

const IGNORED_ROOT = new Set(['settings', 'meta', 'name', 'id', 'formatVersion', 'suppressions', 'packing', 'ext', 'reportDefinitions']);

/**
 * Sprawdza tylko to, co mogły naruszyć łaty: obiekty dotknięte oraz zależności zwrotne
 * (np. usunięcie instancji → połączenia do niej; zmiana definicji → przypięte instancje i ich połączenia).
 * Zmiana rejestrów lub łata o nieznanej ścieżce → bezpieczny powrót do pełnego sprawdzenia.
 */
export function checkInvariantsIncremental(prev: Project, next: Project, patches: Patch[]): string[] {
  const def = new Set<string>(), inst = new Set<string>(), cnx = new Set<string>(), cab = new Set<string>();
  const plc = new Set<string>(), view = new Set<string>();
  const added: [Coll, string][] = [];
  let structTouched = false;
  for (const patch of patches) {
    const path = patch.path;
    if (path.length === 0) return checkInvariants(next);
    const name = String(path[0]);
    if (IGNORED_ROOT.has(name)) continue;
    if (name === 'registries') return checkInvariants(next);
    const id = String(path[1] ?? '');
    switch (name) {
      case 'definitions': def.add(id); break;
      case 'equipment': inst.add(id); break;
      case 'connections': cnx.add(id); break;
      case 'cables': cab.add(id); break;
      case 'placements': plc.add(id); break;
      case 'views': view.add(id); break;
      case 'spaces': case 'zones': case 'racks': case 'cabinets': case 'stageObjects': structTouched = true; break;
      default: return checkInvariants(next);
    }
    if (path.length === 2 && patch.op === 'add') added.push([name as Coll, id]);
  }
  const v: string[] = [];
  if (structTouched) checkCabinets(next, v);
  for (const [name, id] of added) checkIdAdded(next, name, id, v);

  // definicje → ich własne sprawdzenie + przypięte instancje
  for (const d of def) checkDefinition(next, d, v);
  if (def.size) for (const [iid, e] of Object.entries(next.equipment)) if (def.has(e.definitionId)) inst.add(iid);
  for (const i of inst) checkInstance(next, i, v);

  // połączenia: dotknięte + prowadzące do instancji, których stan się zmienił lub zniknęły
  const cablesRemoved = new Set([...cab].filter((k) => !next.cables[k] && prev.cables[k]));
  if (inst.size || cablesRemoved.size) {
    for (const [cid, c] of Object.entries(next.connections)) {
      if (inst.has(c.from.instanceId) || inst.has(c.to.instanceId) || (c.cableId && cablesRemoved.has(c.cableId))) cnx.add(cid);
    }
  }
  for (const c of cnx) checkConnection(next, c, v);
  for (const k of cab) checkCableType(next, k, v);

  // osierocone kable: dotknięte + kable, do których prowadziły usunięte/zmienione połączenia
  const orphanCandidates = new Set(cab);
  for (const c of cnx) {
    const a = prev.connections[c]?.cableId, b = next.connections[c]?.cableId;
    if (a) orphanCandidates.add(a);
    if (b) orphanCandidates.add(b);
  }
  checkOrphans(next, orphanCandidates, v);

  // placements i widoki
  const targetsChanged = inst.size > 0 || structTouched;
  for (const p of (targetsChanged ? Object.keys(next.placements ?? {}) : plc)) checkPlacement(next, p, v);
  const viewsAffected = targetsChanged || cnx.size > 0;
  for (const vid of (viewsAffected ? Object.keys(next.views ?? {}) : view)) checkView(next, vid, v);
  return v;
}
