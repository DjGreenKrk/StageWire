import type { Project } from '../types.ts';
import { cablePaths } from '../lengths.ts';
import { rackPlacementKey, rackFootprint, inPlacedHolder, spaceOrigin, byDrawOrder } from '../plan.ts';
import { passagesOf, passageLength } from '../passage.ts';

/**
 * DrawList: renderer-agnostyczna lista prymitywów (ARCHITECTURE §3, ADR-017). Czysta funkcja `model + widok → DrawList`.
 * Plan: jednostki = mm (Y w górę, jak w modelu). Diagram: jednostki diagramu (Y w dół).
 * Ta sama lista zasila Canvas 2D, SVG na ekranie i eksport SVG/PDF.
 */
/** `round`: elipsa wpisana w prostokąt (walec na planie). */
export interface Rect { t: 'rect'; id: string; x: number; y: number; w: number; h: number; rot: number; fill: string; stroke: string; lw: number; round?: boolean }
export interface Line { t: 'line'; id: string; pts: number[]; stroke: string; lw: number }
export interface Text { t: 'text'; id: string; x: number; y: number; s: string; size: number; color: string }
export interface Dot { t: 'dot'; id: string; x: number; y: number; r: number; fill: string }
export type Prim = Rect | Line | Text | Dot;
export interface DrawList { prims: Prim[]; unit: 'mm' | 'u' }
export type BBox = [number, number, number, number]; // minX, minY, maxX, maxY

// paleta GreenCrew (branding rodziny)
export const C = { bg: '#000000', surface: '#121212', variant: '#1E1E1E', border: '#2A2A2A', green: '#00C853', text: '#FFFFFF', text2: '#B0B0B0', warn: '#FFD54F', info: '#64B5F6' };

export function bboxOf(p: Prim): BBox {
  switch (p.t) {
    case 'rect': {
      if (!p.rot) return [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2];
      const a = (p.rot * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      const hw = (p.w * c + p.h * s) / 2, hh = (p.w * s + p.h * c) / 2;
      return [p.x - hw, p.y - hh, p.x + hw, p.y + hh];
    }
    case 'line': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < p.pts.length; i += 2) { x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]); y0 = Math.min(y0, p.pts[i + 1]); y1 = Math.max(y1, p.pts[i + 1]); }
      return [x0, y0, x1, y1];
    }
    case 'text': return [p.x, p.y - p.size, p.x + p.s.length * p.size * 0.6, p.y + p.size * 0.3];
    case 'dot': return [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];
  }
}

// ---------- plan sali (mm) ----------

const DEFAULT_W = 400, DEFAULT_D = 300;
const PASSAGE_COLOR = '#CE93D8';

/**
 * `cables`: przebieg kabli (po trasach lub prosto); `labels: false` pomija etykiety (rysowane osobno z unikaniem nakładania).
 * Wiele sal: `spaceId` = tylko ta sala, we własnych współrzędnych (PDF); `relativeTo` = wszystkie sale, współrzędne względem początku tej sali
 * (widok planu; inne sale rysują się z przesunięciem wynikającym z ich położenia w budynku). Domyślnie względem pierwszej sali.
 */
export function planDrawList(p: Project, opts: { cables?: boolean; labels?: boolean; spaceId?: string; relativeTo?: string; /** kable kolorowane wg rodzaju sygnału (eksport kolorowy) */ bySignal?: boolean } = {}): DrawList {
  const lines: Prim[] = [], rects: Prim[] = [], texts: Prim[] = [];
  const centers = new Map<string, [number, number]>();
  const ref = opts.spaceId ?? opts.relativeTo ?? Object.keys(p.spaces ?? {})[0], ro = ref ? spaceOrigin(p, ref) : [0, 0];
  const off = (sid: string): [number, number] => { if (opts.spaceId) return [0, 0]; const o = spaceOrigin(p, sid); return [o[0] - ro[0], o[1] - ro[1]]; };
  const multi = Object.keys(p.spaces ?? {}).length > 1;
  for (const [sid, sp] of Object.entries<any>(p.spaces ?? {})) {
    if (opts.spaceId && sid !== opts.spaceId) continue;
    const b: number[][] = sp.boundary ?? [], [ox, oy] = off(sid), active = sid === ref;
    if (b.length) lines.push({ t: 'line', id: sid, pts: [...b.flatMap((q) => [q[0] + ox, q[1] + oy]), b[0][0] + ox, b[0][1] + oy], stroke: active || !multi ? C.border : '#4A4A55', lw: 2 });
    if (multi && !active && b.length) texts.push({ t: 'text', id: sid, x: Math.min(...b.map((q) => q[0])) + ox, y: Math.max(...b.map((q) => q[1])) + oy + 300, s: sp.name, size: 520, color: C.text2 });
    for (const [rid, r] of Object.entries<any>(sp.cableRoutes ?? {})) lines.push({ t: 'line', id: rid, pts: r.points.flatMap((q: number[]) => [q[0] + ox, q[1] + oy]), stroke: '#00897B', lw: 6 });
  }
  for (const [plid, pl0] of Object.entries<any>(p.placements ?? {}).sort(([, a], [, b]) => byDrawOrder(a, b))) {
    if (opts.spaceId && pl0.spaceId !== opts.spaceId) continue;
    const [ox, oy] = off(pl0.spaceId), pl = { ...pl0, position: { ...pl0.position, x: pl0.position.x + ox, y: pl0.position.y + oy } };
    let w = DEFAULT_W, d = DEFAULT_D, label = '', fill = C.variant, stroke = C.green, id = pl.targetId, round = false, stairs = 0;
    if (pl.targetKind === 'equipment') {
      const inst = p.equipment[pl.targetId]; if (!inst) continue;
      if (inPlacedHolder(p, pl.targetId)) continue; // stoi w racku lub szafie, które są na planie
      const rev = p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)];
      w = rev?.dimensionsMm?.width ?? DEFAULT_W; d = rev?.dimensionsMm?.depth ?? DEFAULT_D; label = inst.name;
    } else if (pl.targetKind === 'stageObject') {
      const so = p.stageObjects?.[pl.targetId]; if (!so) continue;
      w = so.footprint?.widthMm ?? 1000; d = so.footprint?.depthMm ?? 1000; label = so.name; fill = so.color ?? C.surface; stroke = C.text2; round = so.shape === 'cylinder'; stairs = so.shape === 'stairs' ? Math.max(2, Math.round(so.steps ?? 6)) : 0;
    } else if (pl.targetKind === 'rack') {
      const rk = p.racks?.[pl.targetId]; if (!rk) continue;
      ({ w, d } = rackFootprint(p, pl.targetId)); label = (rk as any).name; fill = C.surface; stroke = C.warn;
    } else if (pl.targetKind === 'cabinet') {
      const cb = p.cabinets?.[pl.targetId] as any; if (!cb) continue;
      if (cb.mount && p.placements?.[rackPlacementKey(cb.mount.rackId)]) continue; // moduł w racku: rysowany jest rack
      ({ w, d } = rackFootprint(p, pl.targetId)); label = cb.name; fill = C.surface; stroke = '#FF8A65';
    } else continue;
    rects.push({ t: 'rect', id, x: pl.position.x, y: pl.position.y, w, h: d, rot: pl.rotationDeg ?? 0, fill, stroke, lw: 1.5, ...(round ? { round: true } : {}) });
    if (stairs) { // schody: kreski stopni i strzałka w stronę najwyższego stopnia (lokalny +Y); rysowane nad prostokątem
      const a = ((pl.rotationDeg ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), W2 = (x: number, y: number): number[] => [pl.position.x + x * ca - y * sa, pl.position.y + x * sa + y * ca];
      for (let i = 1; i < stairs; i++) { const ly = -d / 2 + (i * d) / stairs; texts.push({ t: 'line', id, pts: [...W2(-w / 2, ly), ...W2(w / 2, ly)], stroke: C.text2, lw: 1 }); }
      const tip = d * 0.3, head = Math.min(w, d) * 0.08;
      texts.push({ t: 'line', id, pts: [...W2(0, -tip), ...W2(0, tip)], stroke: C.text, lw: 1.5 }, { t: 'line', id, pts: [...W2(-head, tip - head), ...W2(0, tip), ...W2(head, tip - head)], stroke: C.text, lw: 1.5 });
    }
    if (opts.labels !== false) texts.push({ t: 'text', id, x: pl.position.x - w / 2, y: pl.position.y + d / 2 + 160, s: label, size: 140, color: C.text });
    centers.set(pl.targetId, [pl.position.x, pl.position.y]);
  }
  if (opts.cables) {
    for (const cp of cablePaths(p)) { if (opts.spaceId && cp.spaceId !== opts.spaceId) continue; const [ox, oy] = off(cp.spaceId); lines.push({ t: 'line', id: cp.connectionId, pts: cp.pts.map((v, k) => v + (k % 2 ? oy : ox)), stroke: opts.bySignal ? signalColor(p.connections[cp.connectionId]?.signalKey) : cp.method === 'route' ? C.info : C.warn, lw: 1.5 }); }
  }
  if (!opts.spaceId) { // przejścia kablowe między salami (widok całego budynku)
    for (const [pid, ps] of passagesOf(p)) {
      if (!p.spaces?.[ps.a.spaceId] || !p.spaces?.[ps.b.spaceId]) continue;
      const [ax, ay] = off(ps.a.spaceId), [bx, by] = off(ps.b.spaceId), x1 = ps.a.x + ax, y1 = ps.a.y + ay, x2 = ps.b.x + bx, y2 = ps.b.y + by;
      lines.push({ t: 'line', id: pid, pts: [x1, y1, x2, y2], stroke: PASSAGE_COLOR, lw: 3 });
      rects.push({ t: 'rect', id: pid, x: x1, y: y1, w: 420, h: 420, rot: 0, fill: PASSAGE_COLOR, stroke: PASSAGE_COLOR, lw: 1, round: true }, { t: 'rect', id: pid, x: x2, y: y2, w: 420, h: 420, rot: 0, fill: PASSAGE_COLOR, stroke: PASSAGE_COLOR, lw: 1, round: true });
      texts.push({ t: 'text', id: pid, x: (x1 + x2) / 2 + 120, y: (y1 + y2) / 2 + 120, s: `${ps.name} · ${(Math.round(passageLength(p, ps) / 10) / 100).toString().replace('.', ',')} m`, size: 420, color: PASSAGE_COLOR });
    }
  }
  return { prims: [...lines, ...rects, ...texts], unit: 'mm' };
}

// ---------- diagram (jednostki diagramu) ----------

/** Rodziny sygnałów i ich kolory na schemacie (czytelne na czarnym tle; w PDF kolorowym przyciemniane pod biały papier). */
const SIGNAL_FAMILIES: { re: RegExp; color: string; label: string }[] = [
  { re: /sdi|st2110|st-2110/, color: '#4FC3F7', label: 'Wideo SDI / IP' },
  { re: /hdmi|dvi/, color: '#BA68C8', label: 'Wideo HDMI / DVI' },
  { re: /displayport|(^|\/)dp($|-)/, color: '#7E57C2', label: 'Wideo DisplayPort' },
  { re: /vga/, color: '#9575CD', label: 'Wideo VGA' },
  { re: /ndi/, color: '#26A69A', label: 'NDI' },
  { re: /ethernet|rj45|poe|(^|\/)usb/, color: '#66BB6A', label: 'Sieć / USB' },
  { re: /dante|aes|audio|xlr|speak|wordclock|jack|rca|midi/, color: '#FFA726', label: 'Audio' },
  { re: /dmx|artnet|sacn|ctrl|relay/, color: '#EC407A', label: 'Światło / sterowanie' },
  { re: /power|iec|schuko|powercon|dc/, color: '#A1887F', label: 'Zasilanie' },
  { re: /fiber|fibre|sfp|lc-/, color: '#4DD0E1', label: 'Światłowód' },
  { re: /timecode|ltc|rs232|rs422|serial/, color: '#90A4AE', label: 'Timecode / serial' },
];
export const SIGNAL_DEFAULT = { color: '#B0BEC5', label: 'Inny sygnał' };
/** Własne kolory użytkownika (ustawienia programu): nazwa rodziny → #rrggbb; puste = kolory domyślne. */
let signalOverrides: Record<string, string> = {};
export const setSignalColors = (m: Record<string, string>) => { signalOverrides = { ...m }; };
/** Rodziny sygnałów z kolorami domyślnymi (do okna ustawień). */
export const SIGNAL_FAMILY_DEFAULTS: { label: string; color: string }[] = [...SIGNAL_FAMILIES.map(({ label, color }) => ({ label, color })), SIGNAL_DEFAULT];
export const signalFamily = (key: string | undefined): { color: string; label: string } => { const f = SIGNAL_FAMILIES.find((x) => x.re.test((key ?? '').toLowerCase())) ?? SIGNAL_DEFAULT; return { label: f.label, color: signalOverrides[f.label] ?? f.color }; };
export const signalColor = (key: string | undefined): string => signalFamily(key).color;
/** Rodziny sygnałów użyte w połączeniach projektu (do legendy). */
export function signalLegend(p: Project): { color: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const c of Object.values(p.connections)) { const f = signalFamily(c.signalKey); if (!seen.has(f.label)) seen.set(f.label, f.color); }
  return [...seen].map(([label, color]) => ({ label, color }));
}

export const NODE_W = 170, HEADER = 26, PORT_H = 16, STUB = 14;

export interface NodeLayout { x: number; y: number }
export interface DiagramView { nodes: Record<string, NodeLayout> } // klucz = instanceId (uproszczenie PoC)

// ---------- szafy jako bloki (ADR-052, etap 2) ----------
export type PRef = { instanceId: string; portId: string };
const isCabId = (id: string) => id.startsWith('cab_');
/** Szafa pokazywana jako blok, w której stoi osprzęt (undefined = osprzęt widoczny normalnie). */
export const blockCabOf = (p: Project, instanceId: string): string | undefined => { const c = (p.equipment[instanceId]?.din as any)?.cabinetId as string | undefined; return c && p.cabinets?.[c]?.asBlock ? c : undefined; };
/** Osprzęt zamontowany w szafie bywa ukrywany na schemacie (ustawienie projektu `hideMountedDin`, ADR-064); niezamontowany zostaje widoczny, żeby było widać, co dodano. */
export const hiddenOnDiagram = (p: Project, instanceId: string): boolean => !!(blockCabOf(p, instanceId) || ((p.settings as { hideMountedDin?: boolean } | undefined)?.hideMountedDin && (p.equipment[instanceId]?.din as any)?.cabinetId && p.cabinets?.[(p.equipment[instanceId].din as any).cabinetId]));
/** Port bloku szafy → port rzeczywistego osprzętu (dla grupy terminali: pierwszy terminal grupy). Inne porty bez zmian. */
export function innerRef(p: Project, r: PRef): PRef {
  if (!isCabId(r.instanceId)) return r;
  if (r.portId.startsWith('grp|')) { const t = (p.cabinets?.[r.instanceId]?.terminals as { instanceId: string; portId: string; group?: string }[] | undefined)?.find((x) => x.group === r.portId.slice(4)); return t ? { instanceId: t.instanceId, portId: t.portId } : r; }
  const k = r.portId.indexOf('|'); return { instanceId: r.portId.slice(0, k), portId: r.portId.slice(k + 1) };
}
/** Port osprzętu → port bloku szafy (tylko terminale); undefined, gdy port jest ukryty wewnątrz bloku. */
export function outerRef(p: Project, r: PRef): PRef | undefined {
  if (isCabId(r.instanceId)) return r;
  const c = blockCabOf(p, r.instanceId); if (!c) return hiddenOnDiagram(p, r.instanceId) ? undefined : r;
  const t = (p.cabinets![c].terminals as { instanceId: string; portId: string; group?: string }[] | undefined)?.find((x) => x.instanceId === r.instanceId && x.portId === r.portId);
  return t ? { instanceId: c, portId: t.group ? `grp|${t.group}` : `${r.instanceId}|${r.portId}` } : undefined;
}

export function portsOf(p: Project, instanceId: string): { left: [string, any][]; right: [string, any][] } {
  if (isCabId(instanceId)) {
    const terms = (p.cabinets?.[instanceId]?.terminals ?? []) as { instanceId: string; portId: string; group?: string }[], seen = new Set<string>();
    const portOfT = (t: { instanceId: string; portId: string }) => { const inst = p.equipment[t.instanceId]; return { inst, port: inst && p.definitions[inst.definitionId]?.revisions[String(inst.definitionRevision)]?.ports[t.portId] }; };
    const all: [string, any][] = terms.flatMap((t, i) => {
      const { inst, port } = portOfT(t); if (!port) return [];
      if (t.group) {
        if (seen.has(t.group)) return []; seen.add(t.group);
        const poles = terms.filter((x) => x.group === t.group).map((x) => portOfT(x).port?.label ?? '?').join(', ');
        return [[`grp|${t.group}`, { ...port, label: `${t.group} (${poles})`, order: i }] as [string, any]];
      }
      return [[`${t.instanceId}|${t.portId}`, { ...port, label: `${inst.name} · ${port.label}`, order: i }] as [string, any]];
    });
    return { left: all.filter(([, q]) => q.direction === 'in' || q.direction === 'io'), right: all.filter(([, q]) => q.direction === 'out' || q.direction === 'loop') };
  }
  const inst = p.equipment[instanceId];
  const rev = p.definitions[inst.definitionId].revisions[String(inst.definitionRevision)];
  const all = Object.entries(rev.ports).sort((a, b) => a[1].order - b[1].order);
  return { left: all.filter(([, q]) => q.direction === 'in' || q.direction === 'io'), right: all.filter(([, q]) => q.direction === 'out' || q.direction === 'loop') };
}

export function nodeSize(p: Project, instanceId: string): [number, number] {
  const { left, right } = portsOf(p, instanceId);
  return [NODE_W, HEADER + Math.max(left.length, right.length, 1) * PORT_H + 6];
}

/** Pozycja kotwicy portu w układzie diagramu. */
export function portAnchor(p: Project, v: DiagramView, instanceId: string, portId: string): [number, number, 'l' | 'r'] | undefined {
  const o = outerRef(p, { instanceId, portId }); if (!o) return undefined; instanceId = o.instanceId; portId = o.portId;
  const n = v.nodes[instanceId]; if (!n) return undefined;
  const { left, right } = portsOf(p, instanceId);
  let i = left.findIndex(([id]) => id === portId);
  if (i >= 0) return [n.x, n.y + HEADER + i * PORT_H + PORT_H / 2, 'l'];
  i = right.findIndex(([id]) => id === portId);
  if (i >= 0) return [n.x + NODE_W, n.y + HEADER + i * PORT_H + PORT_H / 2, 'r'];
  return undefined;
}

/**
 * Trasowanie ortogonalne (tylko segmenty poziome/pionowe). Wyjście prostopadle do boku portu, zygzak w połowie odległości;
 * gdy cel jest „za” źródłem, obejście górą/dołem. `lane` rozsuwa równoległe linie.
 */
export function routeOrthogonal(a: [number, number, 'l' | 'r'], b: [number, number, 'l' | 'r'], lane = 0): number[] {
  const [x1, y1, s1] = a, [x2, y2, s2] = b;
  const o1 = s1 === 'r' ? x1 + STUB : x1 - STUB;
  const o2 = s2 === 'l' ? x2 - STUB : x2 + STUB;
  if (s1 === 'r' && s2 === 'l' && o1 <= o2) {
    const xm = (o1 + o2) / 2 + lane;
    return [x1, y1, xm, y1, xm, y2, x2, y2];
  }
  const ym = (y1 + y2) / 2 + (y1 === y2 ? 40 : 0) + lane;
  return [x1, y1, o1, y1, o1, ym, o2, ym, o2, y2, x2, y2];
}

/** Skraca tekst z wielokropkiem tak, by zmieścił się w `px` (przybliżona szerokość znaku Roboto ≈ 0,56 × rozmiar). */
export function fitText(s: string, px: number, size: number): string {
  const max = Math.max(1, Math.floor(px / (size * 0.56)));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '…';
}

export function diagramDrawList(p: Project, v: DiagramView): DrawList {
  const edges: Prim[] = [], rects: Prim[] = [], dots: Prim[] = [], texts: Prim[] = [], seenEdge = new Set<string>();
  let lane = 0;
  for (const [cid, c] of Object.entries(p.connections)) {
    const a = portAnchor(p, v, c.from.instanceId, c.from.portId), b = portAnchor(p, v, c.to.instanceId, c.to.portId);
    if (!a || !b) continue; // krawędź pochodna
    if (outerRef(p, c.from)!.instanceId === outerRef(p, c.to)!.instanceId && isCabId(outerRef(p, c.from)!.instanceId)) continue; // wewnątrz bloku szafy
    const ob = `${outerRef(p, c.from)!.instanceId}/${outerRef(p, c.from)!.portId}>${outerRef(p, c.to)!.instanceId}/${outerRef(p, c.to)!.portId}`; if (seenEdge.has(ob)) continue; seenEdge.add(ob); // kilka biegunów jednej grupy = jedna kreska: rysowana tylko gdy oba końce są w widoku
    edges.push({ t: 'line', id: cid, pts: routeOrthogonal(a, b, ((lane++ % 5) - 2) * 3), stroke: signalColor(c.signalKey), lw: 1.5 });
  }
  for (const iid of Object.keys(v.nodes)) {
    const n = v.nodes[iid], cab = isCabId(iid) ? p.cabinets?.[iid] : undefined, inst = cab ? { name: `▦ ${cab.name}` } : p.equipment[iid];
    if (!inst || (cab && !cab.asBlock) || (!cab && hiddenOnDiagram(p, iid))) continue;
    const [w, h] = nodeSize(p, iid);
    rects.push({ t: 'rect', id: iid, x: n.x + w / 2, y: n.y + h / 2, w, h, rot: 0, fill: C.surface, stroke: cab ? C.warn : C.border, lw: cab ? 2 : 1 });
    texts.push({ t: 'text', id: iid, x: n.x + 8, y: n.y + 17, s: fitText(inst.name, w - 16, 13), size: 13, color: C.text });
    const { left, right } = portsOf(p, iid);
    left.forEach(([pid, q], i) => {
      const y = n.y + HEADER + i * PORT_H + PORT_H / 2;
      dots.push({ t: 'dot', id: iid + '/' + pid, x: n.x, y, r: 3.5, fill: C.green });
      texts.push({ t: 'text', id: iid + '/' + pid, x: n.x + 8, y: y + 4, s: fitText(q.label, w / 2 - 14, 10), size: 10, color: C.text2 });
    });
    right.forEach(([pid, q], i) => {
      const y = n.y + HEADER + i * PORT_H + PORT_H / 2;
      dots.push({ t: 'dot', id: iid + '/' + pid, x: n.x + w, y, r: 3.5, fill: C.warn });
      { const lb = fitText(q.label, w / 2 - 14, 10); texts.push({ t: 'text', id: iid + '/' + pid, x: n.x + w - 8 - lb.length * 5.6, y: y + 4, s: lb, size: 10, color: C.text2 }); }
    });
  }
  return { prims: [...edges, ...rects, ...dots, ...texts], unit: 'u' };
}

/** Układ siatkowy węzłów do testów syntetycznych (kolejność instancji = kolejność w siatce, więc krawędzie są lokalne). */
export function gridLayout(p: Project, cols?: number): DiagramView {
  const ids = Object.keys(p.equipment);
  const c = cols ?? Math.ceil(Math.sqrt(ids.length));
  const nodes: Record<string, NodeLayout> = {};
  ids.forEach((id, i) => { nodes[id] = { x: (i % c) * 320, y: Math.floor(i / c) * 220 }; });
  return { nodes };
}
