// Widok 3D sali (ADR-053): obrót, przesuwanie, zoom, zaznaczanie brył; rysowanie na Canvas 2D (bez zależności i bez WebGL).
import type { Store } from '../src/store.ts';
import { newId } from '../src/ids.ts';
import { routeCmd } from '../src/routes.ts';
import { pickRoutePoint, type RoutePick } from '../src/view3d.ts';
import { buildScene, defaultCam, fitCam, clampCam, project, groundPoint, baseCorners, sortedFaces, pickBox, type Cam3, type Scene3, type Box3 } from '../src/view3d.ts';

export interface View3dCtx { store: Store; W: number; H: number; say(m: string): void; spaceId?(): string | undefined }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtM = (mm: number) => String(Math.round(mm / 10) / 100).replace('.', ',');
const KIND_PL: Record<string, string> = { equipment: 'Urządzenie', rack: 'Rack', cabinet: 'Szafa DIN', stage: 'Obiekt sceniczny' };
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16), c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function createView3d(ctx: View3dCtx) {
  const { store } = ctx; let W = ctx.W, H = ctx.H;
  const host = document.createElement('div'); host.id = 'view3d';
  host.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#0B0B0E;display:none`;
  document.body.insertBefore(host, document.getElementById('menu'));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'position:absolute;left:0;top:0;cursor:grab'; host.appendChild(cv);
  const g = cv.getContext('2d')!;
  const bar = document.createElement('div'); bar.id = 'v3bar';
  bar.style.cssText = 'position:absolute;left:252px;bottom:44px;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = `<button id="v3-fit">Dopasuj</button><button id="v3-top">Z góry</button><button id="v3-iso">Izometria</button>
    <button id="v3-routes" class="on">Trasy</button><button id="v3-links">Połączenia</button><button id="v3-labels" class="on">Etykiety</button><button id="v3-join">Połącz trasy</button>`;
  host.appendChild(bar);
  const info = document.createElement('div'); info.id = 'v3info';
  info.style.cssText = 'position:absolute;right:8px;top:calc(var(--top,62px) + 8px);width:250px;max-height:calc(100vh - var(--top,62px) - 56px);overflow-y:auto;background:rgba(18,18,18,.94);border:1px solid #2A2A2A;border-radius:8px;padding:12px;box-sizing:border-box;display:none;font-size:13px;color:#ddd';
  host.appendChild(info);
  const hint = document.createElement('div'); hint.style.cssText = 'position:absolute;right:8px;bottom:44px;font-size:12px;color:#8a8a8a;text-align:right;pointer-events:none';
  hint.textContent = 'przeciągnij = obrót · Shift/prawy przycisk = przesuń · kółko = zoom · klik = zaznacz'; host.appendChild(hint);
  const st = document.createElement('style');
  st.textContent = '#v3bar button{min-height:40px;padding:0 12px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff;font-size:14px;cursor:pointer}#v3bar button:hover{border-color:#00C853}#v3bar button.on{border-color:#00C853;color:#00C853}';
  document.head.appendChild(st);

  let active = false, scene: Scene3 = buildScene(store.state, ctx.spaceId?.()), cam: Cam3 = fitCam(scene, defaultCam(scene)), selected: string | undefined;
  const opt = { routes: true, links: false, labels: true };
  let joinMode = false, joinFrom: RoutePick | undefined, hover: RoutePick | undefined;
  type Drag = { mode: 'orbit' | 'pan'; sx: number; sy: number; cam: Cam3; moved: boolean };
  let drag: Drag | undefined;

  function rebuildScene() { scene = buildScene(store.state, ctx.spaceId?.()); if (selected && !scene.boxes.some((b) => b.id === selected)) selected = undefined; }

  function draw() {
    g.clearRect(0, 0, W, H); g.fillStyle = '#0B0B0E'; g.fillRect(0, 0, W, H);
    const P = (q: number[]) => project(cam, W, H, q);
    // podłoga (wg obrysu sali, także nieprostokątnego) z siatką 1 m przyciętą do obrysu
    const bnd = scene.boundary, floor = bnd.map((q) => P([q[0], q[1], 0]));
    if (floor.length >= 3 && floor.every(Boolean)) {
      g.save(); g.beginPath(); floor.forEach((q, i) => (i ? g.lineTo(q!.x, q!.y) : g.moveTo(q!.x, q!.y))); g.closePath(); g.fillStyle = '#14141A'; g.fill(); g.clip();
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.beginPath();
      for (let x = 1000; x < scene.w; x += 1000) { const a = P([x, 0, 0]), b = P([x, scene.d, 0]); if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } }
      for (let y = 1000; y < scene.d; y += 1000) { const a = P([0, y, 0]), b = P([scene.w, y, 0]); if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } }
      g.stroke(); g.restore();
      g.strokeStyle = '#3A3A44'; g.lineWidth = 2; g.beginPath(); floor.forEach((q, i) => (i ? g.lineTo(q!.x, q!.y) : g.moveTo(q!.x, q!.y))); g.closePath(); g.stroke();
    }
    // sufit: słupki w wierzchołkach i obrys (linie przerywane)
    if (scene.ceiling) {
      g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
      const top = bnd.map(([x, y]) => P([x, y, scene.ceiling!]));
      g.beginPath(); top.forEach((q, i) => { if (!q) return; i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); if (top.every(Boolean)) g.closePath(); g.stroke();
      bnd.forEach(([x, y], i) => { const a = P([x, y, 0]), b = top[i]; if (a && b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); } });
      g.setLineDash([]);
    }
    // bryły (ściany od najdalszej)
    const colorOf = new Map(scene.boxes.map((b) => [b.id, b.color]));
    for (const { face, poly } of sortedFaces(scene, cam, W, H)) {
      g.beginPath(); poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
      g.fillStyle = shade(colorOf.get(face.boxId) ?? '#555555', face.shade); g.fill();
      g.strokeStyle = face.boxId === selected ? '#00C853' : 'rgba(0,0,0,.55)'; g.lineWidth = face.boxId === selected ? 2 : 1; g.stroke();
    }
    // trasy i połączenia
    const line = (pts: number[][], color: string, lw: number, dash: number[] = []) => {
      g.strokeStyle = color; g.lineWidth = lw; g.setLineDash(dash); g.beginPath(); let started = false;
      for (const q of pts) { const p = P(q); if (!p) { started = false; continue; } if (started) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); started = true; } }
      g.stroke(); g.setLineDash([]);
    };
    if (opt.routes) for (const r of scene.routes) line(r.pts, '#26C6B0', 3);
    if (opt.links) for (const l of scene.links) l.method === 'route' ? line(l.pts, 'rgba(255,213,79,.9)', 2) : line(l.pts, 'rgba(255,213,79,.6)', 1.5, [5, 4]);
    if (joinMode) {
      const dot = (pk: RoutePick | undefined, color: string) => { const p = pk && P(pk.point); if (!p) return; g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, 7, 0, 7); g.fill(); g.stroke(); };
      if (joinFrom && hover) line([joinFrom.point, hover.point], '#FFD54F', 3, [6, 4]);
      dot(joinFrom, '#00C853'); dot(hover, '#FFD54F');
    }
    // etykiety: rack, szafa i zaznaczone zawsze; reszta przy włączonych etykietach (z unikaniem nakładania)
    if (opt.labels || selected) {
      g.font = '11px Roboto,Segoe UI,sans-serif'; const taken: number[][] = [];
      const order = [...scene.boxes].sort((a, b) => (a.id === selected ? -1 : b.id === selected ? 1 : (a.kind === 'equipment' ? 1 : 0) - (b.kind === 'equipment' ? 1 : 0)));
      for (const b of order) {
        if (!opt.labels && b.id !== selected) continue;
        if (b.total && b.step !== b.total.steps - 1) continue; // schody: jedna etykieta (przy najwyższym stopniu)
        const p = P([b.cx, b.cy, b.z0 + b.h]); if (!p) continue;
        const tw = g.measureText(b.name).width, r = [p.x - tw / 2 - 3, p.y - 22, p.x + tw / 2 + 3, p.y - 7];
        if (b.id !== selected && taken.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) continue;
        taken.push(r); g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        g.fillStyle = b.id === selected ? '#00C853' : b.kind === 'rack' ? '#FFD54F' : b.kind === 'cabinet' ? '#FF8A65' : '#fff'; g.fillText(b.name, p.x - tw / 2, p.y - 11);
      }
    }
    if (!scene.boxes.length) { g.fillStyle = '#8a8a8a'; g.font = '15px Roboto,sans-serif'; g.textAlign = 'center'; g.fillText(scene.spaceId ? 'Na planie sali nie ma jeszcze urządzeń, racków ani szaf.' : 'Brak sali. Dodaj ją w widoku planu („Sala…”).', W / 2, H / 2); g.textAlign = 'start'; }
  }

  function renderInfo() {
    const b0 = selected ? scene.boxes.filter((x) => x.id === selected) : [], top = b0.reduce<Box3 | undefined>((m, x) => (!m || x.h > m.h ? x : m), undefined);
    const b = top && top.total ? { ...top, ...top.total, h: top.total.h } : top; // schody: wymiary i środek całego obiektu
    if (!b) { info.style.display = 'none'; return; }
    info.style.display = 'block';
    info.innerHTML = `<div style="font-size:11px;color:#00C853;text-transform:uppercase;letter-spacing:.04em">${KIND_PL[b.kind]}</div>
      <div style="font-size:15px;color:#fff;margin:2px 0 6px">${esc(b.name)}</div><div style="color:#B0B0B0">${esc(b.detail)}</div>
      <div style="margin-top:8px">${fmtM(b.w)} × ${fmtM(b.d)} × ${fmtM(b.h)} m<br>X ${fmtM(b.cx)} · Y ${fmtM(b.cy)} · wysokość podstawy ${fmtM(b.z0)} m<br>obrót ${b.rotDeg}°</div>`;
  }
  function refresh() { if (!active) return; rebuildScene(); renderInfo(); draw(); }

  // ---------- mysz ----------
  const pos = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousedown', (e) => {
    const p = pos(e); drag = { mode: e.button === 2 || e.shiftKey || e.button === 1 ? 'pan' : 'orbit', sx: p.x, sy: p.y, cam: { ...cam }, moved: false }; cv.style.cursor = 'grabbing';
  });
  function setJoin(on: boolean) {
    joinMode = on; joinFrom = undefined; hover = undefined; q('v3-join').classList.toggle('on', on); q('v3-join').textContent = on ? 'Połącz trasy: kliknij 1. trasę' : 'Połącz trasy';
    cv.style.cursor = on ? 'crosshair' : 'grab'; draw();
  }
  function joinClick(p: { x: number; y: number }) {
    const pk = pickRoutePoint(scene, cam, W, H, p.x, p.y);
    if (!pk) { ctx.say('Kliknij w linię trasy (turkusową)'); return; }
    if (!joinFrom) { joinFrom = pk; q('v3-join').textContent = 'Połącz trasy: kliknij 2. trasę'; draw(); return; }
    if (pk.routeId === joinFrom.routeId) { ctx.say('Wybierz punkt na innej trasie'); return; }
    if (!scene.spaceId) return;
    const a = joinFrom, n = scene.routes.length + 1;
    try { store.dispatch('Połącz trasy pionem', routeCmd.addRoute(scene.spaceId, newId('rte'), `Pion ${n}`, [a.point, pk.point])); }
    catch (err) { ctx.say(String((err as Error).message)); return; }
    ctx.say(`Połączono trasy „${a.name}” i „${pk.name}” (odcinek ${fmtM(Math.hypot(...a.point.map((v, k) => v - pk.point[k])))} m)`);
    refresh(); setJoin(false);
  }
  window.addEventListener('mousemove', (e) => {
    if (active && joinMode && !drag) { const p = pos(e); const h = pickRoutePoint(scene, cam, W, H, p.x, p.y); if (h?.point.join() !== hover?.point.join()) { hover = h; draw(); } }
    if (!active || !drag) return; const p = pos(e), dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true; if (!drag.moved) return;
    if (drag.mode === 'orbit') cam = clampCam({ ...drag.cam, yaw: drag.cam.yaw - dx * 0.008, pitch: drag.cam.pitch + dy * 0.006 });
    else {
      const a = groundPoint(drag.cam, W, H, drag.sx, drag.sy), b = groundPoint(drag.cam, W, H, p.x, p.y);
      if (a && b) cam = { ...drag.cam, tx: drag.cam.tx - (b[0] - a[0]), ty: drag.cam.ty - (b[1] - a[1]) };
    }
    draw();
  });
  window.addEventListener('mouseup', (e) => {
    if (!active || !drag) return; const d = drag; drag = undefined; cv.style.cursor = 'grab';
    if (!d.moved && e.button === 0 && joinMode) { joinClick(pos(e)); return; }
    if (!d.moved && e.button === 0) { const p = pos(e); selected = pickBox(scene, cam, W, H, p.x, p.y); renderInfo(); draw(); }
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam = clampCam({ ...cam, dist: cam.dist * Math.exp(e.deltaY * 0.0012) }); draw(); }, { passive: false });
  window.addEventListener('keydown', (e) => { if (active && e.key === 'Escape' && joinMode) { setJoin(false); return; } if (active && e.key === 'Escape') { selected = undefined; renderInfo(); draw(); } });

  const q = (id: string) => bar.querySelector('#' + id) as HTMLButtonElement;
  q('v3-join').onclick = () => setJoin(!joinMode);
  q('v3-fit').onclick = () => { cam = fitCam(scene, cam); draw(); };
  q('v3-top').onclick = () => { cam = clampCam({ ...fitCam(scene, cam), pitch: 1.5, yaw: -Math.PI / 2 }); draw(); };
  q('v3-iso').onclick = () => { cam = fitCam(scene, { ...defaultCam(scene) }); draw(); };
  for (const [id, key] of [['v3-routes', 'routes'], ['v3-links', 'links'], ['v3-labels', 'labels']] as const) q(id).onclick = () => { opt[key] = !opt[key]; q(id).classList.toggle('on', opt[key]); draw(); };

  return {
    resize(w: number, h: number) { W = w; H = h; host.style.width = w + 'px'; host.style.height = h + 'px'; cv.width = w; cv.height = h; if (active) draw(); },
    get active() { return active; },
    show() { active = true; host.style.display = 'block'; rebuildScene(); cam = fitCam(scene, cam); renderInfo(); draw(); },
    hide() { active = false; if (joinMode) setJoin(false); drag = undefined; host.style.display = 'none'; },
    refresh,
    selected: () => selected,
    scene: () => scene,
    camera: () => ({ ...cam }),
    setCamera: (c: Partial<Cam3>) => { cam = clampCam({ ...cam, ...c }); draw(); },
    /** Do testów: punkt na ekranie, w którym widać środek góry bryły. */
    boxScreen(id: string): [number, number] | undefined { const b: Box3 | undefined = scene.boxes.find((x) => x.id === id); if (!b) return undefined; const p = project(cam, W, H, [b.cx, b.cy, b.z0 + b.h]); return p ? [p.x, p.y] : undefined; },
    /** Do testów: punkt 3D na ekranie. */
    pointScreen(pt: number[]): [number, number] | undefined { const p = project(cam, W, H, pt); return p ? [p.x, p.y] : undefined; },
    cornersOf: (id: string) => { const b = scene.boxes.find((x) => x.id === id); return b ? baseCorners(b) : undefined; },
  };
}
