// Prototyp edytora diagramu: gest „port → port” (ryzyko R2, IMPLEMENTATION-PLAN). Wyłącznie do pomiaru kosztu interakcji.
import { openAbout } from './about.ts';
import { createLibBrowser } from './libBrowser.ts';
import { settings, openSettings } from './settings.ts';
import { openUpgradeDialog } from './upgradeUi.ts';
import { openDeviceBuilder } from './deviceBuilder.ts';
import { openElectricalBuilder } from './electricalBuilder.tsx';
import { UPGRADES, pendingUpgrades } from '../src/migrations.ts';
import { setHideMountedDin } from '../src/cabinets.ts';
import { exportName } from './exportName.ts';
import { syntheticProject } from '../src/synthetic.ts';
import { routeOrthogonal, diagramDrawList, gridLayout, portsOf, portAnchor, nodeSize, innerRef, outerRef, hiddenOnDiagram, HEADER, PORT_H, NODE_W, C, signalColor, signalLegend, type DiagramView, type DrawList } from '../src/render/drawlist.ts';
import { Store } from '../src/store.ts';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Autosaver, checkRecovery, type AutosaveIO, type Kind } from '../src/autosave.ts';
import { packProject, openProject } from '../src/format.ts';
import type { Project } from '../src/types.ts';
import { cmd } from '../src/commands.ts';
import { newId } from '../src/ids.ts';
import { searchCatalog, addFromCatalog, uniqueName, starterRegistries, ensureRegistries, catalogEntries, STARTER_ID } from '../src/catalog/index.ts';
import { saveDefinition, forkDefinition, draftRevision, impactOf, portDrafts, newPortId, renameInstance, type PortDraft, type DefinitionMeta } from '../src/definitions.ts';
import { patchList, toCsv } from '../src/reports.ts';
import { cableListPdf } from '../src/reportPdf.ts';
import { diagramPdf } from '../src/diagramPdf.ts';
import latinFontUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import latinExtFontUrl from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url';
import { setNodePositions, syncLayout } from '../src/layout.ts';
import { groupFrames, autoLayout } from '../src/groups.ts';
import { createGroupUi } from './groupUi.ts';
import { createPlan } from './plan.ts';
import { createRack } from './rack.ts';
import { createCabinet } from './cabinet.ts';
import { createView3d } from './view3d.ts';
import { cabCmd } from '../src/cabinets.ts';
import { createLibrary } from './library.ts';
import { definitionIdOf, SOURCE_KINDS, sourceTrust, TRUST_LABEL, type SourceKind } from '../src/pack.ts';
import { plan as planCmd } from '../src/plan.ts';
import { validate } from '../src/validation.ts';
import type { Issue } from '../src/types.ts';
import { planConnection, bestPort, usageOf, portKey, type Plan, type Usage } from '../src/editor/connect.ts';
import type { PortRef } from '../src/types.ts';
import { CanvasBackend } from './canvasBackend.ts';
import type { Camera } from './types.ts';

const q = new URLSearchParams(location.search);
const devices = Number(q.get('devices') ?? 200);
let W = window.innerWidth, H = window.innerHeight - 28;
const now = () => performance.now();
const MAGNET_PX = 14;
const magnet = q.get('magnet') !== '0';

// ---------- stan ----------
// ---------- otwarcie projektu, autozapis, okno odzyskiwania (?project=ścieżka, tylko w aplikacji Tauri) ----------
const inTauri = !!(window as any).__TAURI_INTERNALS__;
if (inTauri && !q.has('project') && !q.has('new')) { // start aplikacji: samotest (PoC) albo projekt z wiersza poleceń
  const cfg: any = await invoke('selftest_config');
  if (cfg && Object.keys(cfg).length) { location.replace('selftest.html'); await new Promise(() => {}); }
  const sp: string | null = await invoke('startup_project');
  if (sp) { location.replace(`editor.html?project=${encodeURIComponent(sp)}`); await new Promise(() => {}); }
}
const isNew = q.has('new');
let projectPath: string | null = q.get('project');
const paths: Record<Kind, string> = { main: projectPath ?? '', autosave: (projectPath ?? '') + '.autosave' };
const io: AutosaveIO = {
  read: async (k) => { if (!paths[k]) return undefined; const r: any = await invoke('read_file', { path: paths[k] }); return r ? { bytes: new Uint8Array(r.bytes), mtimeMs: r.mtime_ms } : undefined; },
  write: async (k, b) => { if (!paths[k]) return; await invoke(k === 'main' ? 'save_project' : 'save_autosave', { path: paths[k], data: Array.from(b) }); },
  remove: async (k) => { if (!paths[k]) return; await invoke('remove_file', { path: paths[k] }); },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function portLabelOf(r: PortRef): string { const i = store.state.equipment[r.instanceId]; return store.state.definitions[i.definitionId].revisions[String(i.definitionRevision)].ports[r.portId]?.label ?? r.portId; }

/** Okno modalne: zwraca wybór użytkownika. Przyciski ≥ 44 px (standard rodziny). */
function ask(title: string, text: string, buttons: [string, string][]): Promise<string> {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.id = 'dialog';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    ov.innerHTML = `<div style="background:#1E1E1E;border:1px solid #2A2A2A;border-radius:8px;padding:24px;max-width:480px"><h2 style="margin:0 0 8px;font-size:18px;font-weight:500">${title}</h2><p style="color:#B0B0B0;margin:0 0 20px;line-height:1.5">${text}</p><div style="display:flex;gap:8px;justify-content:flex-end">${buttons.map(([id, l], i) => `<button data-id="${id}" style="min-height:44px;padding:0 16px;border-radius:6px;border:1px solid ${i === 0 ? '#00C853' : '#2A2A2A'};background:${i === 0 ? '#00C853' : '#121212'};color:${i === 0 ? '#000' : '#fff'};font-size:14px;cursor:pointer">${l}</button>`).join('')}</div></div>`;
    ov.addEventListener('click', (e) => { const id = (e.target as HTMLElement).dataset?.id; if (id) { ov.remove(); resolve(id); } });
    document.body.appendChild(ov);
  });
}

/** Pusty projekt: bez urządzeń, definicji i rejestrów (te dochodzą z katalogu przy pierwszym użyciu). */
function emptyProject(): Project { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {}; p.name = 'Nowy projekt'; for (const u of UPGRADES) u.apply(p as any); p.ext = { upgrades: { applied: UPGRADES.map((u) => u.id) } }; return p; }
let restored = false;
/** Informacja po otwarciu pliku: migracja formatu albo plik z nowszą wersją drobną (pokazywana po starcie). */
let openNote = '';
async function loadInitial(): Promise<Project> {
  if (isNew) return emptyProject();
  if (!projectPath || !inTauri) return syntheticProject(devices, Math.round(devices * 2.5), 1, true);
  const rec = await checkRecovery(io);
  const m = await io.read('main'); const mr = m ? openProject(m.bytes) : undefined;
  if (rec.kind === 'offer') {
    const when = new Date(rec.autosaveMtimeMs).toLocaleString('pl-PL');
    const c = await ask('Odzyskać niezapisane zmiany?', `Znaleziono autozapis z ${when}, nowszy niż zapisany projekt${rec.mainMissing ? ' (pliku projektu brak)' : ''}. Poprzednia sesja zakończyła się bez zapisu.`,
      [['restore', 'Przywróć'], ['later', 'Otwórz zapisany, zachowaj autozapis'], ['discard', 'Odrzuć autozapis']]);
    if (c === 'restore') { restored = true; return rec.project; }
    if (c === 'discard') await io.remove('autosave');
  }
  if (mr?.status === 'ok') {
    if (mr.migrations?.length) openNote = `Projekt zaktualizowany z formatu ${mr.migratedFrom}; poprzednia wersja pliku zostaje w kopii zapasowej przy pierwszym zapisie.`;
    else if (mr.newerMinor) openNote = `Plik z nowszej wersji formatu (${mr.newerMinor}): nieznane dane zostaną zachowane przy zapisie.`;
    return mr.project;
  }
  if (m) { // plik istnieje, ale nie da się go otworzyć: nie wolno go potem nadpisać „pustym” projektem
    const why = mr?.status === 'newer-major' ? 'Plik pochodzi z nowszej wersji programu.' : mr?.status === 'error' ? mr.errors.slice(0, 2).join('; ') : 'Nieznany błąd.';
    await ask('Nie można otworzyć pliku', `${why} Plik nie zostanie zmieniony. Otwieram pusty projekt (zapis poprosi o nową nazwę).`, [['ok', 'OK']]);
    projectPath = null; paths.main = ''; paths.autosave = '';
  }
  return emptyProject(); // ścieżka do nieistniejącego pliku = nowy, pusty projekt pod tą nazwą
}
const store = new Store(await loadInitial());
const autosaver = inTauri ? new Autosaver(store, io, undefined, { idleMs: Number(q.get('autosaveIdle') ?? 5000), maxMs: Number(q.get('autosaveMax') ?? 30000) }) : undefined;
if (autosaver && restored) { autosaver.forceDirty(); autosaver.notify(); }
const FILTERS = [{ name: 'Projekt StageWire', extensions: ['sw'] }];
const nameOf = (p: string) => p.split(/[\\/]/).pop()!;
function setTitle() { document.title = `${autosaver?.dirty ? '● ' : ''}${projectPath ? nameOf(projectPath) : 'Nowy projekt'} — StageWire`; }

/** Zapis; bez ścieżki (nowy projekt) lub `as` = okno „Zapisz jako”. Zwraca false, gdy użytkownik anulował lub zapis się nie udał. */
async function saveProject(as = false): Promise<boolean> {
  if (!autosaver) { say('Zapis niedostępny poza aplikacją'); return false; }
  try {
    if (as || !projectPath) {
      let target = await saveDialog({ filters: FILTERS, defaultPath: projectPath ?? 'projekt.sw' });
      if (!target) return false;
      if (!/\.sw$/i.test(target)) target += '.sw';
      const old = paths.autosave;
      projectPath = target; paths.main = target; paths.autosave = target + '.autosave';
      await invoke('remove_file', { path: old }).catch(() => {});
    }
    await io.write('main', packProject(store.state)); await autosaver.markSaved(); revalidate(); say('Zapisano'); setTitle();
    return true;
  } catch (e) { say('Błąd zapisu: ' + String(e)); return false; }
}

/** Gdy są niezapisane zmiany: pyta, co zrobić. Zwraca true, jeśli można iść dalej. */
async function guardUnsaved(): Promise<boolean> {
  if (!autosaver?.dirty) return true;
  const c = await ask('Niezapisane zmiany', 'Projekt ma niezapisane zmiany. Zapisać je przed przejściem dalej?', [['save', 'Zapisz'], ['drop', 'Nie zapisuj'], ['cancel', 'Anuluj']]);
  if (c === 'cancel') return false;
  if (c === 'save') return await saveProject();
  return true;
}
const goto = (qs: string) => { location.search = qs; };
async function newProject() { if (await guardUnsaved()) goto('?new=1'); }
async function openProjectDialog() {
  if (!inTauri) { say('Otwieranie plików działa w aplikacji'); return; }
  if (!(await guardUnsaved())) return;
  const f = await openDialog({ filters: FILTERS, multiple: false });
  if (typeof f === 'string') goto('?project=' + encodeURIComponent(f));
}
const legendEl = document.getElementById('siglegend')!;
let view: DiagramView = gridLayout(store.state);
const backend = new CanvasBackend(document.getElementById('stage')!, W, H);
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
overlay.width = W; overlay.height = H;
const octx = overlay.getContext('2d')!;
const cam: Camera = { x: 160, y: 110, zoom: 1, flipY: false };
let dl: DrawList;
let edgePrim = new Map<string, number[]>();
let edgeObj = new Map<string, any>(); // prymitywy krawędzi (kolorowanie wg walidacji)
let issueList: Issue[] = [];
let selectedEdge: string | undefined;
let selectedNode: string | undefined;
let nodePrims = new Map<string, number[]>(); // prymitywy węzła (ramka, kropki, teksty)
let nodeEdges = new Map<string, number[]>(); // krawędzie dotykające węzła

/** Przeciąganie węzła bez przebudowy całej listy: przesuwa prymitywy węzła i przelicza tylko jego krawędzie (trasa na pasie 0 do puszczenia). */
function moveNodeTo(id: string, nx: number, ny: number) {
  const n = view.nodes[id], dx = nx - n.x, dy = ny - n.y;
  n.x = nx; n.y = ny;
  const idx = backend.index();
  backend.move(nodePrims.get(id) ?? [], dx, dy);
  for (const i of nodeEdges.get(id) ?? []) {
    const p = idx.prims[i]; if (p.t !== 'line') continue;
    const c = store.state.connections[p.id];
    const a = portAnchor(store.state, view, c.from.instanceId, c.from.portId), b = portAnchor(store.state, view, c.to.instanceId, c.to.portId);
    if (a && b) { p.pts = routeOrthogonal(a, b, 0); edgePrim.set(p.id, p.pts); idx.refresh(i); }
  }
}
let issues = 0;

// ---------- metryki ----------
const M: Record<string, number[]> = { gestureStart: [], move: [], commit: [], commitToFrame: [], rebuild: [], validate: [], nodeDragFrame: [], undo: [] };
const log: string[] = [];
const rec = (k: string, v: number) => (M[k] ??= []).push(v);

const toWorld = (sx: number, sy: number): [number, number] => [(sx - W / 2) / cam.zoom + cam.x, (sy - H / 2) / cam.zoom + cam.y];
const toScreen = (wx: number, wy: number): [number, number] => [(wx - cam.x) * cam.zoom + W / 2, (wy - cam.y) * cam.zoom + H / 2];

let dinLabelRef: (() => void) | undefined;
function rebuild() {
  const t = now(); dinLabelRef?.();
  syncLayout(store.state, view, () => gridLayout(store.state));
  { const base = diagramDrawList(store.state, view); dl = { ...base, prims: [...groupFrames(store.state, view), ...base.prims] }; }
  edgePrim = new Map(); edgeObj = new Map();
  nodePrims = new Map(); nodeEdges = new Map();
  dl.prims.forEach((p, i) => {
    if (p.t === 'line') {
      edgePrim.set(p.id, p.pts); edgeObj.set(p.id, p);
      const c = store.state.connections[p.id];
      if (c) for (const iid of new Set([outerRef(store.state, c.from)?.instanceId, outerRef(store.state, c.to)?.instanceId])) if (iid) (nodeEdges.get(iid) ?? nodeEdges.set(iid, []).get(iid)!).push(i);
    } else { const iid = p.id.split('/')[0]; (nodePrims.get(iid) ?? nodePrims.set(iid, []).get(iid)!).push(i); }
  });
  backend.load(dl);
  { const lg = signalLegend(store.state); legendEl.innerHTML = lg.length ? '<b>Kable</b>' + lg.map((x) => `<span><i style="background:${x.color}"></i>${x.label}</span>`).join('') : ''; legendEl.hidden = !lg.length; }
  rec('rebuild', now() - t);
}
function draw() { backend.render(cam); drawOverlay(); planApi?.redraw(); }

const ISSUE_COLOR = { error: '#E53935', warning: '#FFD54F' } as const;
/** Krawędzie z uwagami walidacji (niezgodne złącza/sygnał/kierunek, brak kabla…) są kolorowane: błąd czerwony, ostrzeżenie żółty. */
function recolorEdges() {
  const byCable = new Map<string, string>();
  for (const [cid, c] of Object.entries(store.state.connections)) if (c.cableId) byCable.set(c.cableId, cid);
  const want = new Map<string, string>();
  for (const i of issueList) {
    const cid = store.state.connections[i.subject] ? i.subject : byCable.get(i.subject);
    if (!cid || (i.level !== 'error' && i.level !== 'warning')) continue;
    if (want.get(cid) !== ISSUE_COLOR.error) want.set(cid, ISSUE_COLOR[i.level]);
  }
  // port przeciążony (np. plik z wersji bez blokady): oba kable do tego gniazda na czerwono
  if (issueList.some((i) => i.ruleId === 'V-002')) {
    const load = usageOf(store.state).load;
    for (const [cid, c] of Object.entries(store.state.connections)) for (const r of [c.from, c.to]) {
      const inst = store.state.equipment[r.instanceId], cap = store.state.definitions[inst.definitionId].revisions[String(inst.definitionRevision)].ports[r.portId]?.capacity ?? 1;
      if ((load.get(portKey(r)) ?? 0) > cap) want.set(cid, ISSUE_COLOR.error);
    }
  }
  for (const [cid, prim] of edgeObj) prim.stroke = want.get(cid) ?? signalColor(store.state.connections[cid]?.signalKey);
}

function revalidate() {
  const t = now();
  issueList = validate(store.state); issues = issueList.length;
  recolorEdges();
  rec('validate', now() - t);
  autosaver?.notify(); setTitle(); renderProps(); planApi?.refresh(); rackApi?.refresh(); cabApi?.refresh(); v3Api?.refresh(); refreshCatalog();
  const s = store.state;
  document.getElementById('stat')!.innerHTML =
    `${autosaver?.dirty ? '<b>●</b> niezapisane · ' : ''}<b>${Object.keys(s.equipment).length}</b> urządzeń · <b>${Object.keys(s.connections).length}</b> połączeń · uwagi walidacji: <a href="#" id="issues-link" style="color:${issues ? '#FFD54F' : '#00C853'};font-weight:500">${issues}</a> · cofnij: ${store.undoLabel ?? '—'}`;
}
let planApi: ReturnType<typeof createPlan> | undefined;
let rackApi: ReturnType<typeof createRack> | undefined;
let cabApi: ReturnType<typeof createCabinet> | undefined;
let v3Api: ReturnType<typeof createView3d> | undefined;
const say = (m: string) => { document.getElementById('msg')!.textContent = m; };
let renderCatalog: () => void = () => {};
let refreshCatalog: () => void = () => {};
const library = createLibrary({ inTauri, project: () => store.state, say, ask, changed: () => renderCatalog(), apply: (label, m) => { store.dispatch(label, m); rebuild(); revalidate(); draw(); renderCatalog(); autosaver?.notify(); setTitle(); } });
await library.init();

// ---------- trafienia ----------
type Hit = { k: 'port'; ref: PortRef; x: number; y: number } | { k: 'node'; id: string; header: boolean } | { k: 'edge'; id: string } | { k: 'none' };

function pick(sx: number, sy: number): Hit {
  const [wx, wy] = toWorld(sx, sy);
  const tolW = 6 / cam.zoom; // margines trafienia 6 px ekranu
  const idx = backend.index();
  const cand = idx.query(wx - tolW - NODE_W / 2, wy - tolW - 300, wx + tolW + NODE_W / 2, wy + tolW + 300);
  // węzły: najwyższy (ostatni w kolejności rysowania), którego prostokąt (z marginesem) zawiera punkt
  for (let k = cand.length - 1; k >= 0; k--) {
    const p = idx.prims[cand[k]];
    if (p.t !== 'rect') continue;
    const n = view.nodes[p.id]; if (!n) continue;
    const [w, h] = nodeSize(store.state, p.id);
    if (wx < n.x - tolW || wx > n.x + w + tolW || wy < n.y - tolW || wy > n.y + h + tolW) continue;
    if (wy >= n.y + HEADER) {
      const row = Math.floor((wy - n.y - HEADER) / PORT_H);
      const { left, right } = portsOf(store.state, p.id);
      const leftSide = wx < n.x + w / 2;
      const e = (leftSide ? left : right)[row];
      if (e) { const a = portAnchor(store.state, view, p.id, e[0])!; return { k: 'port', ref: innerRef(store.state, { instanceId: p.id, portId: e[0] }), x: a[0], y: a[1] }; }
    }
    return { k: 'node', id: p.id, header: wy < n.y + HEADER };
  }
  if (magnet && status.size) { // magnes: najbliższy oznaczony port w promieniu MAGNET_PX (tylko podczas gestu łączenia)
    let best: Hit = { k: 'none' }, bd = MAGNET_PX;
    for (const k of status.keys()) {
      const [iid, pid] = k.split('/'); const a = portAnchor(store.state, view, iid, pid); if (!a) continue;
      const [ax, ay] = toScreen(a[0], a[1]); const d = Math.hypot(ax - sx, ay - sy);
      if (d <= bd && status.get(k)!.level !== 'no') { bd = d; best = { k: 'port', ref: innerRef(store.state, { instanceId: iid, portId: pid }), x: a[0], y: a[1] }; }
    }
    if (best.k === 'port') return best;
  }
  const h = idx.hit(wx, wy, tolW);
  if (h >= 0 && idx.prims[h].t === 'line') return { k: 'edge', id: idx.prims[h].id };
  return { k: 'none' };
}

// ---------- gest ----------
type Mode =
  | { m: 'idle' }
  | { m: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { m: 'node'; id: string; sx: number; sy: number; ox: number; oy: number; dirty: boolean }
  | { m: 'connect'; from: PortRef; fx: number; fy: number; sx: number; sy: number; moved: boolean; armed: boolean };
let mode: Mode = { m: 'idle' };
let armed: PortRef | undefined; // tryb „klik, klik”
let status = new Map<string, Plan>(); // plan dla każdego portu widocznego w oknie (liczony raz na początku gestu)
let usage: Usage;
let hover: Hit = { k: 'none' };
let hoverPlan: Plan | undefined;
let frameQueued = false;
let pendingMove: [string, number, number] | undefined;

function beginConnect(from: PortRef, fx: number, fy: number, sx: number, sy: number) {
  const t = now();
  usage = usageOf(store.state);
  status = new Map();
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
  const idx = backend.index();
  for (const i of idx.query(x0, y0, x1, y1)) {
    const p = idx.prims[i];
    if (p.t !== 'dot') continue;
    const [iid, pid] = p.id.split('/'), to = innerRef(store.state, { instanceId: iid, portId: pid });
    if (to.instanceId === from.instanceId && to.portId === from.portId) continue;
    status.set(p.id, planConnection(store.state, from, to, usage));
  }
  rec('gestureStart', now() - t);
  mode = { m: 'connect', from, fx, fy, sx, sy, moved: false, armed: false };
  hover = { k: 'none' }; hoverPlan = undefined;
}

function planFor(from: PortRef, h: Hit): Plan | undefined {
  if (h.k === 'port') return status.get(portKey(h.ref)) ?? planConnection(store.state, from, h.ref, usage);
  if (h.k === 'node') return h.id.startsWith('cab_') ? undefined : bestPort(store.state, from, h.id, usage);
  return undefined;
}

/** Po `connect` dokłada tylko nową krawędź (pas 0); pełna przebudowa dopiero przy cofnięciu/usunięciu/zwolnieniu węzła. */
function addEdgeIncremental(cid: string) {
  const c = store.state.connections[cid];
  const a = portAnchor(store.state, view, c.from.instanceId, c.from.portId), b = portAnchor(store.state, view, c.to.instanceId, c.to.portId);
  if (!a || !b) return;
  const idx = backend.index();
  const i = idx.add({ t: 'line', id: cid, pts: routeOrthogonal(a, b, 0), stroke: C.info, lw: 1.5 });
  const pts = (idx.prims[i] as any).pts as number[]; edgePrim.set(cid, pts); edgeObj.set(cid, idx.prims[i]);
  for (const iid of new Set([outerRef(store.state, c.from)?.instanceId, outerRef(store.state, c.to)?.instanceId])) if (iid) (nodeEdges.get(iid) ?? nodeEdges.set(iid, []).get(iid)!).push(i);
}

function commit(plan: Plan) {
  const t0 = now();
  const s = store.state;
  const label = `Połącz ${s.equipment[plan.from.instanceId].name} → ${s.equipment[plan.to.instanceId].name}`;
  store.dispatch(label, cmd.connect(plan.from, plan.to, plan.signalKey));
  addEdgeIncremental(Object.keys(store.state.connections).at(-1)!);
  revalidate(); draw();
  const t1 = now();
  rec('commit', t1 - t0);
  requestAnimationFrame(() => requestAnimationFrame(() => rec('commitToFrame', now() - t0)));
  say(plan.level === 'ok' ? `${label} ✓` : `${label} — uwaga: ${plan.reasons.join('; ')}`);
}

async function finishConnect(h: Hit) {
  if (mode.m !== 'connect') return;
  const from = mode.from;
  const plan = planFor(from, h);
  mode = { m: 'idle' }; status = new Map(); hover = { k: 'none' }; hoverPlan = undefined;
  if (!plan) { say('Anulowano (upuszczono poza portem)'); draw(); return; }
  if (plan.level === 'no') { say('Nie można połączyć: ' + plan.reasons.join('; ')); draw(); return; }
  if (plan.level === 'warn') {
    const nm = (r: PortRef) => `${esc(store.state.equipment[r.instanceId].name)} · ${esc(portLabelOf(r))}`;
    const c = await ask('Niezgodne połączenie', `${nm(plan.from)} → ${nm(plan.to)}<br><br>${plan.reasons.map(esc).join('<br>')}<br><br>Połączenie zostanie oznaczone na schemacie i w uwagach walidacji.`, [['no', 'Anuluj'], ['go', 'Połącz mimo to']]);
    if (c !== 'go') { say('Anulowano niezgodne połączenie'); draw(); return; }
  }
  commit(plan);
}

const host = document.getElementById('stage')!;
host.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  host.setPointerCapture(e.pointerId);
  const h = pick(e.offsetX, e.offsetY);
  if (armed) { // drugie kliknięcie trybu „klik, klik”
    const from = armed; armed = undefined;
    beginConnect(from, 0, 0, e.offsetX, e.offsetY);
    if (h.k === 'port' || h.k === 'node') finishConnect(h); else { mode = { m: 'idle' }; say('Anulowano'); draw(); }
    return;
  }
  selectedEdge = h.k === 'edge' ? h.id : undefined;
  if (h.k === 'port') beginConnect(h.ref, h.x, h.y, e.offsetX, e.offsetY);
  else if (h.k === 'node' && h.header) { const n = view.nodes[h.id]; mode = { m: 'node', id: h.id, sx: e.offsetX, sy: e.offsetY, ox: n.x, oy: n.y, dirty: false }; }
  else mode = { m: 'pan', sx: e.offsetX, sy: e.offsetY, cx: cam.x, cy: cam.y };
  draw();
});

host.addEventListener('pointermove', (e) => {
  const t = now();
  if (mode.m === 'pan') { cam.x = mode.cx - (e.offsetX - mode.sx) / cam.zoom; cam.y = mode.cy - (e.offsetY - mode.sy) / cam.zoom; schedule(); }
  else if (mode.m === 'node') {
    mode.dirty = true; pendingMove = [mode.id, mode.ox + (e.offsetX - mode.sx) / cam.zoom, mode.oy + (e.offsetY - mode.sy) / cam.zoom]; schedule(true);
  } else if (mode.m === 'connect') {
    mode.sx = e.offsetX; mode.sy = e.offsetY;
    if (Math.hypot(e.offsetX - toScreen(mode.fx, mode.fy)[0], e.offsetY - toScreen(mode.fx, mode.fy)[1]) > 4) mode.moved = true;
    hover = pick(e.offsetX, e.offsetY);
    hoverPlan = planFor(mode.from, hover);
    drawOverlay();
  } else if (armed) {
    mode = { m: 'idle' };
  }
  rec('move', now() - t);
});

host.addEventListener('pointerup', (e) => {
  if (mode.m === 'connect') {
    if (!mode.moved) { // zwykłe kliknięcie portu: uzbrój tryb „klik, klik”
      armed = mode.from; mode = { m: 'idle' }; status = new Map(); say('Kliknij drugi port (Esc anuluje)'); armedDraw(e.offsetX, e.offsetY); return;
    }
    finishConnect(pick(e.offsetX, e.offsetY));
  } else {
    if (mode.m === 'node') { if (mode.dirty) { const n = view.nodes[mode.id]; store.dispatch('Przesuń urządzenie', setNodePositions({ [mode.id]: { x: n.x, y: n.y } })); rebuild(); autosaver?.notify(); setTitle(); } else selectNode(mode.id); }
    else if (mode.m === 'pan' && Math.hypot(e.offsetX - mode.sx, e.offsetY - mode.sy) < 4) { const h = pick(e.offsetX, e.offsetY); selectNode(h.k === 'node' ? h.id : undefined); }
    mode = { m: 'idle' };
  }
  if (mode.m === 'idle') draw();
});

host.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [wx, wy] = toWorld(e.offsetX, e.offsetY);
  cam.zoom = Math.min(8, Math.max(0.05, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
  cam.x = wx - (e.offsetX - W / 2) / cam.zoom; cam.y = wy - (e.offsetY - H / 2) / cam.zoom;
  schedule();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { mode = { m: 'idle' }; armed = undefined; status = new Map(); say('Anulowano'); draw(); }
  else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void saveProject(e.shiftKey); }
  else if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); void openProjectDialog(); }
  else if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); void newProject(); }
  else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { const t = now(); if (store.undo()) { rebuild(); revalidate(); draw(); say('Cofnięto'); rec('undo', now() - t); } }
  else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) { if (store.redo()) { rebuild(); revalidate(); draw(); say('Ponowiono'); } }
  else if (e.key === 'Delete' && selectedEdge) {
    store.dispatch('Usuń połączenie', cmd.disconnect(selectedEdge)); selectedEdge = undefined; rebuild(); revalidate(); draw(); say('Usunięto połączenie');
  }
});

// przerysowanie co najwyżej raz na klatkę; przy przeciąganiu węzła przebudowa listy rysowania (krawędzie podążają za węzłem)
function schedule(rebuildToo = false) {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    const t = now();
    if (rebuildToo && pendingMove) { moveNodeTo(...pendingMove); pendingMove = undefined; }
    draw();
    if (rebuildToo) rec('nodeDragFrame', now() - t);
  });
}

// ---------- nakładka: gumka, podświetlenia portów ----------
function ring(x: number, y: number, r: number, color: string, w = 2) {
  const [sx, sy] = toScreen(x, y);
  octx.beginPath(); octx.arc(sx, sy, r, 0, 6.2832); octx.lineWidth = w; octx.strokeStyle = color; octx.stroke();
}
function armedDraw(sx: number, sy: number) {
  // w trybie „klik, klik” policz statusy dla źródła, aby podświetlić cele
  if (!armed) return;
  const from = armed; beginConnect(from, 0, 0, sx, sy); mode = { m: 'idle' }; drawOverlay();
}
let labelCache: { v: number; list: [string, string][] } = { v: -1, list: [] };
/** Połączenia z etykietą lub numerem kabla; przeliczane tylko po zmianie projektu (store.version). */
function labelsNow(): [string, string][] {
  if (labelCache.v !== store.version) {
    const list: [string, string][] = [];
    for (const [cid, con] of Object.entries(store.state.connections)) { const t = con.label || (con.cableId ? store.state.cables[con.cableId]?.number : undefined); if (t) list.push([cid, t]); }
    labelCache = { v: store.version, list };
  }
  return labelCache.list;
}
function drawOverlay() {
  octx.clearRect(0, 0, W, H);
  if (selectedNode && view.nodes[selectedNode] && (store.state.equipment[selectedNode] || store.state.cabinets?.[selectedNode])) {
    const n = view.nodes[selectedNode], [w, h] = nodeSize(store.state, selectedNode), [x, y] = toScreen(n.x, n.y);
    octx.strokeStyle = C.green; octx.lineWidth = 2; octx.strokeRect(x - 2, y - 2, w * cam.zoom + 4, h * cam.zoom + 4);
  }
  if (cam.zoom >= 0.5) { // etykiety kabli przy wyjściu z urządzenia (początek trasy, nad linią); bez etykiety pokazujemy numer kabla
    octx.font = '11px Roboto, Segoe UI, sans-serif'; octx.textBaseline = 'alphabetic';
    for (const [cid, txt] of labelsNow()) {
      const pts = edgePrim.get(cid); if (!pts || pts.length < 4) continue;
      const dir = pts[2] >= pts[0] ? 1 : -1, [sx, sy] = toScreen(pts[0], pts[1]);
      if (sx < -200 || sx > W + 200 || sy < -20 || sy > H + 20) continue;
      const tw = octx.measureText(txt).width, x0 = dir > 0 ? sx + 5 : sx - 5 - tw;
      octx.fillStyle = 'rgba(18,18,18,.85)'; octx.fillRect(x0 - 2, sy - 15, tw + 4, 13); octx.fillStyle = C.text; octx.fillText(txt, x0, sy - 5);
    }
  }
  if (selectedEdge) {
    const pts = edgePrim.get(selectedEdge);
    if (pts) { octx.beginPath(); for (let i = 0; i < pts.length; i += 2) { const [x, y] = toScreen(pts[i], pts[i + 1]); i ? octx.lineTo(x, y) : octx.moveTo(x, y); } octx.lineWidth = 3; octx.strokeStyle = C.green; octx.stroke(); }
  }
  const active = mode.m === 'connect' || armed;
  if (!active) return;
  const r = Math.max(5, 5 * cam.zoom);
  for (const [k, plan] of status) {
    const [iid, pid] = k.split('/');
    const a = portAnchor(store.state, view, iid, pid); if (!a) continue;
    const dim = plan.level === 'no';
    ring(a[0], a[1], r, plan.level === 'ok' ? C.green : plan.level === 'warn' ? C.warn : '#444', dim ? 1 : 2);
  }
  if (mode.m === 'connect') {
    const [fx, fy] = toScreen(mode.fx, mode.fy);
    let tx = mode.sx, ty = mode.sy, color = C.text2;
    if (hover.k === 'port') { [tx, ty] = toScreen(hover.x, hover.y); }
    if (hoverPlan) color = hoverPlan.level === 'ok' ? C.green : hoverPlan.level === 'warn' ? C.warn : '#E53935';
    octx.beginPath(); octx.moveTo(fx, fy); octx.lineTo(tx, ty); octx.lineWidth = 2; octx.strokeStyle = color; octx.setLineDash([6, 4]); octx.stroke(); octx.setLineDash([]);
    if (hoverPlan) say(hoverPlan.level === 'ok' ? 'Zwolnij, aby połączyć' : hoverPlan.reasons.join('; ') + (hoverPlan.level === 'warn' ? ' — połączenie powstanie z uwagą' : ''));
  }
}

// ---------- API do testów automatycznych (Playwright) ----------
(window as any).__editor = {
  ready: true,
  metrics: M,
  cam,
  store,
  /** Ustawia widok tak, by środek ekranu był w (wx,wy) przy danym zoomie. */
  look(wx: number, wy: number, zoom: number) { cam.x = wx; cam.y = wy; cam.zoom = zoom; draw(); },
  portScreen(instanceId: string, portId: string): [number, number] | undefined {
    const a = portAnchor(store.state, view, instanceId, portId); return a ? toScreen(a[0], a[1]) : undefined;
  },
  nodeScreen(instanceId: string): { header: [number, number]; body: [number, number] } {
    const n = view.nodes[instanceId], [w, h] = nodeSize(store.state, instanceId);
    return { header: toScreen(n.x + w / 2, n.y + HEADER / 2), body: toScreen(n.x + w / 2, n.y + h - 3) };
  },
  nodes: () => view.nodes,
  toScreen: (x: number, y: number) => toScreen(x, y),
  edgeMid(id: string): [number, number] | undefined {
    const p = edgePrim.get(id); if (!p || p.length < 4) return undefined;
    return toScreen((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
  },
  issues: () => issues,
  counts: () => ({ devices: Object.keys(store.state.equipment).length, connections: Object.keys(store.state.connections).length, cables: Object.keys(store.state.cables).length }),
  H, W,
};

rebuild(); revalidate(); draw();
say(`Gotowe: ${Object.keys(store.state.equipment).length} urządzeń. Przeciągnij z portu (kropki) na port.`);

{
  const fm = document.getElementById('filemenu')!, bb = document.getElementById('b-burger')!;
  const setFm = (open: boolean) => { fm.hidden = !open; bb.setAttribute('aria-expanded', String(open)); };
  bb.onclick = (e) => { e.stopPropagation(); setFm(fm.hidden); };
  fm.addEventListener('click', () => setFm(false));
  document.addEventListener('click', (e) => { if (!fm.hidden && !fm.contains(e.target as Node)) setFm(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fm.hidden) setFm(false); });
}
document.getElementById('b-about')!.onclick = () => openAbout();
document.getElementById('b-upgrade')!.onclick = () => openUpgradeDialog({ store, say, changed: () => { rebuild(); revalidate(); draw(); autosaver?.notify(); setTitle(); } });
{ const n = pendingUpgrades(store.state).length; const msg = [openNote, n ? `Dostępne ulepszenia projektu: ${n} (Menu → Aktualizacja projektu…)` : ''].filter(Boolean).join(' · '); if (msg) setTimeout(() => say(msg), 300); }
document.getElementById('b-settings')!.onclick = () => openSettings(() => { rebuild(); recolorEdges(); draw(); });
document.getElementById('b-new')!.onclick = () => void newProject();
document.getElementById('b-open')!.onclick = () => void openProjectDialog();
document.getElementById('b-save')!.onclick = () => void saveProject();
document.getElementById('b-saveas')!.onclick = () => void saveProject(true);
setTitle();

// ---------- katalog urządzeń (panel po lewej): wyszukiwanie, dodawanie jedną transakcją ----------
{
  const panel = document.getElementById('catalog')!;
  const input = panel.querySelector('input')!, list = panel.querySelector('#cat-list')!;
  /** Znacznik wiarygodności danych w katalogu: tylko gdy dane nie są zweryfikowane ani ogólne (żeby nie zaśmiecać listy). */
  const trustMark = (e: { device: { source: Parameters<typeof sourceTrust>[0] } }) => { const t = sourceTrust(e.device.source); return t === 'verified' || t === 'generic' ? '' : ` · <span title="Źródło danych: ${TRUST_LABEL[t]}" style="color:#FFD54F">${TRUST_LABEL[t]}</span>`; };
  const portsWord = (n: number) => `${n} ${n === 1 ? 'port' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'porty' : 'portów'}`;
  /** W widoku planu nowe urządzenie od razu trafia na plan (środek widoku); w schemacie nic. */
  const onPlan = (id: string) => { const sid = planApi?.active ? planApi.spaceId() : undefined; if (!sid) return () => {}; const c = planApi!.center(); return planCmd.place(id, sid, c.x, c.y); };
  const spot = () => ({ x: Math.round(cam.x - NODE_W / 2), y: Math.round(cam.y - 40) });
  const place = () => { rebuild(); revalidate(); draw(); };
  const addCatalog = (key: string, model: string, mountAt?: (id: string) => (d: any) => void, at?: { node?: { x: number; y: number }; plan?: { x: number; y: number } }) => {
    const name = uniqueName(model, Object.values(store.state.equipment).map((e) => e.name)), id = newId('eqi');
    { const a = addFromCatalog(key, name, id), b = setNodePositions({ [id]: at?.node ?? spot() }), c = at?.plan && planApi?.active && planApi.spaceId() ? planCmd.place(id, planApi.spaceId()!, at.plan.x, at.plan.y) : onPlan(id), r = mountAt ? mountAt(id) : rackApi?.active ? rackApi.mountOnAdd(id) : cabApi?.active ? cabApi.mountOnAdd(id) : () => {}; store.dispatch(`Dodaj ${name}`, (d) => { a(d); b(d); c(d); r(d); }); } place(); say(`Dodano ${name}`);
  };
  const addProjectDef = (defId: string, model: string) => {
    const name = uniqueName(model, Object.values(store.state.equipment).map((e) => e.name)), id = newId('eqi');
    { const a = cmd.addInstance(defId, name, id), b = setNodePositions({ [id]: spot() }), c = onPlan(id); store.dispatch(`Dodaj ${name}`, (d) => { a(d); b(d); c(d); }); } place(); say(`Dodano ${name}`);
  };
  /** Widok, w którym buduje się z katalogu: rack albo szafa. Filtr „tylko pasujące” (domyślnie włączony) ukrywa pozycje, które się tam nie zamontują. */
  const viewKind = (): 'rack' | 'cab' | 'diagram' | undefined => (rackApi?.active ? 'rack' : cabApi?.active ? 'cab' : planApi?.active ? undefined : 'diagram');
  /** Stan przełącznika „tylko pasujące” osobno dla każdego widoku. */
  const fitOn: Record<string, boolean> = { rack: true, cab: true, diagram: true };
  const fitsView = (dev: { rackUnits?: unknown; dinModules?: unknown }) => { const k = viewKind(); if (!k || !fitOn[k]) return true; return k === 'rack' ? !!dev.rackUnits : k === 'cab' ? dev.dinModules !== undefined : dev.dinModules === undefined; };
  const row = (label: string, sub: string, attr: [string, string], onClick: () => void) => {
    const b = document.createElement('button'); b.dataset[attr[0]] = attr[1];
    if (attr[0] === 'cat') { b.draggable = true; b.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData('application/x-sw-cat', attr[1] + '	' + label); ev.dataTransfer!.effectAllowed = 'copy'; }); }
    b.innerHTML = `<span>${label}</span><small>${sub}</small>`; b.onclick = onClick; list.appendChild(b);
  };
  const render = () => {
    list.innerHTML = '';
    const found = searchCatalog(input.value).filter((e) => fitsView(e.device));
    const bf = document.getElementById('cat-fit'), vk = viewKind(); if (bf) { bf.style.display = vk ? 'block' : 'none'; if (vk) { (bf.querySelector('label') as HTMLElement).lastChild!.textContent = vk === 'rack' ? ' Tylko do racka 19″' : vk === 'cab' ? ' Tylko na szynę DIN' : ' Bez osprzętu DIN (aparaty do szaf)'; (document.getElementById('cat-fit-cb') as HTMLInputElement).checked = fitOn[vk]; } }
    const cats = [...new Set(found.map((e) => e.category))];
    for (const c of cats) {
      const h = document.createElement('h3'); h.textContent = c; list.appendChild(h);
      for (const e of found.filter((x) => x.category === c)) row(e.model, `${e.manufacturer} · ${portsWord(e.ports.length)}${e.packId === STARTER_ID ? '' : ' · ' + esc(e.packName)}${trustMark(e)}`, ['cat', e.key], () => addCatalog(e.key, e.model));
    }
    if (!found.length) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'Brak wyników'; list.appendChild(d); }
    const inCatalog = new Set(catalogEntries.map((x) => definitionIdOf(x.packId, x.devKey)));
    // definicje projektu spoza katalogu albo zmienione względem pakietu (rewizja > 1)
    const own = Object.entries(store.state.definitions).filter(([id, def]) => !inCatalog.has(id) || def.latestRevision > 1);
    if (own.length && !input.value) {
      const h = document.createElement('h3'); h.textContent = 'W tym projekcie'; list.appendChild(h);
      for (const [defId, def] of own) { const rev = def.revisions[String(def.latestRevision)]; row(rev.model, portsWord(Object.keys(rev.ports).length), ['def', defId], () => addProjectDef(defId, rev.model)); }
    }
  };
  input.addEventListener('input', render); render();
  document.getElementById('cat-fit-cb')!.addEventListener('change', (ev) => { const vk = viewKind(); if (vk) fitOn[vk] = (ev.target as HTMLInputElement).checked; renderCatalog(); if (cabApi?.active) cabApi.refresh(); });
  // kreator własnego urządzenia: wprost z panelu katalogu i z menu
  const openBuilder = () => openDeviceBuilder({ library: library as any, say, addToProject: (key, model) => addCatalog(key, model) });
  const openElBuilder = () => openElectricalBuilder({ library: library as any, say, addToProject: (key, model) => addCatalog(key, model) });
  document.getElementById('b-newel')!.onclick = openElBuilder; document.getElementById('b-newel2')!.onclick = () => { document.getElementById('filemenu')?.setAttribute('hidden', ''); openElBuilder(); };
  document.getElementById('b-newdev')!.onclick = openBuilder; document.getElementById('b-newdev2')!.onclick = () => { document.getElementById('filemenu')?.setAttribute('hidden', ''); openBuilder(); };
  // upuszczenie pozycji z katalogu na schemat blokowy albo na plan sali: nowa instancja w miejscu upuszczenia
  { const stage = document.getElementById('stage')!;
    const over = (ev: DragEvent) => { if (ev.dataTransfer?.types.includes('application/x-sw-cat') && (viewKind() === 'diagram' || planApi?.active)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } };
    const drop = (ev: DragEvent, el: HTMLElement) => {
      const raw = ev.dataTransfer?.getData('application/x-sw-cat'); if (!raw) return; const r = el.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, [key, model] = raw.split('\t');
      if (planApi?.active) { ev.preventDefault(); addCatalog(key, model, undefined, { plan: planApi.pointAt(sx, sy) }); }
      else if (viewKind() === 'diagram') { ev.preventDefault(); const [wx, wy] = toWorld(sx, sy); addCatalog(key, model, undefined, { node: { x: Math.round(wx - NODE_W / 2), y: Math.round(wy - 20) } }); }
    };
    stage.addEventListener('dragover', over); stage.addEventListener('drop', (ev) => drop(ev, stage));
    setTimeout(function wirePlan() { const h = planApi?.host as HTMLElement | undefined; if (!h) { setTimeout(wirePlan, 100); return; } h.addEventListener('dragover', over); h.addEventListener('drop', (ev) => drop(ev, h)); }, 0); }
  // upuszczenie pozycji z katalogu na rack albo szynę: nowa instancja od razu w wybranym miejscu
  for (const api of [() => rackApi, () => cabApi]) { setTimeout(function wire() { const c = api()?.canvas as HTMLCanvasElement | undefined; if (!c) { setTimeout(wire, 100); return; }
    c.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('application/x-sw-cat')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    c.addEventListener('drop', (ev) => { const raw = ev.dataTransfer?.getData('application/x-sw-cat'); if (!raw) return; ev.preventDefault(); const [key, model] = raw.split('	'); const m = api()!.dropMount(ev.clientX, ev.clientY); addCatalog(key, model, m); }); }, 0); }
  /** Odświeża listę, gdy zmienił się zestaw definicji projektu lub pakietów; zachowuje przewinięcie. */
  let sig = '';
  renderCatalog = () => { const top = list.scrollTop; render(); list.scrollTop = top; };
  refreshCatalog = () => { const s = Object.entries(store.state.definitions).map(([k, d]) => k + ':' + d.latestRevision).join() + '|' + catalogEntries.length; if (s !== sig) { sig = s; renderCatalog(); } };
  document.getElementById('b-library')!.onclick = () => library.openDialogUi();
  const libBrowser = createLibBrowser({ library: library as any, say, addToProject: (key, model) => addCatalog(key, model) });
  document.getElementById('b-browse')!.onclick = () => libBrowser.toggle();
  window.addEventListener('keydown', (e) => { if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) && !document.querySelector('.dlg') && !planApi?.active) { e.preventDefault(); libBrowser.toggle(); } });
  (window as any).__editor.libBrowser = libBrowser;
  input.addEventListener('keydown', (e) => e.stopPropagation()); // skróty edytora nie działają podczas pisania
}

// ---------- zaznaczenie, panel właściwości, edycja definicji ----------
function selectNode(id: string | undefined) { selectedNode = id; renderProps(); drawOverlay(); }

function renderCabinetBlockProps(el: HTMLElement, id: string) {
  const cab = store.state.cabinets![id], n = cab.terminals?.length ?? 0;
  el.style.display = 'block';
  el.innerHTML = `<h3>Szafa (blok)</h3><div class="meta"><b style="color:#fff">${esc(cab.name)}</b><br>${cab.rows} szyn × ${cab.modules} mod. · terminali: ${n}</div>
    <div class="meta">Na schemacie widać tylko oznaczone terminale. Osprzęt, przewody wewnętrzne i terminale ustawiasz w widoku „Szafa”.</div>
    <button id="cb-expand">Rozwiń na schemacie</button>`;
  el.querySelector('#cb-expand')!.addEventListener('click', () => { store.dispatch('Rozwiń szafę na schemacie', cabCmd.setBlock(id, false)); selectedNode = undefined; delete view.nodes[id]; rebuild(); revalidate(); draw(); renderProps(); say('Szafa rozwinięta: osprzęt widoczny na schemacie'); });
}

function renderProps() {
  const el = document.getElementById('props')!;
  if (rackApi?.active || cabApi?.active) { el.style.display = 'none'; return; }
  const id = selectedNode, inst = id ? store.state.equipment[id] : undefined;
  if (id && !inst && store.state.cabinets?.[id]) { renderCabinetBlockProps(el, id); return; }
  if (!id || !inst) { renderCableProps(el); return; }
  const def = store.state.definitions[inst.definitionId], rev = def.revisions[String(inst.definitionRevision)];
  const outdated = inst.definitionRevision < def.latestRevision;
  el.style.display = 'block';
  el.innerHTML = `<h3>Urządzenie</h3>
    <label>Nazwa<input id="p-name" value="${inst.name.replace(/"/g, '&quot;')}"></label>
    <div class="meta">${rev.model} · rewizja ${inst.definitionRevision}${outdated ? ` <b class="warn">(najnowsza: ${def.latestRevision})</b>` : ''}</div>
    <button id="p-edit">Edytuj definicję…</button>
    ${outdated ? `<button id="p-upg">Zaktualizuj do rewizji ${def.latestRevision}</button>` : ''}
    <button id="p-del" class="danger">Usuń urządzenie</button>${planApi?.active ? planApi.propsHtml(id) : ''}`;
  const nm = el.querySelector('#p-name') as HTMLInputElement;
  nm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nm.blur(); });
  nm.addEventListener('change', () => {
    try { store.dispatch('Zmień nazwę', renameInstance(id, nm.value)); rebuild(); revalidate(); draw(); }
    catch (e) { say(String((e as Error).message)); nm.value = store.state.equipment[id].name; }
  });
  if (planApi?.active) planApi.bindProps(el, id);
  el.querySelector('#p-edit')!.addEventListener('click', () => openDefEditor(inst.definitionId));
  el.querySelector('#p-upg')?.addEventListener('click', () => void upgradeOne(id));
  el.querySelector('#p-del')!.addEventListener('click', () => void removeSelected(id));
}

/** Opcje listy typów kabla: najpierw pasujące do obu złączy portów, potem pozostałe. */
function cableTypeOptions(con: { from: PortRef; to: PortRef }, current: string): string {
  const reg: Record<string, any> = { ...starterRegistries, ...store.state.registries };
  const conn = (r: PortRef) => store.state.definitions[store.state.equipment[r.instanceId].definitionId].revisions[String(store.state.equipment[r.instanceId].definitionRevision)].ports[r.portId]?.connectorKey;
  const a = conn(con.from), b = conn(con.to);
  const fits = (r: any) => (r.endPairs as string[][] | undefined)?.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const all = Object.entries(reg).filter(([, r]) => r.kind === 'cable');
  const opt = ([k, r]: [string, any], mark = '') => `<option value="${k}"${k === current ? ' selected' : ''}>${mark}${esc(r.name)}</option>`;
  const good = all.filter(([, r]) => fits(r)), rest = all.filter(([, r]) => !fits(r));
  return `${good.length ? `<optgroup label="Pasują do obu złączy">${good.map((x) => opt(x)).join('')}</optgroup>` : ''}<optgroup label="${good.length ? 'Pozostałe (niezgodne złącza)' : 'Brak pasującego typu — wszystkie'}">${rest.map((x) => opt(x)).join('')}</optgroup>`;
}

/** Połączenie fizyczne bez kabla (nie było typu pasującego do obu złączy): panel pozwala wybrać typ i przypisać kabel. */
function renderNoCableProps(el: HTMLElement, cid: string, con: { from: PortRef; to: PortRef }) {
  const S = store.state, nm = (r: PortRef) => esc(S.equipment[r.instanceId].name);
  el.style.display = 'block';
  el.innerHTML = `<h3>Połączenie bez kabla</h3><div class="meta">${nm(con.from)} → ${nm(con.to)}</div>
    <div class="meta warn">Brak typu kabla pasującego do obu złączy, więc kabel nie powstał (nie ma numeru ani długości). Wybierz typ i przypisz kabel.</div>
    <label>Typ kabla<select id="c-type" style="display:block;width:100%;box-sizing:border-box;min-height:44px;margin:4px 0 8px;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#fff;padding:0 8px">${cableTypeOptions(con, '')}</select></label>
    <button id="c-assign" class="primary">Przypisz kabel</button><button id="c-del" class="danger">Usuń połączenie</button>`;
  el.querySelector('#c-assign')!.addEventListener('click', () => {
    const key = (el.querySelector('#c-type') as HTMLSelectElement).value;
    try { store.dispatch('Przypisz kabel', (d) => { ensureRegistries(d, [key, ...((starterRegistries[key]?.endPairs as string[][] | undefined)?.flat() ?? [])]); cmd.assignCable(cid, key)(d); }); revalidate(); draw(); say('Przypisano kabel'); }
    catch (err) { say(String((err as Error).message)); }
  });
  el.querySelector('#c-del')!.addEventListener('click', () => { store.dispatch('Usuń połączenie', cmd.disconnect(cid)); selectedEdge = undefined; rebuild(); revalidate(); draw(); renderProps(); say('Usunięto połączenie'); });
}

function renderCableProps(el: HTMLElement) {
  if (planApi?.active && (planApi.renderRackProps(el) || planApi.renderRouteProps(el))) return;
  const cid = selectedEdge, con = cid ? store.state.connections[cid] : undefined, cab = con?.cableId ? store.state.cables[con.cableId] : undefined;
  if (cid && con && !cab && con.medium === 'physical') { renderNoCableProps(el, cid, con); return; }
  if (!cid || !con || !cab || !con.cableId) { el.style.display = 'none'; return; }
  const cabId = con.cableId, S = store.state, reg = (k: string) => S.registries[k]?.name ?? starterRegistries[k]?.name ?? k;
  const dev = (r: PortRef) => S.equipment[r.instanceId].name;
  el.style.display = 'block';
  el.innerHTML = `<h3>Kabel</h3>
    <div class="meta">${dev(con.from).replace(/</g, '&lt;')} → ${dev(con.to).replace(/</g, '&lt;')}<br>${reg(cab.cableTypeKey)} · ${reg(con.signalKey)}</div>
    <label>Typ kabla<select id="c-type" style="display:block;width:100%;box-sizing:border-box;min-height:44px;margin:4px 0 8px;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#fff;padding:0 8px">${cableTypeOptions(con, cab.cableTypeKey)}</select></label>
    <label>Etykieta (na diagramie)<input id="c-lbl" value="${(con.label ?? '').replace(/"/g, '&quot;')}" placeholder="np. Kamera 1 PGM"></label>
    <label>Numer kabla<input id="c-num" value="${(cab.number ?? '').replace(/"/g, '&quot;')}" placeholder="np. V001 lub Kamera 1"></label>
    <label>Długość [m]<input id="c-len" type="number" min="0" step="0.5" value="${cab.lengthMm !== undefined ? cab.lengthMm / 1000 : ''}"></label>
    <div class="meta">${cab.lengthSource === 'estimated' ? 'Długość oszacowana z planu (wpisanie własnej ją zastąpi)' : cab.lengthSource === 'manual' ? 'Długość wpisana ręcznie' : 'Długość nieznana'}</div>
    <button id="c-del" class="danger">Usuń połączenie</button>`;
  const apply = (label: string, m: ReturnType<typeof cmd.setCableNumber>, revert: () => void) => {
    try { store.dispatch(label, m); draw(); } catch (err) { say(String((err as Error).message)); revert(); }
  };
  (el.querySelector('#c-type') as HTMLSelectElement).addEventListener('change', (ev) => {
    const key = (ev.target as HTMLSelectElement).value;
    try { store.dispatch('Typ kabla', (d) => { ensureRegistries(d, [key, ...((starterRegistries[key]?.endPairs as string[][] | undefined)?.flat() ?? [])]); cmd.setCableType(cabId, key)(d); }); revalidate(); draw(); say('Zmieniono typ kabla'); }
    catch (err) { say(String((err as Error).message)); }
  });
  const lbl = el.querySelector('#c-lbl') as HTMLInputElement, num = el.querySelector('#c-num') as HTMLInputElement, len = el.querySelector('#c-len') as HTMLInputElement;
  for (const i of [lbl, num, len]) i.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') i.blur(); });
  lbl.addEventListener('change', () => { if (lbl.value.trim() !== (con.label ?? '')) apply('Etykieta kabla', cmd.setConnectionLabel(cid, lbl.value), () => {}); });
  num.addEventListener('change', () => { if (num.value.trim() !== (cab.number ?? '')) apply('Nazwa kabla', cmd.setCableNumber(cabId, num.value), () => { num.value = store.state.cables[cabId].number ?? ''; }); });
  len.addEventListener('change', () => { const m = Number(len.value); if (len.value !== '' && m >= 0) apply('Długość kabla', cmd.setCableLengths(cabId, { lengthMm: Math.round(m * 1000) }), () => {}); });
  el.querySelector('#c-del')!.addEventListener('click', () => { store.dispatch('Usuń połączenie', cmd.disconnect(cid)); selectedEdge = undefined; rebuild(); revalidate(); draw(); renderProps(); say('Usunięto połączenie'); });
}

async function upgradeOne(id: string) {
  const inst = store.state.equipment[id], def = store.state.definitions[inst.definitionId];
  const target = def.revisions[String(def.latestRevision)];
  const lost = Object.values(store.state.connections).filter((c) => [c.from, c.to].some((r) => r.instanceId === id && !target.ports[r.portId])).length;
  if (lost && (await ask('Aktualizacja zerwie połączenia', `Nowa rewizja nie ma portów, do których podłączono ${lost} połączeń. Zostaną usunięte (można cofnąć).`, [['go', 'Zaktualizuj'], ['no', 'Anuluj']])) !== 'go') return;
  store.dispatch('Aktualizuj urządzenie', cmd.upgradeInstance(id, def.latestRevision, 'delete')); rebuild(); revalidate(); draw();
  say(`Zaktualizowano do rewizji ${def.latestRevision}`);
}

async function removeSelected(id: string) {
  const pv = cmd.previewRemoveInstance(store.state, id), name = store.state.equipment[id].name;
  const extra = pv.connections ? ` Usunięte zostaną też ${pv.connections} połączeń i ${pv.cables} kabli.` : '';
  if ((await ask(`Usunąć „${esc(name)}”?`, `Urządzenie zostanie usunięte z projektu (także z planu i schematu).${extra} Można cofnąć (Ctrl+Z).`, [['go', 'Usuń'], ['no', 'Anuluj']])) !== 'go') return;
  store.dispatch(`Usuń ${name}`, cmd.removeInstance(id)); delete view.nodes[id]; selectedNode = undefined; rebuild(); revalidate(); draw(); say(`Usunięto ${name}`);
}

function openDefEditor(defId: string) {
  const s0 = store.state, def0 = s0.definitions[defId], rev0 = def0.revisions[String(def0.latestRevision)];
  const rows: PortDraft[] = portDrafts(rev0).map((p) => ({ ...p, signalKeys: [...p.signalKeys] }));
  const reg: Record<string, any> = { ...starterRegistries, ...s0.registries };
  /** Napięcia i moc portu mają sens tylko dla portów zasilających (PoE, zasilanie AC/DC); wiersz zostaje, gdy port ma już zapisane wartości. */
  const showElectrical = (r: PortDraft) => !!(r as any).electrical || r.signalKeys.some((k) => reg[k]?.domain === 'power');
  const opts = (kind: string, sel: string) => Object.entries(reg).filter(([, r]) => r.kind === kind).map(([k, r]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${r.name}</option>`).join('');
  const DIRS: [string, string][] = [['in', 'wejście'], ['out', 'wyjście'], ['io', 'wej./wyj.'], ['loop', 'przelot']];
  const KIND_LABEL: Record<SourceKind, string> = { datasheet: 'karta katalogowa producenta', manual: 'instrukcja producenta', measured: 'zmierzone / sprawdzone na egzemplarzu', estimated: 'szacunek (do weryfikacji)', generic: 'urządzenie ogólne', custom: 'własna konfiguracja' };
  // stan pól opisowych (przeżywa przerysowanie okna po dodaniu/usunięciu portu)
  const m = {
    manufacturer: rev0.manufacturer, model: rev0.model, category: rev0.category, tags: (rev0.tags ?? []).join(', '), notes: rev0.notes ?? '',
    w: String(rev0.dimensionsMm?.width ?? ''), d: String(rev0.dimensionsMm?.depth ?? ''), h: String(rev0.dimensionsMm?.height ?? ''),
    weight: rev0.weightKg !== undefined ? String(rev0.weightKg) : '', power: rev0.powerW !== undefined ? String(rev0.powerW) : '', powerMax: typeof rev0.powerMaxW === 'number' ? String(rev0.powerMaxW) : '',
    srcUrl: String(rev0.sourceUrl ?? ''), hwRev: String(rev0.hardwareRevision ?? ''), generated: rev0.sourceGenerated === true,
    din: String(rev0.dinModules ?? ''), ru: String(rev0.rackUnits?.heightU ?? ''), ruFrac: String(rev0.rackUnits?.widthFraction ?? 1),
    srcKind: ((rev0.sourceKind as SourceKind | undefined) ?? (rev0.origin?.custom ? 'custom' : 'estimated')) as SourceKind,
    srcRef: rev0.origin?.source && rev0.origin.source !== rev0.sourceKind && rev0.origin.source !== 'generic' ? rev0.origin.source : '', srcVerified: String(rev0.sourceVerified ?? ''),
  };
  const num = (s: string, what: string): number | null => { if (!s.trim()) return null; const v = Number(s.replace(',', '.')); if (!Number.isFinite(v)) throw new Error(`${what}: podaj liczbę`); return v; };
  /** Zebranie pól opisowych; puste pole opcjonalne = usunięcie (null). */
  const metaOut = (): DefinitionMeta => {
    const w = num(m.w, 'Szerokość'), dd = num(m.d, 'Głębokość'), h = num(m.h, 'Wysokość'), ru = num(m.ru, 'Rack U'), din = num(m.din, 'Moduły DIN');
    if ([w, dd, h].some((x) => x === null) && [w, dd, h].some((x) => x !== null)) throw new Error('Wymiary: podaj wszystkie trzy (szerokość, głębokość, wysokość) albo żadnego');
    return {
      manufacturer: m.manufacturer, model: m.model, category: m.category, tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: m.notes,
      dimensionsMm: w === null ? null : { width: w, depth: dd!, height: h! }, weightKg: num(m.weight, 'Masa'), powerW: num(m.power, 'Moc'), powerMaxW: num(m.powerMax, 'Moc maksymalna'),
      dinModules: din,
      rackUnits: ru === null ? null : { heightU: ru, widthFraction: Number(m.ruFrac) },
      source: { kind: m.srcKind, ...(m.srcRef.trim() ? { ref: m.srcRef.trim() } : {}), ...(m.srcVerified.trim() ? { verified: m.srcVerified.trim() } : {}), url: m.srcUrl, hardwareRevision: m.hwRev, generated: m.generated },
    };
  };
  const ov = document.createElement('div'); ov.id = 'defdialog';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  document.body.appendChild(ov);
  const keepAll = { v: true }; let metaOpen = false;
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const redraw = () => {
    const imp = impactOf(store.state, defId, rows.map((r) => r.id));
    const fld = (id: string, label: string, val: string) => `<label style="flex:1;min-width:120px">${label}<input id="${id}" value="${attr(val)}" style="display:block;width:100%;margin-top:4px"></label>`;
    ov.innerHTML = `<div class="dlg"><h2>Definicja: ${esc(m.manufacturer)} ${esc(m.model)}</h2>
      <div style="display:flex;gap:8px;margin-bottom:8px">${fld('m-model', 'Model', m.model)}${fld('m-manufacturer', 'Producent', m.manufacturer)}${fld('m-category', 'Kategoria', m.category)}</div>
      <details id="d-more"${metaOpen ? ' open' : ''}><summary style="cursor:pointer;color:#00C853;margin:4px 0 8px">Dane urządzenia: wymiary, masa, rack, źródło danych</summary>
        <div style="display:flex;gap:8px;margin-bottom:8px">${fld('m-w', 'Szerokość [mm]', m.w)}${fld('m-d', 'Głębokość [mm]', m.d)}${fld('m-h', 'Wysokość [mm]', m.h)}${fld('m-weight', 'Masa [kg]', m.weight)}${fld('m-power', 'Moc typowa [W]', m.power)}${fld('m-powermax', 'Moc maks. [W]', m.powerMax)}</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">${fld('m-ru', 'Rack [U] (puste = brak)', m.ru)}<label style="flex:1">Szerokość w racku<select id="m-rufrac" style="display:block;width:100%;margin-top:4px">${['1', '0.5', '0.33'].map((v) => `<option value="${v}"${v === m.ruFrac ? ' selected' : ''}>${v === '1' ? 'pełna' : v === '0.5' ? '1/2' : '1/3'}</option>`).join('')}</select></label>${fld('m-din', 'Moduły DIN (puste = brak)', m.din)}${fld('m-tags', 'Tagi (po przecinku)', m.tags)}</div>
        ${fld('m-notes', 'Opis (własnymi słowami, do 400 znaków)', m.notes)}
        <div style="display:flex;gap:8px;margin:8px 0">${fld('m-srcurl', 'Adres źródła (https://…)', m.srcUrl)}${fld('m-hwrev', 'Rewizja sprzętu (np. rev B)', m.hwRev)}<label class="chk" style="flex:1;align-self:end;margin-bottom:6px"><input type="checkbox" id="m-generated"${m.generated ? ' checked' : ''}> dane wygenerowane (do weryfikacji)</label></div>
        <div style="display:flex;gap:8px;margin:8px 0"><label style="flex:2">Źródło danych<select id="m-srckind" style="display:block;width:100%;margin-top:4px">${SOURCE_KINDS.map((k) => `<option value="${k}"${k === m.srcKind ? ' selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></label>${fld('m-srcref', 'Odnośnik do dokumentu (karta, instrukcja, adres)', m.srcRef)}${fld('m-srcver', 'Sprawdzono (RRRR-MM-DD)', m.srcVerified)}</div>
        <p style="color:#B0B0B0;font-size:13px;margin:4px 0 10px">Dane z katalogu producenta wpisuj własnymi słowami i podawaj źródło; nie kopiuj cudzych baz.</p></details>
      <div class="rows">${rows.map((r, i) => `<div class="prow" data-i="${i}">
        <input class="f-label" value="${attr(r.label)}" aria-label="Nazwa portu">
        <select class="f-conn" aria-label="Złącze">${opts('connector', r.connectorKey)}</select>
        <select class="f-sig" aria-label="Sygnał" title="${r.signalKeys.length > 1 ? 'Port obsługuje więcej sygnałów (' + r.signalKeys.length + '); zmiana zastępuje pierwszy' : ''}">${opts('signal', r.signalKeys[0])}</select>
        <select class="f-dir" aria-label="Kierunek">${DIRS.map(([v, l]) => `<option value="${v}"${v === r.direction ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input class="f-cap" type="number" min="1" value="${r.capacity}" aria-label="Pojemność">
        <button class="f-del" aria-label="Usuń port">✕</button>
        <div class="f-extra"><label class="xl">grupa portów<input class="f-grp" value="${attr(String(r.group ?? ''))}" placeholder="grupa (np. DMX, 230 V)" aria-label="Grupa portów" title="Porty tej samej grupy (np. A, B, GND jednego wejścia) są pokazywane razem"></label>
          ${r.signalKeys.slice(1).map((k, j) => `<select class="f-sigx" data-k="${j + 1}" aria-label="Dodatkowy sygnał ${j + 1}" title="Dodatkowy sygnał portu (np. PoE na RJ45); „usuń” zdejmuje go"><option value="">usuń sygnał</option>${opts('signal', k)}</select>`).join('')}
          <button class="f-sigadd" type="button" title="Dodaj kolejny sygnał obsługiwany przez ten port">+ sygnał</button>
          ${showElectrical(r) ? `<label class="xl">U min [V]<input class="f-umin" type="number" min="0" step="any" value="${(r as any).electrical?.voltageMinV ?? ''}" placeholder="U min [V]" aria-label="Napięcie minimalne [V]"></label>
          <label class="xl">U maks. [V]<input class="f-umax" type="number" min="0" step="any" value="${(r as any).electrical?.voltageMaxV ?? ''}" placeholder="U maks. [V]" aria-label="Napięcie maksymalne [V]"></label>
          <label class="xl">P maks. [W]<input class="f-pmax" type="number" min="0" step="any" value="${(r as any).electrical?.maxW ?? ''}" placeholder="P maks. [W]" aria-label="Moc maksymalna portu [W]"></label>` : ''}</div></div>`).join('')}</div>
      <button id="d-add">+ Port</button>
      <p class="imp">${imp.instances} urządzeń używa tej definicji${imp.lostConnections ? ` · <b class="warn">usunięcie portów zerwie ${imp.lostConnections} połączeń po aktualizacji</b>` : ''}</p>
      <label class="chk"><input type="checkbox" id="d-all"${keepAll.v ? ' checked' : ''}> Zaktualizuj wszystkie urządzenia do nowej rewizji</label>
      <div class="btns"><button id="d-save" class="primary">Zapisz rewizję</button><button id="d-fork" title="Zapisuje zmiany jako nowe urządzenie w projekcie i przepina na nie zaznaczone urządzenie; oryginał zostaje bez zmian">Zapisz jako nowe urządzenie</button><button id="d-lib" title="Zapisuje urządzenie w pakiecie „Moje urządzenia” w bibliotece użytkownika (dostępne we wszystkich projektach)">Do mojej biblioteki</button><button id="d-cancel">Anuluj</button></div></div>`;
    const q2 = (sel: string) => ov.querySelector(sel) as HTMLInputElement;
    const bindM = (id: string, key: keyof typeof m, ev: 'input' | 'change' = 'input') => q2(id).addEventListener(ev, (x) => { (m as any)[key] = (x.target as HTMLInputElement).value; });
    for (const [id, key] of [['#m-model', 'model'], ['#m-manufacturer', 'manufacturer'], ['#m-category', 'category'], ['#m-w', 'w'], ['#m-d', 'd'], ['#m-h', 'h'], ['#m-weight', 'weight'], ['#m-power', 'power'], ['#m-ru', 'ru'], ['#m-din', 'din'], ['#m-tags', 'tags'], ['#m-notes', 'notes'], ['#m-srcref', 'srcRef'], ['#m-srcver', 'srcVerified']] as const) bindM(id, key);
    bindM('#m-rufrac', 'ruFrac', 'change'); bindM('#m-srckind', 'srcKind', 'change'); bindM('#m-powermax', 'powerMax'); bindM('#m-srcurl', 'srcUrl'); bindM('#m-hwrev', 'hwRev');
    q2('#m-generated').addEventListener('change', (x) => { m.generated = (x.target as HTMLInputElement).checked; });
    q2('#d-more').addEventListener('toggle', (x) => { metaOpen = (x.target as HTMLDetailsElement).open; });
    q2('#d-all').addEventListener('change', (x) => { keepAll.v = (x.target as HTMLInputElement).checked; });
    ov.querySelectorAll('.prow').forEach((el) => {
      const i = Number((el as HTMLElement).dataset.i), g = (c: string) => el.querySelector(c) as HTMLInputElement;
      g('.f-label').addEventListener('input', (x) => { rows[i].label = (x.target as HTMLInputElement).value; });
      g('.f-conn').addEventListener('change', (x) => { rows[i].connectorKey = (x.target as HTMLInputElement).value; });
      g('.f-sig').addEventListener('change', (x) => { rows[i].signalKeys = [(x.target as HTMLInputElement).value, ...rows[i].signalKeys.slice(1).filter((s) => s !== (x.target as HTMLInputElement).value)]; redraw(); });
      g('.f-dir').addEventListener('change', (x) => { rows[i].direction = (x.target as HTMLInputElement).value as PortDraft['direction']; });
      g('.f-cap').addEventListener('input', (x) => { rows[i].capacity = Number((x.target as HTMLInputElement).value); });
      g('.f-grp').addEventListener('input', (x) => { const v = (x.target as HTMLInputElement).value.trim(); if (v) rows[i].group = v; else delete rows[i].group; });
      el.querySelectorAll('.f-sigx').forEach((sel) => sel.addEventListener('change', (x) => {
        const v = (x.target as HTMLSelectElement).value, k = Number((sel as HTMLElement).dataset.k), keys = [...rows[i].signalKeys];
        if (!v) keys.splice(k, 1); else keys[k] = v;
        rows[i].signalKeys = keys.filter((q, n) => keys.indexOf(q) === n); redraw();
      }));
      el.querySelector('.f-sigadd')!.addEventListener('click', () => {
        const have = new Set(rows[i].signalKeys), first = Object.entries(reg).find(([k, v]) => v.kind === 'signal' && !have.has(k))?.[0];
        if (!first) { say('Brak kolejnego sygnału do dodania'); return; }
        rows[i].signalKeys = [...rows[i].signalKeys, first]; redraw();
      });
      const elec = () => {
        if (!el.querySelector('.f-umin')) return; // pola napięć są tylko przy portach zasilających
        const n = (c: string) => { const v = g(c).value.trim(); return v === '' ? undefined : Number(v.replace(',', '.')); };
        const e: { voltageMinV?: number; voltageMaxV?: number; maxW?: number } = {}, a = n('.f-umin'), b2 = n('.f-umax'), c = n('.f-pmax');
        if (a !== undefined) e.voltageMinV = a; if (b2 !== undefined) e.voltageMaxV = b2; if (c !== undefined) e.maxW = c;
        if (Object.keys(e).length) (rows[i] as any).electrical = e; else delete (rows[i] as any).electrical;
      };
      for (const c of ['.f-umin', '.f-umax', '.f-pmax']) el.querySelector(c)?.addEventListener('input', elec);
      g('.f-del').addEventListener('click', () => { rows.splice(i, 1); redraw(); });
    });
    ov.querySelectorAll('input,select').forEach((x) => x.addEventListener('keydown', (ev) => ev.stopPropagation()));
    q2('#d-add').addEventListener('click', () => {
      const last = rows.at(-1), n = rows.length + 1;
      rows.push({ id: newPortId(rows.map((r) => r.id).concat(Object.keys(rev0.ports)), 'Port ' + n), label: 'Port ' + n, order: n,
        connectorKey: last?.connectorKey ?? 'std/rj45', signalKeys: [last?.signalKeys[0] ?? 'std/ethernet'], direction: 'io', side: 'auto', capacity: 1 });
      redraw();
    });
    q2('#d-cancel').addEventListener('click', () => ov.remove());
    const finish = () => { ov.remove(); for (const id of Object.keys(view.nodes)) if (!store.state.equipment[id]) delete view.nodes[id]; rebuild(); revalidate(); draw(); };
    q2('#d-save').addEventListener('click', () => {
      try {
        const all = keepAll.v;
        const n = store.dispatch(`Edytuj definicję ${m.model}`, saveDefinition(defId, { ports: rows, meta: metaOut() }, all ? 'all' : 'none'));
        finish();
        const d = store.state.definitions[defId];
        say(n ? `Zapisano rewizję ${d.latestRevision}${all ? '' : ' (urządzenia zostają na starej rewizji)'}` : 'Bez zmian');
      } catch (err) { say('Nie zapisano: ' + String((err as Error).message)); }
    });
    q2('#d-fork').addEventListener('click', () => {
      try {
        const repin = selectedNode && store.state.equipment[selectedNode]?.definitionId === defId ? selectedNode : undefined;
        const forkId = newId('eqd');
        store.dispatch(`Nowe urządzenie ${m.model}`, forkDefinition(defId, { ports: rows, meta: metaOut() }, repin, forkId));
        finish(); say(`Utworzono nowe urządzenie „${store.state.definitions[forkId].revisions['1'].model}”${repin ? ' i przepięto na nie zaznaczone urządzenie' : ''}`);
      } catch (err) { say('Nie zapisano: ' + String((err as Error).message)); }
    });
    q2('#d-lib').addEventListener('click', async () => {
      try {
        const draft = draftRevision(rev0, { ports: rows, meta: metaOut() });
        say(await library.saveToMyLibrary(draft, rev0.key));
      } catch (err) { say(String((err as Error).message).split('\n')[0]); await ask('Nie zapisano w bibliotece', esc(String((err as Error).message)).replace(/\n/g, '<br>'), [['ok', 'OK']]); }
    });
  };
  redraw();
}
(window as any).__editor.selectNode = selectNode;
(window as any).__editor.toScreen = toScreen;
(window as any).__editor.revisionOf = (id: string) => store.state.equipment[id]?.definitionRevision;

const pdfFonts = async () => { const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer()); return { latin: await get(latinFontUrl), latinExt: await get(latinExtFontUrl) }; };
const buildCableListPdf = async () => cableListPdf(store.state, { fonts: await pdfFonts(), projectName: store.state.name ?? 'Projekt', date: new Date().toISOString().slice(0, 10) });
(window as any).__editor.cableListPdf = buildCableListPdf;
const buildDiagramPdf = async () => diagramPdf(store.state, view, { color: settings.exportColor, fonts: await pdfFonts(), projectName: store.state.name ?? 'Projekt', date: new Date().toISOString().slice(0, 10) });
(window as any).__editor.diagramPdf = buildDiagramPdf;
document.getElementById('b-diagpdf')!.onclick = async () => {
  if (!inTauri) { say('Eksport działa w aplikacji'); return; }
  try {
    const r = await buildDiagramPdf();
    const target = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: exportName(store.state.name, 'schemat', undefined, 'pdf') });
    if (!target) return;
    await invoke('save_autosave', { path: /\.pdf$/i.test(target) ? target : target + '.pdf', data: Array.from(r.bytes) });
    say(`Zapisano ${nameOf(target)} (papier ${r.paper})`);
  } catch (err) { say('Błąd eksportu PDF: ' + String(err)); }
};

// ---------- lista kabli (patchlista): numeracja, długości, eksport CSV ----------
function openReport() {
  const ov = document.createElement('div'); ov.id = 'reportdialog';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  document.body.appendChild(ov);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const redraw = () => {
    const rows = patchList(store.state), noNum = rows.filter((r) => r.cableId && !r.number).length;
    ov.innerHTML = `<div class="dlg" style="width:1000px"><h2>Lista kabli</h2>
      <div class="imp">${rows.length} połączeń${noNum ? ` · <b class="warn">${noNum} kabli bez numeru</b>` : ''}</div>
      <div class="rwrap"><table class="rt"><thead><tr><th>Numer</th><th>Typ kabla</th><th>Z</th><th>Do</th><th>Sygnał</th><th>Długość [m]</th><th>Z magazynu [m]</th></tr></thead><tbody>${rows.map((r) => `<tr data-cab="${r.cableId ?? ''}">
        <td>${esc(r.number)}</td><td>${esc(starterRegistries[r.cableType]?.name ?? store.state.registries[r.cableType]?.name ?? r.cableType)}</td>
        <td>${esc(r.fromDevice)} · ${esc(r.fromPort)}</td><td>${esc(r.toDevice)} · ${esc(r.toPort)}</td><td>${esc(store.state.registries[r.signal]?.name ?? r.signal)}</td>
        <td>${r.lengthSource === 'estimated' ? '<i class="warn" title="oszacowana z planu">~</i> ' : ''}${r.cableId ? `<input class="f-len" type="number" min="0" step="0.5" value="${r.lengthMm !== undefined ? r.lengthMm / 1000 : ''}" aria-label="Długość w metrach">` : (r.medium === 'physical' ? '<span class="warn" title="Połączenie bez kabla: zaznacz je na schemacie i przypisz kabel">brak kabla</span>' : '—')}</td>
        <td>${r.stockLengthMm !== undefined ? r.stockLengthMm / 1000 : r.suggestedStockMm !== undefined ? `<i class="warn" title="propozycja do weryfikacji">${r.suggestedStockMm / 1000}?</i>` : ''}</td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<div class="none">Brak połączeń</div>'}</div>
      <div class="btns"><button id="r-num">Ponumeruj brakujące</button><button id="r-csv">Eksport CSV…</button><button id="r-pdf">Eksport PDF…</button><button id="r-close" class="primary">Zamknij</button></div></div>`;
    ov.querySelectorAll('.f-len').forEach((el) => {
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('change', () => {
        const inp = el as HTMLInputElement, cab = (inp.closest('tr') as HTMLElement).dataset.cab!, m = Number(inp.value);
        if (!inp.value || !(m >= 0)) return;
        store.dispatch('Ustaw długość kabla', cmd.setCableLengths(cab, { lengthMm: Math.round(m * 1000) })); redraw();
      });
    });
    ov.querySelector('#r-num')!.addEventListener('click', () => { store.dispatch('Numeruj kable', cmd.numberMissingCables()); redraw(); say('Nadano numery'); });
    ov.querySelector('#r-close')!.addEventListener('click', () => ov.remove());
    ov.querySelector('#r-pdf')!.addEventListener('click', async () => {
      if (!inTauri) { say('Eksport działa w aplikacji'); return; }
      try {
        const r = await buildCableListPdf();
        const target = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: exportName(store.state.name, 'lista-kabli', undefined, 'pdf') });
        if (!target) return;
        await invoke('save_autosave', { path: /\.pdf$/i.test(target) ? target : target + '.pdf', data: Array.from(r.bytes) });
        say(`Zapisano ${nameOf(target)} (${r.rows} połączeń, ${r.pages} str.)`);
      } catch (err) { say('Błąd eksportu PDF: ' + String(err)); }
    });
    ov.querySelector('#r-csv')!.addEventListener('click', async () => {
      if (!inTauri) { say('Eksport działa w aplikacji'); return; }
      try {
        const target = await saveDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: exportName(store.state.name, 'lista-kabli', undefined, 'csv') });
        if (!target) return;
        await invoke('save_autosave', { path: target, data: Array.from(new TextEncoder().encode(toCsv(patchList(store.state)))) });
        say('Zapisano ' + nameOf(target));
      } catch (e) { say('Błąd eksportu: ' + String(e)); }
    });
  };
  redraw();
}
document.getElementById('b-report')!.onclick = openReport;
(window as any).__editor.openReport = openReport;
(window as any).__editor.dl = () => dl.prims;
(window as any).__editor.edgeColor = (id: string) => edgeObj.get(id)?.stroke;
(window as any).__editor.edgeId = (n: number) => Object.keys(store.state.connections)[n];

// ---------- przełącznik Schemat / Plan sali ----------
planApi = createPlan({ store, W, H, say, changed: () => revalidate(), select: (id) => selectNode(id), selected: () => selectedNode });
{
  const b = document.getElementById('b-mode')!, br = document.getElementById('b-rack')!;
  const bc = document.getElementById('b-cab')!;
  v3Api = createView3d({ store, W, H, say, spaceId: () => planApi?.spaceId() });
  const b3 = document.getElementById('b-3d')!;
  const leave3d = () => { if (v3Api!.active) { v3Api!.hide(); planApi!.suspend(false); b3.textContent = 'Widok 3D'; } };
  b3.onclick = () => {
    if (v3Api!.active) { leave3d(); return; }
    v3Api!.show(); planApi!.suspend(true); b3.textContent = 'Widok 2D';
  };
  const chrome = () => { renderCatalog();
    if (!planApi!.active) leave3d();
    const on = planApi!.active || rackApi!.active || cabApi!.active;
    document.getElementById('help')!.style.display = on ? 'none' : '';
    document.getElementById('b-diagpdf')!.style.display = on ? 'none' : '';
    legendEl.style.display = on ? 'none' : '';
  };
  rackApi = createRack({ store, W, H, say, changed: () => revalidate(), ask });
  cabApi = createCabinet({ store, W, H, say, changed: () => revalidate(), ask });
  const leaveOthers = (keep: 'plan' | 'rack' | 'cab') => {
    if (keep !== 'plan' && planApi!.active) { planApi!.hide(); b.textContent = 'Plan sali'; }
    if (keep !== 'rack' && rackApi!.active) { rackApi!.hide(); br.textContent = 'Rack'; }
    if (keep !== 'cab' && cabApi!.active) { cabApi!.hide(); bc.textContent = 'Szafa'; }
  };
  br.onclick = () => {
    if (rackApi!.active) { rackApi!.hide(); br.textContent = 'Rack'; rebuild(); draw(); }
    else { leaveOthers('rack'); rackApi!.show(); br.textContent = 'Schemat'; }
    chrome(); selectNode(selectedNode);
  };
  bc.onclick = () => {
    if (cabApi!.active) { cabApi!.hide(); bc.textContent = 'Szafa'; rebuild(); draw(); }
    else { leaveOthers('cab'); cabApi!.show(); bc.textContent = 'Schemat'; }
    chrome(); selectNode(selectedNode);
  };
  b.onclick = () => {
    leaveOthers('plan');
    if (planApi!.active) { planApi!.hide(); b.textContent = 'Plan sali'; rebuild(); draw(); }
    else { planApi!.show(); b.textContent = 'Schemat'; }
    chrome();
    selectNode(selectedNode);
  };
  const groupUi = createGroupUi({ store, say, changed: () => { rebuild(); draw(); autosaver?.notify(); setTitle(); } });
  document.getElementById('b-groups')!.onclick = () => groupUi.open();
  const bdin = document.getElementById('b-din') as HTMLButtonElement, dinLabel = () => { const hide = !!(store.state.settings as { hideMountedDin?: boolean }).hideMountedDin; bdin.textContent = hide ? 'Osprzęt DIN: ukryty' : 'Osprzęt DIN: widoczny'; bdin.style.borderColor = hide ? '#FFD54F' : ''; };
  bdin.onclick = () => { const hide = !(store.state.settings as { hideMountedDin?: boolean }).hideMountedDin; store.dispatch(hide ? 'Ukryj osprzęt DIN na schemacie' : 'Pokaż osprzęt DIN na schemacie', setHideMountedDin(hide)); rebuild(); revalidate(); draw(); autosaver?.notify(); setTitle(); dinLabel(); say(hide ? 'Osprzęt zamontowany w szafach jest ukryty na schemacie' : 'Osprzęt z szaf jest widoczny na schemacie'); };
  dinLabel(); dinLabelRef = dinLabel;
  document.getElementById('b-layout')!.onclick = () => {
    if (!Object.keys(store.state.equipment).length) { say('Brak urządzeń do ułożenia'); return; }
    store.dispatch('Uporządkuj schemat', setNodePositions(autoLayout(store.state)));
    rebuild(); autosaver?.notify(); setTitle();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [id, n] of Object.entries(view.nodes)) { if (!store.state.equipment[id] && !store.state.cabinets?.[id]) continue; if (store.state.equipment[id] && hiddenOnDiagram(store.state, id)) continue; const [w, h] = nodeSize(store.state, id); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h); }
    if (isFinite(x0)) { cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2; cam.zoom = Math.min(1.2, Math.max(0.05, Math.min((W - 60) / (x1 - x0 + 120), (H - 140) / (y1 - y0 + 120)))); }
    draw(); say('Schemat uporządkowany od źródeł do odbiorników (Ctrl+Z cofa)');
  };
  window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight - 28;
  backend.resize(W, H); overlay.width = W; overlay.height = H;
  planApi?.resize(W, H); rackApi?.resize(W, H); cabApi?.resize(W, H); v3Api?.resize(W, H);
  draw();
});
(window as any).__editor.plan = planApi;
  (window as any).__editor.rack = rackApi;
  (window as any).__editor.cab = cabApi;
  (window as any).__editor.view3d = v3Api;
}

// ---------- lista uwag walidacji (klik w licznik na pasku) ----------
function openIssues() {
  const S = store.state, byCable = new Map<string, string>();
  for (const [cid, c] of Object.entries(S.connections)) if (c.cableId) byCable.set(c.cableId, cid);
  const nm = (id: string) => S.equipment[id]?.name ?? id;
  const where = (i: Issue): string => {
    const cid = S.connections[i.subject] ? i.subject : byCable.get(i.subject);
    if (cid) { const c = S.connections[cid]; return `${nm(c.from.instanceId)} → ${nm(c.to.instanceId)}`; }
    return S.equipment[i.subject] ? nm(i.subject) : i.subject;
  };
  const ov = document.createElement('div'); ov.id = 'issuesdialog';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  const rows = [...issueList].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  ov.innerHTML = `<div class="dlg" style="width:900px"><h2>Uwagi walidacji (${rows.length})</h2>
    <div class="rwrap">${rows.length ? `<table class="rt"><thead><tr><th>Waga</th><th>Reguła</th><th>Gdzie</th><th>Opis</th></tr></thead><tbody>${rows.map((i, n) => `<tr data-n="${n}" style="cursor:pointer"><td style="color:${i.level === 'error' ? '#E53935' : i.level === 'warning' ? '#FFD54F' : '#B0B0B0'}">${i.level === 'error' ? 'błąd' : i.level === 'warning' ? 'uwaga' : 'info'}</td><td>${i.ruleId}</td><td>${esc(where(i))}</td><td>${esc(i.message)}</td></tr>`).join('')}</tbody></table>` : '<div class="none">Brak uwag.</div>'}</div>
    <div class="btns"><button id="i-close" class="primary">Zamknij</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#i-close')!.addEventListener('click', () => ov.remove());
  ov.querySelectorAll('tr[data-n]').forEach((tr) => tr.addEventListener('click', () => {
    const i = rows[Number((tr as HTMLElement).dataset.n)], cid = S.connections[i.subject] ? i.subject : byCable.get(i.subject);
    ov.remove();
    if (v3Api?.active) { v3Api.hide(); planApi?.suspend(false); document.getElementById('b-3d')!.textContent = 'Widok 3D'; }
    if (planApi?.active) { planApi.hide(); document.getElementById('b-mode')!.textContent = 'Plan sali'; document.getElementById('help')!.style.display = ''; rebuild(); }
    if (cabApi?.active) { cabApi.hide(); document.getElementById('b-cab')!.textContent = 'Szafa'; document.getElementById('help')!.style.display = ''; document.getElementById('b-diagpdf')!.style.display = ''; rebuild(); }
    if (rackApi?.active) { rackApi.hide(); document.getElementById('b-rack')!.textContent = 'Rack'; document.getElementById('help')!.style.display = ''; document.getElementById('b-diagpdf')!.style.display = ''; rebuild(); }
    if (cid) { selectedEdge = cid; const m = edgePrim.get(cid); if (m && m.length >= 4) { cam.x = (m[0] + m[m.length - 2]) / 2; cam.y = (m[1] + m[m.length - 1]) / 2; } selectNode(undefined); }
    else if (S.equipment[i.subject] && view.nodes[i.subject]) { const n = view.nodes[i.subject]; cam.x = n.x + NODE_W / 2; cam.y = n.y + 40; selectNode(i.subject); }
    draw();
  }));
}
document.getElementById('stat')!.addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 'issues-link') { e.preventDefault(); openIssues(); } });

// ---------- układ pasków: drugi pasek pod pierwszym, a panele i kamera planu zaczynają się pod nimi (zmienna CSS --top) ----------
{
  const menu = document.getElementById('menu')!, pb = document.getElementById('planbar')!;
  const upd = () => {
    const mb = menu.getBoundingClientRect().bottom;
    pb.style.top = `${Math.round(mb) - 1}px`;
    const bottoms = [mb, ...(getComputedStyle(pb).display !== 'none' ? [pb.getBoundingClientRect().bottom] : [])];
    document.documentElement.style.setProperty('--top', `${Math.ceil(Math.max(...bottoms)) + 8}px`);
  };
  const ro = new ResizeObserver(upd); ro.observe(menu); ro.observe(pb); window.addEventListener('resize', upd); upd();
}
