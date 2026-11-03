import type { Project, PortRef, PortDefinition } from '../types.ts';
import { pinnedRevision } from '../commands.ts';

/**
 * Logika gestu „port → port” (prototyp PoC-3b, UX-WORKFLOWS §4). Czysta: model + dwa porty → plan połączenia.
 * Walidacja jest miękka (DOMAIN-MODEL §7) dla niezgodności typu, ale nie dla zajętego portu (ADR-046):
 *   ok   – połączenie bez uwag;
 *   warn – połączenie możliwe po potwierdzeniu, wygeneruje uwagę walidacji (V-001/V-010/V-011);
 *   no   – niedozwolone (to samo urządzenie, duplikat pary portów, brak portu, port zajęty ponad pojemność).
 */
export type Level = 'ok' | 'warn' | 'no';
export interface Plan { from: PortRef; to: PortRef; signalKey: string; level: Level; reasons: string[] }

export const portKey = (r: PortRef) => `${r.instanceId}/${r.portId}`;

/** Obciążenie portów (liczba połączeń) i zbiór par; liczone raz na początku gestu, O(połączeń). */
export interface Usage { load: Map<string, number>; pairs: Set<string> }
export function usageOf(p: Project): Usage {
  const load = new Map<string, number>(), pairs = new Set<string>();
  for (const c of Object.values(p.connections)) {
    const a = portKey(c.from), b = portKey(c.to);
    load.set(a, (load.get(a) ?? 0) + 1); load.set(b, (load.get(b) ?? 0) + 1);
    pairs.add(a + '|' + b); pairs.add(b + '|' + a);
  }
  return { load, pairs };
}

function portDef(p: Project, r: PortRef): PortDefinition | undefined {
  return p.equipment[r.instanceId] ? pinnedRevision(p, r.instanceId).ports[r.portId] : undefined;
}

const SRC = new Set(['out', 'loop']);

/** Plan połączenia dla przeciągnięcia z `a` na `b`. Kierunek jest normalizowany (wyjście → wejście), gdy da się to ustalić. */
export function planConnection(p: Project, a: PortRef, b: PortRef, use: Usage): Plan {
  const pa = portDef(p, a), pb = portDef(p, b);
  const no = (why: string): Plan => ({ from: a, to: b, signalKey: '', level: 'no', reasons: [why] });
  if (!pa || !pb) return no('Brak portu');
  if (a.instanceId === b.instanceId) return no('To samo urządzenie');
  if (use.pairs.has(portKey(a) + '|' + portKey(b))) return no('Te porty są już połączone');

  let from = a, to = b, pf = pa, pt = pb;
  if (pa.direction === 'in' && (SRC.has(pb.direction) || pb.direction === 'io')) { from = b; to = a; pf = pb; pt = pa; }
  else if (pa.direction === 'io' && SRC.has(pb.direction)) { from = b; to = a; pf = pb; pt = pa; }

  const reasons: string[] = [];
  // port zajęty ponad pojemność: jedno gniazdo = jeden kabel; twarda blokada (ADR-046)
  for (const [r, d] of [[from, pf], [to, pt]] as const) if ((use.load.get(portKey(r)) ?? 0) + 1 > d.capacity)
    return { from, to, signalKey: '', level: 'no', reasons: [`Port „${d.label}" na „${p.equipment[r.instanceId].name}" jest już zajęty (pojemność ${d.capacity}). Odepnij istniejący kabel.`] };
  if (!(SRC.has(pf.direction) || pf.direction === 'io') || !(pt.direction === 'in' || pt.direction === 'io'))
    reasons.push(`Kierunek: ${pf.direction} → ${pt.direction} (V-001)`);
  const common = pf.signalKeys.filter((s) => pt.signalKeys.includes(s));
  if (!common.length) reasons.push('Brak wspólnego sygnału (V-010)');
  if (pf.connectorKey !== pt.connectorKey) { const n = (k: string) => (p.registries[k]?.name as string | undefined) ?? k; reasons.push(`Różne złącza: ${n(pf.connectorKey)} → ${n(pt.connectorKey)} (V-011)`); }
  return { from, to, signalKey: common[0] ?? pf.signalKeys[0] ?? '', level: reasons.length ? 'warn' : 'ok', reasons };
}

/** Upuszczenie na korpus urządzenia: najlepszy port (najpierw ok, potem warn; w obrębie poziomu wg kolejności portów). */
export function bestPort(p: Project, a: PortRef, instanceId: string, use: Usage): Plan | undefined {
  const rev = pinnedRevision(p, instanceId);
  let best: Plan | undefined;
  for (const [pid] of Object.entries(rev.ports).sort((x, y) => x[1].order - y[1].order)) {
    const plan = planConnection(p, a, { instanceId, portId: pid }, use);
    if (plan.level === 'no') continue;
    if (!best || (best.level === 'warn' && plan.level === 'ok')) best = plan;
    if (best.level === 'ok') break;
  }
  return best;
}
