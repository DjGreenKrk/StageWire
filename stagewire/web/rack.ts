// Widok racka (elewacja frontu/tyłu): montaż urządzeń rackowych przeciąganiem, sumy masy i mocy, eksport PDF.
import { exportName } from './exportName.ts';
import type { Store, Mutator } from '../src/store.ts';
import type { Project } from '../src/types.ts';
import { rackCmd, rackContents, rackFit, holder, itemInfo, mountProblem, firstFree, rackTotals, slotsFor, slotRange, newRackId, type Mount, type Rack, type Face, type Slot } from '../src/racks.ts';
import { rackPdf } from '../src/rackPdf.ts';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import latinUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import latinExtUrl from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url';

export interface RackCtx {
  store: Store; W: number; H: number;
  say(m: string): void;
  /** Po zmianie modelu: walidacja, autozapis, odświeżenie paneli. */
  changed(): void;
  ask(title: string, text: string, buttons: [string, string][]): Promise<string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const COLORS: Record<string, string> = { wideo: '#2b5d8a', audio: '#8a4b2b', 'sieć': '#2b7a5d', 'oświetlenie': '#8a7a2b', sterowanie: '#5d2b8a', zasilanie: '#8a2b3f' };
const colorOf = (cat: string) => COLORS[cat.split('/')[0].trim().toLowerCase()] ?? '#4a4a5a';
const RAIL = 28, RACK_W = 360, TOP = 150;

export function createRack(ctx: RackCtx) {
  const { store } = ctx; let W = ctx.W, H = ctx.H;
  const host = document.createElement('div'); host.id = 'rackview';
  host.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#0E0E0E;display:none`;
  document.body.insertBefore(host, document.getElementById('menu'));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'position:absolute;left:0;top:0'; host.appendChild(cv);
  const g = cv.getContext('2d')!;
  const bar = document.createElement('div'); bar.id = 'rackbar';
  bar.style.cssText = 'position:absolute;left:252px;top:var(--top,62px);display:flex;gap:6px;align-items:center';
  bar.innerHTML = `<select id="rk-sel" style="min-height:44px;min-width:180px;padding:0 8px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff;font-size:14px"></select>
    <button id="rk-new">Nowy rack…</button><button id="rk-edit">Zmień…</button><button id="rk-face">Przód</button><button id="rk-pdf">PDF…</button>`;
  host.appendChild(bar);
  const panel = document.createElement('div'); panel.id = 'rackpanel';
  panel.style.cssText = 'position:absolute;right:8px;top:var(--top,62px);bottom:36px;width:270px;overflow:auto;background:rgba(18,18,18,.94);border:1px solid #2A2A2A;border-radius:8px;padding:12px;box-sizing:border-box';
  host.appendChild(panel);
  const st = document.createElement('style');
  st.textContent = '#rackbar button,#rackpanel button{min-height:44px;padding:0 12px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff;font-size:14px;cursor:pointer}#rackbar button:hover,#rackpanel button:hover{border-color:#00C853}#rackpanel h3{margin:12px 0 6px;font-size:11px;font-weight:500;color:#00C853;text-transform:uppercase;letter-spacing:.04em}#rackpanel h3:first-child{margin-top:0}#rackpanel .meta{font-size:12px;color:#B0B0B0;margin-bottom:6px}#rackpanel .li{display:flex;flex-direction:column;align-items:flex-start;width:100%;margin:0 0 4px;text-align:left}#rackpanel .li small{color:#B0B0B0;font-size:11px}#rackpanel .li.sel{border-color:#00C853}';
  document.head.appendChild(st);

  let active = false, rackId: string | undefined, face: Face = 'front', selected: string | undefined;
  type Drag = { id: string; grab: number; fromList: boolean; sx: number; sy: number; x: number; y: number; moved: boolean };
  let drag: Drag | undefined;

  const S = (): Project => store.state;
  const racks = () => Object.entries(S().racks ?? {}) as [string, Rack][];
  const cur = (): Rack | undefined => (rackId ? (S().racks?.[rackId] as Rack | undefined) : undefined);
  const nameOf = (id: string) => itemInfo(S(), id).name;
  const revOf = (id: string) => { const it = itemInfo(S(), id); return { category: it.category, manufacturer: it.isCabinet ? 'Szafa' : it.device.split(' ')[0], model: it.isCabinet ? it.device.replace(/^Szafa /, '') : it.device.split(' ').slice(1).join(' ') }; };

  // ---------- geometria ----------
  const geo = () => {
    const rack = cur(); const units = rack?.units ?? 0;
    const pxU = Math.max(10, Math.min(32, Math.floor((H - 36 - TOP - 10) / Math.max(units, 1))));
    const cx = Math.round((250 + (W - 290)) / 2), inL = cx - RACK_W / 2;
    return { units, pxU, inL, outL: inL - RAIL, outR: inL + RACK_W + RAIL };
  };
  const yTop = (u: number, gm = geo()) => TOP + (gm.units - u) * gm.pxU; // górna krawędź komórki U (U1 na dole)
  /** Pozycja kursora → numer U i ułamek szerokości (poza rackiem: null). */
  function cell(x: number, y: number): { u: number; frac: number } | null {
    const gm = geo(), row = Math.floor((y - TOP) / gm.pxU);
    if (row < 0 || row >= gm.units || x < gm.inL || x > gm.inL + RACK_W) return null;
    return { u: gm.units - row, frac: (x - gm.inL) / RACK_W };
  }
  /** Miejsce w poziomie dla urządzenia o danej szerokości i pozycji kursora. */
  function slotAt(widthFraction: number, frac: number): Slot {
    const s = slotsFor(widthFraction); return s[Math.min(s.length - 1, Math.max(0, Math.floor(frac * s.length)))];
  }
  /** Docelowa pozycja przy przeciąganiu: kursor wskazuje komórkę, uchwyt przesuwa górną krawędź. */
  function target(d: Drag): Mount | null {
    const c = cell(d.x, d.y), fit = rackFit(S(), d.id); if (!c || !fit || !rackId) return null;
    const uTop = c.u + d.grab; // numer U górnego wiersza urządzenia
    return { rackId, uStart: Math.max(1, uTop - fit.heightU + 1), face, slot: slotAt(fit.widthFraction, c.frac) };
  }

  // ---------- rysowanie ----------
  function draw() {
    g.clearRect(0, 0, W, H); g.fillStyle = '#0E0E0E'; g.fillRect(0, 0, W, H);
    const rack = cur();
    if (!rack) {
      g.fillStyle = '#B0B0B0'; g.font = '16px Roboto,sans-serif'; g.textAlign = 'center';
      g.fillText(racks().length ? 'Wybierz rack z listy' : 'Brak racków. Kliknij „Nowy rack…”, aby zacząć', (250 + W - 290) / 2, H / 2); g.textAlign = 'left'; return;
    }
    const gm = geo(), inR = gm.inL + RACK_W, bottom = TOP + gm.units * gm.pxU;
    g.fillStyle = '#E0E0E0'; g.font = '500 15px Roboto,sans-serif'; g.textAlign = 'center';
    g.fillText(`${rack.name} · ${rack.units} U · ${face === 'front' ? 'przód' : 'tył'}`, gm.inL + RACK_W / 2, TOP - 24); g.textAlign = 'left';
    // słupki z numeracją U
    g.fillStyle = '#1A1A1A'; g.fillRect(gm.outL, TOP - 6, RAIL, gm.units * gm.pxU + 12); g.fillRect(inR, TOP - 6, RAIL, gm.units * gm.pxU + 12);
    g.strokeStyle = '#2A2A2A'; g.lineWidth = 1; g.strokeRect(gm.outL + 0.5, TOP - 5.5, RACK_W + 2 * RAIL - 1, gm.units * gm.pxU + 11);
    g.font = `${Math.min(11, gm.pxU - 3)}px Roboto,sans-serif`; g.fillStyle = '#8A8A8A'; g.textAlign = 'center';
    for (let u = 1; u <= gm.units; u++) { const y = yTop(u, gm); g.fillText(String(u), gm.outL + RAIL / 2, y + gm.pxU / 2 + 4); g.fillText(String(u), inR + RAIL / 2, y + gm.pxU / 2 + 4); }
    g.textAlign = 'left';
    // wolne komórki
    g.fillStyle = '#151515'; g.fillRect(gm.inL, TOP, RACK_W, gm.units * gm.pxU);
    g.strokeStyle = '#242424';
    for (let u = 0; u <= gm.units; u++) { const y = TOP + u * gm.pxU + 0.5; g.beginPath(); g.moveTo(gm.inL, y); g.lineTo(inR, y); g.stroke(); }
    // urządzenia danej strony; z drugiej strony – ciemny ślad zajętości
    for (const o of rackContents(S(), rackId!)) {
      const [a, b] = slotRange(o.mount.slot, o.fit.widthFraction), x = gm.inL + a * RACK_W + 1, w = (b - a) * RACK_W - 2;
      const y = yTop(o.mount.uStart + o.fit.heightU - 1, gm) + 1, h = o.fit.heightU * gm.pxU - 2;
      if (o.mount.face !== face) { g.fillStyle = '#1B1B1B'; g.fillRect(x, y, w, h); continue; }
      const rev = revOf(o.id), isDrag = drag?.id === o.id && drag.moved;
      g.globalAlpha = isDrag ? 0.35 : 1; g.fillStyle = colorOf(rev?.category ?? ''); g.fillRect(x, y, w, h);
      g.strokeStyle = selected === o.id ? '#00C853' : '#00000066'; g.lineWidth = selected === o.id ? 2 : 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.fillStyle = '#FFFFFF'; g.font = '500 12px Roboto,sans-serif';
      const name = fitText(nameOf(o.id), w - 10); g.fillText(name, x + 6, y + Math.min(h, 18) - 4);
      if (h >= 34 && rev) { g.fillStyle = '#D0D0D0'; g.font = '11px Roboto,sans-serif'; g.fillText(fitText(`${rev.manufacturer} ${rev.model}`, w - 10), x + 6, y + 31); }
      else if (rev && w > 230 && h < 34) { g.fillStyle = '#C0C0C0'; g.font = '11px Roboto,sans-serif'; const nw = g.measureText(name).width; const m = fitText(rev.model, w - nw - 22); if (m) { g.textAlign = 'right'; g.fillText(m, x + w - 6, y + Math.min(h, 18) - 4); g.textAlign = 'left'; } }
      g.globalAlpha = 1;
    }
    // podgląd upuszczenia
    if (drag?.moved) {
      const t = target(drag), fit = rackFit(S(), drag.id);
      if (t && fit) {
        const bad = mountProblem(S(), drag.id, t), [a, b] = slotRange(t.slot, fit.widthFraction);
        const x = gm.inL + a * RACK_W + 1, w = (b - a) * RACK_W - 2, y = yTop(t.uStart + fit.heightU - 1, gm) + 1, h = fit.heightU * gm.pxU - 2;
        g.fillStyle = bad ? '#E5393555' : '#00C85344'; g.fillRect(x, y, w, h); g.strokeStyle = bad ? '#E53935' : '#00C853'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }
      g.fillStyle = '#FFFFFF'; g.font = '12px Roboto,sans-serif'; g.fillText(nameOf(drag.id), drag.x + 12, drag.y - 8);
    }
    void bottom;
  }
  function fitText(s: string, maxPx: number): string {
    if (maxPx <= 8) return ''; if (g.measureText(s).width <= maxPx) return s;
    let t = s; while (t.length > 1 && g.measureText(t + '…').width > maxPx) t = t.slice(0, -1); return t + '…';
  }

  // ---------- panel ----------
  function renderBar() {
    const sel = bar.querySelector('#rk-sel') as HTMLSelectElement;
    sel.innerHTML = racks().map(([id, r]) => `<option value="${id}"${id === rackId ? ' selected' : ''}>${esc(r.name)} (${r.units} U)</option>`).join('') || '<option value="">(brak racków)</option>';
    (bar.querySelector('#rk-face') as HTMLElement).textContent = face === 'front' ? 'Przód' : 'Tył';
    for (const id of ['rk-edit', 'rk-pdf']) (bar.querySelector('#' + id) as HTMLButtonElement).disabled = !racks().length;
  }
  function renderPanel() {
    const rack = cur();
    if (!rack || !rackId) { panel.innerHTML = '<h3>Rack</h3><div class="meta">Utwórz rack, a potem przeciągaj do niego urządzenia rackowe (z wysokością w U w definicji).</div>'; return; }
    const t = rackTotals(S(), rackId), sel = selected ? holder(S(), selected) : undefined, sm = sel?.mount;
    const unmounted = [...Object.entries(S().equipment), ...Object.entries(S().cabinets ?? {})].filter(([id, i]: [string, any]) => !i.mount && rackFit(S(), id));
    const li = (id: string) => { const r = revOf(id), f = rackFit(S(), id)!; return `<button class="li${selected === id ? ' sel' : ''}" data-un="${id}"><span>${esc(nameOf(id))}</span><small>${esc(r ? `${r.manufacturer} ${r.model}` : '')} · ${f.heightU} U${f.widthFraction < 1 ? ' · ' + (f.widthFraction === 0.5 ? '1/2' : '1/3') + ' szer.' : ''}</small></button>`; };
    panel.innerHTML = `<h3>${esc(rack.name)}</h3>
      <div class="meta">${rack.units} U${rack.depthMm ? ` · głębokość ${rack.depthMm} mm` : ''}${rack.notes ? '<br>' + esc(rack.notes) : ''}</div>
      <div id="rk-tot" class="meta">Zajęte ${t.usedU} z ${rack.units} U · wolne ${t.freeU}<br>Masa: ${fmt(t.weightKg)} kg${t.weightUnknown ? ` (+${t.weightUnknown} bez danych)` : ''}<br>Pobór: ${fmt(t.powerW)} W, maks. ${fmt(t.powerMaxW)} W${t.powerUnknown ? ` (+${t.powerUnknown} bez danych)` : ''}</div>
      ${sel && selected ? `<h3>Zaznaczone</h3><div class="meta"><b style="color:#fff">${esc(nameOf(selected))}</b><br>${sm ? `${sm.rackId === rackId ? '' : 'w innym racku · '}U${sm.uStart}${(() => { const f = rackFit(S(), selected!); return f && f.heightU > 1 ? '–' + (sm.uStart + f.heightU - 1) : ''; })()} · ${sm.face === 'front' ? 'przód' : 'tył'}` : 'poza rackiem'}</div>
        ${sm ? '<button id="rk-un">Zdejmij z racka</button>' : '<button id="rk-auto" class="primary">Zamontuj w pierwszym wolnym</button>'}` : ''}
      <h3>Poza rackiem (${unmounted.length})</h3>
      ${unmounted.length ? `<div class="meta">Przeciągnij na rack albo kliknij i użyj przycisku.</div>${unmounted.map(([id]) => li(id)).join('')}` : '<div class="meta">Wszystkie urządzenia rackowe są zamontowane.</div>'}`;
    panel.querySelector('#rk-un')?.addEventListener('click', () => { dispatch('Zdejmij z racka', rackCmd.unmount(selected!)); });
    panel.querySelector('#rk-auto')?.addEventListener('click', () => autoMountSelected());
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-un]')) {
      b.addEventListener('click', () => { selected = b.dataset.un; refresh(); });
      b.addEventListener('mousedown', (e) => { if (e.button !== 0) return; selected = b.dataset.un; drag = { id: selected!, grab: 0, fromList: true, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false }; });
    }
  }
  function refresh() { if (!active) return; if (rackId && !cur()) rackId = undefined; if (!rackId) rackId = racks()[0]?.[0]; if (selected && !holder(S(), selected)) selected = undefined; renderBar(); renderPanel(); draw(); }

  function dispatch(label: string, m: Mutator): boolean {
    try { store.dispatch(label, m); ctx.changed(); refresh(); return true; } catch (e) { ctx.say(String((e as Error).message)); refresh(); return false; }
  }
  function autoMountSelected() {
    if (!selected || !rackId) return;
    const m = firstFree(S(), selected, rackId); if (!m) { ctx.say('W tym racku nie ma wolnego miejsca dla tego urządzenia'); return; }
    dispatch('Zamontuj w racku', rackCmd.mount(selected, m));
  }

  // ---------- mysz ----------
  const pos = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(x: number, y: number): string | undefined {
    const c = cell(x, y); if (!c || !rackId) return undefined;
    return rackContents(S(), rackId).find((o) => {
      if (o.mount.face !== face) return false;
      const [a, b] = slotRange(o.mount.slot, o.fit.widthFraction);
      return c.u >= o.mount.uStart && c.u < o.mount.uStart + o.fit.heightU && c.frac >= a && c.frac < b;
    })?.id;
  }
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; const p = pos(e), id = hit(p.x, p.y);
    selected = id; if (id) { const o = holder(S(), id)!.mount!, c = cell(p.x, p.y)!; drag = { id, grab: o.uStart + (rackFit(S(), id)?.heightU ?? 1) - 1 - c.u, fromList: false, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false }; }
    refresh();
  });
  window.addEventListener('mousemove', (e) => {
    if (!active || !drag) return; const p = pos(e); drag.x = p.x; drag.y = p.y;
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) drag.moved = true;
    if (drag.moved) draw();
  });
  window.addEventListener('mouseup', (e) => {
    if (!active || !drag) return; const d = drag; drag = undefined; const p = pos(e);
    if (!d.moved) { draw(); return; }
    d.x = p.x; d.y = p.y; const t = target(d);
    if (!t) { ctx.say(d.fromList ? 'Upuść urządzenie na rack' : 'Upuszczono poza rackiem: bez zmian'); refresh(); return; }
    dispatch(d.fromList ? 'Zamontuj w racku' : 'Przenieś w racku', rackCmd.mount(d.id, t));
  });
  window.addEventListener('keydown', (e) => {
    if (!active || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && holder(S(), selected)?.mount) { e.preventDefault(); dispatch('Zdejmij z racka', rackCmd.unmount(selected)); }
    else if (e.key === 'Escape') { drag = undefined; selected = undefined; refresh(); }
  });

  // ---------- okna ----------
  function rackForm(title: string, init: { name: string; units: number; depthMm?: number; notes?: string }, onOk: (v: { name: string; units: number; depthMm?: number; notes: string }) => boolean, extra?: string) {
    const o = document.createElement('div'); o.id = 'rackdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:440px"><h2>${esc(title)}</h2>
      <label>Nazwa<input id="rf-name" style="display:block;width:100%;margin:4px 0 10px" value="${esc(init.name)}"></label>
      <div style="display:flex;gap:8px"><label style="flex:1">Wysokość [U]<input id="rf-units" style="display:block;width:100%;margin:4px 0 10px" value="${init.units}"></label>
      <label style="flex:1">Głębokość [mm] (opcjonalnie)<input id="rf-depth" style="display:block;width:100%;margin:4px 0 10px" value="${init.depthMm ?? ''}"></label></div>
      <label>Uwagi<input id="rf-notes" style="display:block;width:100%;margin:4px 0 10px" value="${esc(init.notes ?? '')}"></label>
      <div id="rf-msg" class="imp" style="color:#E53935;min-height:18px"></div>
      <div class="btns">${extra ?? ''}<button id="rf-cancel">Anuluj</button><button id="rf-ok" class="primary">Zapisz</button></div></div>`;
    document.body.appendChild(o);
    for (const i of o.querySelectorAll('input')) i.addEventListener('keydown', (ev) => ev.stopPropagation());
    const v = (id: string) => (o.querySelector('#' + id) as HTMLInputElement).value.trim();
    o.querySelector('#rf-cancel')!.addEventListener('click', () => o.remove());
    o.querySelector('#rf-ok')!.addEventListener('click', () => {
      const units = Number(v('rf-units').replace(',', '.')), depth = v('rf-depth') ? Number(v('rf-depth').replace(',', '.')) : undefined;
      if (!Number.isFinite(units) || (depth !== undefined && !Number.isFinite(depth))) { (o.querySelector('#rf-msg') as HTMLElement).textContent = 'Wysokość i głębokość muszą być liczbami'; return; }
      try { if (onOk({ name: v('rf-name'), units, depthMm: depth, notes: v('rf-notes') })) o.remove(); } catch (e) { (o.querySelector('#rf-msg') as HTMLElement).textContent = String((e as Error).message); }
    });
    return o;
  }
  bar.querySelector('#rk-new')!.addEventListener('click', () => {
    rackForm('Nowy rack', { name: `Rack ${racks().length + 1}`, units: 12 }, (v) => {
      const id = newRackId(); store.dispatch(`Dodaj ${v.name}`, rackCmd.addRack(id, v)); rackId = id; ctx.changed(); refresh(); ctx.say(`Dodano ${v.name}`); return true;
    });
  });
  bar.querySelector('#rk-edit')!.addEventListener('click', () => {
    const rack = cur(); if (!rack || !rackId) return; const id = rackId;
    const o = rackForm('Rack', rack, (v) => { store.dispatch('Zmień rack', rackCmd.updateRack(id, { name: v.name, units: v.units, depthMm: v.depthMm ?? null, notes: v.notes })); ctx.changed(); refresh(); return true; }, '<button id="rf-del" class="danger" style="margin-right:auto">Usuń rack</button>');
    o.querySelector('#rf-del')!.addEventListener('click', async () => {
      const n = rackContents(S(), id).length;
      const c = await ctx.ask('Usunąć rack?', `Rack „${esc(rack.name)}” zostanie usunięty.${n ? ` ${n} urządzeń zostanie zdjętych z racka (zostają w projekcie).` : ''}`, [['no', 'Anuluj'], ['go', 'Usuń']]);
      if (c !== 'go') return; store.dispatch(`Usuń ${rack.name}`, rackCmd.removeRack(id)); o.remove(); ctx.changed(); refresh(); ctx.say(`Usunięto ${rack.name}`);
    });
  });
  (bar.querySelector('#rk-sel') as HTMLSelectElement).addEventListener('change', (e) => { rackId = (e.target as HTMLSelectElement).value || undefined; selected = undefined; refresh(); });
  bar.querySelector('#rk-face')!.addEventListener('click', () => { face = face === 'front' ? 'rear' : 'front'; refresh(); });
  bar.querySelector('#rk-pdf')!.addEventListener('click', async () => {
    try {
      const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
      const r = await rackPdf(S(), { fonts: { latin: await get(latinUrl), latinExt: await get(latinExtUrl) }, projectName: S().name ?? 'Projekt', date: new Date().toISOString().slice(0, 10), onlyRackId: rackId });
      const target = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: exportName(S().name, 'rack', rackId ? (S().racks?.[rackId] as any)?.name : 'wszystkie', 'pdf') });
      if (!target) return;
      await invoke('save_autosave', { path: /\.pdf$/i.test(target) ? target : target + '.pdf', data: Array.from(r.bytes) });
      ctx.say(`Zapisano PDF racka (${r.pages} str.)`);
    } catch (e) { ctx.say('Błąd eksportu PDF: ' + String(e)); }
  });

  return {
    resize(w: number, h: number) { W = w; H = h; host.style.width = w + 'px'; host.style.height = h + 'px'; cv.width = w; cv.height = h; if (active) draw(); },
    get active() { return active; },
    rackId: () => rackId,
    show() { active = true; host.style.display = 'block'; refresh(); },
    hide() { active = false; drag = undefined; host.style.display = 'none'; },
    refresh,
    /** Przy dodawaniu urządzenia z katalogu w widoku racka: montaż w pierwszym wolnym miejscu aktywnego racka (urządzenia nierackowe zostają poza rackiem). */
    mountOnAdd(id: string): Mutator { return (d) => { if (!active || !rackId) return; const m = firstFree(d as Project, id, rackId); if (m) rackCmd.mount(id, m)(d); }; },
    /** Do testów: środek komórki U (1 = dół) w współrzędnych strony; frac = położenie w poziomie 0–1. */
    pointOf(u: number, frac = 0.5): [number, number] { const gm = geo(); return [gm.inL + frac * RACK_W, yTop(u, gm) + gm.pxU / 2]; },
    select: (id: string | undefined) => { selected = id; refresh(); },
    setFace: (f: Face) => { face = f; refresh(); },
    setRack: (id: string) => { rackId = id; selected = undefined; refresh(); },
  };
}
