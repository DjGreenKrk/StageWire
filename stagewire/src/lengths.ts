import type { Project, Id } from './types.ts';
import { CommandError, type Mutator } from './store.ts';
import { effectivePosition } from './plan.ts';
import { buildNet, routesOf, type RouteNet } from './routes.ts';
import { passagesBetween, passagesOf, passageLength } from './passage.ts';

/** Domyślny zapas na kabel (łuki, wpięcie, ruch urządzenia). Wartość startowa [HIPOTEZA], do ustawienia w projekcie. */
export const DEFAULT_SLACK_MM = 1000;
export const ROUND_MM = 100;

export interface Estimate { connectionId: Id; cableId: Id; lengthMm: number; method: 'route' | 'direct'; routes?: Id[]; passage?: Id }
/** `otherSpace`: połączenia między salami bez przejścia kablowego (pominięte); `viaPassage`: policzone przez przejście. */
export interface EstimateReport { estimates: Estimate[]; skippedManual: number; noPlacement: number; noCable: number; otherSpace: number; viaRoute: number; direct: number; viaPassage: number }

/**
 * Długość z planu (3D: x, y, z w mm). Gdy w sali narysowano trasy kablowe i oba urządzenia da się do nich podpiąć (do 10 m), kabel idzie trasą:
 * dojście od punktu urządzenia do trasy (poziomo prostopadle + w pionie) + najkrótsza ścieżka po trasach + dojście do drugiego urządzenia + zapas.
 * Bez tras (albo gdy brak połączenia) liczona jest odległość prostopadła (Manhattan) między środkami + zapas. Wynik w górę do 100 mm.
 * Wartość orientacyjna: bez wysokości montażu, konkretnych gniazd i luzów na łukach. Ręcznie wpisanych długości nie rusza.
 */
/** Punkty (x, y, z) urządzeń w sali, z uwzględnieniem racków (zamontowane urządzenie liczy się w miejscu racka). */
function pointsIn(p: Project, sid: Id): number[][] {
  const pts = Object.keys(p.equipment).map((id) => effectivePosition(p, id)).filter((e) => e && e.spaceId === sid).map((e) => [e!.x, e!.y, e!.z]);
  for (const [, ps] of passagesOf(p)) for (const e of [ps.a, ps.b]) if (e.spaceId === sid) pts.push([e.x, e.y, e.z]);
  return pts;
}

/** Odcinek kabla w jednej sali między dwoma punktami: trasą, jeśli oba da się podpiąć (do 10 m), inaczej prosto (Manhattan). Bez zapasu. */
interface Leg { length: number; method: 'route' | 'direct'; routes?: Id[]; pts: number[][] }
function legIn(p: Project, nets: Map<Id, RouteNet | null>, sid: Id, pa: number[], pb: number[]): Leg {
  let net = nets.get(sid);
  if (net === undefined) { const routes = routesOf(p, sid); net = Object.keys(routes).length ? buildNet(routes, pointsIn(p, sid)) : null; nets.set(sid, net); }
  const ta = net?.attach(pa), tb = net?.attach(pb), path = ta && tb ? net!.path(ta.node, tb.node) : null;
  if (path && ta && tb) {
    const first = path.points[0], last = path.points.at(-1)!;
    return { length: ta.stub + path.length + tb.stub, method: 'route', routes: path.routes, pts: [pa, [first[0], first[1], pa[2]], [...first], ...path.points.slice(1, -1).map((q) => [...q]), [...last], [last[0], last[1], pb[2]], pb] };
  }
  return { length: Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]), method: 'direct', pts: [pa, pb] };
}
export interface PassageRun { passage: Id; length: number; method: 'route' | 'direct'; routes?: Id[]; legA: Leg; legB: Leg; passageMm: number }
/** Najkrótszy kabel między urządzeniami w różnych salach przez przejście kablowe: dojście w sali A + przejście + dojście w sali B (bez zapasu). */
function runViaPassage(p: Project, nets: Map<Id, RouteNet | null>, a: { spaceId: Id; x: number; y: number; z: number }, b: { spaceId: Id; x: number; y: number; z: number }): PassageRun | null {
  let best: PassageRun | null = null;
  for (const c of passagesBetween(p, a.spaceId, b.spaceId)) {
    const legA = legIn(p, nets, a.spaceId, [a.x, a.y, a.z], [c.near.x, c.near.y, c.near.z]), legB = legIn(p, nets, b.spaceId, [c.far.x, c.far.y, c.far.z], [b.x, b.y, b.z]), pm = passageLength(p, c.ps);
    const length = legA.length + pm + legB.length;
    if (!best || length < best.length) best = { passage: c.id, length, method: legA.method === 'route' || legB.method === 'route' ? 'route' : 'direct', routes: [...(legA.routes ?? []), ...(legB.routes ?? [])], legA, legB, passageMm: pm };
  }
  return best;
}

export function estimateLengths(p: Project, slackMm = p.settings.defaultCableSlackMm ?? DEFAULT_SLACK_MM): EstimateReport {
  const r: EstimateReport = { estimates: [], skippedManual: 0, noPlacement: 0, noCable: 0, otherSpace: 0, viaRoute: 0, direct: 0, viaPassage: 0 };
  const pnets = new Map<Id, RouteNet | null>();
  const nets = new Map<Id, RouteNet>();
  const netOf = (sid: Id): RouteNet | undefined => {
    const routes = routesOf(p, sid); if (!Object.keys(routes).length) return undefined;
    let n = nets.get(sid);
    if (!n) {
      const pts = pointsIn(p, sid);
      n = buildNet(routes, pts); nets.set(sid, n);
    }
    return n;
  };
  for (const [cid, c] of Object.entries(p.connections)) {
    if (c.medium !== 'physical' || !c.cableId || !p.cables[c.cableId]) { r.noCable++; continue; }
    const cab = p.cables[c.cableId];
    if (cab.lengthSource === 'manual') { r.skippedManual++; continue; }
    const a = effectivePosition(p, c.from.instanceId), b = effectivePosition(p, c.to.instanceId);
    if (!a || !b) { r.noPlacement++; continue; }
    if (a.spaceId !== b.spaceId) {
      const run = runViaPassage(p, pnets, a, b);
      if (!run) { r.otherSpace++; continue; }
      r.viaPassage++; run.method === 'route' ? r.viaRoute++ : r.direct++;
      r.estimates.push({ connectionId: cid, cableId: c.cableId, lengthMm: Math.ceil((run.length + slackMm) / ROUND_MM) * ROUND_MM, method: run.method, ...(run.routes?.length ? { routes: run.routes } : {}), passage: run.passage });
      continue;
    }
    const dz = Math.abs(a.z - b.z);
    let length: number, method: 'route' | 'direct' = 'direct', routes: Id[] | undefined;
    const net = netOf(a.spaceId), pa = [a.x, a.y, a.z], pb = [b.x, b.y, b.z];
    const ta = net?.attach(pa), tb = net?.attach(pb), path = ta && tb ? net!.path(ta.node, tb.node) : null;
    if (path && ta && tb) { length = ta.stub + path.length + tb.stub + slackMm; method = 'route'; routes = path.routes; r.viaRoute++; }
    else { length = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + dz + slackMm; r.direct++; }
    r.estimates.push({ connectionId: cid, cableId: c.cableId, lengthMm: Math.ceil(length / ROUND_MM) * ROUND_MM, method, routes });
  }
  return r;
}

export interface CablePath { connectionId: Id; cableId?: Id; spaceId: Id; pts: number[]; method: 'route' | 'direct' }

/**
 * Przebieg kabli do narysowania na planie (rzut z góry): dojście prostopadłe do trasy, trasa, dojście do drugiego urządzenia.
 * Ta sama logika wyboru co w `estimateLengths` (trasa, gdy oba końce da się podpiąć; inaczej prosto). Pomija połączenia bez rozmieszczenia.
 */
export function cablePaths(p: Project): CablePath[] {
  const out: CablePath[] = [];
  const nets = new Map<Id, RouteNet>(), pnets = new Map<Id, RouteNet | null>();
  const flat = (pts: number[][]) => pts.flatMap((q) => [q[0], q[1]]);
  for (const [cid, c] of Object.entries(p.connections)) {
    const a = effectivePosition(p, c.from.instanceId), b = effectivePosition(p, c.to.instanceId);
    if (a && b && a.spaceId !== b.spaceId && c.medium === 'physical') { // między salami: dwa odcinki, każdy w swojej sali (przejście rysowane osobno)
      const run = runViaPassage(p, pnets, a, b);
      if (run) { out.push({ connectionId: cid, cableId: c.cableId ?? undefined, spaceId: a.spaceId, method: run.legA.method, pts: flat(run.legA.pts) }, { connectionId: cid, cableId: c.cableId ?? undefined, spaceId: b.spaceId, method: run.legB.method, pts: flat(run.legB.pts) }); }
      continue;
    }
    if (!a || !b || a.spaceId !== b.spaceId || c.medium !== 'physical') continue;
    let net = nets.get(a.spaceId);
    const routes = routesOf(p, a.spaceId);
    if (!net && Object.keys(routes).length) {
      net = buildNet(routes, pointsIn(p, a.spaceId)); nets.set(a.spaceId, net);
    }
    const pa = [a.x, a.y, a.z], pb = [b.x, b.y, b.z];
    const ta = net?.attach(pa), tb = net?.attach(pb), path = ta && tb ? net!.path(ta.node, tb.node) : null;
    if (path) {
      const first = path.points[0], last = path.points.at(-1)!;
      out.push({ connectionId: cid, cableId: c.cableId ?? undefined, spaceId: a.spaceId, method: 'route', pts: [pa[0], pa[1], pa[0], first[1], ...path.points.flatMap((q) => [q[0], q[1]]), pb[0], last[1], pb[0], pb[1]] });
    } else out.push({ connectionId: cid, cableId: c.cableId ?? undefined, spaceId: a.spaceId, method: 'direct', pts: [pa[0], pa[1], pb[0], pa[1], pb[0], pb[1]] });
  }
  return out;
}

export interface CablePath3 { connectionId: Id; cableId?: Id; pts: number[][]; method: 'route' | 'direct' }

/**
 * Przebieg kabli w 3D (widok 3D sali): od urządzenia poziomo do trasy, pionowo do jej wysokości, po trasach (także przez skrzyżowania),
 * i tak samo w dół do drugiego urządzenia. Ta sama logika wyboru co `cablePaths`; bez trasy: prosta linia między końcami.
 */
export function cablePaths3d(p: Project, spaceId?: Id): CablePath3[] {
  const out: CablePath3[] = [];
  const nets = new Map<Id, RouteNet>();
  for (const [cid, c] of Object.entries(p.connections)) {
    const a = effectivePosition(p, c.from.instanceId), b = effectivePosition(p, c.to.instanceId);
    if (!a || !b || a.spaceId !== b.spaceId || c.medium !== 'physical' || (spaceId && a.spaceId !== spaceId)) continue;
    let net = nets.get(a.spaceId);
    const routes = routesOf(p, a.spaceId);
    if (!net && Object.keys(routes).length) { net = buildNet(routes, pointsIn(p, a.spaceId)); nets.set(a.spaceId, net); }
    const pa = [a.x, a.y, a.z], pb = [b.x, b.y, b.z];
    const ta = net?.attach(pa), tb = net?.attach(pb), path = ta && tb ? net!.path(ta.node, tb.node) : null;
    const cableId = c.cableId ?? undefined;
    if (path) {
      const first = path.points[0], last = path.points.at(-1)!;
      out.push({ connectionId: cid, cableId, method: 'route', pts: [pa, [first[0], first[1], pa[2]], [...first], ...path.points.slice(1, -1).map((q) => [...q]), [...last], [last[0], last[1], pb[2]], pb] });
    } else out.push({ connectionId: cid, cableId, method: 'direct', pts: [pa, pb] });
  }
  return out;
}

/** Zapisuje oszacowane długości (lengthSource = estimated) i zapas w ustawieniach; jedna transakcja. */
export function applyEstimates(slackMm: number): Mutator {
  return (d) => {
    if (!(slackMm >= 0 && slackMm <= 20000)) throw new CommandError('Zapas musi być w zakresie 0–20 m');
    d.settings.defaultCableSlackMm = Math.round(slackMm);
    for (const e of estimateLengths(d as Project, slackMm).estimates) { const c = d.cables[e.cableId]; c.lengthMm = e.lengthMm; c.lengthSource = 'estimated'; c.estimateBasis = { method: e.method, ...(e.method === 'route' ? { routes: e.routes } : {}), ...(e.passage ? { passage: e.passage } : {}) }; }
  };
}
