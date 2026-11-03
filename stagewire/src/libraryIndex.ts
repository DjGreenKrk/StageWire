// Filtrowanie biblioteki urządzeń: wyszukiwarka tekstowa i filtry fasetowe z licznikami
// (kategoria, producent, wejścia, wyjścia, wiarygodność danych, pakiet). Wewnątrz jednego filtra wartości łączą się przez LUB, między filtrami przez I.
import type { CatalogEntry } from './catalog/index.ts';
import { sourceTrust, TRUST_LABEL } from './pack.ts';

export type FacetId = 'category' | 'manufacturer' | 'inputs' | 'outputs' | 'trust' | 'pack';
export const FACET_ORDER: FacetId[] = ['category', 'manufacturer', 'inputs', 'outputs', 'trust', 'pack'];
export const FACET_LABEL: Record<FacetId, string> = { category: 'Kategoria', manufacturer: 'Producent', inputs: 'Wejścia', outputs: 'Wyjścia', trust: 'Dane', pack: 'Pakiet' };
export type Selection = Partial<Record<FacetId, string[]>>;
export interface FacetValue { value: string; label: string; count: number; selected: boolean }
export interface Facet { id: FacetId; label: string; values: FacetValue[] }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
/** Nazwa sygnału do wyświetlenia: z rejestrów, a gdy brak, końcówka klucza. */
export type SignalNames = Record<string, { name: string } | undefined>;
const sigName = (names: SignalNames, k: string) => names[k]?.name ?? k.replace(/^(std|user)\//, '');

/** Wartości każdego filtra dla jednego urządzenia (klucze; etykiety są osobno). */
export function facetValues(e: CatalogEntry): Record<FacetId, string[]> {
  const ins = new Set<string>(), outs = new Set<string>();
  for (const p of e.ports) {
    if (p.direction === 'in' || p.direction === 'io' || p.direction === 'loop') p.signals.forEach((s) => ins.add(s));
    if (p.direction === 'out' || p.direction === 'io' || p.direction === 'loop') p.signals.forEach((s) => outs.add(s));
  }
  return { category: [e.category], manufacturer: [e.manufacturer], inputs: [...ins], outputs: [...outs], trust: [sourceTrust(e.device.source)], pack: [e.packId] };
}

const labelOf = (id: FacetId, value: string, names: SignalNames, packNames: Record<string, string>): string =>
  id === 'inputs' || id === 'outputs' ? sigName(names, value) : id === 'trust' ? TRUST_LABEL[value as keyof typeof TRUST_LABEL] ?? value : id === 'pack' ? packNames[value] ?? value : value;

export function matchesQuery(e: CatalogEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${e.manufacturer} ${e.model} ${e.category} ${e.tags.join(' ')} ${e.description} ${e.packName} ${e.ports.map((p) => p.label).join(' ')}`);
  return words.every((w) => hay.includes(w));
}

/** Wpisy spełniające tekst i filtry; `except` pomija jeden filtr (do liczenia liczników tego filtra). */
export function filterEntries(entries: CatalogEntry[], query: string, sel: Selection, except?: FacetId): CatalogEntry[] {
  return entries.filter((e) => {
    if (!matchesQuery(e, query)) return false;
    const fv = facetValues(e);
    for (const id of FACET_ORDER) { if (id === except) continue; const want = sel[id]; if (want?.length && !want.some((w) => fv[id].includes(w))) return false; }
    return true;
  });
}

/** Filtry z licznikami: licznik wartości = ile wyników byłoby po jej wybraniu przy pozostałych filtrach bez zmian. Wartości bez wyników znikają, chyba że są wybrane. */
export function buildFacets(entries: CatalogEntry[], query: string, sel: Selection, names: SignalNames = {}): Facet[] {
  const packNames: Record<string, string> = {}; for (const e of entries) packNames[e.packId] = e.packName;
  return FACET_ORDER.map((id) => {
    const pool = filterEntries(entries, query, sel, id), counts = new Map<string, number>();
    for (const e of pool) for (const v of facetValues(e)[id]) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const v of sel[id] ?? []) if (!counts.has(v)) counts.set(v, 0);
    const values = [...counts].map(([value, count]) => ({ value, label: labelOf(id, value, names, packNames), count, selected: !!sel[id]?.includes(value) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pl'));
    return { id, label: FACET_LABEL[id], values };
  }).filter((f) => f.values.length > 0);
}

export const sortEntries = (entries: CatalogEntry[]): CatalogEntry[] => [...entries].sort((a, b) => a.manufacturer.localeCompare(b.manufacturer, 'pl') || a.model.localeCompare(b.model, 'pl', { numeric: true }));
export function toggleSelection(sel: Selection, id: FacetId, value: string): Selection {
  const cur = new Set(sel[id] ?? []); if (cur.has(value)) cur.delete(value); else cur.add(value);
  const next = { ...sel }; if (cur.size) next[id] = [...cur]; else delete next[id]; return next;
}
