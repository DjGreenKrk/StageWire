// Kreator urządzenia: nowe urządzenie od zera albo na wzór istniejącego, gotowe zestawy portów („8 × XLR wejście”), podgląd bloku na żywo,
// sprawdzanie na bieżąco i zapis do „Moje urządzenia” (pojedynczo, bez przepisywania reszty biblioteki).
import { starterRegistries, catalogEntries } from '../src/catalog/index.ts';
import { SOURCE_KINDS, type PackDevice, type PackPort, type SourceKind } from '../src/pack.ts';
import { buildDevice, checkDevice, expandPreset, presetsAvailable, MY_PACK_ID, type DeviceForm } from '../src/deviceBuild.ts';

type Lib = { saveDevices(d: PackDevice[], onConflict?: () => 'replace' | 'keep-both' | 'skip'): Promise<{ added: string[]; replaced: string[]; skipped: string[]; pack: { devices: PackDevice[] } }> };
export interface BuilderCtx {
  library: Lib; say(m: string): void;
  /** Po zapisie: dodanie urządzenia do projektu (klucz w katalogu: `moje-urzadzenia/<klucz>`). */
  addToProject?(entryKey: string, model: string): void;
  /** Urządzenie wyjściowe (kopia istniejącego) i klucz, który ma zostać zastąpiony przy zapisie (edycja własnego urządzenia). */
  prefill?: PackDevice; editKey?: string;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DIRS: [PackPort['direction'], string][] = [['in', 'wejście'], ['out', 'wyjście'], ['io', 'wej./wyj.'], ['loop', 'przelot']];
const KIND_LABEL: Record<SourceKind, string> = { datasheet: 'karta katalogowa producenta', manual: 'instrukcja producenta', measured: 'zmierzone / sprawdzone na egzemplarzu', estimated: 'szacunek (do weryfikacji)', generic: 'urządzenie ogólne', custom: 'własna konfiguracja' };
const numOrNull = (s: string): number | null => { const t = s.trim().replace(',', '.'); if (!t) return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };

export function openDeviceBuilder(c: BuilderCtx) {
  document.getElementById('builddialog')?.remove();
  const reg = starterRegistries, pre = c.prefill;
  const st = {
    manufacturer: pre?.manufacturer ?? '', model: pre?.model ?? '', category: pre?.category ?? '', tags: (pre?.tags ?? []).join(', '), description: pre?.description ?? '',
    w: String(pre?.dimensionsMm?.width ?? ''), d: String(pre?.dimensionsMm?.depth ?? ''), h: String(pre?.dimensionsMm?.height ?? ''),
    weight: pre?.weightKg !== undefined ? String(pre.weightKg) : '', power: pre?.powerW !== undefined ? String(pre.powerW) : '', powerMax: pre?.powerMaxW !== undefined ? String(pre.powerMaxW) : '',
    ru: String(pre?.rackUnits?.heightU ?? ''), ruFrac: String(pre?.rackUnits?.widthFraction ?? 1), din: String(pre?.dinModules ?? ''),
    srcKind: (pre?.source.kind ?? 'custom') as SourceKind, srcRef: pre?.source.ref ?? '', srcUrl: pre?.source.url ?? '', srcVerified: pre?.source.verified ?? '', srcNote: pre?.source.note ?? '',
  };
  const ports: PackPort[] = (pre?.ports ?? []).map((p) => ({ ...p, signals: [...p.signals] }));
  let showMore = !!pre?.dimensionsMm || !!pre?.rackUnits;
  let presetSel = '', presetCount = 8;

  /** Komunikaty walidatora pakietów w zwykłym języku: bez ścieżek typu devices[0] (klucz).pole. */
  const FIELD: Record<string, string> = { manufacturer: 'Producent', model: 'Model', category: 'Kategoria', ports: 'Porty', dimensionsMm: 'Wymiary', weightKg: 'Masa', powerW: 'Moc typowa', powerMaxW: 'Moc maksymalna', source: 'Źródło danych', description: 'Opis', rackUnits: 'Rack', dinModules: 'Moduły DIN', tags: 'Tagi', key: 'Klucz' };
  const human = (m: string): string => {
    if (/brak dimensionsMm/.test(m)) return 'Brak wymiarów: urządzenie nie trafi na plan w skali (uzupełnij w „Wymiary, masa…”).';
    let t = m.replace(/^devices\[0\]( \([^)]*\))?/, '').replace(/^\./, '');
    t = t.replace(/^ports\[(\d+)\]( \([^)]*\))?\.?/, (_x, i) => `Port ${Number(i) + 1}: `);
    t = t.replace(/^(\w+)(\.\w+)?: /, (_x, f) => `${FIELD[f] ?? f}: `).replace(/^[:\s]+/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const o = document.createElement('div'); o.id = 'builddialog';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  document.body.appendChild(o);

  const opts = (kind: string, sel: string) => Object.entries(reg).filter(([, r]) => r.kind === kind).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl')).map(([k, r]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  const sigName = (k: string) => reg[k]?.name ?? k;

  function form(): DeviceForm | string {
    const dims = [numOrNull(st.w), numOrNull(st.d), numOrNull(st.h)], ru = numOrNull(st.ru), din = numOrNull(st.din), wt = numOrNull(st.weight), pw = numOrNull(st.power), pm = numOrNull(st.powerMax);
    if ([...dims, ru, din, wt, pw, pm].some((x) => Number.isNaN(x))) return 'Pola liczbowe: wpisz liczbę (np. 482 albo 2,5)';
    if (dims.some((x) => x === null) && dims.some((x) => x !== null)) return 'Wymiary: podaj wszystkie trzy (szerokość, głębokość, wysokość) albo żadnego';
    return {
      manufacturer: st.manufacturer, model: st.model, category: st.category, tags: st.tags.split(',').map((t) => t.trim()).filter(Boolean), description: st.description,
      dimensionsMm: dims[0] === null ? null : { width: dims[0]!, depth: dims[1]!, height: dims[2]! }, weightKg: wt, powerW: pw, powerMaxW: pm,
      rackUnits: ru === null ? null : { heightU: ru!, widthFraction: Number(st.ruFrac) }, dinModules: din, ports,
      source: { kind: st.srcKind, ...(st.srcRef.trim() ? { ref: st.srcRef.trim() } : {}), ...(st.srcUrl.trim() ? { url: st.srcUrl.trim() } : {}), ...(st.srcVerified.trim() ? { verified: st.srcVerified.trim() } : {}), ...(st.srcNote.trim() ? { note: st.srcNote.trim() } : {}) },
    };
  }
  const takenKeys = () => (c.library as any).takenKeys?.() ?? catalogEntries.filter((e) => e.packId === MY_PACK_ID).map((e) => e.devKey);
  const current = (): { device?: PackDevice; errors: string[]; warnings: string[] } => {
    const f = form(); if (typeof f === 'string') return { errors: [f], warnings: [] };
    const device = buildDevice(f, c.editKey ? [] : takenKeys(), c.editKey), rep = checkDevice(device, { ...reg });
    return { device, errors: rep.errors, warnings: rep.warnings };
  };

  const preview = () => {
    const left = ports.filter((p) => p.direction === 'in' || p.direction === 'loop'), right = ports.filter((p) => p.direction === 'out'), io = ports.filter((p) => p.direction === 'io');
    const col = (list: PackPort[], dot: string) => list.map((p) => `<div style="display:flex;align-items:center;gap:6px;height:18px;font-size:11px;color:#B0B0B0;white-space:nowrap"><i style="width:8px;height:8px;border-radius:4px;background:${dot};flex:none"></i>${esc(p.label)}</div>`).join('');
    return `<div style="border:1px solid #2A2A2A;border-radius:6px;background:#121212;min-width:200px"><div style="padding:6px 10px;font-size:13px;color:#fff;border-bottom:1px solid #2A2A2A">${esc(st.model || 'Nowe urządzenie')}<div style="font-size:11px;color:#8A8A8A">${esc(st.manufacturer || 'producent')}</div></div>
      <div style="display:flex;gap:18px;padding:8px 10px;justify-content:space-between"><div>${col([...left, ...io], '#00C853')}</div><div style="text-align:right">${col(right, '#FFD54F')}</div></div></div>`;
  };

  const redraw = () => {
    const cur = current(), lists = (n: string, vals: string[]) => `<datalist id="${n}">${vals.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
    const mf = [...new Set(catalogEntries.map((e) => e.manufacturer))].sort(), cats = [...new Set(catalogEntries.map((e) => e.category))].sort();
    const fld = (id: string, label: string, v: string, extra = '', list = '') => `<label style="flex:1;min-width:110px">${label}<input id="${id}" value="${esc(v)}" ${list ? `list="${list}" ` : ''}style="display:block;width:100%;margin-top:4px" ${extra}></label>`;
    const presets = presetsAvailable(reg);
    o.innerHTML = `<style>#builddialog .prow>*{min-width:0}#builddialog .prow select,#builddialog .prow input{min-height:38px;padding:0 6px}#builddialog .prow button{padding:0 8px;min-width:34px}</style><div class="dlg" style="width:1040px;max-width:96vw;max-height:92vh"><h2>${c.editKey ? 'Edytuj urządzenie' : pre ? 'Nowe urządzenie na wzór istniejącego' : 'Nowe urządzenie'}</h2>
      ${lists('b-mf', mf)}${lists('b-cat', cats)}
      <div style="display:flex;gap:8px;margin-bottom:8px">${fld('b-model', 'Model *', st.model)}${fld('b-manufacturer', 'Producent *', st.manufacturer, '', 'b-mf')}${fld('b-category', 'Kategoria *', st.category, '', 'b-cat')}${fld('b-tags', 'Tagi (po przecinku)', st.tags)}</div>
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:6px 0;padding:8px;background:#161616;border:1px solid #2A2A2A;border-radius:6px">
            <b style="align-self:center">Dodaj porty:</b>
            <input id="b-pcount" type="number" min="1" max="64" value="${presetCount}" style="width:64px" aria-label="Liczba portów">
            <span style="align-self:center">×</span>
            <select id="b-preset" aria-label="Rodzaj portu" style="flex:1;min-width:180px">${presets.map((p) => `<option value="${p.id}"${p.id === presetSel ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
            <button id="b-padd" class="primary" style="margin:0">Dodaj</button><button id="b-pblank" style="margin:0" title="Pusty wiersz do ręcznego wypełnienia">+ Własny port</button></div>
          <div id="b-rows" style="max-height:34vh;overflow:auto">${ports.map((p, i) => `<div class="prow" data-i="${i}" style="display:flex;gap:6px;margin:3px 0;align-items:center">
            <input class="f-label" value="${esc(p.label)}" aria-label="Nazwa portu" style="flex:1.2;min-width:90px">
            <select class="f-conn" aria-label="Złącze" style="flex:1.2">${opts('connector', p.connector)}</select>
            <select class="f-sig" aria-label="Sygnał" style="flex:1.2" title="${p.signals.length > 1 ? 'Port ma więcej sygnałów: ' + esc(p.signals.map(sigName).join(', ')) : ''}">${opts('signal', p.signals[0])}</select>
            <select class="f-dir" aria-label="Kierunek" style="width:96px;flex:none">${DIRS.map(([v, l]) => `<option value="${v}"${v === p.direction ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <button class="f-up" aria-label="W górę" style="min-height:34px;margin:0" ${i ? '' : 'disabled'}>▲</button><button class="f-dn" aria-label="W dół" style="min-height:34px;margin:0" ${i < ports.length - 1 ? '' : 'disabled'}>▼</button><button class="f-dup" aria-label="Powiel" title="Powiel port" style="min-height:34px;margin:0">⧉</button><button class="f-del" aria-label="Usuń port" style="min-height:34px;margin:0">✕</button></div>`).join('') || '<div class="imp">Brak portów: dodaj je zestawem powyżej albo „Własny port”.</div>'}</div>
        </div>
        <div style="width:200px;flex:none"><div class="imp" style="margin-bottom:4px">Podgląd bloku</div><div id="b-pv">${preview()}</div></div></div>
      <details id="b-more"${showMore ? ' open' : ''} style="margin-top:8px"><summary style="cursor:pointer;color:#00C853;margin:4px 0 8px">Wymiary, masa, zasilanie, rack, opis</summary>
        <div style="display:flex;gap:8px;margin-bottom:8px">${fld('b-w', 'Szerokość [mm]', st.w)}${fld('b-d', 'Głębokość [mm]', st.d)}${fld('b-h', 'Wysokość [mm]', st.h)}${fld('b-weight', 'Masa [kg]', st.weight)}${fld('b-power', 'Moc typowa [W]', st.power)}${fld('b-powermax', 'Moc maks. [W]', st.powerMax)}</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">${fld('b-ru', 'Rack [U] (puste = nie do racka)', st.ru)}<label style="flex:1">Szerokość w racku<select id="b-rufrac" style="display:block;width:100%;margin-top:4px">${['1', '0.5', '0.33'].map((v) => `<option value="${v}"${v === st.ruFrac ? ' selected' : ''}>${v === '1' ? 'pełna' : v === '0.5' ? 'połowa' : 'jedna trzecia'}</option>`).join('')}</select></label>${fld('b-din', 'Moduły DIN (szyna)', st.din)}</div>
        ${fld('b-desc', 'Opis (własnymi słowami, do 400 znaków)', st.description)}</details>
      <details id="b-src" open style="margin-top:6px"><summary style="cursor:pointer;color:#00C853;margin:4px 0 8px">Skąd te dane?</summary>
        <div style="display:flex;gap:8px"><label style="flex:2">Źródło<select id="b-srckind" style="display:block;width:100%;margin-top:4px">${SOURCE_KINDS.map((k) => `<option value="${k}"${k === st.srcKind ? ' selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></label>${fld('b-srcref', 'Dokument / odnośnik', st.srcRef)}${fld('b-srcurl', 'Adres (https://…)', st.srcUrl)}${fld('b-srcver', 'Sprawdzono (RRRR-MM-DD)', st.srcVerified)}</div>
        <p class="imp">Dane wpisuj własnymi słowami i wskaż dokument producenta; nie kopiuj cudzych baz ani opisów. Bez daty sprawdzenia dane są oznaczone jako niezweryfikowane.</p></details>
      <div id="b-check" style="margin:8px 0">${cur.errors.length ? `<div style="color:#E53935"><b>Do poprawienia:</b><ul style="margin:4px 0 0 18px;padding:0">${cur.errors.slice(0, 6).map((e) => `<li>${esc(human(e))}</li>`).join('')}</ul></div>` : '<div style="color:#00C853">Urządzenie jest poprawne.</div>'}${cur.warnings.length ? `<div style="color:#FFD54F;margin-top:4px">${cur.warnings.slice(0, 3).map((w) => esc(human(w))).join('<br>')}</div>` : ''}</div>
      <div class="btns"><button id="bd-save" class="primary"${cur.errors.length ? ' disabled' : ''}>Zapisz w Moich urządzeniach</button>${c.addToProject ? `<button id="bd-saveadd"${cur.errors.length ? ' disabled' : ''}>Zapisz i dodaj do projektu</button>` : ''}<button id="bd-cancel">Anuluj</button></div></div>`;
    const q = (s: string) => o.querySelector(s) as HTMLInputElement;
    const bind = (id: string, key: keyof typeof st, ev = 'input', soft = false) => q(id).addEventListener(ev, (x) => { (st as any)[key] = (x.target as HTMLInputElement).value; if (!soft) { recheck(); refreshPreview(); } });
    for (const [id, key] of [['#b-model', 'model'], ['#b-manufacturer', 'manufacturer'], ['#b-category', 'category'], ['#b-tags', 'tags'], ['#b-w', 'w'], ['#b-d', 'd'], ['#b-h', 'h'], ['#b-weight', 'weight'], ['#b-power', 'power'], ['#b-powermax', 'powerMax'], ['#b-ru', 'ru'], ['#b-din', 'din'], ['#b-desc', 'description'], ['#b-srcref', 'srcRef'], ['#b-srcurl', 'srcUrl'], ['#b-srcver', 'srcVerified']] as const) bind(id, key);
    bind('#b-rufrac', 'ruFrac', 'change'); bind('#b-srckind', 'srcKind', 'change');
    q('#b-more').addEventListener('toggle', (x) => { showMore = (x.target as HTMLDetailsElement).open; });
    o.querySelectorAll('input,select').forEach((x) => x.addEventListener('keydown', (ev) => ev.stopPropagation()));
    q('#b-preset').addEventListener('change', (x) => { presetSel = (x.target as HTMLSelectElement).value; });
    q('#b-pcount').addEventListener('input', (x) => { presetCount = Number((x.target as HTMLInputElement).value) || 1; });
    q('#b-padd').addEventListener('click', () => { const p = presets.find((x) => x.id === (presetSel || presets[0]?.id)); if (!p) return; ports.push(...expandPreset(p, presetCount, ports)); redraw(); });
    q('#b-pblank').addEventListener('click', () => { const n = ports.length + 1; ports.push({ key: `port-${n}-${Math.random().toString(36).slice(2, 5)}`, label: `Port ${n}`, connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }); redraw(); });
    o.querySelectorAll('.prow').forEach((el) => {
      const i = Number((el as HTMLElement).dataset.i), g = (cl: string) => el.querySelector(cl) as HTMLInputElement;
      g('.f-label').addEventListener('input', (x) => { ports[i].label = (x.target as HTMLInputElement).value; recheck(); refreshPreview(); });
      g('.f-conn').addEventListener('change', (x) => { ports[i].connector = (x.target as HTMLInputElement).value; recheck(); });
      g('.f-sig').addEventListener('change', (x) => { ports[i].signals = [(x.target as HTMLInputElement).value, ...ports[i].signals.slice(1).filter((s) => s !== (x.target as HTMLInputElement).value)]; recheck(); });
      g('.f-dir').addEventListener('change', (x) => { ports[i].direction = (x.target as HTMLInputElement).value as PackPort['direction']; redraw(); });
      g('.f-up').addEventListener('click', () => { [ports[i - 1], ports[i]] = [ports[i], ports[i - 1]]; redraw(); });
      g('.f-dn').addEventListener('click', () => { [ports[i + 1], ports[i]] = [ports[i], ports[i + 1]]; redraw(); });
      g('.f-dup').addEventListener('click', () => { const p = ports[i]; ports.splice(i + 1, 0, { ...p, signals: [...p.signals], key: `${p.key}-k${Math.random().toString(36).slice(2, 5)}`, label: p.label + ' (kopia)' }); redraw(); });
      g('.f-del').addEventListener('click', () => { ports.splice(i, 1); redraw(); });
    });
    q('#bd-cancel').addEventListener('click', () => o.remove());
    const save = async (andAdd: boolean) => {
      const now = current(); if (!now.device || now.errors.length) return;
      try {
        const res = await c.library.saveDevices([now.device], () => 'replace');
        o.remove();
        const key = `${MY_PACK_ID}/${now.device.key}`;
        c.say(res.skipped.length ? 'Takie urządzenie już jest w Moich urządzeniach' : `Zapisano „${now.device.model}” w Moich urządzeniach`);
        if (andAdd) c.addToProject?.(key, now.device.model);
      } catch (e) { q('#b-check').innerHTML = `<div style="color:#E53935">${esc(String((e as Error).message)).replace(/\n/g, '<br>')}</div>`; }
    };
    q('#bd-save').addEventListener('click', () => void save(false)); o.querySelector('#bd-saveadd')?.addEventListener('click', () => void save(true));
    // przerysowanie samej części „sprawdzenie” (bez utraty fokusu w polach)
    function recheck() {
      const now = current(), el = o.querySelector('#b-check') as HTMLElement;
      el.innerHTML = `${now.errors.length ? `<div style="color:#E53935"><b>Do poprawienia:</b><ul style="margin:4px 0 0 18px;padding:0">${now.errors.slice(0, 6).map((e) => `<li>${esc(human(e))}</li>`).join('')}</ul></div>` : '<div style="color:#00C853">Urządzenie jest poprawne.</div>'}${now.warnings.length ? `<div style="color:#FFD54F;margin-top:4px">${now.warnings.slice(0, 3).map((w) => esc(human(w))).join('<br>')}</div>` : ''}`;
      for (const id of ['#bd-save', '#bd-saveadd']) { const b = o.querySelector(id) as HTMLButtonElement | null; if (b) b.disabled = now.errors.length > 0; }
    }
    function refreshPreview() { const pv = o.querySelector('#b-pv'); if (pv) pv.innerHTML = preview(); }
  };
  redraw();
}
