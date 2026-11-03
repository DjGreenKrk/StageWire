import type { Project, Id, PortDefinition, DefinitionRevision } from './types.ts';

/**
 * Grzebienie i mostki na zaciskach aparatów (ADR-064). Styk jest **wyliczany z położenia**, nie zapisywany: ząb grzebienia (port z `terminal.at`)
 * leżący na module, na którym aparat w tej samej szafie i rzędzie ma zacisk typu `comb-slot` po tej samej stronie, łączy te dwa porty.
 * Przesunięcie aparatu zmienia styki (i węzły, i walidację) bez migracji czegokolwiek.
 */
export interface PortRef { instanceId: Id; portId: Id }
export interface Contact { tooth: PortRef; slot: PortRef; busbar: Id; body: Id; module: number }
export type BusbarIssueKind = 'open' | 'unaligned' | 'mismatch';
/** `open`: pod zębem nie ma aparatu; `unaligned`: aparat jest, ale nie ma zacisku pod grzebień na tym module i stronie; `mismatch`: zacisk jest, ale tagi zgodności się nie pokrywają. */
export interface BusbarIssue { kind: BusbarIssueKind; busbar: Id; tooth: Id; body?: Id; module: number }

const revOf = (p: Project, id: Id): DefinitionRevision | undefined => { const i = p.equipment[id]; return i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]; };
const dinWidth = (r: DefinitionRevision | undefined) => (typeof r?.dinModules === 'number' ? r.dinModules : 1);
const abs = (din: { at: number }, t: { at?: number }) => din.at + Math.floor(t.at ?? 0);
const sharesFit = (a?: string[], b?: string[]) => !a?.length || !b?.length || a.some((x) => b.includes(x));

export function busbarContacts(p: Project): { contacts: Contact[]; issues: BusbarIssue[] } {
  const contacts: Contact[] = [], issues: BusbarIssue[] = [];
  const mounted = Object.entries(p.equipment).filter(([, i]) => i.din && p.cabinets?.[(i.din as { cabinetId: Id }).cabinetId]);
  const bars = mounted.filter(([, i]) => (i.din as { layer?: string }).layer === 'busbar');
  const bodies = mounted.filter(([, i]) => (i.din as { layer?: string }).layer !== 'busbar');
  for (const [bid, bi] of bars) {
    const bd = bi.din as { cabinetId: Id; row: number; at: number }, br = revOf(p, bid); if (!br) continue;
    for (const [tid, tp] of Object.entries<PortDefinition>(br.ports)) {
      const t = tp.terminal; if (!t || t.at === undefined) continue;
      const m = abs(bd, t);
      const under = bodies.find(([oid, oi]) => { const od = oi.din as { cabinetId: Id; row: number; at: number }; return od.cabinetId === bd.cabinetId && od.row === bd.row && od.at <= m && m < od.at + dinWidth(revOf(p, oid)); });
      if (!under) { issues.push({ kind: 'open', busbar: bid, tooth: tid, module: m }); continue; }
      const [oid, oi] = under, od = oi.din as { at: number }, or = revOf(p, oid); if (!or) continue;
      const atModule = Object.entries<PortDefinition>(or.ports).filter(([, q]) => q.terminal?.at !== undefined && abs(od, q.terminal) === m && (!t.side || !q.terminal.side || q.terminal.side === t.side));
      const slots = atModule.filter(([, q]) => q.terminal?.kind === 'comb-slot');
      if (!slots.length) { issues.push({ kind: atModule.length ? 'mismatch' : 'unaligned', busbar: bid, tooth: tid, body: oid, module: m }); continue; }
      const fitting = slots.filter(([, q]) => sharesFit(t.fits, q.terminal?.fits));
      if (!fitting.length) { issues.push({ kind: 'mismatch', busbar: bid, tooth: tid, body: oid, module: m }); continue; }
      for (const [sid] of fitting) contacts.push({ tooth: { instanceId: bid, portId: tid }, slot: { instanceId: oid, portId: sid }, busbar: bid, body: oid, module: m });
    }
  }
  return { contacts, issues };
}
