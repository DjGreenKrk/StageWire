// Widok planu sali (skala, mm, oś Y w górę): sala, rozmieszczanie urządzeń przeciąganiem, obrót, siatka 100 mm.
import { exportName } from './exportName.ts';
import type { Store } from '../src/store.ts';
import { planDrawList, C, type DrawList } from '../src/render/drawlist.ts';
import { estimateLengths, applyEstimates, DEFAULT_SLACK_MM } from '../src/lengths.ts';
import { routeCmd, routesOf, routeLength, routeHeight } from '../src/routes.ts';
import { newId } from '../src/ids.ts';
import { plan, effectivePosition, inPlacedHolder, placementKey, rackPlacementKey, rackFootprint, spaceSize, snap, newSpaceId, polygonProblem, polygonArea, isRectBoundary, spaceOrigin, pointInPolygon, floorLevel, byDrawOrder } from '../src/plan.ts';
import { buildScene, type Box3 } from '../src/view3d.ts';
import { underlayCmd, underlaysOf, imageToWorld } from '../src/underlay.ts';
import { drawUnderlays } from './underlayDraw.ts';
import { createUnderlayUi } from './underlayUi.ts';
import { settings } from './settings.ts';
import { createUnplacedUi, type UnplacedItem } from './unplacedUi.ts';
import { createPassageUi, DEFAULT_PASSAGE_Z } from './passageUi.ts';
import { passageCmd } from '../src/passage.ts';
import { followSurface, routeZAt } from '../src/surface.ts';
import { stageCmd, STAGE_PRESETS, STAGE_SHAPES, DEFAULT_STEPS, MIN_STEPS, MAX_STEPS, type StageShape } from '../src/stage.ts';
import { CanvasBackend } from './canvasBackend.ts';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { planPdf, PAPERS, SCALES, autoScale } from '../src/planPdf.ts';
import { spaceSize as spaceSz } from '../src/plan.ts';
import latinUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import latinExtUrl from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url';
import type { Camera } from './types.ts';

export interface PlanCtx {
  store: Store; W: number; H: number;
  say(m: string): void;
  /** Po zmianie modelu: walidacja, autozapis, odświeżenie paneli. */
  changed(): void;
  select(id: string | undefined): void;
  selected(): string | undefined;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtM = (mm: number) => String(Math.round(mm / 10) / 100).replace('.', ',');
const parseM = (s: string) => Number(s.replace(',', '.')) * 1000;

export function createPlan(ctx: PlanCtx) {
  const { store } = ctx; let W = ctx.W, H = ctx.H;
  const host = document.createElement('div'); host.id = 'plan';
  host.style.cssText = 'position:absolute;left:0;top:0;display:none';
  document.body.insertBefore(host, document.getElementById('menu'));
  const backend = new CanvasBackend(host, W, H);
  const buildingOrigin = (): number[] => { const a = spaceId(); return a ? spaceOrigin(store.state, a) : [0, 0]; };
  backend.underlay = (cx) => { drawUnderlays(cx, store.state, buildingOrigin(), () => draw(), underTmp); };
  const ov = document.createElement('canvas'); ov.width = W; ov.height = H; ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  host.appendChild(ov);
  const octx = ov.getContext('2d')!;
  const cam: Camera = { x: 10000, y: 6000, zoom: 0.05, flipY: true };
  let active = false, showCables = false, dl: DrawList | undefined;
  type Drag = { id: string; sx: number; sy: number; ox: number; oy: number; px: number; py: number; moved: boolean; idx: number[] } | { pan: true; sx: number; sy: number; cx: number; cy: number };
  let drag: Drag | undefined;
  type Pt = [number, number];
  let drawing: { pts: number[][]; cur?: number[] } | undefined; // rysowana trasa kablowa
  let shapeDraw: { pts: number[][]; cur?: number[]; name: string; h: number | null; forNew: boolean } | undefined; // rysowany obrys sali
  let selRoute: string | undefined;
  // edycja wierzchołków zaznaczonej trasy: praca na kopii punktów, zapis jednym poleceniem po puszczeniu
  let rdrag: { pts: number[][]; idx: number; sx: number; sy: number; moved: boolean; inserted: boolean } | undefined;
  let selVertex: { route: string; idx: number } | undefined;
  let routeZ = 0; // wysokość nowo rysowanych tras (mm); zapamiętuje ostatnio ustawioną
  // podkład z pliku: wskazywanie dwóch punktów (skala/wyprostowanie) i przesuwanie myszą
  let pick: { id: string; kind: 'scale' | 'level' | 'passage'; pts: number[][]; cur?: number[]; ends?: { spaceId: string; x: number; y: number }[] } | undefined; // punkty we współrzędnych budynku
  let umove: { id: string; drag?: { sx: number; sy: number } } | undefined;
  let underTmp: { id: string; dx: number; dy: number } | undefined;
  let onSolid = false; // trasa „po bryle”: wysokość punktów wynika z górnej powierzchni brył pod nimi
  let solidsCache: Box3[] | undefined;
  const solids = (): Box3[] => (solidsCache ??= buildScene(store.state, spaceId()).boxes);

  const toWorld = (sx: number, sy: number): [number, number] => [(sx - W / 2) / cam.zoom + cam.x, cam.y - (sy - H / 2) / cam.zoom];
  const toScreen = (wx: number, wy: number): [number, number] => [(wx - cam.x) * cam.zoom + W / 2, -(wy - cam.y) * cam.zoom + H / 2];
  let activeId: string | undefined; // aktywna sala: współrzędne planu i edycji są lokalne dla niej, pozostałe sale rysują się z przesunięciem
  const spaceId = (): string | undefined => { const ids = Object.keys(store.state.spaces ?? {}); return activeId && ids.includes(activeId) ? activeId : ids[0]; };
  /** Zmienia aktywną salę; widok zostaje w tym samym miejscu ekranu (kamera jest we współrzędnych aktywnej sali). */
  function setActive(id: string | undefined) {
    const old = spaceId(); if (!id || id === old || !store.state.spaces?.[id]) return;
    const o0 = old ? spaceOrigin(store.state, old) : [0, 0], o1 = spaceOrigin(store.state, id);
    cam.x -= o1[0] - o0[0]; cam.y -= o1[1] - o0[1]; activeId = id;
    selRoute = undefined; selRack = undefined; selVertex = undefined; ctx.select(undefined); ctx.changed(); refresh();
  }
  /** Inna sala pod punktem ekranu (do przełączania kliknięciem w jej obrys). */
  function roomAt(sx: number, sy: number): string | undefined {
    const [wx, wy] = toWorld(sx, sy), act = spaceId(), ao = act ? spaceOrigin(store.state, act) : [0, 0];
    for (const [id, sp] of Object.entries<any>(store.state.spaces ?? {})) { if (id === act) continue; const o = spaceOrigin(store.state, id); if (pointInPolygon([wx - (o[0] - ao[0]), wy - (o[1] - ao[1])], sp.boundary)) return id; }
    return undefined;
  }
  /** Rack albo szafa DIN: duże obiekty stawiane na planie razem z zamontowanym w nich osprzętem. */
  const isRack = (id: string) => id.startsWith('rck_') || id.startsWith('cab_') || id.startsWith('sob_');
  /** Urządzenie stoi w racku lub szafie, które są na planie: nie ma wtedy własnego punktu. */
  const hiddenInHolder = (id: string) => inPlacedHolder(store.state, id);
  const bigAt = (p: any) => (p.targetKind === 'stageObject' && store.state.stageObjects?.[p.targetId]) || (p.targetKind === 'rack' && store.state.racks?.[p.targetId]) || (p.targetKind === 'cabinet' && store.state.cabinets?.[p.targetId] && !(store.state.cabinets[p.targetId] as any).mount);
  const dims = (id: string) => { if (isRack(id)) { const f = rackFootprint(store.state, id); return { w: f.w, d: f.d }; } const i = store.state.equipment[id], d = i && store.state.definitions[i.definitionId]?.revisions[String(i.definitionRevision)]?.dimensionsMm; return { w: d?.width ?? 400, d: d?.depth ?? 300 }; };
  const placementOf = (id: string) => store.state.placements?.[isRack(id) ? rackPlacementKey(id) : placementKey(id)];
  let selRack: string | undefined;
  const nameOf = (id: string): string => isRack(id) ? ((store.state.racks?.[id] ?? store.state.cabinets?.[id] ?? store.state.stageObjects?.[id]) as any)?.name ?? id : store.state.equipment[id].name;

  /** Miejsce zajęte u góry przez paski narzędzi (zmienne --top ustawia edytor). */
  const topInset = () => { const pb = document.getElementById('planbar')!, m = document.getElementById('menu')!.getBoundingClientRect().bottom; return Math.max(70, Math.ceil(Math.max(m, pb.offsetHeight ? pb.getBoundingClientRect().bottom : 0)) + 8); };
  function fit() {
    const sid = spaceId(), sz = sid ? spaceSize(store.state, sid) : undefined;
    if (!sz) return;
    const L = 250, R = 270, T = topInset(), B = 50; // katalog po lewej, panel właściwości po prawej, pasek u góry i u dołu
    cam.zoom = Math.min((W - L - R) / sz.widthMm, (H - T - B) / sz.depthMm);
    const cx = L + (W - L - R) / 2, cy = T + (H - T - B) / 2; // środek wolnego obszaru na ekranie
    cam.x = sz.widthMm / 2 - (cx - W / 2) / cam.zoom; cam.y = sz.depthMm / 2 + (cy - H / 2) / cam.zoom;
  }
  /** Widok obejmujący wszystkie sale (we współrzędnych aktywnej sali). */
  function fitAll() {
    const act = spaceId(), ao = act ? spaceOrigin(store.state, act) : [0, 0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [id, sp] of Object.entries<any>(store.state.spaces ?? {})) { const o = spaceOrigin(store.state, id); for (const q of sp.boundary as number[][]) { const x = q[0] + o[0] - ao[0], y = q[1] + o[1] - ao[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    for (const [, u] of underlaysOf(store.state)) if (u.visible) for (const [px, py] of [[0, 0], [u.widthPx, 0], [u.widthPx, u.heightPx], [0, u.heightPx]]) { const w = imageToWorld(u, px, py), x = w[0] - ao[0], y = w[1] - ao[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!Number.isFinite(x0)) return;
    const L = 250, R = 270, T = topInset(), B = 50; cam.zoom = Math.min((W - L - R) / Math.max(x1 - x0, 1), (H - T - B) / Math.max(y1 - y0, 1), 2);
    const cx = L + (W - L - R) / 2, cy = T + (H - T - B) / 2; cam.x = (x0 + x1) / 2 - (cx - W / 2) / cam.zoom; cam.y = (y0 + y1) / 2 + (cy - H / 2) / cam.zoom;
  }
  function rebuild() { solidsCache = undefined; dl = planDrawList(store.state, { cables: showCables, labels: false, relativeTo: spaceId() }); backend.load(dl); }
  function draw() { backend.render(cam); drawOverlay(); }
  function refresh() { if (!active) return; rebuild(); draw(); updateBar(); }

  /** Etykiety urządzeń w px (stały rozmiar), z unikaniem nakładania: najpierw zaznaczone, potem kolejne; zasłonięte się nie rysują (przybliż, by zobaczyć). */
  function drawLabels() {
    octx.font = '11px Roboto, Segoe UI, sans-serif'; octx.textBaseline = 'alphabetic';
    const sel = ctx.selected(), taken = new Map<string, number[][]>(), CELL = 80;
    const free = (r: number[]) => {
      for (let cx = Math.floor(r[0] / CELL); cx <= Math.floor(r[2] / CELL); cx++) for (let cy = Math.floor(r[1] / CELL); cy <= Math.floor(r[3] / CELL); cy++)
        for (const o of taken.get(cx + ',' + cy) ?? []) if (r[0] < o[2] + 2 && r[2] > o[0] - 2 && r[1] < o[3] + 1 && r[3] > o[1] - 1) return false;
      return true;
    };
    const mark = (r: number[]) => { for (let cx = Math.floor(r[0] / CELL); cx <= Math.floor(r[2] / CELL); cx++) for (let cy = Math.floor(r[1] / CELL); cy <= Math.floor(r[3] / CELL); cy++) { const k = cx + ',' + cy; (taken.get(k) ?? taken.set(k, []).get(k)!).push(r); } };
    const act = spaceId(), ids = Object.values<any>(store.state.placements ?? {}).filter((p) => p.spaceId === act).filter((p) => (p.targetKind === 'equipment' && store.state.equipment[p.targetId] && placementOf(p.targetId) === p && !hiddenInHolder(p.targetId)) || bigAt(p)).map((p) => p.targetId as string);
    if (selRack) ids.sort((a, b) => (a === selRack ? -1 : b === selRack ? 1 : 0));
    if (sel) ids.sort((a, b) => (a === sel ? -1 : b === sel ? 1 : 0));
    let hidden = 0;
    for (const id of ids) {
      const pl = placementOf(id)!, { d } = dims(id), [cx, cy] = toScreen(pl.position.x, pl.position.y);
      const ly = cy + (d * cam.zoom) / 2 + 12, name = nameOf(id), tw = octx.measureText(name).width;
      if (cx < -tw || cx > W + tw || ly < -4 || ly > H + 14) continue;
      const r = [cx - tw / 2 - 2, ly - 10, cx + tw / 2 + 2, ly + 3];
      if (!free(r)) { hidden++; continue; }
      mark(r);
      octx.fillStyle = 'rgba(0,0,0,.65)'; octx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      octx.fillStyle = id === sel || id === selRack ? C.green : isRack(id) ? (id.startsWith('cab_') ? '#FF8A65' : id.startsWith('sob_') ? '#B0B0C0' : C.warn) : C.text; octx.fillText(name, cx - tw / 2, ly);
    }
    if (hidden) { octx.fillStyle = C.text2; octx.fillText(`Ukryte etykiety: ${hidden} (przybliż widok)`, W - 270 - 8, H - 8); }
  }

  /** Rysowany właśnie obrys sali (także gdy sali jeszcze nie ma). */
  function drawShapeDraft() {
    if (shapeDraw) {
      const pts = shapeDraw.cur ? [...shapeDraw.pts, shapeDraw.cur] : shapeDraw.pts;
      octx.beginPath(); pts.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); i ? octx.lineTo(x, y) : octx.moveTo(x, y); });
      if (shapeDraw.pts.length >= 3) octx.closePath();
      octx.fillStyle = 'rgba(255,213,79,.08)'; octx.fill(); octx.strokeStyle = '#FFD54F'; octx.lineWidth = 3; octx.setLineDash([8, 5]); octx.stroke(); octx.setLineDash([]);
      shapeDraw.pts.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); octx.beginPath(); octx.arc(x, y, i === 0 ? 7 : 4, 0, 6.2832); octx.fillStyle = i === 0 ? '#00C853' : '#FFD54F'; octx.fill(); });
      const last = shapeDraw.pts.at(-1);
      if (last && shapeDraw.cur) { const len = Math.hypot(shapeDraw.cur[0] - last[0], shapeDraw.cur[1] - last[1]), [x, y] = toScreen(shapeDraw.cur[0], shapeDraw.cur[1]); octx.fillStyle = C.text; octx.fillText(`${fmtM(len)} m`, x + 10, y - 8); }
    }
  }

  /** Wskazywane punkty podkładu (skala / wyprostowanie). */
  function drawPickOverlay() {
    if (!pick) return; const o = buildingOrigin(), pts = pick.cur && pick.pts.length < 2 ? [...pick.pts, pick.cur] : pick.pts;
    const sc = pts.map((q) => toScreen(q[0] - o[0], q[1] - o[1]));
    octx.strokeStyle = '#FF4081'; octx.fillStyle = '#FF4081'; octx.lineWidth = 2; octx.setLineDash([6, 4]); octx.beginPath(); sc.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y))); octx.stroke(); octx.setLineDash([]);
    pick.pts.forEach((q, i) => { const [x, y] = toScreen(q[0] - o[0], q[1] - o[1]); octx.beginPath(); octx.arc(x, y, 6, 0, 6.2832); octx.fill(); octx.fillStyle = '#fff'; octx.fillText(String(i + 1), x + 9, y - 8); octx.fillStyle = '#FF4081'; });
    if (pick.kind !== 'passage' && pick.pts.length === 1 && pick.cur) { const len = Math.hypot(pick.cur[0] - pick.pts[0][0], pick.cur[1] - pick.pts[0][1]), [x, y] = sc[1]; octx.fillStyle = '#fff'; octx.fillText(`${fmtM(len)} m (wg obecnej skali)`, x + 10, y - 8); }
  }
  /** Przejście kablowe: dwa kliknięcia w dwóch różnych salach (końce w ich lokalnych współrzędnych). */
  function addPassPoint(sx: number, sy: number) {
    if (!pick) return; const [wx, wy] = toWorld(sx, sy), o = buildingOrigin(), act = spaceId()!, sp: any = store.state.spaces![act];
    const sid = pointInPolygon([wx, wy], sp.boundary) ? act : roomAt(sx, sy);
    if (!sid) { ctx.say('Kliknij wewnątrz sali: każdy koniec przejścia leży w jednej z sal'); return; }
    if (pick.ends?.[0]?.spaceId === sid) { ctx.say('Drugi koniec przejścia musi być w innej sali'); return; }
    const so = spaceOrigin(store.state, sid); pick.pts.push([wx + o[0], wy + o[1]]); pick.ends!.push({ spaceId: sid, x: Math.round(wx + o[0] - so[0]), y: Math.round(wy + o[1] - so[1]) });
    if (pick.ends!.length < 2) { ctx.say('Wskaż drugi koniec przejścia w innej sali'); draw(); return; }
    const [ea, eb] = pick.ends!, n = Object.keys((store.state as any).passages ?? {}).length + 1; pick = undefined; host.style.cursor = '';
    try { store.dispatch('Dodaj przejście kablowe', passageCmd.add(newId('pas'), { name: `Przejście ${n}`, a: { ...ea, z: DEFAULT_PASSAGE_Z }, b: { ...eb, z: DEFAULT_PASSAGE_Z } })); ctx.changed(); ctx.say('Dodano przejście. Nadaj mu nazwę i wysokość; długość można wpisać ręcznie (np. kręty korytarz)'); }
    catch (err) { ctx.say(String((err as Error).message)); }
    refresh(); passUi.open();
  }
  function addPick(sx: number, sy: number) {
    if (!pick) return;
    if (pick.kind === 'passage') { addPassPoint(sx, sy); return; } const [wx, wy] = toWorld(sx, sy), o = buildingOrigin(); pick.pts.push([wx + o[0], wy + o[1]]);
    if (pick.pts.length < 2) { ctx.say('Wskaż drugi punkt'); draw(); return; }
    const pk = pick, [p1, p2] = pk.pts; pick = undefined; host.style.cursor = '';
    if (pk.kind === 'level') {
      const deg = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI, rot = -(deg - Math.round(deg / 90) * 90);
      try { store.dispatch('Wyprostuj podkład', underlayCmd.rotateAbout(pk.id, p1, rot)); ctx.changed(); ctx.say(`Obrócono podkład o ${Math.round(rot * 100) / 100}°: wskazany odcinek jest teraz poziomy lub pionowy`); } catch (err) { ctx.say(String((err as Error).message)); }
      refresh(); return;
    }
    askDistance(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), (mm) => {
      try { store.dispatch('Wyskaluj podkład', underlayCmd.scaleByPoints(pk.id, p1, p2, mm)); ctx.changed(); ctx.say(`Wyskalowano podkład: odcinek ma teraz ${fmtM(mm)} m`); } catch (err) { ctx.say(String((err as Error).message)); }
      refresh();
    }, () => { draw(); });
  }
  function askDistance(curMm: number, ok: (mm: number) => void, cancel: () => void) {
    const o = document.createElement('div'); o.id = 'pickdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:380px"><h2>Wyskaluj podkład</h2><p class="imp">Wskazany odcinek ma na podkładzie ${fmtM(curMm)} m (wg obecnej skali). Ile ma naprawdę?</p>
      <label>Rzeczywista długość [m]<input id="pk-len" style="display:block;width:100%;margin:4px 0 10px" value="${fmtM(curMm)}"></label><div class="btns"><button id="pk-ok" class="primary">Wyskaluj</button><button id="pk-cancel">Anuluj</button></div></div>`;
    document.body.appendChild(o); const inp = o.querySelector('#pk-len') as HTMLInputElement; inp.focus(); inp.select();
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (o.querySelector('#pk-ok') as HTMLElement).click(); if (ev.key === 'Escape') (o.querySelector('#pk-cancel') as HTMLElement).click(); });
    o.querySelector('#pk-cancel')!.addEventListener('click', () => { o.remove(); cancel(); });
    o.querySelector('#pk-ok')!.addEventListener('click', () => { const mm = parseM(inp.value); if (!Number.isFinite(mm) || mm <= 0) { ctx.say('Podaj długość w metrach'); return; } o.remove(); ok(mm); });
  }
  const underUi = createUnderlayUi({
    store, say: ctx.say, changed: () => ctx.changed(), refresh: () => refresh(),
    startPick(id, kind) { pick = { id, kind, pts: [] }; host.style.cursor = 'crosshair'; ctx.say(kind === 'scale' ? 'Wyskaluj: kliknij dwa punkty o znanej odległości na podkładzie (np. końce wymiarowanego odcinka). Esc = anuluj' : 'Wyprostuj: kliknij dwa punkty odcinka, który ma być poziomy lub pionowy (np. ściana). Esc = anuluj'); draw(); },
    startMove(id) { umove = { id }; host.style.cursor = 'move'; ctx.say('Przeciągnij podkład myszą w nowe miejsce. Esc = anuluj'); },
    focus(id) {
      const u = (store.state as any).underlays?.[id]; if (!u) return; const o = buildingOrigin();
      const cs = [[0, 0], [u.widthPx, 0], [u.widthPx, u.heightPx], [0, u.heightPx]].map(([px, py]) => imageToWorld(u, px, py));
      const x0 = Math.min(...cs.map((q) => q[0])) - o[0], x1 = Math.max(...cs.map((q) => q[0])) - o[0], y0 = Math.min(...cs.map((q) => q[1])) - o[1], y1 = Math.max(...cs.map((q) => q[1])) - o[1];
      const L = 250, R = 270, T = topInset(), B = 50; cam.zoom = Math.min((W - L - R) / (x1 - x0 || 1), (H - T - B) / (y1 - y0 || 1), 2);
      const cx = L + (W - L - R) / 2, cy = T + (H - T - B) / 2; cam.x = (x0 + x1) / 2 - (cx - W / 2) / cam.zoom; cam.y = (y0 + y1) / 2 + (cy - H / 2) / cam.zoom; draw();
    },
  });
  const passUi = createPassageUi({
    store, say: ctx.say, changed: () => ctx.changed(), refresh: () => refresh(),
    startPick() { pick = { id: '', kind: 'passage', pts: [], ends: [] }; host.style.cursor = 'crosshair'; fitAll(); ctx.say('Przejście kablowe: kliknij punkt w jednej sali (np. wyjście multicore\'a na FOH), potem punkt w drugiej (np. stage box na scenie). Esc = anuluj'); draw(); },
    showAll() { fitAll(); draw(); },
  });
  function drawOverlay() {
    octx.clearRect(0, 0, W, H);
    const sid = spaceId(), sz = sid ? spaceSize(store.state, sid) : undefined;
    if (!sz || !sid) { if (shapeDraw) { drawShapeDraft(); return; } octx.fillStyle = C.text2; octx.font = '16px Roboto, Segoe UI, sans-serif'; octx.textAlign = 'center'; octx.fillText('Brak sali. Kliknij „Sala…”, aby ustawić wymiary.', W / 2, H / 2); octx.textAlign = 'start'; return; }
    const [x0, y0] = toScreen(0, sz.depthMm), [x1, y1] = toScreen(sz.widthMm, 0);
    const bnd: number[][] = store.state.spaces![sid].boundary ?? [];
    octx.save(); octx.beginPath(); bnd.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); i ? octx.lineTo(x, y) : octx.moveTo(x, y); }); octx.closePath(); octx.clip(); // siatka tylko wewnątrz obrysu sali
    octx.fillStyle = 'rgba(255,255,255,.025)'; octx.fillRect(0, 0, W, H);
    // siatka: 1 m (gdy ≥ 8 px) i 5 m
    octx.lineWidth = 1;
    for (const [step, color, minPx] of [[1000, 'rgba(255,255,255,.07)', 8], [5000, 'rgba(255,255,255,.16)', 4]] as const) {
      if (step * cam.zoom < minPx) continue;
      octx.strokeStyle = color; octx.beginPath();
      for (let x = 0; x <= sz.widthMm; x += step) { const sx = Math.round(toScreen(x, 0)[0]) + 0.5; octx.moveTo(sx, y0); octx.lineTo(sx, y1); }
      for (let y = 0; y <= sz.depthMm; y += step) { const sy = Math.round(toScreen(0, y)[1]) + 0.5; octx.moveTo(x0, sy); octx.lineTo(x1, sy); }
      octx.stroke();
    }
    octx.restore();
    octx.fillStyle = C.text2; octx.font = '12px Roboto, Segoe UI, sans-serif';
    octx.fillText(`${store.state.spaces![sid].name} · ${isRectBoundary(bnd) ? `${fmtM(sz.widthMm)} × ${fmtM(sz.depthMm)} m` : `${fmtM(sz.widthMm)} × ${fmtM(sz.depthMm)} m (ramka) · ${Math.round(polygonArea(bnd) / 10000) / 100} m²`}`, x0, y0 - 6);
    drawLabels();
    // trasa zaznaczona i rysowana
    const sr0 = selRoute ? routeEntries().find(([id]) => id === selRoute)?.[1] : undefined;
    const sr = sr0 && rdrag ? { ...sr0, points: rdrag.pts } : sr0;
    if (sr) { octx.beginPath(); sr.points.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); i ? octx.lineTo(x, y) : octx.moveTo(x, y); }); octx.strokeStyle = C.text; octx.lineWidth = 5; octx.globalAlpha = 0.5; octx.stroke(); octx.globalAlpha = 1;
      sr.points.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]), on = selVertex !== undefined && selVertex.route === selRoute && selVertex.idx === i; octx.fillStyle = on ? C.green : C.text; octx.strokeStyle = '#000'; octx.lineWidth = 1; octx.fillRect(x - 5, y - 5, 10, 10); octx.strokeRect(x - 5, y - 5, 10, 10); });
      if (!rdrag) for (let i = 1; i < sr.points.length; i++) { const [x, y] = toScreen((sr.points[i - 1][0] + sr.points[i][0]) / 2, (sr.points[i - 1][1] + sr.points[i][1]) / 2); octx.beginPath(); octx.arc(x, y, 4, 0, 6.2832); octx.strokeStyle = C.text; octx.lineWidth = 1.5; octx.stroke(); }
    }
    if (drawing) {
      const pts = drawing.cur ? [...drawing.pts, drawing.cur] : drawing.pts;
      octx.beginPath(); pts.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); i ? octx.lineTo(x, y) : octx.moveTo(x, y); });
      octx.strokeStyle = '#4DD0E1'; octx.lineWidth = 3; octx.setLineDash([8, 5]); octx.stroke(); octx.setLineDash([]);
      for (const q of drawing.pts) { const [x, y] = toScreen(q[0], q[1]); octx.beginPath(); octx.arc(x, y, 4, 0, 6.2832); octx.fillStyle = '#4DD0E1'; octx.fill(); }
      const last = drawing.pts.at(-1);
      if (last && drawing.cur) { const len = Math.hypot(drawing.cur[0] - last[0], drawing.cur[1] - last[1]), [x, y] = toScreen(drawing.cur[0], drawing.cur[1]); octx.fillStyle = C.text; octx.fillText(`${fmtM(len)} m · z ${fmtM(drawing.cur[2])} m`, x + 10, y - 8); }
    }
    drawShapeDraft(); drawPickOverlay();
    // zaznaczenie
    const sel = selRack ?? ctx.selected(), pl = sel ? placementOf(sel) : undefined;
    if (sel && pl) {
      const { w, d } = dims(sel), [cx, cy] = toScreen(pl.position.x, pl.position.y), a = ((pl.rotationDeg ?? 0) * Math.PI) / 180;
      octx.save(); octx.translate(cx, cy); octx.rotate(-a); octx.strokeStyle = C.green; octx.lineWidth = 2;
      octx.strokeRect(-w * cam.zoom / 2 - 2, -d * cam.zoom / 2 - 2, w * cam.zoom + 4, d * cam.zoom + 4); octx.restore();
    }
    // podziałka
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].map((m) => m * 1000).find((mm) => mm * cam.zoom >= 90) ?? 50000;
    const px = nice * cam.zoom, bx = 260, by = H - 24;
    octx.strokeStyle = C.text; octx.lineWidth = 2; octx.beginPath(); octx.moveTo(bx, by - 4); octx.lineTo(bx, by); octx.lineTo(bx + px, by); octx.lineTo(bx + px, by - 4); octx.stroke();
    octx.fillStyle = C.text; octx.fillText(`${fmtM(nice)} m`, bx + px + 8, by);
  }

  function hit(sx: number, sy: number): string | undefined {
    const [wx, wy] = toWorld(sx, sy);
    const act = spaceId(), pls = Object.values<any>(store.state.placements ?? {}).filter((p) => p.spaceId === act).filter((p) => (p.targetKind === 'equipment' && store.state.equipment[p.targetId] && !hiddenInHolder(p.targetId)) || bigAt(p)).sort(byDrawOrder); // ta sama kolejność co przy rysowaniu: urządzenia nad bryłami
    const tol = 4 / cam.zoom;
    for (let i = pls.length - 1; i >= 0; i--) {
      const p = pls[i], { w, d } = dims(p.targetId), a = ((p.rotationDeg ?? 0) * Math.PI) / 180;
      const dx = wx - p.position.x, dy = wy - p.position.y, lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 + tol && Math.abs(ly) <= d / 2 + tol) return p.targetId;
    }
    return undefined;
  }

  const routeEntries = () => { const sid = spaceId(); return sid ? Object.entries(routesOf(store.state, sid)) : []; };
  function routeAt(sx: number, sy: number): string | undefined {
    const [wx, wy] = toWorld(sx, sy), tol = 7 / cam.zoom;
    for (const [rid, r] of routeEntries()) for (let i = 1; i < r.points.length; i++) {
      const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / l2)) : 0;
      if (Math.hypot(wx - (ax + t * dx), wy - (ay + t * dy)) <= tol) return rid;
    }
    return undefined;
  }
  let snapZ: number | undefined; // wysokość wierzchołka istniejącej trasy, do którego przyciągnięto ostatni punkt
  const zBox = document.getElementById('rt-hbox')!, zIn = document.getElementById('rt-h') as HTMLInputElement;
  const setZ = (mm: number) => { routeZ = Math.round(mm); zIn.value = fmtM(routeZ); };
  zIn.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') zIn.blur(); });
  zIn.addEventListener('change', () => { const z = parseM(zIn.value); if (Number.isFinite(z) && z >= 0) setZ(z); else zIn.value = fmtM(routeZ); });
  /** Punkt trasy: siatka 100 mm; przyciąganie do istniejących wierzchołków (12 px); Shift = oś prostopadła do poprzedniego punktu. */
  function routePoint(sx: number, sy: number, shift: boolean): Pt {
    const [wx, wy] = toWorld(sx, sy);
    let best: Pt | undefined, bd = 12 / cam.zoom;
    snapZ = undefined;
    for (const [, r] of routeEntries()) for (const q of r.points) { const d = Math.hypot(q[0] - wx, q[1] - wy); if (d <= bd) { bd = d; best = [q[0], q[1]]; snapZ = q[2] ?? 0; } }
    if (drawing) for (const q of drawing.pts) { const d = Math.hypot(q[0] - wx, q[1] - wy); if (d <= bd) { bd = d; best = [q[0], q[1]]; snapZ = undefined; } }
    if (best) return [best[0], best[1]];
    let p: Pt = [snap(wx), snap(wy)];
    const last = drawing?.pts.at(-1);
    if (shift && last) p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    return p;
  }
  function setDrawing(on: boolean) {
    drawing = on ? { pts: [] } : undefined; host.style.cursor = on ? 'crosshair' : '';
    zBox.style.display = on ? 'flex' : 'none'; if (on) setZ(routeZ); if (on) solidsCache = undefined;
    const b = document.getElementById('b-route')!; b.textContent = on ? 'Zakończ trasę (Enter)' : 'Rysuj trasę'; b.classList.toggle('on', on);
    if (on) { selRoute = undefined; ctx.select(undefined); ctx.say('Klikaj punkty trasy. Zmiana poziomu: ustaw wysokość i kliknij „Pion” (albo kliknij ten sam punkt po zmianie wysokości). Shift = oś prostopadła, Backspace = cofnij, Enter = zakończ, Esc = anuluj'); }
    draw();
  }
  function addRiser() {
    const last = drawing?.pts.at(-1);
    if (!drawing || !last) { ctx.say('Najpierw kliknij pierwszy punkt trasy'); return; }
    if (last[2] === routeZ) { ctx.say('Ustaw najpierw inną wysokość niż ostatni punkt'); return; }
    drawing.pts.push([last[0], last[1], routeZ]); ctx.say(`Dodano pion: ${fmtM(last[2])} → ${fmtM(routeZ)} m`); draw();
  }
  function finishRoute() {
    const d = drawing, sid = spaceId(); if (!d || !sid) return;
    if (d.pts.length < 2) { setDrawing(false); ctx.say('Trasa wymaga co najmniej dwóch punktów; anulowano'); return; }
    const n = routeEntries().length + 1, id = newId('rte');
    try { store.dispatch('Dodaj trasę kablową', routeCmd.addRoute(sid, id, `Trasa ${n}`, d.pts)); } catch (err) { ctx.say(String((err as Error).message)); return; }
    setDrawing(false); selRoute = id; ctx.changed(); refresh(); ctx.say(`Dodano trasę ${n} (${fmtM(routeLength(routesOf(store.state, sid)[id]))} m)`);
  }

  const HANDLE_PX = 9;
  /** Uchwyt wierzchołka lub środka odcinka zaznaczonej trasy pod kursorem (px ekranu). */
  function handleAt(sx: number, sy: number): { kind: 'v' | 'm'; i: number } | undefined {
    const sid = spaceId(), r = sid && selRoute ? routesOf(store.state, sid)[selRoute] : undefined; if (!r) return undefined;
    for (let i = 0; i < r.points.length; i++) { const [x, y] = toScreen(r.points[i][0], r.points[i][1]); if (Math.hypot(x - sx, y - sy) <= HANDLE_PX) return { kind: 'v', i }; }
    for (let i = 1; i < r.points.length; i++) {
      const [x, y] = toScreen((r.points[i - 1][0] + r.points[i][0]) / 2, (r.points[i - 1][1] + r.points[i][1]) / 2);
      if (Math.hypot(x - sx, y - sy) <= HANDLE_PX) return { kind: 'm', i };
    }
    return undefined;
  }
  /** Przyciąganie przeciąganego wierzchołka: wierzchołki innych tras (12 px), inaczej siatka 100 mm. */
  function vertexSnap(sx: number, sy: number): [number, number] {
    const [wx, wy] = toWorld(sx, sy); let best: [number, number] | undefined, bd = 12 / cam.zoom;
    for (const [rid, r] of routeEntries()) if (rid !== selRoute) for (const q of r.points) { const d = Math.hypot(q[0] - wx, q[1] - wy); if (d <= bd) { bd = d; best = [q[0], q[1]]; } }
    return best ?? [snap(wx), snap(wy)];
  }
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    host.setPointerCapture(e.pointerId);
    if (!drawing && selRoute) {
      const h = handleAt(e.offsetX, e.offsetY), sid = spaceId(), r = sid ? routesOf(store.state, sid)[selRoute] : undefined;
      if (h && r) {
        const pts = r.points.map((q) => [...q]);
        if (h.kind === 'm') { const a = pts[h.i - 1], b = pts[h.i]; pts.splice(h.i, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round(((a[2] ?? 0) + (b[2] ?? 0)) / 2)]); }
        rdrag = { pts, idx: h.i, sx: e.offsetX, sy: e.offsetY, moved: false, inserted: h.kind === 'm' };
        selVertex = { route: selRoute, idx: h.i }; draw(); return;
      }
    }
    if (umove) { umove.drag = { sx: e.offsetX, sy: e.offsetY }; return; }
    const id = drawing || shapeDraw || pick ? undefined : hit(e.offsetX, e.offsetY);
    if (id) {
      selRoute = undefined; selRack = isRack(id) ? id : undefined;
      const pl = placementOf(id)!, idx: number[] = [];
      dl!.prims.forEach((p, i) => { if (p.id === id) idx.push(i); }); // także kreski stopni schodów
      if ((pl as any).locked) { ctx.select(isRack(id) ? undefined : id); drag = { pan: true, sx: e.offsetX, sy: e.offsetY, cx: cam.x, cy: cam.y }; ctx.say('Obiekt zablokowany: przeciąganie przesuwa tylko widok (odblokuj go we właściwościach)'); draw(); return; }
      drag = { id, sx: e.offsetX, sy: e.offsetY, ox: pl.position.x, oy: pl.position.y, px: pl.position.x, py: pl.position.y, moved: false, idx };
      ctx.select(isRack(id) ? undefined : id);
    } else drag = { pan: true, sx: e.offsetX, sy: e.offsetY, cx: cam.x, cy: cam.y };
    draw();
  });
  host.addEventListener('pointermove', (e) => {
    if (rdrag) {
      if (!rdrag.moved && Math.hypot(e.offsetX - rdrag.sx, e.offsetY - rdrag.sy) < 4) return;
      const [nx, ny] = vertexSnap(e.offsetX, e.offsetY); rdrag.moved = true;
      rdrag.pts[rdrag.idx] = [nx, ny, rdrag.pts[rdrag.idx][2] ?? 0]; ctx.say(`Punkt trasy: ${fmtM(nx)} × ${fmtM(ny)} m`); drawOverlay(); return;
    }
    if (umove?.drag) { underTmp = { id: umove.id, dx: (e.offsetX - umove.drag.sx) / cam.zoom, dy: -(e.offsetY - umove.drag.sy) / cam.zoom }; draw(); return; }
    if (pick && !drag) { const [wx, wy] = toWorld(e.offsetX, e.offsetY), o = buildingOrigin(); pick.cur = [wx + o[0], wy + o[1]]; drawOverlay(); return; }
    if (shapeDraw && !drag) { shapeDraw.cur = shapePoint(e.offsetX, e.offsetY, e.shiftKey); drawOverlay(); return; }
    if (drawing && !drag) { const q = routePoint(e.offsetX, e.offsetY, e.shiftKey); drawing.cur = [q[0], q[1], onSolid ? routeZAt(solids(), q[0], q[1], routeZ) : routeZ]; drawOverlay(); return; }
    if (!drag) return;
    if ('pan' in drag) { cam.x = drag.cx - (e.offsetX - drag.sx) / cam.zoom; cam.y = drag.cy + (e.offsetY - drag.sy) / cam.zoom; draw(); return; }
    if (!drag.moved && Math.hypot(e.offsetX - drag.sx, e.offsetY - drag.sy) < 4) return;
    const nx = snap(drag.ox + (e.offsetX - drag.sx) / cam.zoom), ny = snap(drag.oy - (e.offsetY - drag.sy) / cam.zoom);
    drag.moved = true;
    if (nx !== drag.px || ny !== drag.py) { backend.move(drag.idx, nx - drag.px, ny - drag.py); drag.px = nx; drag.py = ny; draw(); }
    ctx.say(`${fmtM(nx)} × ${fmtM(ny)} m`);
  });
  host.addEventListener('pointerup', (e) => {
    if (rdrag) {
      const d = rdrag, sid = spaceId(); rdrag = undefined;
      if ((d.moved || d.inserted) && sid && selRoute) {
        try { store.dispatch(d.inserted ? 'Dodaj punkt trasy' : 'Przesuń punkt trasy', routeCmd.setRoutePoints(sid, selRoute, d.pts)); ctx.changed(); ctx.say('Zmieniono trasę (długości kabli policz ponownie)'); }
        catch (err) { ctx.say(String((err as Error).message)); }
      }
      refresh(); return;
    }
    if (umove?.drag) {
      const um = umove, t = underTmp; umove = undefined; underTmp = undefined; host.style.cursor = '';
      const u = (store.state as any).underlays?.[um.id];
      if (u && t && (Math.abs(t.dx) > 0.5 || Math.abs(t.dy) > 0.5)) { try { store.dispatch('Przesuń podkład', underlayCmd.update(um.id, { x: u.x + t.dx, y: u.y + t.dy })); ctx.changed(); ctx.say('Przesunięto podkład'); } catch (err) { ctx.say(String((err as Error).message)); } }
      refresh(); return;
    }
    const d = drag; drag = undefined;
    if (!d) return;
    if ('pan' in d) {
      if (Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy) < 4) {
        if (drawing) {
          const q = routePoint(e.offsetX, e.offsetY, e.shiftKey), last = drawing.pts.at(-1);
          if (!last && snapZ !== undefined && snapZ !== routeZ) { setZ(snapZ); ctx.say(`Początek na istniejącej trasie: wysokość ustawiona na ${fmtM(snapZ)} m`); }
          if (onSolid && last) { for (const pt of followSurface(solids(), last, q[0], q[1], routeZ)) drawing.pts.push(pt); }
          else {
            const q3 = [q[0], q[1], onSolid ? routeZAt(solids(), q[0], q[1], routeZ) : routeZ];
            if (!last || last[0] !== q3[0] || last[1] !== q3[1] || last[2] !== q3[2]) drawing.pts.push(q3);
          }
        }
        else if (pick) addPick(e.offsetX, e.offsetY);
        else if (shapeDraw) addShapePoint(e.offsetX, e.offsetY, e.shiftKey);
        else { const rt = routeAt(e.offsetX, e.offsetY), other = rt ? undefined : roomAt(e.offsetX, e.offsetY); if (other) { setActive(other); ctx.say(`Aktywna sala: ${store.state.spaces![other].name}`); } else { selRoute = rt; selVertex = undefined; selRack = undefined; ctx.select(undefined); } }
      }
      draw(); return;
    }
    if (d.moved) {
      const sid = placementOf(d.id)!.spaceId;
      if (d.px !== d.ox || d.py !== d.oy) { store.dispatch('Przesuń na planie', isRack(d.id) ? plan.placeRack(d.id, sid, d.px, d.py) : plan.place(d.id, sid, d.px, d.py)); ctx.changed(); }
    }
    refresh(); ctx.select(isRack(d.id) ? undefined : d.id); if (isRack(d.id)) ctx.changed();
  });
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wy] = toWorld(e.offsetX, e.offsetY);
    cam.zoom = Math.min(2, Math.max(0.004, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    cam.x = wx - (e.offsetX - W / 2) / cam.zoom; cam.y = wy + (e.offsetY - H / 2) / cam.zoom;
    draw();
  }, { passive: false });

  let suspended = false; // widok 3D przykrywa plan: klawisze planu (R, Delete, Enter…) nie działają
  window.addEventListener('keydown', (e) => {
    if (!active || suspended || ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if ((pick || umove) && e.key === 'Escape') { pick = undefined; umove = undefined; underTmp = undefined; host.style.cursor = ''; draw(); ctx.say('Anulowano'); return; }
    if (pick || umove) return;
    if (shapeDraw) {
      if (e.key === 'Enter') { e.preventDefault(); finishShape(); }
      else if (e.key === 'Escape') { cancelShape(); ctx.say('Anulowano rysowanie obrysu'); }
      else if (e.key === 'Backspace') { e.preventDefault(); shapeDraw.pts.pop(); draw(); }
      return;
    }
    if (e.key === 'Delete' && selRack?.startsWith('sob_') && store.state.stageObjects?.[selRack]) { removeStage(selRack); return; }
    if (drawing) {
      if (e.key === 'Enter') { e.preventDefault(); finishRoute(); }
      else if (e.key === 'Escape') { setDrawing(false); ctx.say('Anulowano trasę'); }
      else if (e.key === 'Backspace') { e.preventDefault(); drawing.pts.pop(); draw(); }
      return;
    }
    if (e.key === 'Delete' && selRoute) {
      const sid = spaceId(), r = sid ? routesOf(store.state, sid)[selRoute] : undefined;
      if (sid && r && selVertex?.route === selRoute && r.points.length > 2 && selVertex.idx < r.points.length) {
        const pts = r.points.filter((_, i) => i !== selVertex!.idx); selVertex = undefined;
        store.dispatch('Usuń punkt trasy', routeCmd.setRoutePoints(sid, selRoute, pts)); ctx.changed(); refresh(); ctx.say('Usunięto punkt trasy (Delete bez zaznaczonego punktu usuwa całą trasę)'); return;
      }
      removeRoute(selRoute); return;
    }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && selRack && placementOf(selRack)) { try { store.dispatch('Obróć rack', plan.rotateRack(selRack, e.shiftKey ? -90 : 90)); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); } return; }
    const sel = ctx.selected();
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && sel && placementOf(sel)) { try { store.dispatch('Obróć', plan.rotate(sel, e.shiftKey ? -90 : 90)); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); } }
  });

  function removeRoute(id: string) {
    const sid = spaceId(); if (!sid) return;
    store.dispatch('Usuń trasę kablową', routeCmd.deleteRoute(sid, id)); selRoute = undefined; ctx.changed(); refresh(); ctx.say('Usunięto trasę (długości kabli policz ponownie)');
  }

  // ---------- okno sali ----------
  const SHAPE_PRESETS: Record<string, [string, number[][]]> = {
    L: ['Litera L', [[0, 0], [12000, 0], [12000, 5000], [5000, 5000], [5000, 10000], [0, 10000]]],
    U: ['Litera U', [[0, 0], [12000, 0], [12000, 9000], [8000, 9000], [8000, 4000], [4000, 4000], [4000, 9000], [0, 9000]]],
    trap: ['Trapez (scena zwężona)', [[0, 0], [16000, 0], [13000, 10000], [3000, 10000]]],
    oct: ['Ośmiokąt', [[3000, 0], [9000, 0], [12000, 3000], [12000, 9000], [9000, 12000], [3000, 12000], [0, 9000], [0, 3000]]],
  };
  const ptsToText = (b: number[][]) => b.map((q) => `${fmtM(q[0])}; ${fmtM(q[1])}`).join('\n');
  /** Wierzchołki z pola tekstowego: jeden na linię „x; y” w metrach (przecinek dziesiętny dozwolony). */
  function parsePts(txt: string): number[][] {
    const out: number[][] = [];
    for (const [i, line] of txt.split(/\r?\n/).entries()) {
      const t = line.trim(); if (!t) continue;
      const parts = t.split(/[;\s]+/).filter(Boolean).map((s) => Number(s.replace(',', '.')) * 1000);
      if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error(`Wiersz ${i + 1}: podaj dwie liczby „x; y” w metrach`);
      out.push([Math.round(parts[0]), Math.round(parts[1])]);
    }
    return out;
  }
  /** Zapis kształtu: istniejąca sala (`sid`) albo nowa. `ref` = początek układu, w którym narysowano punkty (rysowanie na planie); bez niego nowa sala trafia obok istniejących. */
  function saveShape(sid: string | undefined, name: string, pts: number[][], h: number | undefined | null, ref?: [number, number]) {
    if (sid) { store.dispatch('Zmień kształt sali', plan.setSpaceShape(sid, pts, name, h === undefined ? null : h)); ctx.changed(); refresh(); return; }
    const nid = newSpaceId(); store.dispatch('Dodaj salę', plan.addSpaceShape(nid, name, pts, h ?? undefined, ref));
    setActive(nid); fit(); ctx.changed(); refresh();
  }
  function spaceDialog(forceNew = false) {
    const sid = forceNew ? undefined : spaceId(), sp = sid ? store.state.spaces![sid] : undefined, sz = sid ? spaceSize(store.state, sid) : undefined;
    const poly = !!sp && !isRectBoundary(sp.boundary);
    const o = document.createElement('div'); o.id = 'spacedialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:460px"><h2>${sp ? 'Sala' : 'Nowa sala'}</h2>
      <label>Nazwa<input id="s-name" style="display:block;width:100%;margin:4px 0 10px" value="${esc(sp?.name ?? 'Sala główna')}"></label>
      <label>Kształt<select id="s-shape" style="display:block;width:100%;margin:4px 0 10px"><option value="rect"${poly ? '' : ' selected'}>Prostokąt</option><option value="poly"${poly ? ' selected' : ''}>Dowolny kształt (wielokąt)</option></select></label>
      <div id="s-rect" style="display:${poly ? 'none' : 'flex'};gap:8px"><label style="flex:1">Szerokość [m]<input id="s-w" style="display:block;width:100%;margin-top:4px" value="${sz ? fmtM(sz.widthMm) : '20'}"></label>
      <label style="flex:1">Głębokość [m]<input id="s-d" style="display:block;width:100%;margin-top:4px" value="${sz ? fmtM(sz.depthMm) : '12'}"></label></div>
      <div id="s-poly" style="display:${poly ? 'block' : 'none'}"><label>Wierzchołki obrysu (jeden w linii: x; y w metrach, po kolei wokół sali)<textarea id="s-pts" rows="7" style="display:block;width:100%;margin:4px 0 6px;font-family:Consolas,monospace;background:#1E1E1E;color:#fff;border:1px solid #2A2A2A;border-radius:6px;padding:6px;box-sizing:border-box"></textarea></label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${Object.entries(SHAPE_PRESETS).map(([k, [l]]) => `<button type="button" class="s-preset" data-k="${k}">${l}</button>`).join('')}<button type="button" id="s-draw">Rysuj na planie…</button></div>
        <div class="imp" id="s-info"></div></div>
      <label>Wysokość do sufitu / kratownicy [m] (opcjonalnie)<input id="s-h" style="display:block;width:140px;margin:4px 0 10px" value="${sp?.ceilingHeightMm ? fmtM(sp.ceilingHeightMm) : ''}"></label>
      <label>Poziom podłogi względem pierwszej sali [m] (np. FOH na galerii 2,6; poniżej: -1,2)<input id="s-floor" style="display:block;width:140px;margin:4px 0 10px" value="${fmtM(floorLevel(store.state, sid ?? '') || 0)}"></label>
      ${sid ? `<div style="display:flex;gap:8px"><label style="flex:1">Początek sali w budynku X [m]<input id="s-ox" style="display:block;width:100%;margin-top:4px" value="${fmtM(spaceOrigin(store.state, sid)[0])}"></label><label style="flex:1">Y [m]<input id="s-oy" style="display:block;width:100%;margin-top:4px" value="${fmtM(spaceOrigin(store.state, sid)[1])}"></label></div>` : ''}
      <p class="imp">Obrys przesuwany jest tak, by jego lewy dolny róg leżał w punkcie 0,0 sali; podłoga na wysokości 0. Przy zmianie kształtu urządzenia i trasy zostają w tych samych miejscach sali. „Początek sali w budynku” ustawia, gdzie sala leży względem innych sal i podkładu.</p><div class="btns"><button id="s-save" class="primary">Zapisz</button><button id="s-cancel">Anuluj</button>${sid ? '<button id="s-del" class="danger">Usuń salę</button>' : ''}</div></div>`;
    document.body.appendChild(o);
    o.querySelectorAll('input,textarea').forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
    const q = <T extends HTMLElement>(s: string) => o.querySelector(s) as T, v = (s: string) => (o.querySelector(s) as HTMLInputElement).value;
    const shapeSel = q<HTMLSelectElement>('#s-shape'), ta = q<HTMLTextAreaElement>('#s-pts'), info = q<HTMLElement>('#s-info');
    const initPts = sp ? sp.boundary : [[0, 0], [12000, 0], [12000, 5000], [5000, 5000], [5000, 10000], [0, 10000]];
    ta.value = ptsToText(initPts);
    const upd = () => {
      try { const pts = parsePts(ta.value), pr = polygonProblem(pts); info.innerHTML = pr ? `<b class="warn">${esc(pr)}</b>` : `${pts.length} wierzchołków · pole ${Math.round(polygonArea(pts) / 10000) / 100} m²`; }
      catch (err) { info.innerHTML = `<b class="warn">${esc((err as Error).message)}</b>`; }
    };
    const sync = () => { q('#s-rect').style.display = shapeSel.value === 'rect' ? 'flex' : 'none'; q('#s-poly').style.display = shapeSel.value === 'poly' ? 'block' : 'none'; if (shapeSel.value === 'poly') upd(); };
    shapeSel.addEventListener('change', sync); ta.addEventListener('input', upd); sync();
    o.querySelectorAll<HTMLElement>('.s-preset').forEach((bt) => bt.addEventListener('click', () => { ta.value = ptsToText(SHAPE_PRESETS[bt.dataset.k!][1]); upd(); }));
    q('#s-draw').addEventListener('click', () => { const nm = v('#s-name'), h = v('#s-h').trim() ? parseM(v('#s-h')) : null; o.remove(); startShapeDraw(nm, h, !sid); });
    let delArmed = false;
    o.querySelector('#s-del')?.addEventListener('click', (ev) => { const bt = ev.target as HTMLButtonElement; if (!delArmed) { delArmed = true; bt.textContent = 'Na pewno? Usunie zawartość sali'; return; } try { store.dispatch('Usuń salę', plan.removeSpace(sid!)); activeId = undefined; o.remove(); ctx.changed(); refresh(); ctx.say('Usunięto salę wraz z jej zawartością (urządzenia, racki i szafy zostają w projekcie bez położenia)'); } catch (err) { ctx.say(String((err as Error).message)); } });
    q('#s-cancel').addEventListener('click', () => o.remove());
    q('#s-save').addEventListener('click', () => {
      try {
        const h = v('#s-h').trim() ? parseM(v('#s-h')) : undefined;
        if (shapeSel.value === 'poly') saveShape(sid, v('#s-name'), parsePts(ta.value), h);
        else {
          const w = parseM(v('#s-w')), d = parseM(v('#s-d'));
          if (sid) store.dispatch('Edytuj salę', plan.editSpace(sid, v('#s-name'), w, d, h)); else { const nid = newSpaceId(); store.dispatch('Dodaj salę', plan.addSpace(nid, v('#s-name'), w, d, h)); setActive(nid); fit(); }
          ctx.changed(); refresh();
        }
        if (sid && o.querySelector('#s-ox')) { const ox = parseM(v('#s-ox')), oy = parseM(v('#s-oy')), c0 = spaceOrigin(store.state, sid); if (Math.round(ox) !== c0[0] || Math.round(oy) !== c0[1]) { store.dispatch('Położenie sali w budynku', plan.setSpaceOrigin(sid, ox, oy)); ctx.changed(); refresh(); } }
        { const tid = sid ?? spaceId(), fl = Math.round(parseM(v('#s-floor') || '0')); if (tid && fl !== floorLevel(store.state, tid)) { store.dispatch('Poziom podłogi sali', plan.setFloorLevel(tid, fl)); ctx.changed(); refresh(); } }
        o.remove(); ctx.say('Zapisano salę');
      } catch (err) { ctx.say(String((err as Error).message)); }
    });
  }

  // ---------- rysowanie obrysu sali na planie ----------
  function startShapeDraw(name: string, h: number | null, forNew = false) {
    shapeDraw = { pts: [], name: name.trim() || 'Sala', h, forNew }; host.style.cursor = 'crosshair'; selRoute = undefined; selRack = undefined; ctx.select(undefined);
    if (!spaceId() && !underlaysOf(store.state).length) { cam.x = 10000; cam.y = 6000; cam.zoom = 0.05; } // pierwsza sala bez podkładu: widok startowy
    ctx.say('Klikaj kolejne wierzchołki obrysu sali. Klik w pierwszy punkt albo Enter = zamknij, Backspace = cofnij, Shift = oś prostopadła, Esc = anuluj'); draw();
  }
  function shapePoint(sx: number, sy: number, shift: boolean): number[] {
    const [wx, wy] = toWorld(sx, sy); let p = [snap(wx), snap(wy)]; const last = shapeDraw?.pts.at(-1);
    if (shift && last) p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    return p;
  }
  function addShapePoint(sx: number, sy: number, shift: boolean) {
    const sd = shapeDraw; if (!sd) return;
    const first = sd.pts[0];
    if (first && sd.pts.length >= 3) { const [fx, fy] = toScreen(first[0], first[1]); if (Math.hypot(fx - sx, fy - sy) <= 12) { finishShape(); return; } }
    const p = shapePoint(sx, sy, shift), last = sd.pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) sd.pts.push(p);
    draw();
  }
  function finishShape() {
    const sd = shapeDraw; if (!sd) return;
    const pr = polygonProblem(sd.pts); if (pr) { ctx.say(pr); return; }
    try { const act = spaceId(); saveShape(sd.forNew ? undefined : act, sd.name, sd.pts, sd.h, sd.forNew ? (act ? spaceOrigin(store.state, act) : [0, 0]) : undefined); } catch (err) { ctx.say(String((err as Error).message)); return; }
    shapeDraw = undefined; host.style.cursor = ''; if (!sd.forNew) fit(); draw(); ctx.say(`Zapisano kształt sali (${sd.pts.length} wierzchołków)`);
  }
  function cancelShape() { shapeDraw = undefined; host.style.cursor = ''; draw(); }

  // ---------- obiekty sceniczne ----------
  function objectDialog() {
    const sid = spaceId(); if (!sid) { ctx.say('Najpierw dodaj salę'); return; }
    const o = document.createElement('div'); o.id = 'objdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    const P0 = STAGE_PRESETS[0];
    o.innerHTML = `<div class="dlg" style="width:440px"><h2>Obiekt sceniczny / dekoracja</h2>
      <label>Gotowy wzór<select id="o-preset" style="display:block;width:100%;margin:4px 0 10px">${STAGE_PRESETS.map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}<option value="">Własny wymiar</option></select></label>
      <label>Nazwa<input id="o-name" style="display:block;width:100%;margin:4px 0 10px" value="Kostka"></label>
      <div style="display:flex;gap:8px;margin-bottom:10px"><label style="flex:2">Kształt<select id="o-shape" style="display:block;width:100%;margin-top:4px">${Object.entries(STAGE_SHAPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label id="o-stepsbox" style="flex:1;display:none">Stopnie<input id="o-steps" style="display:block;width:100%;margin-top:4px" value="${DEFAULT_STEPS}"></label></div>
      <div style="display:flex;gap:8px"><label style="flex:1">Szerokość [m]<input id="o-w" style="display:block;width:100%;margin-top:4px" value="${fmtM(P0.widthMm)}"></label><label style="flex:1">Głębokość [m]<input id="o-d" style="display:block;width:100%;margin-top:4px" value="${fmtM(P0.depthMm)}"></label><label style="flex:1">Wysokość [m]<input id="o-h" style="display:block;width:100%;margin-top:4px" value="${fmtM(P0.heightMm)}"></label></div>
      <label style="display:block;margin:10px 0">Kolor <input id="o-color" type="color" value="${P0.color}" style="vertical-align:middle;width:56px;height:30px;background:none;border:0"></label>
      <p class="imp" id="o-hint">Obiekt pojawi się na środku widoku. Przeciągnij go na miejsce; wysokość podstawy (Z) ustawisz w panelu, więc można piętrzyć bryły (np. kostka na podeście).</p>
      <div class="btns"><button id="o-add" class="primary">Dodaj</button><button id="o-cancel">Anuluj</button></div></div>`;
    document.body.appendChild(o);
    o.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
    const g = (s: string) => o.querySelector(s) as HTMLInputElement, sel = o.querySelector('#o-preset') as HTMLSelectElement;
    const shapeSel = g('#o-shape') as unknown as HTMLSelectElement, hint = o.querySelector('#o-hint') as HTMLElement;
    const syncShape = () => {
      (o.querySelector('#o-stepsbox') as HTMLElement).style.display = shapeSel.value === 'stairs' ? 'block' : 'none';
      hint.textContent = shapeSel.value === 'stairs' ? 'Schody / widownia: stopnie rosną w głąb obiektu (strzałka na planie pokazuje stronę najwyższą), wysokość to wysokość ostatniego stopnia. Obróć obiekt (R), by widownia patrzyła na scenę.' : shapeSel.value === 'cylinder' ? 'Walec: szerokość i głębokość to średnice (różne dają elipsę).' : 'Obiekt pojawi się na środku widoku. Przeciągnij go na miejsce; wysokość podstawy (Z) ustawisz w panelu, więc można piętrzyć bryły (np. kostka na podeście).';
    };
    shapeSel.addEventListener('change', syncShape);
    sel.addEventListener('change', () => {
      const p = STAGE_PRESETS.find((x) => x.key === sel.value); if (!p) return;
      g('#o-name').value = p.label.replace(/ [Ø\d(].*$/, '').trim(); g('#o-w').value = fmtM(p.widthMm); g('#o-d').value = fmtM(p.depthMm); g('#o-h').value = fmtM(p.heightMm); g('#o-color').value = p.color;
      shapeSel.value = p.shape ?? 'box'; g('#o-steps').value = String(p.steps ?? DEFAULT_STEPS); syncShape();
    });
    g('#o-cancel').addEventListener('click', () => o.remove());
    g('#o-add').addEventListener('click', () => {
      const id = newId('sob'), c = (document.getElementById('b-obj') as any)._c ?? { x: snap(cam.x), y: snap(cam.y) };
      try {
        store.dispatch('Dodaj obiekt sceniczny', stageCmd.addObject(id, { name: g('#o-name').value, widthMm: parseM(g('#o-w').value), depthMm: parseM(g('#o-d').value), heightMm: parseM(g('#o-h').value), color: g('#o-color').value, shape: shapeSel.value as StageShape, steps: Number(g('#o-steps').value) }));
        store.dispatch('Postaw obiekt na planie', plan.placeRack(id, sid, c.x, c.y));
      } catch (err) { ctx.say(String((err as Error).message)); if (store.state.stageObjects?.[id]) store.undo(); return; }
      o.remove(); selRack = id; selRoute = undefined; ctx.select(undefined); ctx.changed(); refresh(); ctx.say('Dodano obiekt. Przeciągnij go na miejsce, R obraca, Delete usuwa');
    });
  }
  const lockRow = (id: string) => `<label class="lockrow" style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="pl-lock"${placementOf(id)?.locked ? ' checked' : ''} style="width:18px;height:18px"> Zablokuj położenie (nie da się przesunąć)</label>`;
  function bindLock(el: HTMLElement, id: string) {
    (el.querySelector('#pl-lock') as HTMLInputElement | null)?.addEventListener('change', (ev) => { store.dispatch((ev.target as HTMLInputElement).checked ? 'Zablokuj obiekt' : 'Odblokuj obiekt', plan.setLocked([id], (ev.target as HTMLInputElement).checked)); ctx.changed(); refresh(); ctx.say((ev.target as HTMLInputElement).checked ? 'Obiekt zablokowany' : 'Obiekt odblokowany'); });
  }
  function removeStage(id: string) { try { store.dispatch('Usuń obiekt sceniczny', stageCmd.removeObject(id)); } catch (err) { ctx.say(String((err as Error).message)); return; } if (selRack === id) selRack = undefined; ctx.changed(); refresh(); ctx.say('Usunięto obiekt'); }

  // ---------- pasek planu i panel urządzenia ----------
  const bar = document.getElementById('planbar')!;
  const missing = () => Object.keys(store.state.equipment).filter((id) => !placementOf(id) && !effectivePosition(store.state, id)).length;
  const unplacedBig = () => [...Object.keys(store.state.racks ?? {}), ...Object.entries(store.state.cabinets ?? {}).filter(([, c]: [string, any]) => !c.mount).map(([k]) => k)].filter((k) => !placementOf(k));
  function updateBar() {
    const rp = document.getElementById('b-rackput') as HTMLButtonElement, ur = unplacedBig().length;
    const rooms = Object.entries<any>(store.state.spaces ?? {}), act = spaceId();
    roomSel.style.display = rooms.length > 1 ? 'inline-block' : 'none'; roomSel.innerHTML = rooms.map(([id, s]) => `<option value="${id}"${id === act ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    { const lb = document.getElementById('b-lock') as HTMLButtonElement, so = Object.values<any>(store.state.placements ?? {}).filter((x) => x.targetKind === 'stageObject' && x.spaceId === act); lb.textContent = so.length && so.every((x) => x.locked) ? 'Odblokuj' : 'Zablokuj'; lb.disabled = !so.length; }
    unplUi.refresh();
    rp.textContent = ur ? `Postaw rack/szafę (${ur})` : 'Postaw rack/szafę'; rp.disabled = !ur || !spaceId();
    const m = missing(), b = document.getElementById('b-placeall') as HTMLButtonElement;
    b.textContent = m ? `Rozmieść brakujące (${m})` : 'Rozmieść brakujące'; b.disabled = !m || !spaceId();
  }
  document.getElementById('b-space')!.onclick = () => spaceDialog();
  document.getElementById('b-under')!.onclick = () => underUi.open();
  document.getElementById('b-pass')!.onclick = () => passUi.open();
  // lista „Do rozmieszczenia”: przeciąganie urządzeń, racków i szaf na wybraną salę
  const unplUi = createUnplacedUi({
    items: (): UnplacedItem[] => {
      const out: UnplacedItem[] = [];
      for (const [id, i] of Object.entries<any>(store.state.equipment)) {
        if (placementOf(id) || effectivePosition(store.state, id)) continue;
        const r: any = store.state.definitions[i.definitionId]?.revisions[String(i.definitionRevision)];
        out.push({ id, name: i.name, sub: r ? [r.manufacturer, r.model].filter(Boolean).join(' ') : '', kind: 'device' });
      }
      for (const k of unplacedBig()) { const c: any = store.state.racks?.[k] ?? store.state.cabinets?.[k]; out.push({ id: k, name: c.name, sub: k.startsWith('cab_') ? 'szafa' : `rack ${c.units} U`, kind: k.startsWith('cab_') ? 'cabinet' : 'rack' }); }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));
    },
    roomName: () => { const s = spaceId(); return s ? (store.state.spaces![s] as any).name : undefined; },
    isOverPlan: (x, y) => { const e = document.elementFromPoint(x, y); return !!e && host.contains(e); },
    drop: (id, cx, cy) => {
      const sid = spaceId(); if (!sid) return false;
      const r = host.getBoundingClientRect(), [wx, wy] = toWorld(cx - r.left, cy - r.top), x = snap(wx), y = snap(wy);
      try {
        if (isRack(id)) { store.dispatch(id.startsWith('cab_') ? 'Postaw szafę na planie' : 'Postaw rack na planie', plan.placeRack(id, sid, x, y)); selRack = id; ctx.select(undefined); }
        else { store.dispatch('Postaw urządzenie na planie', plan.place(id, sid, x, y)); selRack = undefined; ctx.select(id); }
        ctx.changed(); refresh(); ctx.say(`„${nameOf(id)}” stoi w sali „${(store.state.spaces![sid] as any).name}”`); return true;
      } catch (err) { ctx.say(String((err as Error).message)); return false; }
    },
    batch: (ids) => {
      const sid = spaceId(); if (!sid || !ids.length) return;
      try {
        const devs = ids.filter((i) => !!store.state.equipment[i]), bigs = ids.filter((i) => isRack(i)), c = toWorld(W / 2, H / 2);
        if (devs.length) store.dispatch('Rozmieść wybrane urządzenia', plan.placeMissing(sid, devs));
        bigs.forEach((b, n) => store.dispatch(b.startsWith('cab_') ? 'Postaw szafę na planie' : 'Postaw rack na planie', plan.placeRack(b, sid, snap(c[0] + n * 1000), snap(c[1]))));
        ctx.changed(); refresh(); ctx.say(`Rozmieszczono ${ids.length} w sali „${(store.state.spaces![sid] as any).name}”`);
      } catch (err) { ctx.say(String((err as Error).message)); }
    },
  });
  document.getElementById('b-pick')!.onclick = () => unplUi.toggle();
  document.getElementById('b-lock')!.onclick = () => {
    const sid = spaceId(); if (!sid) return;
    const ids = Object.values<any>(store.state.placements ?? {}).filter((x) => x.targetKind === 'stageObject' && x.spaceId === sid);
    if (!ids.length) { ctx.say('W tej sali nie ma brył scenicznych'); return; }
    const lock = !ids.every((x) => x.locked);
    store.dispatch(lock ? 'Zablokuj sceny' : 'Odblokuj sceny', plan.setLocked(ids.map((x) => x.targetId), lock)); ctx.changed(); refresh(); ctx.say(lock ? `Zablokowano ${ids.length} brył scenicznych` : `Odblokowano ${ids.length} brył scenicznych`);
  };
  document.getElementById('b-addroom')!.onclick = () => spaceDialog(true);
  const roomSel = document.getElementById('b-room') as HTMLSelectElement;
  roomSel.onchange = () => setActive(roomSel.value);
  document.getElementById('b-rackput')!.onclick = () => {
    const sid = spaceId(), rid = unplacedBig()[0]; if (!sid || !rid) return;
    const c = (document.getElementById('b-rackput') as any)._c ?? { x: snap(cam.x), y: snap(cam.y) };
    store.dispatch(rid.startsWith('cab_') ? 'Postaw szafę na planie' : 'Postaw rack na planie', plan.placeRack(rid, sid, c.x, c.y)); selRack = rid; ctx.select(undefined); ctx.changed(); refresh(); ctx.say(`${rid.startsWith('cab_') ? 'Szafa' : 'Rack'} „${nameOf(rid)}” stoi na planie. Urządzenia w niej liczą się w jej miejscu (długości kabli policz ponownie)`);
  };
  document.getElementById('b-riser')!.onclick = addRiser;
  document.getElementById('b-onsolid')!.onclick = (e) => { onSolid = !onSolid; (e.target as HTMLElement).classList.toggle('on', onSolid); ctx.say(onSolid ? 'Trasa po bryle: punkty układają się na górnej powierzchni brył (stopnie, podesty, kostki). Wysokość w polu to najniższa wysokość trasy.' : 'Trasa po bryle wyłączona'); };
  document.getElementById('b-obj')!.onclick = objectDialog;
  document.getElementById('b-route')!.onclick = () => { if (drawing) finishRoute(); else if (spaceId()) setDrawing(true); else ctx.say('Najpierw dodaj salę'); };
  document.getElementById('b-lengths')!.onclick = () => {
    const o = document.createElement('div'); o.id = 'lendialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    const slack0 = store.state.settings.defaultCableSlackMm ?? DEFAULT_SLACK_MM;
    o.innerHTML = `<div class="dlg" style="width:480px"><h2>Długości kabli z planu</h2>
      <p class="imp">Odległość prostopadła między środkami urządzeń na planie plus zapas, zaokrąglona w górę do 0,1 m. To oszacowanie orientacyjne: bez wysokości, tras kablowych i konkretnych gniazd. Długości wpisane ręcznie zostają bez zmian.</p>
      <label>Zapas na kabel [m]<input id="l-slack" style="display:block;width:140px;margin:4px 0 10px" value="${fmtM(slack0)}"></label>
      <div class="imp" id="l-sum"></div><div class="btns"><button id="l-go" class="primary">Policz i zapisz</button><button id="l-cancel">Anuluj</button></div></div>`;
    document.body.appendChild(o);
    const inp = o.querySelector('#l-slack') as HTMLInputElement; inp.addEventListener('keydown', (ev) => ev.stopPropagation());
    const sum = () => {
      const r = estimateLengths(store.state, parseM(inp.value) || 0);
      (o.querySelector('#l-sum') as HTMLElement).innerHTML = `Zostanie policzonych: <b>${r.estimates.length}</b> kabli` +
        `${r.noPlacement ? ` · <b class="warn">${r.noPlacement} bez obu urządzeń na planie</b>` : ''}${r.skippedManual ? ` · ${r.skippedManual} z długością ręczną (pominięte)` : ''}${r.viaPassage ? ` · ${r.viaPassage} między salami (przez przejście)` : ''}${r.otherSpace ? ` · <b class="warn">${r.otherSpace} między salami bez przejścia (pominięte; dodaj je w „Przejścia…”)</b>` : ''}`;
    };
    inp.addEventListener('input', sum); sum();
    o.querySelector('#l-cancel')!.addEventListener('click', () => o.remove());
    o.querySelector('#l-go')!.addEventListener('click', () => {
      try {
        const n = estimateLengths(store.state, parseM(inp.value)).estimates.length;
        store.dispatch('Długości kabli z planu', applyEstimates(parseM(inp.value))); o.remove(); ctx.changed(); refresh(); ctx.say(`Policzono długości: ${n} kabli`);
      } catch (err) { ctx.say(String((err as Error).message)); }
    });
  };
  const loadFonts = async () => { const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer()); return { latin: await get(latinUrl), latinExt: await get(latinExtUrl) }; };
  const buildPdf = async (paper: string, scale: number | undefined, cables: boolean, color = settings.exportColor) =>
    planPdf(store.state, { spaceId: spaceId(), paper, scale, cables, color, fonts: await loadFonts(), projectName: store.state.name ?? 'Projekt', date: new Date().toISOString().slice(0, 10) });
  document.getElementById('b-pdf')!.onclick = () => {
    const sid = spaceId(), sz = sid ? spaceSz(store.state, sid) : undefined;
    if (!sid || !sz) { ctx.say('Najpierw dodaj salę'); return; }
    const o = document.createElement('div'); o.id = 'pdfdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:460px"><h2>Eksport planu do PDF</h2>
      <div style="display:flex;gap:8px"><label style="flex:1">Papier (poziomo)<select id="x-paper" style="display:block;width:100%;margin-top:4px">${Object.keys(PAPERS).map((k) => `<option${k === 'A3' ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      <label style="flex:1">Skala<select id="x-scale" style="display:block;width:100%;margin-top:4px"></select></label></div>
      <label class="chk"><input type="checkbox" id="x-cables" checked> Rysuj kable (po trasach)</label>
      <label class="chk"><input type="checkbox" id="x-color"${settings.exportColor ? ' checked' : ''}> Kolorowy eksport (domyślnie wg ustawień)</label>
      <p class="imp" id="x-info"></p><div class="btns"><button id="x-go" class="primary">Zapisz PDF…</button><button id="x-cancel">Anuluj</button></div></div>`;
    document.body.appendChild(o);
    const paper = o.querySelector('#x-paper') as HTMLSelectElement, scaleSel = o.querySelector('#x-scale') as HTMLSelectElement, info = o.querySelector('#x-info') as HTMLElement;
    const fill = () => { scaleSel.innerHTML = `<option value="">Auto (1:${autoScale(sz.widthMm, sz.depthMm, paper.value)})</option>` + SCALES.map((s) => `<option value="${s}">1:${s}</option>`).join(''); upd(); };
    const upd = () => { const sc = Number(scaleSel.value) || autoScale(sz.widthMm, sz.depthMm, paper.value), [pw, ph] = PAPERS[paper.value]; const ok = sz.widthMm / sc <= pw - 20 && sz.depthMm / sc <= ph - 44; info.innerHTML = ok ? `Sala w skali: ${Math.round(sz.widthMm / sc)} × ${Math.round(sz.depthMm / sc)} mm.` : '<b class="warn">Sala nie mieści się na papierze w tej skali (zostanie obcięta).</b>'; };
    paper.addEventListener('change', fill); scaleSel.addEventListener('change', upd); fill();
    o.querySelector('#x-cancel')!.addEventListener('click', () => o.remove());
    o.querySelector('#x-go')!.addEventListener('click', async () => {
      try {
        const r = await buildPdf(paper.value, Number(scaleSel.value) || undefined, (o.querySelector('#x-cables') as HTMLInputElement).checked, (o.querySelector('#x-color') as HTMLInputElement).checked);
        const target = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: exportName(store.state.name, 'plan', (spaceId() && (store.state as any).spaces?.[spaceId()!]?.name) || undefined, 'pdf') });
        if (!target) return;
        await invoke('save_autosave', { path: /\.pdf$/i.test(target) ? target : target + '.pdf', data: Array.from(r.bytes) });
        o.remove(); ctx.say(`Zapisano PDF (skala 1:${r.scale}${r.hiddenLabels ? `, ${r.hiddenLabels} numerów bez nazwy – patrz spis na kolejnych stronach` : ''})`);
      } catch (err) { ctx.say('Błąd eksportu PDF: ' + String(err)); }
    });
  };
  document.getElementById('b-fit')!.onclick = () => { fit(); draw(); };
  document.getElementById('b-fitall')!.onclick = () => { fitAll(); draw(); };
  document.getElementById('b-cables')!.onclick = (e) => { showCables = !showCables; (e.target as HTMLElement).classList.toggle('on', showCables); refresh(); };
  document.getElementById('b-placeall')!.onclick = () => {
    const sid = spaceId(); if (!sid) return;
    const n = store.dispatch('Rozmieść urządzenia', plan.placeMissing(sid)); ctx.changed(); refresh(); ctx.say(n ? 'Rozmieszczono brakujące urządzenia' : 'Wszystko jest już na planie');
  };

  return {
    resize(w: number, h: number) { W = w; H = h; backend.resize(w, h); ov.width = w; ov.height = h; if (active) draw(); },
    get active() { return active; },
    spaceId,
    /** Środek widoku, przyciągnięty do siatki: tu trafiają nowo dodane urządzenia. */
    center: () => ({ x: snap(cam.x), y: snap(cam.y) }),
    show() { active = true; host.style.display = 'block'; bar.style.display = 'flex'; document.body.classList.add('plan-on'); if (spaceId() && cam.zoom === 0.05) fit(); rebuild(); draw(); updateBar(); },
    suspend(on: boolean) { suspended = on; },
    hide() { unplUi.close(); if (drawing) setDrawing(false); if (shapeDraw) cancelShape(); selRoute = undefined; selRack = undefined; active = false; host.style.display = 'none'; bar.style.display = 'none'; document.body.classList.remove('plan-on'); },
    refresh,
    redraw: () => { if (active) draw(); },
    /** Panel zaznaczonego obiektu scenicznego (bryły); wywoływany z renderRackProps. */
    renderStageProps(el: HTMLElement, id: string): boolean {
      const so = store.state.stageObjects?.[id] as any, pl = placementOf(id);
      if (!so || !pl) return false;
      const f = so.footprint;
      el.style.display = 'block';
      el.innerHTML = `<h3>Obiekt sceniczny</h3><label>Nazwa<input id="so-name" value="${esc(so.name)}"></label>
        <div style="display:flex;gap:6px"><label style="flex:1">Szer. [m]<input id="so-w" value="${fmtM(f.widthMm)}"></label><label style="flex:1">Głęb. [m]<input id="so-d" value="${fmtM(f.depthMm)}"></label><label style="flex:1">Wys. [m]<input id="so-h" value="${fmtM(f.heightMm)}"></label></div>
        <div style="display:flex;gap:6px"><label style="flex:2">Kształt<select id="so-shape" style="display:block;width:100%;margin-top:4px;min-height:36px;background:#1E1E1E;color:#fff;border:1px solid #2A2A2A;border-radius:6px">${Object.entries(STAGE_SHAPES).map(([k, l]) => `<option value="${k}"${(so.shape ?? 'box') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>${so.shape === 'stairs' ? `<label style="flex:1">Stopnie<input id="so-steps" value="${so.steps ?? DEFAULT_STEPS}" title="${MIN_STEPS}–${MAX_STEPS}"></label>` : ''}</div>
        ${so.shape === 'stairs' ? `<div class="meta">stopień: ${fmtM(f.heightMm / (so.steps ?? DEFAULT_STEPS))} m wys. × ${fmtM(f.depthMm / (so.steps ?? DEFAULT_STEPS))} m głęb. · strzałka pokazuje stronę najwyższą</div>` : ''}
        <label>Kolor <input id="so-color" type="color" value="${so.color ?? '#555566'}" style="vertical-align:middle;width:56px;height:28px;background:none;border:0"></label>
        <div style="display:flex;gap:6px"><label style="flex:1">X [m]<input id="rp-x" value="${fmtM(pl.position.x)}"></label><label style="flex:1">Y [m]<input id="rp-y" value="${fmtM(pl.position.y)}"></label><label style="flex:1">Z [m]<input id="rp-z" value="${fmtM(pl.position.z ?? 0)}" title="wysokość podstawy nad podłogą (np. kostka na podeście)"></label></div>
        <div class="meta">obrót ${pl.rotationDeg ?? 0}° · bryła widoczna na planie i w widoku 3D</div>
        ${lockRow(id)}<button id="so-rot">Obróć 90° (R)</button><button id="so-dup">Powiel (obok)</button><button id="so-del" class="danger">Usuń obiekt</button>`;
      const run = (label: string, m: ReturnType<typeof plan.place>) => { try { store.dispatch(label, m); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); } };
      const q = (s: string) => el.querySelector(s) as HTMLInputElement;
      for (const i of el.querySelectorAll('input')) i.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (ev.target as HTMLElement).blur(); });
      q('#so-name').addEventListener('change', () => run('Nazwa obiektu', stageCmd.updateObject(id, { name: q('#so-name').value })));
      const dimsChange = () => run('Wymiary obiektu', stageCmd.updateObject(id, { widthMm: parseM(q('#so-w').value), depthMm: parseM(q('#so-d').value), heightMm: parseM(q('#so-h').value) }));
      for (const s of ['#so-w', '#so-d', '#so-h']) q(s).addEventListener('change', dimsChange);
      q('#so-shape').addEventListener('change', () => run('Kształt obiektu', stageCmd.updateObject(id, { shape: (q('#so-shape') as unknown as HTMLSelectElement).value as StageShape })));
      el.querySelector('#so-steps')?.addEventListener('change', () => run('Liczba stopni', stageCmd.updateObject(id, { steps: Number(q('#so-steps').value) })));
      q('#so-color').addEventListener('change', () => run('Kolor obiektu', stageCmd.updateObject(id, { color: q('#so-color').value })));
      const pos = () => {
        const x = parseM(q('#rp-x').value), y = parseM(q('#rp-y').value), z = parseM(q('#rp-z').value);
        if (![x, y, z].every(Number.isFinite)) { ctx.say('Podaj liczby w metrach'); return; }
        if (Math.round(x) !== pl.position.x || Math.round(y) !== pl.position.y || Math.round(z) !== (pl.position.z ?? 0)) run('Ustaw pozycję obiektu', plan.placeRack(id, pl.spaceId, x, y, undefined, z));
      };
      for (const s of ['#rp-x', '#rp-y', '#rp-z']) q(s).addEventListener('change', pos);
      bindLock(el, id);
      el.querySelector('#so-rot')!.addEventListener('click', () => run('Obróć obiekt', plan.rotateRack(id, 90)));
      el.querySelector('#so-dup')!.addEventListener('click', () => { const nid = newId('sob'); run('Powiel obiekt', stageCmd.duplicateObject(id, nid, Math.max(f.widthMm, 500) + 200, 0)); selRack = nid; refresh(); ctx.changed(); });
      el.querySelector('#so-del')!.addEventListener('click', () => removeStage(id));
      return true;
    },
    /** Panel zaznaczonego racka na planie (zamiast panelu urządzenia); false, gdy nie zaznaczono. */
    renderRackProps(el: HTMLElement): boolean {
      if (active && selRack?.startsWith('sob_')) return this.renderStageProps(el, selRack);
      const id = selRack, rk = id ? ((store.state.racks?.[id] ?? store.state.cabinets?.[id]) as any) : undefined, pl = id ? placementOf(id) : undefined;
      if (!active || !id || !rk || !pl) return false;
      const f = rackFootprint(store.state, id);
      el.style.display = 'block';
      el.innerHTML = `<h3>${id.startsWith('cab_') ? 'Szafa' : 'Rack'}: ${esc(rk.name)}</h3><div class="meta">${id.startsWith('cab_') ? `${rk.rows} szyn × ${rk.modules} mod.` : `${rk.units} U`} · ${fmtM(f.w)} × ${fmtM(f.d)} m · obrót ${pl.rotationDeg ?? 0}°</div>
        <div style="display:flex;gap:6px"><label style="flex:1">X [m]<input id="rp-x" value="${fmtM(pl.position.x)}"></label><label style="flex:1">Y [m]<input id="rp-y" value="${fmtM(pl.position.y)}"></label><label style="flex:1">Z [m]<input id="rp-z" value="${fmtM(pl.position.z ?? 0)}" title="wysokość podstawy nad podłogą"></label></div>
        <div class="meta">${id.startsWith('cab_') ? 'Osprzęt na szynach liczy się w miejscu szafy, na wysokości swojej szyny.' : 'Urządzenia zamontowane w racku liczą się w jego miejscu, na wysokości swojej pozycji U.'}</div>
        ${lockRow(id)}<button id="rp-rot">Obróć 90° (R)</button><button id="rp-off">Zdejmij z planu</button>`;
      const run = (label: string, m: ReturnType<typeof plan.place>) => { try { store.dispatch(label, m); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); } };
      bindLock(el, id);
      el.querySelector('#rp-rot')!.addEventListener('click', () => run('Obróć rack', plan.rotateRack(id, 90)));
      el.querySelector('#rp-off')!.addEventListener('click', () => { run('Zdejmij rack z planu', plan.unplaceRack(id)); selRack = undefined; ctx.changed(); });
      const ix = el.querySelector('#rp-x') as HTMLInputElement, iy = el.querySelector('#rp-y') as HTMLInputElement, iz = el.querySelector('#rp-z') as HTMLInputElement;
      const pos = () => {
        const x = parseM(ix.value), y = parseM(iy.value), z = parseM(iz.value);
        if (![x, y, z].every(Number.isFinite)) { ctx.say('Podaj liczby w metrach'); return; }
        if (Math.round(x) !== pl.position.x || Math.round(y) !== pl.position.y || Math.round(z) !== (pl.position.z ?? 0)) run('Ustaw pozycję racka', plan.placeRack(id, pl.spaceId, x, y, undefined, z));
      };
      for (const i of [ix, iy, iz]) {
        i.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') pos(); });
        i.addEventListener('focusout', (ev) => { const to = (ev as FocusEvent).relatedTarget; if (to !== ix && to !== iy && to !== iz) pos(); });
      }
      return true;
    },
    selectedRack: () => selRack,
    setActive,
    roomAt,
    fitAll,
    pickState: () => pick,
    routeDrawing: () => drawing,
    setOnSolid(on: boolean) { onSolid = on; document.getElementById('b-onsolid')!.classList.toggle('on', on); },
    shapeDrawing: () => shapeDraw,
    startShapeDraw,
    finishShape,
    /** Panel zaznaczonej trasy kablowej (zamiast panelu urządzenia); false, gdy nic nie zaznaczono. */
    renderRouteProps(el: HTMLElement): boolean {
      const sid = spaceId(), r = sid && selRoute ? routesOf(store.state, sid)[selRoute] : undefined;
      if (!active || !sid || !selRoute || !r) return false;
      const id = selRoute;
      el.style.display = 'block';
      el.innerHTML = `<h3>Trasa kablowa</h3><label>Nazwa<input id="rt-name" value="${esc(r.name)}"></label>
        <div class="meta">${fmtM(routeLength(r))} m · ${r.points.length} punktów</div>
        <label>Wysokość trasy nad podłogą [m]<input id="rt-z" value="${fmtM(routeHeight(r).max)}"></label>
        ${routeHeight(r).min !== routeHeight(r).max ? `<div class="meta warn">Punkty na różnych wysokościach (${fmtM(routeHeight(r).min)}–${fmtM(routeHeight(r).max)} m); zapis ustawi wszystkie na tę samą.</div>` : ''}
        <div class="meta">Przeciągnij kwadrat, by przesunąć punkt; kliknij kółko na środku odcinka, by dodać punkt; zaznaczony punkt usuwa Delete.</div>
        <div class="meta">Po zmianie tras policz długości kabli ponownie („Długości kabli…”).</div>
        <button id="rt-del" class="danger">Usuń trasę</button>`;
      const nm = el.querySelector('#rt-name') as HTMLInputElement;
      nm.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') nm.blur(); });
      nm.addEventListener('change', () => { try { store.dispatch('Nazwa trasy', routeCmd.renameRoute(sid, id, nm.value)); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); nm.value = r.name; } });
      const zi = el.querySelector('#rt-z') as HTMLInputElement;
      zi.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') zi.blur(); });
      zi.addEventListener('change', () => { const z = parseM(zi.value); try { store.dispatch('Wysokość trasy', routeCmd.setRouteHeight(sid, id, z)); routeZ = Math.round(z); ctx.changed(); refresh(); ctx.say('Ustawiono wysokość trasy (długości kabli policz ponownie)'); } catch (err) { ctx.say(String((err as Error).message)); } });
      el.querySelector('#rt-del')!.addEventListener('click', () => removeRoute(id));
      return true;
    },
    /** Fragment panelu właściwości urządzenia dotyczący planu. */
    propsHtml(id: string): string {
      const pl = placementOf(id);
      if (!spaceId()) return '<h3>Plan</h3><div class="meta">Najpierw dodaj salę.</div>';
      if (!pl) return '<h3>Plan</h3><div class="meta">Poza planem</div><button id="pl-put">Umieść na planie</button>';
      const { w, d } = dims(id);
      return `<h3>Plan</h3><div class="meta">${fmtM(w)} × ${fmtM(d)} m · obrót ${pl.rotationDeg ?? 0}°</div>
        <div style="display:flex;gap:6px"><label style="flex:1">X [m]<input id="pl-x" value="${fmtM(pl.position.x)}"></label><label style="flex:1">Y [m]<input id="pl-y" value="${fmtM(pl.position.y)}"></label><label style="flex:1">Z [m]<input id="pl-z" value="${fmtM(pl.position.z ?? 0)}" title="wysokość podstawy nad podłogą"></label></div>
        ${lockRow(id)}<button id="pl-rot">Obróć 90° (R)</button><button id="pl-off">Zdejmij z planu</button>`;
    },
    bindProps(el: HTMLElement, id: string) {
      const run = (label: string, m: ReturnType<typeof plan.place>) => { try { store.dispatch(label, m); ctx.changed(); refresh(); } catch (err) { ctx.say(String((err as Error).message)); } };
      bindLock(el, id);
      el.querySelector('#pl-put')?.addEventListener('click', () => { const c = this.center(); run('Umieść na planie', plan.place(id, spaceId()!, c.x, c.y)); });
      el.querySelector('#pl-rot')?.addEventListener('click', () => run('Obróć', plan.rotate(id, 90)));
      el.querySelector('#pl-off')?.addEventListener('click', () => run('Zdejmij z planu', plan.unplace(id)));
      // X i Y zatwierdzane razem: dopiero gdy fokus opuszcza obie pozycje (Tab z X do Y nie przebudowuje panelu) lub po Enter
      const ix = el.querySelector('#pl-x') as HTMLInputElement | null, iy = el.querySelector('#pl-y') as HTMLInputElement | null, iz = el.querySelector('#pl-z') as HTMLInputElement | null;
      const pos = () => {
        const pl = placementOf(id); if (!pl || !ix || !iy || !iz) return;
        const x = parseM(ix.value), y = parseM(iy.value), z = parseM(iz.value);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ctx.say('Podaj liczby w metrach'); return; }
        if (Math.round(x) !== pl.position.x || Math.round(y) !== pl.position.y || Math.round(z) !== (pl.position.z ?? 0)) run('Ustaw pozycję', plan.place(id, pl.spaceId, x, y, undefined, z));
      };
      for (const i of [ix, iy, iz]) {
        i?.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') pos(); });
        i?.addEventListener('focusout', (ev) => { const to = (ev as FocusEvent).relatedTarget; if (to !== ix && to !== iy && to !== iz) pos(); });
      }
    },
    /** Dostęp do testów. */
    toScreen, fit,
    selectedRoute: () => selRoute,
    selectedVertex: () => selVertex,
    handleScreen: (kind: 'v' | 'm', i: number): [number, number] | undefined => { const sid = spaceId(), r = sid && selRoute ? routesOf(store.state, sid)[selRoute] : undefined; if (!r) return undefined; return kind === 'v' ? toScreen(r.points[i][0], r.points[i][1]) : toScreen((r.points[i - 1][0] + r.points[i][0]) / 2, (r.points[i - 1][1] + r.points[i][1]) / 2); },
    buildPdf,
    debug: () => ({ cam: { ...cam }, space: spaceId() }),
    setZoom(z: number) { cam.zoom = z; draw(); },
    look(x: number, y: number, z: number) { cam.x = x; cam.y = y; cam.zoom = z; draw(); },
    hitAt: hit,
  };
}
