import type { Project, Id, DefinitionRevision } from './types.ts';
import { busbarContacts, type PortRef } from './busbar.ts';

/**
 * Węzły elektryczne (ADR-064): klasy równoważności portów o wspólnym potencjale. **Wyliczane, nie zapisywane** (zasada Z10):
 * z przewodów między portami o sygnale zasilania, z wewnętrznych mostków definicji (`bridge`, włączone `jumper`) oraz ze styków grzebieni z aparatami.
 * Połączenia zależne od stanu (`switched`) nie scalają węzłów.
 */
export interface Net { id: number; ports: PortRef[]; tracks: string[] }
export interface Nets { nets: Net[]; netOf(ref: PortRef): Net | undefined }

const key = (r: PortRef) => `${r.instanceId}/${r.portId}`;
const revOf = (p: Project, id: Id): DefinitionRevision | undefined => { const i = p.equipment[id]; return i && p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]; };

/** Czy sygnał jest elektryczny (domena zasilania). */
export const isPowerSignal = (p: Project, signalKey: string): boolean => p.registries[signalKey]?.domain === 'power' || signalKey.startsWith('std/power');

export function electricalNets(p: Project): Nets {
  const parent = new Map<string, string>(), refs = new Map<string, PortRef>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; for (let c = k; parent.get(c) !== r;) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const add = (r: PortRef) => { const k = key(r); if (!parent.has(k)) { parent.set(k, k); refs.set(k, r); } return k; };
  const union = (a: PortRef, b: PortRef) => { const x = find(add(a)), y = find(add(b)); if (x !== y) parent.set(x, y); };

  for (const c of Object.values(p.connections)) if (isPowerSignal(p, c.signalKey)) union(c.from, c.to);
  for (const [iid, inst] of Object.entries(p.equipment)) {
    const rev = revOf(p, iid); if (!rev?.internalLinks) continue;
    rev.internalLinks.forEach((l, idx) => {
      const on = l.kind === 'bridge' || (l.kind === 'jumper' && (inst.jumpers ?? []).includes(idx)); if (!on) return;
      const ids = l.members ?? (l.a && l.b ? [l.a, l.b] : []);
      for (let i = 1; i < ids.length; i++) union({ instanceId: iid, portId: ids[0] }, { instanceId: iid, portId: ids[i] });
    });
  }
  for (const c of busbarContacts(p).contacts) union(c.tooth, c.slot);

  const groups = new Map<string, PortRef[]>();
  for (const [k, r] of refs) { const root = find(k); (groups.get(root) ?? groups.set(root, []).get(root)!).push(r); }
  const nets: Net[] = []; const byPort = new Map<string, Net>();
  for (const ports of groups.values()) {
    if (ports.length < 2) continue;
    const tracks = [...new Set(ports.map((r) => revOf(p, r.instanceId)?.ports[r.portId]?.terminal?.track).filter((t): t is string => !!t))].sort();
    const net: Net = { id: nets.length, ports, tracks }; nets.push(net); for (const r of ports) byPort.set(key(r), net);
  }
  return { nets, netOf: (r) => byPort.get(key(r)) };
}
