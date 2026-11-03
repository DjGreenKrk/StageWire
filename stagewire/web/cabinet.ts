// Widok szafy / rozdzielnicy na szynę DIN: osprzęt układany na szynach, opinanie portów przewodami, terminale szafy.
import { exportName } from './exportName.ts';
import type { Store, Mutator } from '../src/store.ts';
import type { Project } from '../src/types.ts';
import { cabCmd, cabinetContents, cabinetTotals, cabinetWiring, dinFit, dinProblem, firstFreeDin, layerOf, newCabinetId, CABINET_PRESETS, MODULE_MM, type Cabinet, type DinMount, type PlateMount } from '../src/cabinets.ts';
import { catalogEnclosures } from '../src/catalog/index.ts';
import { cmd } from '../src/commands.ts';
import { cabinetPdf } from '../src/cabinetPdf.ts';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import latinUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import latinExtUrl from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url';

export interface CabinetCtx {
  store: Store; W: number; H: number;
  say(m: string): void;
  changed(): void;
  ask(title: string, text: string, buttons: [string, string][]): Promise<string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const COLORS: Record<string, string> = { wideo: '#2b5d8a', audio: '#8a4b2b', 'sieć': '#2b7a5d', 'oświetlenie': '#8a7a2b', sterowanie: '#5d2b8a', zasilanie: '#8a2b3f' };
const colorOf = (cat: string) => COLORS[cat.split('/')[0].trim().toLowerCase()] ?? '#4a4a5a';
const LEFT0 = 262, TOP = 150, PAD = 14;
type PRef = { instanceId: string; portId: string };

export function createCabinet(ctx: CabinetCtx) {
  const { store } = ctx; let W = ctx.W, H = ctx.H;
  const host = document.createElement('div'); host.id = 'cabview';
  host.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#0E0E0E;display:none`;
  document.body.insertBefore(host, document.getElementById('menu'));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'position:absolute;left:0;top:0'; host.appendChild(cv);
  const g = cv.getContext('2d')!;
  const bar = document.createElement('div'); bar.id = 'cabbar';
  bar.style.cssText = 'position:absolute;left:252px;top:var(--top,62px);display:flex;gap:6px;align-items:center';
  bar.innerHTML = `<select id="cb-sel" style="min-height:44px;min-width:200px;padding:0 8px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff;font-size:14px"></select>
    <button id="cb-new">Nowa szafa…</button><button id="cb-edit">Zmień…</button><button id="cb-block" title="Na schemacie blokowym szafa jest jednym blokiem z samymi terminalami">Schemat: osprzęt</button><button id="cb-pdf">PDF…</button>`;
  host.appendChild(bar);
  const panel = document.createElement('div'); panel.id = 'cabpanel';
  panel.style.cssText = 'position:absolute;right:8px;top:var(--top,62px);bottom:36px;width:270px;overflow:auto;background:rgba(18,18,18,.94);border:1px solid #2A2A2A;border-radius:8px;padding:12px;box-sizing:border-box';
  host.appendChild(panel);
  const st = document.createElement('style');
  st.textContent = '#cabbar button,#cabpanel button{min-height:44px;padding:0 12px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff;font-size:14px;cursor:pointer}#cabbar button:hover,#cabpanel button:hover{border-color:#00C853}#cabpanel h3{margin:12px 0 6px;font-size:11px;font-weight:500;color:#00C853;text-transform:uppercase;letter-spacing:.04em}#cabpanel h3:first-child{margin-top:0}#cabpanel .meta{font-size:12px;color:#B0B0B0;margin-bottom:6px}#cabpanel .li{display:flex;flex-direction:column;align-items:flex-start;width:100%;margin:0 0 4px;text-align:left}#cabpanel .li small{color:#B0B0B0;font-size:11px}#cabpanel .li.sel{border-color:#00C853}#cabpanel .pr{display:flex;align-items:center;gap:6px;font-size:12px;color:#ddd;margin:2px 0}#cabpanel .pr label{display:flex;align-items:center;gap:4px;margin-left:auto;color:#B0B0B0;white-space:nowrap}#cabpanel .pr input{width:18px;height:18px}';
  document.head.appendChild(st);

  let active = false, cabId: string | undefined, selected: string | undefined, wireFrom: PRef | undefined, selWire: string | undefined, hover: PRef | undefined;
  type Drag = { id: string; grab: number; fromList: boolean; sx: number; sy: number; x: number; y: number; moved: boolean };
  let drag: Drag | undefined;

  const S = (): Project => store.state;
  const cabs = () => Object.entries(S().cabinets ?? {}) as [string, Cabinet][];
  const cur = (): Cabinet | undefined => (cabId ? (S().cabinets?.[cabId] as Cabinet | undefined) : undefined);
  const nameOf = (id: string) => S().equipment[id]?.name ?? id;
  const revOf = (id: string) => { const i = S().equipment[id]; return i && S().definitions[i.definitionId]?.revisions[String(i.definitionRevision)]; };
  const sigColor = (k: string) => (S().registries[k]?.color as string | undefined) ?? '#9AA0A6';

  // ---------- geometria ----------
  const geo = () => {
    const cab = cur(), rows = cab?.rows ?? 1, mods = cab?.modules ?? 1;
    const avail = W - LEFT0 - 290 - 2 * PAD;
    const pxMod = Math.max(8, Math.min(30, Math.floor(avail / mods)));
    const pxRow = Math.max(70, Math.min(130, Math.floor((H - 36 - TOP - 2 * PAD) / rows)));
    const x0 = LEFT0 + Math.round((avail - mods * pxMod) / 2) + PAD;
    return { rows, mods, pxMod, pxRow, x0, bw: mods * pxMod, bh: rows * pxRow };
  };
  const devH = (gm = geo()) => Math.round(gm.pxRow * 0.42);
  const rowTop = (row: number, gm = geo()) => TOP + (row - 1) * gm.pxRow;
  const devY = (row: number, gm = geo()) => rowTop(row, gm) + Math.round((gm.pxRow - devH(gm)) / 2);
  const devRect = (o: { din: DinMount; modules: number }, gm = geo()) => ({ x: gm.x0 + (o.din.at - 1) * gm.pxMod + 1, y: devY(o.din.row, gm), w: o.modules * gm.pxMod - 2, h: devH(gm) });
  function cell(x: number, y: number): { row: number; at: number } | null {
    const gm = geo(), row = Math.floor((y - TOP) / gm.pxRow) + 1, at = Math.floor((x - gm.x0) / gm.pxMod) + 1;
    if (row < 1 || row > gm.rows || at < 1 || at > gm.mods) return null;
    return { row, at };
  }
  /** Porty urządzenia na krawędziach bloku: wejścia u góry, wyjścia u dołu. */
  function portDots(id: string, r: { x: number; y: number; w: number; h: number }) {
    const rev = revOf(id); if (!rev) return [];
    const all = Object.entries(rev.ports).sort((a, b) => a[1].order - b[1].order);
    const top = all.filter(([, p]) => p.direction === 'in' || p.direction === 'io'), bot = all.filter(([, p]) => !(p.direction === 'in' || p.direction === 'io'));
    const place = (list: typeof all, y: number, side: 't' | 'b') => list.map(([pid, p], i) => ({ ref: { instanceId: id, portId: pid } as PRef, label: p.label, x: r.x + ((i + 0.5) / list.length) * r.w, y, side, signals: p.signalKeys as string[] }));
    return [...place(top, r.y, 't'), ...place(bot, r.y + r.h, 'b')];
  }
  /** Grzebień/mostek (warstwa `busbar`) rysuje się jako cienki pasek nad aparatami; aparat jako blok na szynie. */
  const BAR_H = 9;
  const rectOf = (o: { din: DinMount; modules: number; layer?: string }, gm = geo()) => { const r = devRect(o, gm); return o.layer === 'busbar' ? { x: r.x, y: r.y - BAR_H - 1, w: r.w, h: BAR_H } : r; };
  const trackColor = (t?: string) => ({ L1: '#8D6E63', L2: '#212121', L3: '#9E9E9E', N: '#1E88E5', PE: '#43A047' } as Record<string, string>)[t ?? ''] ?? '#FFB300';
  const dotsAll = () => { if (!cabId) return []; return cabinetContents(S(), cabId).filter((o) => o.layer !== 'busbar').flatMap((o) => portDots(o.id, devRect(o))); };
  const same = (a?: PRef, b?: PRef) => !!a && !!b && a.instanceId === b.instanceId && a.portId === b.portId;
  const isTerminal = (r: PRef) => !!cur()?.terminals?.some((t) => same(t, r));
  const groupOf = (r: PRef) => cur()?.terminals?.find((t) => same(t, r))?.group;
  const connsOf = (r: PRef) => Object.entries(S().connections).filter(([, c]) => same(c.from, r) || same(c.to, r));

  // ---------- rysowanie ----------
  type Wire = { id: string; pts: number[][]; color: string; ext: boolean };
  function wires(): Wire[] {
    if (!cabId) return [];
    const dots = dotsAll(), find = (r: PRef) => dots.find((d) => same(d.ref, r)), out: Wire[] = [], lane = new Map<string, number>();
    const w = cabinetWiring(S(), cabId);
    for (const cid of [...w.internal, ...w.external]) {
      const c = S().connections[cid], a = find(c.from), b = find(c.to), color = sigColor(c.signalKey);
      if (a && b) {
        const key = `${Math.round(a.y)}${a.side}`, k = lane.get(key) ?? 0; lane.set(key, k + 1);
        const cy = a.y + (a.side === 't' ? -1 : 1) * (12 + k * 5);
        out.push({ id: cid, pts: [[a.x, a.y], [a.x, cy], [b.x, cy], [b.x, b.y]], color, ext: false });
      } else {
        const d = a ?? b!; out.push({ id: cid, pts: [[d.x, d.y], [d.x, d.y + (d.side === 't' ? -26 : 26)]], color, ext: true });
      }
    }
    return out;
  }
  function draw() {
    g.clearRect(0, 0, W, H); g.fillStyle = '#0E0E0E'; g.fillRect(0, 0, W, H);
    const cab = cur();
    if (!cab || !cabId) {
      g.fillStyle = '#B0B0B0'; g.font = '16px Roboto,sans-serif'; g.textAlign = 'center';
      g.fillText(cabs().length ? 'Wybierz szafę z listy' : 'Brak szaf. Kliknij „Nowa szafa…”, aby zacząć', (LEFT0 + W - 290) / 2, H / 2); g.textAlign = 'left'; return;
    }
    const gm = geo();
    g.fillStyle = '#E0E0E0'; g.font = '500 15px Roboto,sans-serif'; g.textAlign = 'center';
    g.fillText(`${cab.name} · ${cab.widthMm} × ${cab.heightMm}${cab.depthMm ? ' × ' + cab.depthMm : ''} mm · ${cab.rows} × ${cab.modules} mod.`, gm.x0 + gm.bw / 2, TOP - 28); g.textAlign = 'left';
    g.fillStyle = '#151515'; g.fillRect(gm.x0 - PAD, TOP - PAD, gm.bw + 2 * PAD, gm.bh + 2 * PAD); g.strokeStyle = '#3A3A3A'; g.lineWidth = 2; g.strokeRect(gm.x0 - PAD, TOP - PAD, gm.bw + 2 * PAD, gm.bh + 2 * PAD);
    for (let r = 1; r <= gm.rows; r++) {
      const y = devY(r, gm), h = devH(gm);
      g.fillStyle = '#9AA0A6'; g.fillRect(gm.x0, y + h / 2 - 5, gm.bw, 10); // szyna DIN
      g.strokeStyle = '#1F1F1F'; g.lineWidth = 1;
      for (let m = 0; m <= gm.mods; m++) { const x = gm.x0 + m * gm.pxMod + 0.5; g.beginPath(); g.moveTo(x, y + h / 2 - 5); g.lineTo(x, y + h / 2 + 5); g.stroke(); }
      g.fillStyle = '#6A6A6A'; g.font = '10px Roboto,sans-serif'; g.fillText(String(r), gm.x0 - PAD + 2, y + h / 2 + 3);
    }
    const contents = cabinetContents(S(), cabId);
    for (const o of contents) {
      const r = rectOf(o, gm), rev = revOf(o.id), isDrag = drag?.id === o.id && drag.moved;
      if (o.layer === 'busbar') { // pasek grzebienia: ząb w kolorze toru nad modułem, na którym leży
        g.globalAlpha = isDrag ? 0.35 : 1; g.fillStyle = '#2B2B2B'; g.fillRect(r.x, r.y, r.w, r.h);
        for (const q of Object.values(rev?.ports ?? {})) { const tm = (q as { terminal?: { at?: number; track?: string } }).terminal; if (!tm || tm.at === undefined) continue; g.fillStyle = trackColor(tm.track); g.fillRect(r.x + Math.floor(tm.at) * gm.pxMod + 1, r.y + 1, Math.max(2, gm.pxMod - 3), r.h - 2); }
        g.strokeStyle = selected === o.id ? '#00C853' : '#00000088'; g.lineWidth = selected === o.id ? 2 : 1; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); g.globalAlpha = 1; continue;
      }
      g.globalAlpha = isDrag ? 0.35 : 1; g.fillStyle = colorOf(rev?.category ?? ''); g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = selected === o.id ? '#00C853' : '#00000088'; g.lineWidth = selected === o.id ? 2 : 1; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      g.fillStyle = '#FFFFFF'; g.font = '500 11px Roboto,sans-serif';
      if (r.w >= 40) { const t = fitText(nameOf(o.id), r.w - 6); g.fillText(t, r.x + 3, r.y + r.h / 2 + 4); }
      else { g.save(); g.translate(r.x + r.w / 2 + 4, r.y + r.h - 4); g.rotate(-Math.PI / 2); g.font = '500 10px Roboto,sans-serif'; g.fillText(fitText(nameOf(o.id), r.h - 8), 0, 0); g.restore(); }
      g.globalAlpha = 1;
    }
    // przewody
    for (const w of wires()) {
      g.strokeStyle = w.color; g.lineWidth = selWire === w.id ? 4 : 2; g.beginPath(); w.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      if (w.ext) { const [a, b] = [w.pts[0], w.pts[1]]; g.fillStyle = w.color; g.beginPath(); g.moveTo(b[0] - 4, b[1] + (b[1] < a[1] ? 2 : -2)); g.lineTo(b[0] + 4, b[1] + (b[1] < a[1] ? 2 : -2)); g.lineTo(b[0], b[1] + (b[1] < a[1] ? -5 : 5)); g.fill(); }
    }
    // porty i terminale
    for (const d of dotsAll()) {
      const term = isTerminal(d.ref), sel = same(wireFrom, d.ref), hov = same(hover, d.ref);
      g.beginPath(); g.arc(d.x, d.y, term ? 6 : hov || sel ? 5 : 3.5, 0, 6.2832);
      g.fillStyle = sel ? '#00C853' : connsOf(d.ref).length ? '#FFFFFF' : '#0E0E0E'; g.fill(); g.lineWidth = term ? 3 : 1.5; g.strokeStyle = term ? '#FFD54F' : '#E0E0E0'; g.stroke();
      if (hov || sel) { g.fillStyle = '#FFFFFF'; g.font = '11px Roboto,sans-serif'; const t = `${nameOf(d.ref.instanceId)} · ${d.label}`, tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(d.x - tw / 2 - 3, d.y + (d.side === 't' ? -30 : 14), tw + 6, 16); g.fillStyle = '#FFF'; g.fillText(t, d.x - tw / 2, d.y + (d.side === 't' ? -18 : 26)); }
      else if (term) { g.fillStyle = '#FFD54F'; g.font = '10px Roboto,sans-serif'; const gr = groupOf(d.ref); g.fillText(fitText(gr ? `${gr}: ${d.label}` : d.label, 70), d.x - 10, d.y + (d.side === 't' ? -10 : 18)); }
    }
    if (wireFrom) { const d = dotsAll().find((x) => same(x.ref, wireFrom)); if (d && hoverPos) { g.strokeStyle = '#00C853'; g.setLineDash([5, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(hoverPos.x, hoverPos.y); g.stroke(); g.setLineDash([]); } }
    if (drag?.moved) {
      const t = dragTarget(drag), mod = dinFit(S(), drag.id);
      if (t && mod !== undefined) {
        const bad = dinProblem(S(), drag.id, t), r = rectOf({ din: t, modules: mod, layer: layerOf(S(), drag.id) }, gm);
        g.fillStyle = bad ? '#E5393555' : '#00C85344'; g.fillRect(r.x, r.y, r.w, r.h); g.strokeStyle = bad ? '#E53935' : '#00C853'; g.lineWidth = 2; g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
      g.fillStyle = '#FFFFFF'; g.font = '12px Roboto,sans-serif'; g.fillText(nameOf(drag.id), drag.x + 12, drag.y - 8);
    }
  }
  let hoverPos: { x: number; y: number } | undefined;
  function fitText(s: string, maxPx: number): string {
    if (maxPx <= 8) return ''; if (g.measureText(s).width <= maxPx) return s;
    let t = s; while (t.length > 1 && g.measureText(t + '…').width > maxPx) t = t.slice(0, -1); return t + '…';
  }
  function dragTarget(d: Drag): DinMount | null {
    const c = cell(d.x, d.y); if (!c || !cabId) return null;
    return { cabinetId: cabId, row: c.row, at: Math.max(1, c.at - d.grab) };
  }

  // ---------- panel ----------
  function renderBar() {
    const sel = bar.querySelector('#cb-sel') as HTMLSelectElement;
    sel.innerHTML = cabs().map(([id, c]) => `<option value="${id}"${id === cabId ? ' selected' : ''}>${esc(c.name)} (${c.rows}×${c.modules})</option>`).join('') || '<option value="">(brak szaf)</option>';
    (bar.querySelector('#cb-edit') as HTMLButtonElement).disabled = !cabs().length;
    const bb = bar.querySelector('#cb-block') as HTMLButtonElement; bb.disabled = !cabs().length; (bar.querySelector('#cb-pdf') as HTMLButtonElement).disabled = !cabs().length; bb.textContent = cur()?.asBlock ? 'Schemat: blok' : 'Schemat: osprzęt'; bb.style.borderColor = cur()?.asBlock ? '#FFD54F' : '';
  }
  /** Kolejne wolne miejsce na płycie: schodkowo od lewego górnego rogu (położenie można potem poprawić w danych). */
  function nextPlateSpot(cid: string): PlateMount { const n = Object.values(S().equipment).filter((i) => (i.plate as PlateMount | undefined)?.cabinetId === cid).length; return { cabinetId: cid, x: 20 + (n % 8) * 40, y: 20 + Math.floor(n / 8) * 60 }; }
  function renderPanel() {
    const cab = cur();
    if (!cab || !cabId) { panel.innerHTML = '<h3>Szafa</h3><div class="meta">Utwórz szafę lub rozdzielnicę (rzędy szyn DIN, moduły po 17,5 mm), a potem przeciągaj do niej osprzęt, który ma szerokość w modułach.</div>'; return; }
    const t = cabinetTotals(S(), cabId), w = cabinetWiring(S(), cabId), sel = selected ? S().equipment[selected] : undefined, sm = sel?.din as DinMount | undefined;
    const showAll = !(document.getElementById('cat-fit-cb') as HTMLInputElement | null)?.checked;
    const free = Object.entries(S().equipment).filter(([id, i]) => !i.din && !i.plate && (dinFit(S(), id) !== undefined || showAll));
    const onPlate = Object.entries(S().equipment).filter(([, i]) => (i.plate as PlateMount | undefined)?.cabinetId === cabId);
    const li = (id: string) => { const r = revOf(id); return `<button class="li${selected === id ? ' sel' : ''}" data-un="${id}"><span>${esc(nameOf(id))}</span><small>${esc(r ? `${r.manufacturer} ${r.model}` : '')} · ${dinFit(S(), id) !== undefined ? dinFit(S(), id) + ' mod.' : 'bez DIN'}</small></button>`; };
    const portsHtml = selected && sm ? Object.entries(revOf(selected)?.ports ?? {}).sort((a, b) => a[1].order - b[1].order).map(([pid, p]) => {
      const ref = { instanceId: selected!, portId: pid }, n = connsOf(ref).length;
      return `<div class="pr"><span>${esc(p.label)}</span><small style="color:#888">${n ? n + ' pol.' : ''}</small><label title="Terminal szafy: wchodzi lub wychodzi poza szafę"><input type="checkbox" data-term="${pid}"${isTerminal(ref) ? ' checked' : ''}>terminal</label></div>${isTerminal(ref) ? `<div class="pr" style="margin-left:12px"><input data-grp="${pid}" list="cb-groups" placeholder="grupa (np. 230 V, DMX)" value="${esc(groupOf(ref) ?? '')}" style="flex:1;width:auto;height:32px;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#fff;padding:0 6px"></div>` : ''}`;
    }).join('') : '';
    const wsel = selWire ? S().connections[selWire] : undefined;
    const groups = [...new Set((cab.terminals ?? []).map((x) => x.group).filter(Boolean))] as string[];
    panel.innerHTML = `<datalist id="cb-groups">${groups.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><h3>${esc(cab.name)}</h3>
      <div class="meta">${cab.mount ? `W racku „${esc(S().racks?.[cab.mount.rackId]?.name ?? '?')}” od U${cab.mount.uStart}<br>` : cab.rackUnits ? `Moduł do racka ${cab.rackUnits.heightU} U (ustaw w widoku Rack)<br>` : ''}${cab.widthMm} × ${cab.heightMm}${cab.depthMm ? ' × ' + cab.depthMm : ''} mm · ${cab.rows} szyn × ${cab.modules} mod. (${fmt(cab.modules * MODULE_MM)} mm)${cab.notes ? '<br>' + esc(cab.notes) : ''}</div>
      <div id="cb-tot" class="meta">Zajęte ${t.usedModules} z ${cab.rows * cab.modules} mod. · wolne ${t.freeModules}<br>Masa: ${fmt(t.weightKg)} kg${t.weightUnknown ? ` (+${t.weightUnknown} bez danych)` : ''}<br>Pobór: ${fmt(t.powerW)} W${t.powerUnknown ? ` (+${t.powerUnknown} bez danych)` : ''}<br>Przewody: ${w.internal.length} wewnętrznych, ${w.external.length} wychodzących · terminali: ${cab.terminals?.length ?? 0}</div>
      ${wsel && selWire ? `<h3>Przewód</h3><div class="meta">${esc(nameOf(wsel.from.instanceId))} → ${esc(nameOf(wsel.to.instanceId))}<br>${esc(S().registries[wsel.signalKey]?.name ?? wsel.signalKey)}</div><button id="cb-delw" class="danger">Usuń przewód</button>` : ''}
      ${sel && selected ? `<h3>Zaznaczone</h3><div class="meta"><b style="color:#fff">${esc(sel.name)}</b><br>${sm ? `szyna ${sm.row}, pozycja ${sm.at}${(dinFit(S(), selected) ?? 1) > 1 ? '–' + (sm.at + (dinFit(S(), selected) ?? 1) - 1) : ''}` : 'poza szafą'}</div>
        ${sm ? `<button id="cb-un">Zdejmij z szyny</button><div class="meta" style="margin-top:8px">Porty: zaznacz terminale (wejścia/wyjścia szafy). Terminale o tej samej nazwie grupy (np. „230 V”: L, N, PE, także z różnych urządzeń) są jednym portem bloku na schemacie. Opinanie: kliknij kropkę portu, potem drugi port.</div>${portsHtml}` : '<button id="cb-auto" class="primary">Zamontuj w pierwszym wolnym</button>'}` : ''}
      ${onPlate.length ? `<h3>Na płycie montażowej (${onPlate.length})</h3>${onPlate.map(([id, i]) => `<button class="li${selected === id ? ' sel' : ''}" data-un="${id}"><span>${esc(i.name)}</span><small>x ${(i.plate as PlateMount).x}, y ${(i.plate as PlateMount).y} mm</small></button>`).join('')}` : ''}
      ${sel && selected && !sm && dinFit(S(), selected) === undefined && !(sel.plate) ? '<button id="cb-plate" class="primary">Przykręć do płyty montażowej</button>' : ''}${sel && selected && sel.plate ? '<button id="cb-unplate">Zdejmij z płyty</button>' : ''}
      <h3>Poza szafą (${free.length})</h3>
      ${free.length ? `<div class="meta">Przeciągnij na szynę albo kliknij i użyj przycisku.</div>${free.map(([id]) => li(id)).join('')}` : '<div class="meta">Cały osprzęt DIN jest zamontowany.</div>'}`;
    panel.querySelector('#cb-un')?.addEventListener('click', () => dispatch('Zdejmij z szyny', cabCmd.unmount(selected!)));
    panel.querySelector('#cb-plate')?.addEventListener('click', () => dispatch('Przykręć do płyty', cabCmd.mountPlate(selected!, nextPlateSpot(cabId!))));
    panel.querySelector('#cb-unplate')?.addEventListener('click', () => dispatch('Zdejmij z płyty', cabCmd.unmount(selected!)));
    panel.querySelector('#cb-auto')?.addEventListener('click', () => { const m = selected && cabId ? firstFreeDin(S(), selected, cabId) : undefined; if (!m) { ctx.say('W tej szafie nie ma wolnego miejsca dla tego urządzenia'); return; } dispatch('Zamontuj na szynie', cabCmd.mount(selected!, m)); });
    panel.querySelector('#cb-delw')?.addEventListener('click', () => { const id = selWire!; selWire = undefined; dispatch('Usuń przewód', cmd.disconnect(id)); });
    for (const gi of panel.querySelectorAll<HTMLInputElement>('[data-grp]')) {
      gi.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') gi.blur(); });
      gi.addEventListener('change', () => dispatch('Grupa terminala', cabCmd.setTerminal(cabId!, { instanceId: selected!, portId: gi.dataset.grp! }, true, gi.value.trim() || null)));
    }
    for (const cb of panel.querySelectorAll<HTMLInputElement>('[data-term]')) cb.addEventListener('change', () => dispatch(cb.checked ? 'Terminal szafy' : 'Zdejmij terminal', cabCmd.setTerminal(cabId!, { instanceId: selected!, portId: cb.dataset.term! }, cb.checked)));
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-un]')) {
      b.addEventListener('click', () => { selected = b.dataset.un; refresh(); });
      b.addEventListener('mousedown', (e) => { if (e.button !== 0) return; selected = b.dataset.un; drag = { id: selected!, grab: 0, fromList: true, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false }; });
    }
  }
  function refresh() {
    if (!active) return; if (cabId && !cur()) cabId = undefined; if (!cabId) cabId = cabs()[0]?.[0];
    if (selected && !S().equipment[selected]) selected = undefined; if (selWire && !S().connections[selWire]) selWire = undefined;
    renderBar(); renderPanel(); draw();
  }
  function dispatch(label: string, m: Mutator): boolean {
    try { store.dispatch(label, m); ctx.changed(); refresh(); return true; } catch (e) { ctx.say(String((e as Error).message)); refresh(); return false; }
  }

  // ---------- opinanie ----------
  function connectPorts(a: PRef, b: PRef) {
    const pa = revOf(a.instanceId)?.ports[a.portId], pb = revOf(b.instanceId)?.ports[b.portId]; if (!pa || !pb) return;
    const src = (d: string) => d === 'out' || d === 'io' || d === 'loop', snk = (d: string) => d === 'in' || d === 'io';
    let from = a, to = b, fp = pa, tp = pb;
    if (!(src(pa.direction) && snk(pb.direction))) { if (src(pb.direction) && snk(pa.direction)) { from = b; to = a; fp = pb; tp = pa; } else { ctx.say(`Kierunki portów nie pasują (${pa.direction} ↔ ${pb.direction})`); return; } }
    const common = (fp.signalKeys as string[]).filter((k) => (tp.signalKeys as string[]).includes(k));
    if (!common.length) { ctx.say('Porty nie mają wspólnego sygnału'); return; }
    for (const [r, p] of [[from, fp], [to, tp]] as const) if (connsOf(r).length >= (p.capacity ?? 1)) { ctx.say(`Port „${p.label}” jest już zajęty (pojemność ${p.capacity ?? 1})`); return; }
    dispatch('Opnij przewód', cmd.connect(from, to, common[0]));
  }

  // ---------- mysz ----------
  const pos = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dotAt = (x: number, y: number) => dotsAll().find((d) => Math.hypot(d.x - x, d.y - y) <= 7);
  function hit(x: number, y: number): string | undefined {
    const c = cell(x, y); if (!c || !cabId) return undefined;
    const gm = geo();
    const inR = (o: ReturnType<typeof cabinetContents>[number]) => { const r = rectOf(o, gm); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; };
    const all = cabinetContents(S(), cabId); return (all.find((o) => o.layer === 'busbar' && inR(o)) ?? all.find((o) => o.layer !== 'busbar' && inR(o)))?.id;
  }
  function wireAt(x: number, y: number): string | undefined {
    for (const w of wires()) for (let i = 1; i < w.pts.length; i++) {
      const [ax, ay] = w.pts[i - 1], [bx, by] = w.pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= 4) return w.id;
    }
    return undefined;
  }
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; const p = pos(e), dot = dotAt(p.x, p.y);
    if (dot) {
      if (wireFrom && !same(wireFrom, dot.ref)) { const a = wireFrom; wireFrom = undefined; connectPorts(a, dot.ref); }
      else wireFrom = same(wireFrom, dot.ref) ? undefined : dot.ref;
      selected = dot.ref.instanceId; selWire = undefined; refresh(); return;
    }
    wireFrom = undefined;
    const id = hit(p.x, p.y);
    if (id) { selected = id; selWire = undefined; const o = S().equipment[id].din!, c = cell(p.x, p.y); drag = { id, grab: c ? c.at - o.at : 0, fromList: false, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false }; }
    else { const w = wireAt(p.x, p.y); selWire = w; if (!w) selected = undefined; }
    refresh();
  });
  window.addEventListener('mousemove', (e) => {
    if (!active) return; const p = pos(e); hoverPos = p;
    if (drag) { drag.x = p.x; drag.y = p.y; if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) drag.moved = true; if (drag.moved) draw(); return; }
    const d = dotAt(p.x, p.y)?.ref; if (!same(d, hover) || wireFrom) { hover = d; draw(); }
  });
  window.addEventListener('mouseup', (e) => {
    if (!active || !drag) return; const d = drag; drag = undefined; const p = pos(e);
    if (!d.moved) { draw(); return; }
    d.x = p.x; d.y = p.y; const t = dragTarget(d);
    if (!t) { ctx.say(d.fromList ? 'Upuść osprzęt na szynę' : 'Upuszczono poza szafą: bez zmian'); refresh(); return; }
    dispatch(d.fromList ? 'Zamontuj na szynie' : 'Przenieś na szynie', cabCmd.mount(d.id, t));
  });
  window.addEventListener('keydown', (e) => {
    if (!active || ['INPUT', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace')) {
      if (selWire) { e.preventDefault(); const id = selWire; selWire = undefined; dispatch('Usuń przewód', cmd.disconnect(id)); }
      else if (selected && S().equipment[selected]?.din) { e.preventDefault(); dispatch('Zdejmij z szyny', cabCmd.unmount(selected)); }
    } else if (e.key === 'Escape') { drag = undefined; wireFrom = undefined; selected = undefined; selWire = undefined; refresh(); }
  });

  // ---------- okna ----------
  function form(title: string, init: { name: string; widthMm: number; heightMm: number; depthMm?: number; rows: number; modules: number; notes?: string; rackUnits?: { heightU: number } }, onOk: (v: any) => boolean, extra = '', presets = false) {
    const o = document.createElement('div'); o.id = 'cabdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    const f = (id: string, label: string, v: unknown) => `<label style="flex:1">${label}<input id="${id}" style="display:block;width:100%;margin:4px 0 10px" value="${esc(String(v ?? ''))}"></label>`;
    o.innerHTML = `<div class="dlg" style="width:480px"><h2>${esc(title)}</h2>
      ${presets ? `<label>Typ obudowy<select id="cf-preset" style="display:block;width:100%;margin:4px 0 10px;min-height:40px;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#fff;padding:0 8px"><option value="">(własna)</option>${[...CABINET_PRESETS.map((p) => `<option value="${p.key}">${esc(p.label)}</option>`), ...catalogEnclosures().map((e) => `<option value="enc:${esc(e.key)}">${esc(`${e.enclosure.manufacturer} ${e.enclosure.model} (${e.enclosure.rows} × ${e.enclosure.modules} mod.${e.enclosure.ip ? ', ' + e.enclosure.ip : ''})`)}</option>`)].join('')}</select></label>` : ''}
      <label>Nazwa<input id="cf-name" style="display:block;width:100%;margin:4px 0 10px" value="${esc(init.name)}"></label>
      <div style="display:flex;gap:8px">${f('cf-w', 'Szerokość [mm]', init.widthMm)}${f('cf-h', 'Wysokość [mm]', init.heightMm)}${f('cf-d', 'Głębokość [mm]', init.depthMm)}</div>
      <div style="display:flex;gap:8px">${f('cf-rows', 'Szyny DIN (rzędy)', init.rows)}${f('cf-mods', 'Moduły na szynie', init.modules)}${f('cf-ru', 'Moduł do racka [U] (puste = nie)', init.rackUnits?.heightU)}</div>
      ${f('cf-notes', 'Uwagi', init.notes)}
      <div id="cf-msg" class="imp" style="color:#E53935;min-height:18px"></div>
      <div class="btns">${extra}<button id="cf-cancel">Anuluj</button><button id="cf-ok" class="primary">Zapisz</button></div></div>`;
    document.body.appendChild(o);
    for (const i of o.querySelectorAll('input')) i.addEventListener('keydown', (ev) => ev.stopPropagation());
    const v = (id: string) => (o.querySelector('#' + id) as HTMLInputElement).value.trim(), num = (id: string) => (v(id) ? Number(v(id).replace(',', '.')) : undefined);
    (o.querySelector('#cf-preset') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
      const sel = (e.target as HTMLSelectElement).value, enc = sel.startsWith('enc:') ? catalogEnclosures().find((x) => 'enc:' + x.key === sel)?.enclosure : undefined;
      const p = enc ? { key: sel, label: '', v: { widthMm: enc.widthMm, heightMm: enc.heightMm, depthMm: enc.depthMm, rows: enc.rows, modules: enc.modules, rackUnits: undefined as { heightU: number } | undefined } } : CABINET_PRESETS.find((x) => x.key === sel); if (!p) return;
      if (enc) (o.querySelector('#cf-name') as HTMLInputElement).value = `${enc.manufacturer} ${enc.model}`;
      for (const [id, val] of [['cf-w', p.v.widthMm], ['cf-h', p.v.heightMm], ['cf-d', p.v.depthMm ?? ''], ['cf-rows', p.v.rows], ['cf-mods', p.v.modules], ['cf-ru', p.v.rackUnits?.heightU ?? '']] as const) (o.querySelector('#' + id) as HTMLInputElement).value = String(val);
    });
    o.querySelector('#cf-cancel')!.addEventListener('click', () => o.remove());
    o.querySelector('#cf-ok')!.addEventListener('click', () => {
      const vals = { name: v('cf-name'), widthMm: num('cf-w'), heightMm: num('cf-h'), depthMm: num('cf-d'), rows: num('cf-rows'), modules: num('cf-mods'), rackHeightU: num('cf-ru'), notes: v('cf-notes') };
      if ([vals.widthMm, vals.heightMm, vals.rows, vals.modules].some((x) => x === undefined || !Number.isFinite(x)) || (vals.depthMm !== undefined && !Number.isFinite(vals.depthMm))) { (o.querySelector('#cf-msg') as HTMLElement).textContent = 'Wymiary, szyny i moduły muszą być liczbami'; return; }
      try { if (onOk(vals)) o.remove(); } catch (e) { (o.querySelector('#cf-msg') as HTMLElement).textContent = String((e as Error).message); }
    });
    return o;
  }
  bar.querySelector('#cb-new')!.addEventListener('click', () => {
    form('Nowa szafa', { name: `Szafa ${cabs().length + 1}`, widthMm: 400, heightMm: 500, depthMm: 150, rows: 3, modules: 18 }, (v) => {
      const id = newCabinetId(); store.dispatch(`Dodaj ${v.name}`, cabCmd.addCabinet(id, { ...v, ...(v.rackHeightU ? { rackUnits: { heightU: v.rackHeightU } } : {}) })); cabId = id; ctx.changed(); refresh(); ctx.say(`Dodano ${v.name}`); return true;
    }, '', true);
  });
  bar.querySelector('#cb-edit')!.addEventListener('click', () => {
    const cab = cur(); if (!cab || !cabId) return; const id = cabId;
    const o = form('Szafa', cab, (v) => { store.dispatch('Zmień szafę', cabCmd.updateCabinet(id, { ...v, depthMm: v.depthMm ?? null, rackHeightU: v.rackHeightU ?? null })); ctx.changed(); refresh(); return true; }, '<button id="cf-del" class="danger" style="margin-right:auto">Usuń szafę</button>');
    o.querySelector('#cf-del')!.addEventListener('click', async () => {
      const n = cabinetContents(S(), id).length;
      const c = await ctx.ask('Usunąć szafę?', `Szafa „${esc(cab.name)}” zostanie usunięta.${n ? ` ${n} urządzeń zostanie zdjętych z szyn (zostają w projekcie razem z połączeniami).` : ''}`, [['no', 'Anuluj'], ['go', 'Usuń']]);
      if (c !== 'go') return; store.dispatch(`Usuń ${cab.name}`, cabCmd.removeCabinet(id)); o.remove(); ctx.changed(); refresh(); ctx.say(`Usunięto ${cab.name}`);
    });
  });
  bar.querySelector('#cb-block')!.addEventListener('click', () => {
    const c = cur(); if (!c || !cabId) return;
    if (!c.asBlock && !c.terminals?.length) ctx.say('Uwaga: szafa nie ma terminali, więc blok na schemacie będzie bez portów. Zaznacz terminale w panelu osprzętu.');
    dispatch(c.asBlock ? 'Pokaż osprzęt na schemacie' : 'Pokaż szafę jako blok na schemacie', cabCmd.setBlock(cabId, !c.asBlock));
  });
  bar.querySelector('#cb-pdf')!.addEventListener('click', async () => {
    try {
      const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
      const r = await cabinetPdf(S(), { fonts: { latin: await get(latinUrl), latinExt: await get(latinExtUrl) }, projectName: S().name ?? 'Projekt', date: new Date().toISOString().slice(0, 10), onlyCabinetId: cabId });
      const target = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: exportName(S().name, 'szafa', cabId ? (S().cabinets?.[cabId] as any)?.name : 'wszystkie', 'pdf') });
      if (!target) return;
      await invoke('save_autosave', { path: /\.pdf$/i.test(target) ? target : target + '.pdf', data: Array.from(r.bytes) });
      ctx.say(`Zapisano PDF szafy (${r.pages} str.)`);
    } catch (e) { ctx.say('Błąd eksportu PDF: ' + String(e)); }
  });
  (bar.querySelector('#cb-sel') as HTMLSelectElement).addEventListener('change', (e) => { cabId = (e.target as HTMLSelectElement).value || undefined; selected = undefined; selWire = undefined; wireFrom = undefined; refresh(); });

  return {
    resize(w: number, h: number) { W = w; H = h; host.style.width = w + 'px'; host.style.height = h + 'px'; cv.width = w; cv.height = h; if (active) draw(); },
    get active() { return active; },
    cabinetId: () => cabId,
    show() { active = true; host.style.display = 'block'; refresh(); },
    hide() { active = false; drag = undefined; wireFrom = undefined; host.style.display = 'none'; },
    refresh,
    /** Dodanie z katalogu w widoku szafy: montaż w pierwszym wolnym miejscu (tylko osprzęt DIN). */
    /** Upuszczenie pozycji z katalogu na szynę: mutator montujący nową instancję w komórce pod kursorem (gdy zajęta lub się nie mieści: w pierwszym wolnym miejscu). */
    dropMount(clientX: number, clientY: number): ((id: string) => Mutator) | undefined {
      if (!active || !cabId) return undefined; const r = cv.getBoundingClientRect(), c = cell(clientX - r.left, clientY - r.top); if (!c) return undefined;
      const cid = cabId;
      return (id) => (d) => {
        if (dinFit(d as Project, id) === undefined) return;
        const m: DinMount = { cabinetId: cid, row: c.row, at: c.at };
        const ok = !dinProblem(d as Project, id, m) ? m : firstFreeDin(d as Project, id, cid); if (ok) cabCmd.mount(id, ok)(d);
      };
    },
    canvas: cv,
    mountOnAdd(id: string): Mutator { return (d) => { if (!active || !cabId) return; if (dinFit(d as Project, id) === undefined) { const n = Object.values(d.equipment).filter((i) => (i.plate as PlateMount | undefined)?.cabinetId === cabId).length; cabCmd.mountPlate(id, { cabinetId: cabId, x: 20 + (n % 8) * 40, y: 20 + Math.floor(n / 8) * 60 })(d); return; } const m = firstFreeDin(d as Project, id, cabId); if (m) cabCmd.mount(id, m)(d); }; },
    /** Do testów: środek bloku urządzenia, pozycja portu i środek komórki. */
    deviceCenter(id: string): [number, number] | undefined { const o = cabId ? cabinetContents(S(), cabId).find((x) => x.id === id) : undefined; if (!o) return undefined; const r = rectOf(o); return [r.x + r.w / 2, r.y + r.h / 2]; },
    portPoint(id: string, portId: string): [number, number] | undefined { const d = dotsAll().find((x) => x.ref.instanceId === id && x.ref.portId === portId); return d ? [d.x, d.y] : undefined; },
    cellPoint(row: number, at: number): [number, number] { const gm = geo(); return [gm.x0 + (at - 0.5) * gm.pxMod, devY(row, gm) + devH(gm) / 2]; },
    wireMid(connId: string): [number, number] | undefined { const w = wires().find((x) => x.id === connId); if (!w) return undefined; const a = w.pts[1], b = w.pts[2] ?? w.pts[1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; },
    select: (id: string | undefined) => { selected = id; refresh(); },
    setCabinet: (id: string) => { cabId = id; selected = undefined; refresh(); },
  };
}
