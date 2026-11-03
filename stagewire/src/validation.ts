import type { Project, Issue } from './types.ts';
import { rackContents, conflicts, itemInfo, type Rack } from './racks.ts';
import { cabinetContents, dinConflicts, type Cabinet } from './cabinets.ts';
import { pointInPolygon } from './plan.ts';
import { electricalNets } from './nets.ts';
import { busbarContacts } from './busbar.ts';

const SOURCE_OK = new Set(['out', 'io', 'loop']);
const SINK_OK = new Set(['in', 'io']);

/**
 * Walidacja miękka (DOMAIN-MODEL §7). Wynik jest wyliczany, nigdy zapisywany.
 * PoC-1: pełne przeliczenie (pomiar kosztu w bench); przyrostowość to zadanie M5.
 */
export function validate(p: Project): Issue[] {
  const out: Issue[] = [];
  const push = (ruleId: string, level: Issue['level'], subject: string, message: string) => out.push({ ruleId, level, subject, message });

  const portOf = (ref: { instanceId: string; portId: string }) => {
    const inst = p.equipment[ref.instanceId];
    if (!inst) return undefined;
    return p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)]?.ports[ref.portId];
  };

  // V-012 duplikat nazw instancji
  const names = new Map<string, string[]>();
  for (const [id, i] of Object.entries(p.equipment)) names.set(i.name, [...(names.get(i.name) ?? []), id]);
  for (const [name, ids] of names) if (ids.length > 1) for (const id of ids) push('V-012', 'warning', id, `Duplikat nazwy urządzenia „${name}"`);

  // V-004 duplikat numerów kabli
  const nums = new Map<string, string[]>();
  for (const [id, c] of Object.entries(p.cables)) if (c.number) nums.set(c.number, [...(nums.get(c.number) ?? []), id]);
  for (const [n, ids] of nums) if (ids.length > 1) for (const id of ids) push('V-004', 'error', id, `Duplikat numeru kabla ${n}`);

  // V-002 pojemność portu
  const load = new Map<string, number>();
  const key = (r: { instanceId: string; portId: string }) => `${r.instanceId}/${r.portId}`;
  for (const c of Object.values(p.connections)) for (const r of [c.from, c.to]) load.set(key(r), (load.get(key(r)) ?? 0) + 1);

  for (const [pk, n] of load) {
    const [instanceId, portId] = pk.split('/');
    const port = portOf({ instanceId, portId });
    if (port && n > port.capacity) push('V-002', 'error', instanceId, `Port „${port.label}" ma ${n} połączeń, pojemność ${port.capacity}`);
  }

  // V-003 rack: urządzenia nakładają się w U (ta sama strona i miejsce w poziomie) albo wychodzą poza rack; V-027 urządzenie głębsze niż rack
  for (const [rid, r] of Object.entries(p.racks ?? {}) as [string, Rack][]) {
    const items = rackContents(p, rid), seen = new Set<string>();
    for (const o of items) {
      const nm = itemInfo(p, o.id).name;
      if (o.mount.uStart + o.fit.heightU - 1 > r.units) push('V-003', 'error', o.id, `„${nm}” wychodzi poza rack „${r.name}” (${r.units} U)`);
      for (const other of conflicts(p, o.mount, o.fit, o.id)) {
        const k = [o.id, other].sort().join('|'); if (seen.has(k)) continue; seen.add(k);
        push('V-003', 'error', o.id, `„${nm}” nakłada się z „${itemInfo(p, other).name}” w racku „${r.name}”. Przesuń jedno z urządzeń do wolnej pozycji.`);
      }
      const depth = itemInfo(p, o.id).depthMm;
      if (r.depthMm && depth && depth > r.depthMm) push('V-027', 'warning', o.id, `„${nm}” ma głębokość ${depth} mm, rack „${r.name}” ${r.depthMm} mm`);
    }
  }

  // V-028 szafa DIN: nakładanie się osprzętu na szynie albo wyjście poza szynę/rzędy; V-029 osprzęt głębszy niż szafa
  for (const [kid, k] of Object.entries(p.cabinets ?? {}) as [string, Cabinet][]) {
    const seen = new Set<string>();
    for (const o of cabinetContents(p, kid)) {
      const nm = p.equipment[o.id].name;
      if (o.din.row > k.rows || o.din.at + o.modules - 1 > k.modules) push('V-028', 'error', o.id, `„${nm}” wychodzi poza szynę szafy „${k.name}” (${k.rows} × ${k.modules} mod.)`);
      for (const other of dinConflicts(p, o.din, o.modules, o.id)) {
        const key = [o.id, other].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
        push('V-028', 'error', o.id, `„${nm}” nakłada się z „${p.equipment[other].name}” w szafie „${k.name}”. Przesuń jedno z urządzeń na wolne miejsce.`);
      }
      const rev = p.definitions[p.equipment[o.id].definitionId]?.revisions[String(p.equipment[o.id].definitionRevision)];
      if (k.depthMm && rev?.dimensionsMm && rev.dimensionsMm.depth > k.depthMm) push('V-029', 'warning', o.id, `„${nm}” ma głębokość ${rev.dimensionsMm.depth} mm, szafa „${k.name}” ${k.depthMm} mm`);
    }
  }

  // V-052 element na płycie montażowej wychodzi poza płytę szafy
  for (const [iid, inst] of Object.entries(p.equipment)) {
    const pl = inst.plate as { cabinetId: string; x: number; y: number } | undefined, k = pl && (p.cabinets?.[pl.cabinetId] as Cabinet | undefined); if (!pl || !k) continue;
    const dim = p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)]?.dimensionsMm;
    if (dim && (pl.x + dim.width > k.widthMm || pl.y + dim.height > k.heightMm)) push('V-052', 'warning', iid, `„${inst.name}” wychodzi poza płytę szafy „${k.name}” (${k.widthMm} × ${k.heightMm} mm)`);
  }

  // V-040/V-041 zwarcia torów w węźle elektrycznym; V-046/V-047/V-050 grzebienie na zaciskach aparatów (ADR-064)
  {
    const lbl = (r: { instanceId: string; portId: string }) => `${p.equipment[r.instanceId]?.name ?? r.instanceId} · ${p.definitions[p.equipment[r.instanceId]?.definitionId]?.revisions[String(p.equipment[r.instanceId]?.definitionRevision)]?.ports[r.portId]?.label ?? r.portId}`;
    const CLS = ['L1', 'L2', 'L3', 'N', 'PE'];
    for (const net of electricalNets(p).nets) {
      const named = net.tracks.filter((t) => CLS.includes(t));
      if (named.length < 2) continue;
      const portsOf = (t: string) => net.ports.filter((r) => p.definitions[p.equipment[r.instanceId]?.definitionId]?.revisions[String(p.equipment[r.instanceId]?.definitionRevision)]?.ports[r.portId]?.terminal?.track === t);
      const sample = named.map((t) => `${t}: ${lbl(portsOf(t)[0])}`).join('; ');
      const neutralEarth = named.length === 2 && named.includes('N') && named.includes('PE');
      push(neutralEarth ? 'V-041' : 'V-040', 'error', portsOf(named[0])[0].instanceId, neutralEarth ? `Przewód neutralny (N) połączony z ochronnym (PE) w jednym węźle (${sample})` : `Zwarcie torów ${named.join(' i ')} w jednym węźle elektrycznym (${sample})`);
    }
    const nm = (id: string) => p.equipment[id]?.name ?? id;
    const toothLabel = (id: string, port: string) => p.definitions[p.equipment[id]?.definitionId]?.revisions[String(p.equipment[id]?.definitionRevision)]?.ports[port]?.label ?? port;
    for (const is of busbarContacts(p).issues) {
      if (is.kind === 'mismatch') push('V-046', 'warning', is.busbar, `Ząb „${toothLabel(is.busbar, is.tooth)}” grzebienia „${nm(is.busbar)}” leży na „${nm(is.body!)}”, ale zacisk aparatu nie jest zgodny z grzebieniem (typ lub rozstaw); sprawdź w danych producenta`);
      else if (is.kind === 'unaligned') push('V-047', 'warning', is.busbar, `Ząb „${toothLabel(is.busbar, is.tooth)}” grzebienia „${nm(is.busbar)}” nie trafia w zacisk „${nm(is.body!)}” (moduł ${is.module}); przesuń grzebień lub aparat`);
      else push('V-050', 'info', is.busbar, `Ząb „${toothLabel(is.busbar, is.tooth)}” grzebienia „${nm(is.busbar)}” nie ma pod sobą aparatu (moduł ${is.module}); zabezpiecz nieużywany koniec`);
    }
  }

  // V-030 obiekt na planie poza obrysem sali (środek rack, szafy, urządzenia lub bryły leży poza obrysem)
  for (const pl of Object.values<any>(p.placements ?? {})) {
    const bnd: number[][] | undefined = p.spaces?.[pl.spaceId]?.boundary; if (!bnd || bnd.length < 3) continue;
    if (pointInPolygon([pl.position.x, pl.position.y], bnd)) continue;
    const nm = pl.targetKind === 'equipment' ? p.equipment[pl.targetId]?.name : ((p.racks?.[pl.targetId] ?? p.cabinets?.[pl.targetId] ?? p.stageObjects?.[pl.targetId]) as any)?.name;
    if (nm) push('V-030', 'warning', pl.targetId, `„${nm}” stoi poza obrysem sali „${p.spaces![pl.spaceId].name}”`);
  }

  for (const [cid, c] of Object.entries(p.connections)) {
    const fp = portOf(c.from), tp = portOf(c.to);
    if (!fp || !tp) continue; // naruszenie niezmiennika, nie walidacja

    // V-001 kierunek
    if (!SOURCE_OK.has(fp.direction) || !SINK_OK.has(tp.direction)) {
      push('V-001', 'error', cid, `Kierunek niezgodny: ${fp.direction} → ${tp.direction}. Wskaż inny port docelowy.`);
    }
    // V-010 wspólny sygnał
    if (!fp.signalKeys.includes(c.signalKey) || !tp.signalKeys.includes(c.signalKey)) {
      push('V-010', 'warning', cid, `Sygnał ${c.signalKey} nie jest obsługiwany przez oba porty („${fp.label}" → „${tp.label}")`);
    }
    if (c.medium === 'physical') {
      if (!c.cableId) {
        push('V-019', 'warning', cid, 'Połączenie fizyczne bez kabla (kabel nieprzypisany)');
        continue; // V-011/V-013 tylko z przypisanym kablem
      }
      const cab = p.cables[c.cableId];
      const ct = p.registries[cab.cableTypeKey];
      // V-011 końcówki kabla (trójwartościowo)
      if (!ct?.endPairs?.length) push('V-011', 'info', cid, `Zgodności złączy nie da się ocenić (typ kabla ${cab.cableTypeKey} bez endPairs)`);
      else {
        const a = fp.connectorKey, b = tp.connectorKey;
        const ok = ct.endPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        if (!ok) push('V-011', 'warning', cid, `Kabel ${cab.cableTypeKey} nie wpina się w te porty (${a} ↔ ${b})`);
      }
      // V-013 kabel a sygnał
      if (!ct?.carriesSignals) push('V-013', 'info', cid, `Zgodności kabla z sygnałem nie da się ocenić (${cab.cableTypeKey} bez carriesSignals)`);
      else if (!ct.carriesSignals.includes(c.signalKey)) push('V-013', 'warning', cid, `Kabel ${cab.cableTypeKey} nie przenosi sygnału ${c.signalKey}`);
      // V-026 przydział krótszy od trasy
      if (cab.lengthMm !== undefined && cab.stockLengthMm !== undefined && cab.stockLengthMm < cab.lengthMm) {
        push('V-026', 'warning', c.cableId, `Przydzielony przewód ${cab.stockLengthMm} mm jest krótszy niż wymagane ${cab.lengthMm} mm`);
      }
    }
  }
  return out;
}
