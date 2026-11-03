import { pruneTerminals } from './cabinets.ts';
import { isDraft, original } from 'immer';
import type { Project, PortRef, Medium, DefinitionRevision, Id } from './types.ts';
import { Store, CommandError, type Mutator } from './store.ts';
import { newId } from './ids.ts';

// ---------- pomocnicze (czyste) ----------

/**
 * Skanowanie całych kolekcji na szkicu immera tworzy proxy dla każdego elementu (O(n) obiektów, ~100 ms przy 5000 połączeń).
 * Dlatego odczyty zbiorcze idą po niezmienionym stanie bazowym; szkic służy tylko do zapisu zmienionych kluczy.
 * Mutator wykonuje się raz na początku transakcji, więc stan bazowy jest aktualny.
 */
export function baseOf(d: Project): Project {
  return (isDraft(d) ? original(d) : d) as Project;
}

export function pinnedRevision(p: Project, instanceId: Id): DefinitionRevision {
  const inst = p.equipment[instanceId];
  if (!inst) throw new CommandError(`Brak instancji ${instanceId}`);
  const rev = p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)];
  if (!rev) throw new CommandError(`Brak rewizji ${inst.definitionId}@${inst.definitionRevision}`);
  return rev;
}

/** Domyślny typ kabla: pierwszy z rejestru, którego endPairs pokrywają złącza i który niesie sygnał. */
export function defaultCableType(p: Project, a: string, b: string, signalKey: string): string | undefined {
  for (const [key, e] of Object.entries(p.registries)) {
    if (e.kind !== 'cable') continue;
    const covers = e.endPairs?.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    const carries = !e.carriesSignals || e.carriesSignals.includes(signalKey);
    if (covers && carries) return key;
  }
  return undefined;
}

/** Usuwa połączenia (z kaskadą na osierocone kable i layouty widoków). Mutuje szkic. */
function removeConnections(d: Project, ids: Id[]): void {
  const base = baseOf(d);
  const removed = new Set(ids);
  const cables = new Set<Id>();
  for (const cid of ids) {
    const c = base.connections[cid];
    if (!c) continue;
    if (c.cableId) cables.add(c.cableId);
    delete d.connections[cid];
    for (const vid of Object.keys(base.views ?? {})) if (base.views![vid].edgeLayouts?.[cid]) delete d.views![vid].edgeLayouts[cid];
  }
  if (cables.size) {
    // jedno przejście po stanie bazowym zamiast skanowania per kabel
    const stillUsed = new Set<Id>();
    for (const [cid, c] of Object.entries(base.connections)) if (c.cableId && !removed.has(cid)) stillUsed.add(c.cableId);
    for (const kid of cables) if (!stillUsed.has(kid)) delete d.cables[kid];
  }
}

function connectionsTouching(p: Project, pred: (ref: PortRef) => boolean): Id[] {
  return Object.entries(baseOf(p).connections).filter(([, c]) => pred(c.from) || pred(c.to)).map(([id]) => id);
}

// ---------- polecenia: każde zwraca Mutator ----------

export const cmd = {
  addDefinition(id: Id, rev: DefinitionRevision): Mutator {
    return (d) => {
      if (d.definitions[id]) throw new CommandError(`Definicja ${id} już istnieje`);
      d.definitions[id] = { latestRevision: 1, revisions: { '1': rev } };
    };
  },

  /**
   * Każda edycja definicji tworzy nową niemutowalną rewizję (kopia z zachowaniem ID portów).
   * changeClass wyliczane: cosmetic, gdy zbiór portów i ich złącza/sygnały/kierunek/pojemność są bez zmian.
   */
  editDefinition(defId: Id, edit: (rev: DefinitionRevision) => void): Mutator {
    return (d) => {
      const def = d.definitions[defId];
      if (!def) throw new CommandError(`Brak definicji ${defId}`);
      const prev = def.revisions[String(def.latestRevision)];
      const next: DefinitionRevision = JSON.parse(JSON.stringify(prev));
      edit(next);
      const same = (a: DefinitionRevision, b: DefinitionRevision) => {
        const ka = Object.keys(a.ports).sort(), kb = Object.keys(b.ports).sort();
        if (ka.join() !== kb.join()) return false;
        return ka.every((k) => {
          const x = a.ports[k], y = b.ports[k];
          return x.connectorKey === y.connectorKey && x.direction === y.direction && x.capacity === y.capacity &&
            x.signalKeys.join() === y.signalKeys.join();
        });
      };
      next.changeClass = same(prev, next) ? 'cosmetic' : 'structural';
      const n = def.latestRevision + 1;
      def.revisions[String(n)] = next;
      def.latestRevision = n;
    };
  },

  addInstance(defId: Id, name: string, id: Id = newId('eqi')): Mutator {
    return (d) => {
      const def = d.definitions[defId];
      if (!def) throw new CommandError(`Brak definicji ${defId}`);
      d.equipment[id] = { definitionId: defId, definitionRevision: def.latestRevision, name, supply: 'unknown', portOverrides: {} };
    };
  },

  /**
   * Usunięcie instancji z kaskadą: połączenia, osierocone kable, placements, węzły widoków.
   * Jedna transakcja = jeden krok cofania.
   */
  removeInstance(instanceId: Id): Mutator {
    return (d) => {
      if (!d.equipment[instanceId]) throw new CommandError(`Brak instancji ${instanceId}`);
      removeConnections(d as Project, connectionsTouching(d as Project, (r) => r.instanceId === instanceId));
      pruneTerminals(d, instanceId);
      delete d.equipment[instanceId];
      const base = baseOf(d);
      for (const [pid, pl] of Object.entries<any>(base.placements ?? {})) if (pl.targetId === instanceId) delete d.placements![pid];
      for (const [vid, v] of Object.entries<any>(base.views ?? {})) {
        for (const [nid, n] of Object.entries<any>(v.nodes ?? {})) if (n.instanceId === instanceId) delete d.views![vid].nodes[nid];
      }
    };
  },

  /** Skutki usunięcia instancji (do okna skutków w UI), bez zmiany stanu. */
  previewRemoveInstance(p: Project, instanceId: Id) {
    const cnx = connectionsTouching(p, (r) => r.instanceId === instanceId);
    const cables = new Set(cnx.map((c) => p.connections[c].cableId).filter(Boolean) as Id[]);
    return { connections: cnx.length, cables: cables.size };
  },

  connect(from: PortRef, to: PortRef, signalKey: string, opts: { medium?: Medium; cableTypeKey?: string; id?: Id; cableId?: Id } = {}): Mutator {
    return (d) => {
      const fr = pinnedRevision(d as Project, from.instanceId).ports[from.portId];
      const tr = pinnedRevision(d as Project, to.instanceId).ports[to.portId];
      if (!fr || !tr) throw new CommandError('Port nie istnieje w przypiętej rewizji');
      const medium = opts.medium ?? 'physical';
      const id = opts.id ?? newId('cnx');
      let cableId: Id | null = null;
      if (medium === 'physical') {
        const type = opts.cableTypeKey ?? defaultCableType(d as Project, fr.connectorKey, tr.connectorKey, signalKey);
        if (type) {
          cableId = opts.cableId ?? newId('cbl');
          d.cables[cableId] = { cableTypeKey: type, lengthSource: 'unknown' };
        }
      }
      d.connections[id] = { from, to, signalKey, medium, cableId };
    };
  },

  disconnect(connectionId: Id): Mutator {
    return (d) => {
      if (!d.connections[connectionId]) throw new CommandError(`Brak połączenia ${connectionId}`);
      removeConnections(d as Project, [connectionId]);
    };
  },

  /** Usunięcie kabla zostawia fizyczne połączenie jako „kabel nieprzypisany” (V-019). */
  removeCable(cableId: Id): Mutator {
    return (d) => {
      if (!d.cables[cableId]) throw new CommandError(`Brak kabla ${cableId}`);
      for (const [cid, c] of Object.entries(baseOf(d).connections)) if (c.cableId === cableId) d.connections[cid].cableId = null;
      delete d.cables[cableId];
    };
  },

  setCableLengths(cableId: Id, v: { lengthMm?: number; stockLengthMm?: number }): Mutator {
    return (d) => {
      const c = d.cables[cableId];
      if (!c) throw new CommandError(`Brak kabla ${cableId}`);
      if (v.lengthMm !== undefined) { c.lengthMm = v.lengthMm; c.lengthSource = 'manual'; }
      if (v.stockLengthMm !== undefined) c.stockLengthMm = v.stockLengthMm;
    };
  },

  /** Przypisanie nowego kabla połączeniu fizycznemu, które go nie ma (np. nie było typu pasującego do obu złączy). */
  assignCable(connectionId: Id, typeKey: string, cableId: Id = newId('cbl')): Mutator {
    return (d) => {
      const c = d.connections[connectionId]; if (!c) throw new CommandError(`Brak połączenia ${connectionId}`);
      if (c.medium !== 'physical') throw new CommandError('Kabel można przypisać tylko połączeniu fizycznemu');
      if (c.cableId) throw new CommandError('Połączenie ma już kabel');
      if (d.registries[typeKey]?.kind !== 'cable') throw new CommandError(`Typ kabla ${typeKey} nie jest w rejestrze projektu`);
      d.cables[cableId] = { cableTypeKey: typeKey, lengthSource: 'unknown' }; c.cableId = cableId;
    };
  },

  /** Zmiana typu kabla istniejącego połączenia (np. po pomyłce przy rysowaniu). Typ musi być w rejestrze projektu. */
  setCableType(cableId: Id, typeKey: string): Mutator {
    return (d) => {
      const c = d.cables[cableId]; if (!c) throw new CommandError(`Brak kabla ${cableId}`);
      if (d.registries[typeKey]?.kind !== 'cable') throw new CommandError(`Typ kabla ${typeKey} nie jest w rejestrze projektu`);
      c.cableTypeKey = typeKey;
    };
  },

  /** Etykieta połączenia (widoczna na diagramie przy wyjściu z urządzenia). Pusta = usuń. */
  setConnectionLabel(connId: Id, value: string): Mutator {
    return (d) => {
      const c = d.connections[connId];
      if (!c) throw new CommandError(`Brak połączenia ${connId}`);
      const v = value.trim();
      if (v) c.label = v; else delete c.label;
    };
  },

  /** Nazwa/numer kabla nadana ręcznie. Pusta = usuń. Duplikat numeru w projekcie jest odrzucany. */
  setCableNumber(cableId: Id, value: string): Mutator {
    return (d) => {
      const c = d.cables[cableId];
      if (!c) throw new CommandError(`Brak kabla ${cableId}`);
      const v = value.trim();
      if (!v) { delete c.number; return; }
      if (Object.entries(d.cables).some(([id, o]) => id !== cableId && o.number === v)) throw new CommandError(`Numer „${v}” jest już użyty`);
      c.number = v;
    };
  },

  /** Podstawowy upgrade [M]: usuń powiązane połączenia albo anuluj (bez mapowania portów). */
  upgradeInstance(instanceId: Id, toRevision: number, onRemovedPorts: 'delete' | 'cancel' = 'cancel'): Mutator {
    return (d) => {
      const inst = d.equipment[instanceId];
      if (!inst) throw new CommandError(`Brak instancji ${instanceId}`);
      const def = d.definitions[inst.definitionId];
      const target = def.revisions[String(toRevision)];
      if (!target) throw new CommandError(`Brak rewizji ${toRevision}`);
      const dead = connectionsTouching(d as Project, (r) => r.instanceId === instanceId && !target.ports[r.portId]);
      if (dead.length && onRemovedPorts === 'cancel') throw new CommandError(`Upgrade usunąłby ${dead.length} połączeń; anulowano`);
      removeConnections(d as Project, dead);
      inst.definitionRevision = toRevision;
    };
  },

  /** Nadaje brakujące numery wzorcem {prefix}{seq:3}; nie rusza już nadanych. */
  numberMissingCables(): Mutator {
    return (d) => {
      const counters: Record<string, number> = {};
      const base = baseOf(d);
      for (const c of Object.values(base.cables)) {
        const m = c.number?.match(/^([A-Z]+)(\d+)$/);
        if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]));
      }
      const ids = Object.keys(base.connections).sort();
      for (const cid of ids) {
        const c = base.connections[cid];
        if (!c.cableId) continue;
        if (base.cables[c.cableId].number) continue;
        const cab = d.cables[c.cableId];
        const prefix = (d.registries[c.signalKey]?.prefix as string | undefined) ?? 'X';
        counters[prefix] = (counters[prefix] ?? 0) + 1;
        cab.number = prefix + String(counters[prefix]).padStart(3, '0');
      }
    };
  },
};

export function run(store: Store, label: string, m: Mutator): number {
  return store.dispatch(label, m);
}
