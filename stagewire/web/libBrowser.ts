// Przeglądarka biblioteki urządzeń: wyszukiwarka, filtry z licznikami (kategoria, producent, wejścia, wyjścia, dane, pakiet),
// lista wyników i karta urządzenia z akcjami: dodaj do projektu, eksportuj jedno urządzenie, użyj jako wzoru, edytuj / usuń własne, importuj z pliku.
import { catalogEntries, starterRegistries, type CatalogEntry } from '../src/catalog/index.ts';
import { buildFacets, filterEntries, sortEntries, toggleSelection, FACET_ORDER, type Selection } from '../src/libraryIndex.ts';
import { sourceTrust, TRUST_LABEL, type Pack, type PackDevice } from '../src/pack.ts';
import { MY_PACK_ID, type Conflict } from '../src/deviceBuild.ts';
import { openDeviceBuilder } from './deviceBuilder.ts';
import { openElectricalBuilder } from './electricalBuilder.tsx';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export interface BrowserLib {
  saveDevices(d: PackDevice[], onConflict?: (d: PackDevice) => Conflict): Promise<{ added: string[]; replaced: string[]; skipped: string[]; renamed: [string, string][]; pack: Pack }>;
  removeMine(key: string): Promise<void>;
  exportDevice(d: PackDevice, meta: { author?: string; license: string }): Promise<string | undefined>;
  pickDevicesFile(): Promise<{ pack?: Pack; errors: string[]; warnings: string[] } | undefined>;
  checkDevicesFile(raw: unknown): { pack?: Pack; errors: string[]; warnings: string[] };
  myPack(): Pack | undefined;
  openDialogUi(): void;
}
export interface BrowserCtx { library: BrowserLib; say(m: string): void; addToProject(entryKey: string, model: string): void }
const LICENSES = ['CC0 (domena publiczna)', 'CC BY 4.0 (z podaniem autora)', 'własne (do użytku wewnętrznego)'];
const portsLine = (e: CatalogEntry) => { const ins = e.ports.filter((p) => p.direction === 'in').length, outs = e.ports.filter((p) => p.direction === 'out').length, io = e.ports.length - ins - outs; return `${ins} we · ${outs} wy${io ? ` · ${io} wej./wyj.` : ''}`; };

export function createLibBrowser(c: BrowserCtx) {
  let query = '', sel: Selection = {}, current: string | undefined, open = false;
  let ov: HTMLElement | undefined;
  const expanded = new Set<string>();

  const names = () => starterRegistries as Record<string, { name: string }>;
  const inMine = (e: CatalogEntry) => e.packId === MY_PACK_ID;
  const byKey = (k: string | undefined) => catalogEntries.find((e) => e.key === k);

  function render() {
    if (!ov) return;
    const all = catalogEntries, res = sortEntries(filterEntries(all, query, sel)), facets = buildFacets(all, query, sel, names());
    if (current && !res.some((e) => e.key === current)) current = undefined;
    const sel1 = byKey(current);
    const active = FACET_ORDER.some((f) => sel[f]?.length) || !!query.trim();
    (ov.querySelector('#bw-count') as HTMLElement).textContent = `Wyników: ${res.length} z ${all.length}`;
    (ov.querySelector('#bw-clear') as HTMLElement).style.visibility = active ? 'visible' : 'hidden';
    (ov.querySelector('#bw-facets') as HTMLElement).innerHTML = facets.map((f) => {
      const open6 = expanded.has(f.id) ? f.values : f.values.filter((v, i) => i < 6 || v.selected);
      return `<div class="bw-f"><div class="bw-fh">${f.label}</div>${open6.map((v) => `<label class="bw-v${v.count ? '' : ' zero'}"><input type="checkbox" data-f="${f.id}" data-v="${esc(v.value)}"${v.selected ? ' checked' : ''}><span>${esc(v.label)}</span><small>${v.count}</small></label>`).join('')}${f.values.length > open6.length ? `<button class="bw-more" data-f="${f.id}">Pokaż wszystkie (${f.values.length})</button>` : expanded.has(f.id) && f.values.length > 6 ? `<button class="bw-more" data-f="${f.id}">Pokaż mniej</button>` : ''}</div>`;
    }).join('');
    (ov.querySelector('#bw-list') as HTMLElement).innerHTML = res.length ? res.map((e) => {
      const t = sourceTrust(e.device.source);
      return `<div class="bw-r${e.key === current ? ' on' : ''}" data-k="${esc(e.key)}"><div><b>${esc(e.model)}</b><span class="bw-m"> ${esc(e.manufacturer)}</span></div><div class="bw-s">${esc(e.category)} · ${portsLine(e)}${t === 'verified' || t === 'generic' ? '' : ` · <span style="color:#FFD54F">${TRUST_LABEL[t]}</span>`}${inMine(e) ? ' · <span style="color:#00C853">moje</span>' : ''}</div></div>`;
    }).join('') : '<div class="imp" style="padding:12px">Brak urządzeń dla tych filtrów. Zmień filtry albo dodaj własne urządzenie („Nowe urządzenie…”).</div>';
    (ov.querySelector('#bw-detail') as HTMLElement).innerHTML = sel1 ? detailHtml(sel1) : '<div class="imp" style="padding:12px">Wybierz urządzenie z listy, aby zobaczyć porty i dane. Dwuklik dodaje je do projektu.</div>';
    bindDetail(sel1);
  }

  function detailHtml(e: CatalogEntry): string {
    const d = e.device, s = d.source, t = sourceTrust(s), dim = d.dimensionsMm ? `${d.dimensionsMm.width} × ${d.dimensionsMm.depth} × ${d.dimensionsMm.height} mm` : 'brak wymiarów';
    const sn = (k: string) => (names()[k]?.name ?? k);
    return `<h3 style="margin:0 0 2px;font-size:16px;font-weight:500">${esc(e.model)}</h3><div class="imp">${esc(e.manufacturer)} · ${esc(e.category)}</div>
      ${d.description ? `<p style="margin:8px 0;font-size:13px">${esc(d.description)}</p>` : ''}
      <div class="bw-kv">${dim}${d.weightKg !== undefined ? ` · ${d.weightKg} kg` : ''}${d.powerW !== undefined ? ` · ${d.powerW} W` : ''}${d.rackUnits ? ` · rack ${d.rackUnits.heightU} U` : ''}${d.dinModules ? ` · ${d.dinModules} mod. DIN` : ''}</div>
      <div class="bw-kv">Dane: ${TRUST_LABEL[t]} (${esc(s.kind)}${s.ref ? ', ' + esc(s.ref) : ''}${s.verified ? ', sprawdzono ' + esc(s.verified) : ''})<br>Pakiet: ${esc(e.packName)} ${esc(e.packVersion)}</div>
      <div class="imp" style="margin:8px 0 2px">Porty (${e.ports.length})</div>
      <div style="max-height:22vh;overflow:auto;font-size:12px">${e.ports.map((p) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:1px 0"><span>${esc(p.label)}</span><span style="color:#8A8A8A">${esc(sn(p.signals[0]))} · ${p.direction === 'in' ? 'we' : p.direction === 'out' ? 'wy' : p.direction === 'io' ? 'we/wy' : 'przelot'}</span></div>`).join('')}</div>
      <div class="btns" style="margin-top:10px"><button id="bw-add" class="primary">Dodaj do projektu</button><button id="bw-export">Eksportuj to urządzenie…</button><button id="bw-copy" title="Otwiera kreator z danymi tego urządzenia jako wzorem">Użyj jako wzoru…</button>${inMine(e) ? '<button id="bw-edit">Edytuj…</button><button id="bw-del" class="danger">Usuń z moich</button>' : ''}</div>`;
  }

  const msg = (html: string) => { const m = ov?.querySelector('#bw-msg'); if (m) m.innerHTML = html; };
  function bindDetail(e: CatalogEntry | undefined) {
    if (!ov || !e) return;
    const q = (s: string) => ov!.querySelector(s) as HTMLElement | null;
    q('#bw-add')?.addEventListener('click', () => { c.addToProject(e.key, e.model); msg(`<div style="color:#00C853">Dodano „${esc(e.model)}” do projektu.</div>`); });
    q('#bw-copy')?.addEventListener('click', () => { close(); openDeviceBuilder({ library: c.library as any, say: c.say, addToProject: c.addToProject, prefill: { ...JSON.parse(JSON.stringify(e.device)), model: e.model + ' (kopia)' } }); });
    q('#bw-edit')?.addEventListener('click', () => { close(); openDeviceBuilder({ library: c.library as any, say: c.say, addToProject: c.addToProject, prefill: JSON.parse(JSON.stringify(e.device)), editKey: e.devKey }); });
    q('#bw-del')?.addEventListener('click', async () => {
      const b = q('#bw-del') as HTMLButtonElement; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Na pewno? Projekty zachowają swoje kopie'; return; }
      try { await c.library.removeMine(e.devKey); current = undefined; render(); c.say(`Usunięto „${e.model}” z moich urządzeń`); } catch (err) { msg(`<div style="color:#E53935">${esc(String((err as Error).message))}</div>`); }
    });
    q('#bw-export')?.addEventListener('click', () => exportForm(e));
  }

  /** Mały formularz przed eksportem: autor i licencja trafiają do pliku (potrzebne, gdy urządzenie ma być udostępnione). */
  function exportForm(e: CatalogEntry) {
    msg(`<div class="bw-box"><b>Eksport: ${esc(e.model)}</b><div style="display:flex;gap:8px;margin:6px 0"><label style="flex:1">Autor (opcjonalnie)<input id="bx-author" style="display:block;width:100%"></label><label style="flex:1.4">Licencja danych<select id="bx-lic" style="display:block;width:100%">${LICENSES.map((l) => `<option>${esc(l)}</option>`).join('')}</select></label></div>
      <div class="imp">Plik zawiera tylko to jedno urządzenie wraz ze złączami i sygnałami, więc odbiorca importuje go przyciskiem „Importuj urządzenie z pliku…”.</div><button id="bx-go" class="primary">Zapisz plik…</button></div>`);
    ov!.querySelectorAll('#bw-msg input').forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
    ov!.querySelector('#bx-go')!.addEventListener('click', async () => {
      try {
        const author = (ov!.querySelector('#bx-author') as HTMLInputElement).value, license = (ov!.querySelector('#bx-lic') as HTMLSelectElement).value;
        const t = await c.library.exportDevice(e.device, { author, license }); if (t) msg(`<div style="color:#00C853">Zapisano plik urządzenia.</div>`);
      } catch (err) { msg(`<div style="color:#E53935">${esc(String((err as Error).message)).replace(/\n/g, '<br>')}</div>`); }
    });
  }

  /** Import urządzeń z pliku (jedno lub kilka): lista z oceną (nowe / identyczne / inne niż moje) i wybór postępowania przy konflikcie. Dotyka tylko pakietu „Moje urządzenia”. */
  function importForm(pack: Pack, warnings: string[]) {
    const mine = new Map((c.library.myPack()?.devices ?? []).map((d) => [d.key, d]));
    const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    const rows = pack.devices.map((d, i) => { const m = mine.get(d.key); const st = !m ? 'nowe' : canon(m) === canon(d) ? 'identyczne' : 'inne'; return { d, i, st }; });
    msg(`<div class="bw-box"><b>Import z pliku: ${esc(pack.name)}</b> <span class="imp">(${esc(pack.license)}${pack.author ? ', autor: ' + esc(pack.author) : ''})</span>
      ${warnings.length ? `<div style="color:#FFD54F;font-size:12px;margin:4px 0">${warnings.slice(0, 3).map(esc).join('<br>')}</div>` : ''}
      <div style="max-height:26vh;overflow:auto;margin:6px 0">${rows.map((r) => `<label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="bi" data-i="${r.i}"${r.st === 'identyczne' ? '' : ' checked'}${r.st === 'identyczne' ? ' disabled' : ''}> ${esc(r.d.manufacturer)} ${esc(r.d.model)} <small style="color:${r.st === 'nowe' ? '#00C853' : r.st === 'inne' ? '#FFD54F' : '#8A8A8A'}">${r.st === 'nowe' ? 'nowe' : r.st === 'inne' ? 'inne niż u Ciebie (ten sam klucz)' : 'już masz'}</small></label>`).join('')}</div>
      <label>Gdy urządzenie o tym kluczu już jest, ale jest inne<select id="bi-conf" style="display:block;margin:4px 0 8px"><option value="keep-both">zachowaj oba (nowe pod innym kluczem)</option><option value="replace">podmień moje</option><option value="skip">pomiń</option></select></label>
      <button id="bi-go" class="primary">Dodaj do Moich urządzeń</button></div>`);
    ov!.querySelector('#bi-go')!.addEventListener('click', async () => {
      try {
        const picked = [...ov!.querySelectorAll<HTMLInputElement>('.bi:checked')].map((x) => pack.devices[Number(x.dataset.i)]);
        if (!picked.length) { msg('<div class="imp">Zaznacz co najmniej jedno urządzenie.</div>'); return; }
        const pol = (ov!.querySelector('#bi-conf') as HTMLSelectElement).value as Conflict;
        const res = await c.library.saveDevices(picked, () => pol);
        render(); msg(`<div style="color:#00C853">Dodano: ${res.added.length}, podmieniono: ${res.replaced.length}, pominięto: ${res.skipped.length}.</div>`);
      } catch (err) { msg(`<div style="color:#E53935">${esc(String((err as Error).message)).replace(/\n/g, '<br>')}</div>`); }
    });
  }

  async function importFile() {
    try {
      const r = await c.library.pickDevicesFile(); if (!r) return;
      if (!r.pack) { msg(`<div style="color:#E53935"><b>Plik nie został wczytany:</b><br>${r.errors.slice(0, 6).map(esc).join('<br>')}</div>`); return; }
      importForm(r.pack, r.warnings);
    } catch (err) { msg(`<div style="color:#E53935">${esc(String((err as Error).message))}</div>`); }
  }

  function show() {
    if (ov) { render(); return; }
    ov = document.createElement('div'); ov.id = 'browsedialog'; open = true;
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    ov.innerHTML = `<style>#browsedialog .bw-f{margin-bottom:12px}.bw-fh{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#00C853;margin-bottom:4px}.bw-v{display:flex!important;align-items:center;gap:8px;padding:3px 0;font-size:13px;color:#ddd;cursor:pointer}.bw-v span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bw-v small{color:#8A8A8A;margin-left:auto;padding-left:6px}.bw-v input{accent-color:#00C853}.bw-v.zero{opacity:.45}.bw-v input{display:inline-block!important;width:16px!important;height:16px!important;min-height:0!important;margin:0!important;padding:0!important;flex:none}.bw-v{flex-wrap:nowrap}
      .bw-more{min-height:28px!important;padding:0 8px!important;font-size:12px!important;margin:2px 0!important;background:none!important;border:0!important;color:#64B5F6!important}.bw-r{padding:8px 10px;border-bottom:1px solid #222;cursor:pointer}.bw-r:hover{background:#1A1A1A}.bw-r.on{background:#16301f;outline:1px solid #00C853}.bw-m{color:#8A8A8A;font-size:13px}.bw-s{font-size:12px;color:#B0B0B0;margin-top:2px}.bw-kv{font-size:12px;color:#B0B0B0;margin:4px 0}.bw-box{margin-top:10px;padding:10px;border:1px solid #2A2A2A;border-radius:6px;background:#161616}</style>
      <div class="dlg" style="width:1120px;max-width:96vw;height:86vh;display:flex;flex-direction:column"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><h2 style="margin:0;flex:none">Biblioteka urządzeń</h2>
        <input id="bw-q" type="search" placeholder="Szukaj: model, producent, port…" aria-label="Szukaj w bibliotece" style="flex:1;min-height:40px;padding:0 10px;border-radius:6px;border:1px solid #2A2A2A;background:#121212;color:#fff"><span id="bw-count" class="imp" style="flex:none"></span><button id="bw-clear" style="margin:0">Wyczyść filtry</button></div>
        <div style="display:flex;gap:8px;margin-bottom:8px"><button id="bw-new" class="primary" style="margin:0">+ Nowe urządzenie…</button><button id="bw-newel" style="margin:0">+ Element elektryczny…</button><button id="bw-import" style="margin:0">Importuj urządzenie z pliku…</button><button id="bw-packs" style="margin:0">Pakiety…</button><span style="flex:1"></span><button id="bw-close" style="margin:0">Zamknij</button></div>
        <div style="display:flex;gap:12px;flex:1;min-height:0"><div id="bw-facets" style="width:230px;overflow:auto;flex:none;padding-right:6px"></div><div id="bw-list" style="flex:1;overflow:auto;border:1px solid #2A2A2A;border-radius:6px;min-width:0"></div><div id="bw-detail" style="width:330px;overflow:auto;flex:none"></div></div><div id="bw-msg" style="flex:none;max-height:34vh;overflow:auto"></div></div>`;
    document.body.appendChild(ov);
    const q = ov.querySelector('#bw-q') as HTMLInputElement; q.value = query; q.addEventListener('input', () => { query = q.value; render(); }); q.addEventListener('keydown', (e) => e.stopPropagation());
    ov.querySelector('#bw-close')!.addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#bw-clear')!.addEventListener('click', () => { query = ''; sel = {}; q.value = ''; render(); });
    ov.querySelector('#bw-new')!.addEventListener('click', () => { close(); openDeviceBuilder({ library: c.library as any, say: c.say, addToProject: c.addToProject }); });
    ov.querySelector('#bw-newel')!.addEventListener('click', () => { close(); openElectricalBuilder({ library: c.library as any, say: c.say, addToProject: c.addToProject }); });
    ov.querySelector('#bw-import')!.addEventListener('click', () => void importFile());
    ov.querySelector('#bw-packs')!.addEventListener('click', () => { close(); c.library.openDialogUi(); });
    ov.querySelector('#bw-facets')!.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.f) { sel = toggleSelection(sel, t.dataset.f as any, t.dataset.v!); render(); } });
    ov.querySelector('#bw-facets')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('.bw-more') as HTMLElement | null; if (!b) return; const f = b.dataset.f!; if (expanded.has(f)) expanded.delete(f); else expanded.add(f); render(); });
    ov.querySelector('#bw-list')!.addEventListener('click', (e) => { const r = (e.target as HTMLElement).closest('.bw-r') as HTMLElement | null; if (r) { current = r.dataset.k; render(); } });
    ov.querySelector('#bw-list')!.addEventListener('dblclick', (e) => { const r = (e.target as HTMLElement).closest('.bw-r') as HTMLElement | null; const en = r && byKey(r.dataset.k); if (en) { c.addToProject(en.key, en.model); msg(`<div style="color:#00C853">Dodano „${esc(en.model)}” do projektu.</div>`); } });
    render(); q.focus();
  }
  function close() { ov?.remove(); ov = undefined; open = false; }
  return { show, close, toggle: () => (ov ? close() : show()), isOpen: () => open, importDevicesPack: (raw: unknown) => { const r = c.library.checkDevicesFile(raw); if (!ov) show(); if (r.pack) importForm(r.pack, r.warnings); else msg(`<div style="color:#E53935">${r.errors.map(esc).join('<br>')}</div>`); } };
}
