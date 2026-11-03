// Biblioteka urządzeń użytkownika: wczytywanie pakietów z folderu, import, eksport urządzeń projektu, zapis do „Moje urządzenia”.
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { Project, DefinitionRevision, RegistryEntry } from '../src/types.ts';
import type { Mutator } from '../src/store.ts';
import { loadPack, planInstall, installPack, loadedPacks, starterRegistries, STARTER_ID, BUILTIN_IDS, type InstallPlan } from '../src/catalog/index.ts';
import { libraryUpdates, updateFromCatalog } from '../src/definitions.ts';
import { validatePack, revisionToDevice, deviceKeyFor, defKeyOf, type Pack, type PackDevice } from '../src/pack.ts';
import { mergeIntoMine, mergeEnclosureIntoMine, removeFromPack, registriesFor, singleDevicePack, type Conflict, type MergeResult } from '../src/deviceBuild.ts';

export interface LibFileReport { name: string; path: string; errors: string[]; warnings: string[]; packId?: string }
export const MY_PACK_ID = 'moje-urzadzenia';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const bump = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.1'; };

export interface LibraryCtx {
  inTauri: boolean;
  project(): Project;
  say(m: string): void;
  ask(title: string, text: string, buttons: [string, string][]): Promise<string>;
  /** Po zmianie katalogu (wczytanie/zapis pakietu). */
  changed(): void;
  /** Wykonuje polecenie na projekcie (jeden krok cofania) i odświeża widoki. */
  apply(label: string, m: Mutator): void;
}

export function createLibrary(ctx: LibraryCtx) {
  let dir = '';
  let report: LibFileReport[] = [];
  const paths = new Map<string, string>(); // id pakietu → plik

  /** Wczytuje pakiety z folderu biblioteki (tylko w aplikacji); błędne pliki są raportowane, nie przerywają startu. */
  async function init() {
    if (!ctx.inTauri) return;
    try {
      dir = await invoke<string>('library_dir');
      const files = await invoke<{ path: string; name: string; text: string }[]>('list_library', { dir });
      report = [];
      // pakiety zależne od rejestrów z innych plików czekają na kolejny przebieg (kolejność plików nie ma znaczenia)
      let queue: { name: string; path: string; raw: unknown }[] = [];
      for (const f of files) {
        try { queue.push({ name: f.name, path: f.path, raw: JSON.parse(f.text) }); }
        catch (e) { report.push({ name: f.name, path: f.path, errors: ['Plik nie jest poprawnym JSON: ' + String((e as Error).message).slice(0, 120)], warnings: [] }); }
      }
      for (let pass = 0; queue.length && pass <= files.length; pass++) {
        const retry: typeof queue = [];
        for (const f of queue) {
          const plan = planInstall(f.raw);
          if (plan.errors[0]?.startsWith('Brakujące wpisy rejestrów') && pass < files.length && queue.length > 1) { retry.push(f); continue; }
          if (plan.pack && BUILTIN_IDS.has(plan.pack.id)) { report.push({ name: f.name, path: f.path, errors: [`Pakiet o id „${plan.pack.id}” jest zarezerwowany dla pakietu wbudowanego`], warnings: [] }); continue; }
          const r = plan.errors.length ? plan : installPack(f.raw);
          if (!plan.errors.length) paths.set(plan.pack!.id, f.path);
          report.push({ name: f.name, path: f.path, errors: r.errors, warnings: r.warnings, packId: plan.errors.length ? undefined : plan.pack?.id });
        }
        if (retry.length === queue.length) { for (const f of retry) { const plan = planInstall(f.raw); report.push({ name: f.name, path: f.path, errors: plan.errors, warnings: plan.warnings }); } break; }
        queue = retry;
      }
    } catch (e) { report = [{ name: '(folder biblioteki)', path: dir, errors: [String(e)], warnings: [] }]; }
  }

  const writeFile = (path: string, text: string) => invoke('save_autosave', { path, data: Array.from(new TextEncoder().encode(text)) });
  const readJson = async (path: string): Promise<unknown> => { const r: any = await invoke('read_file', { path }); if (!r) throw new Error('Plik nie istnieje'); return JSON.parse(new TextDecoder().decode(new Uint8Array(r.bytes))); };

  /** Zbiór wpisów rejestrów użytych przez porty, których nie ma w pakiecie startowym (do dołączenia do pakietu użytkownika). */
  function neededRegistries(p: Project, revs: DefinitionRevision[]): Record<string, RegistryEntry> {
    const out: Record<string, RegistryEntry> = {}; const base: Record<string, RegistryEntry> = {}; for (const bp of loadedPacks()) if (BUILTIN_IDS.has(bp.id)) Object.assign(base, bp.registries ?? {});
    const want = new Set<string>(); for (const r of revs) for (const q of Object.values(r.ports)) { want.add(q.connectorKey); q.signalKeys.forEach((s) => want.add(s)); }
    for (const k of want) if (!base[k]) { const e = p.registries[k] ?? starterRegistries[k]; if (e) out[k] = JSON.parse(JSON.stringify(e)); }
    return out;
  }

  /** Zapisuje urządzenie (rewizję definicji z projektu) do pakietu „Moje urządzenia”; zwraca komunikat lub rzuca błąd z listą problemów. */
  async function saveToMyLibrary(rev: DefinitionRevision, existingKey?: string): Promise<string> {
    if (!ctx.inTauri) throw new Error('Biblioteka użytkownika działa w aplikacji');
    if (!dir) await init();
    const file = `${dir}/${MY_PACK_ID}.swpack.json`.replace(/\\/g, '/');
    let pack: Pack | undefined = loadedPacks().find((x) => x.id === MY_PACK_ID);
    if (!pack) pack = { format: 'stagewire-pack/1', id: MY_PACK_ID, name: 'Moje urządzenia', version: '1.0.0', license: 'własne (do użytku wewnętrznego)', description: 'Urządzenia utworzone lub zmienione w StageWire.', devices: [] };
    const copy: Pack = JSON.parse(JSON.stringify(pack));
    const mine = existingKey && existingKey.startsWith(MY_PACK_ID + '/') ? existingKey.slice(MY_PACK_ID.length + 1) : undefined;
    const key = mine && copy.devices.some((d) => d.key === mine) ? mine : deviceKeyFor(rev.model, copy.devices.map((d) => d.key));
    const dev: PackDevice = revisionToDevice(rev, key);
    const i = copy.devices.findIndex((d) => d.key === key); if (i >= 0) copy.devices[i] = dev; else copy.devices.push(dev);
    copy.registries = { ...(copy.registries ?? {}), ...neededRegistries(ctx.project(), [rev]) };
    copy.version = bump(copy.version);
    const rep = validatePack(copy, { ...starterRegistries });
    if (!rep.pack) throw new Error('Urządzenia nie da się zapisać do biblioteki:\n' + rep.errors.slice(0, 8).join('\n'));
    await writeFile(file, JSON.stringify(copy, null, 2) + '\n');
    loadPack(copy); paths.set(MY_PACK_ID, file); ctx.changed();
    return `${i >= 0 ? 'Zaktualizowano' : 'Dodano'} „${rev.model}” w pakiecie „${copy.name}” (${copy.devices.length} urządzeń)`;
  }

  // ---------- okno biblioteki ----------
  function reportHtml(errors: string[], warnings: string[]) {
    return `${errors.length ? `<div style="color:#E53935;font-size:12px;margin:4px 0">${errors.slice(0, 12).map(esc).join('<br>')}${errors.length > 12 ? `<br>… i ${errors.length - 12} więcej` : ''}</div>` : ''}${warnings.length ? `<div style="color:#FFD54F;font-size:12px;margin:4px 0">${warnings.slice(0, 6).map(esc).join('<br>')}${warnings.length > 6 ? `<br>… i ${warnings.length - 6} więcej` : ''}</div>` : ''}`;
  }

  const STATUS_TITLE: Record<string, string> = { upgrade: 'Nowsza wersja pakietu', downgrade: 'Starsza wersja pakietu', 'changed-same-version': 'Ta sama wersja, inna treść' };
  function installSummary(plan: InstallPlan): string {
    const have = plan.previous!, n = plan.pack!;
    const head = plan.status === 'upgrade' ? `Pakiet „${esc(have.name)}” zostanie zastąpiony nowszą wersją: ${esc(have.version)} → ${esc(n.version)}.`
      : plan.status === 'downgrade' ? `Wczytana jest nowsza wersja (${esc(have.version)}) niż importowana (${esc(n.version)}). Zastąpienie cofnie pakiet do starszej wersji.`
        : `Importowany plik ma tę samą wersję (${esc(n.version)}), ale inną treść niż wczytany. Zalecana zmiana numeru wersji w pakiecie.`;
    const list = (t: string, a: string[]) => (a.length ? `<br>${t}: ${a.slice(0, 8).map(esc).join(', ')}${a.length > 8 ? ` … (+${a.length - 8})` : ''}` : '');
    return `${head}${list('Dodane urządzenia', plan.added)}${list('Zmienione', plan.changed)}${list('Usunięte z pakietu', plan.removed)}${list('Uwaga, zmiany łamiące zgodność', plan.breaking)}<br><br>Istniejące projekty mają własne kopie definicji i nie zostaną zmienione.`;
  }

  /** Sekcja okna: definicje projektu, dla których wczytany pakiet ma nowszą wersję. Aktualizacja zawsze jest jawna i cofalna. */
  function updatesHtml(): string {
    const ups = libraryUpdates(ctx.project());
    if (!ups.length) return '';
    return `<h3 style="margin:12px 0 4px;font-size:13px">Aktualizacje w projekcie (${ups.length})</h3>
      <div class="imp">Pakiet w bibliotece jest nowszy niż definicja w projekcie. Nowa rewizja nie zmienia istniejących urządzeń, dopóki ich nie przepniesz; przepięcie usuwa połączenia z portów, których nowa wersja już nie ma. Obie operacje można cofnąć.</div>
      <table class="rt"><thead><tr><th>Urządzenie</th><th>Wersja</th><th>Zmiany portów</th><th>Użycia</th><th></th></tr></thead><tbody>${ups.map((u, i) => `<tr><td>${esc(u.model)}</td><td>${esc(u.fromVersion)} → ${esc(u.toVersion)}</td>
        <td>${u.descriptive ? 'tylko opis i parametry' : [u.added.length ? `+ ${esc(u.added.join(', '))}` : '', u.removed.length ? `<span style="color:#E53935">− ${esc(u.removed.join(', '))}</span>` : '', u.changed.length ? `zmienione: ${esc(u.changed.join(', '))}` : ''].filter(Boolean).join('<br>')}</td>
        <td>${u.instances}${u.lostConnections ? `<br><small style="color:#FFD54F">przepięcie usunie ${u.lostConnections} poł.</small>` : ''}</td>
        <td style="white-space:nowrap"><button class="u-new" data-i="${i}">Nowa rewizja</button> <button class="u-all" data-i="${i}">Nowa rewizja i przepnij</button></td></tr>`).join('')}</tbody></table>`;
  }

  function openDialogUi() {
    const ov = document.createElement('div'); ov.id = 'libdialog';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    document.body.appendChild(ov);
    const redraw = () => {
      const packs = loadedPacks(), bad = report.filter((r) => r.errors.length);
      ov.innerHTML = `<div class="dlg" style="width:880px"><h2>Biblioteka urządzeń</h2>
        <div class="imp">Folder biblioteki: <b>${esc(dir || '(niedostępny poza aplikacją)')}</b><br>Pakiety to pliki <code>*.swpack.json</code>; opis formatu i zasady tworzenia bazy: dokument DEVICE-DB.md.</div>
        <div class="rwrap"><table class="rt"><thead><tr><th>Pakiet</th><th>Wersja</th><th>Urządzeń</th><th>Licencja</th><th>Plik</th></tr></thead><tbody>${packs.map((p) => {
          const rp = report.find((r) => r.packId === p.id);
          return `<tr><td>${esc(p.name)}<br><small style="color:#B0B0B0">${esc(p.id)}</small>${rp ? reportHtml([], rp.warnings) : ''}</td><td>${esc(p.version)}</td><td>${p.devices.length}</td><td>${esc(p.license)}</td><td>${BUILTIN_IDS.has(p.id) ? 'wbudowany' : esc((paths.get(p.id) ?? '').split(/[\\/]/).pop() ?? '')}</td></tr>`;
        }).join('')}</tbody></table>
        ${bad.length ? `<h3 style="color:#E53935;margin:12px 0 4px;font-size:13px">Pliki, których nie wczytano (${bad.length})</h3>${bad.map((r) => `<div><b>${esc(r.name)}</b>${reportHtml(r.errors, r.warnings)}</div>`).join('')}` : ''}</div>
        ${updatesHtml()}
        <div id="lib-out"></div>
        <div class="btns"><button id="l-import">Importuj pakiet…</button><button id="l-export">Eksportuj urządzenia projektu…</button><button id="l-reload">Wczytaj ponownie</button><button id="l-close" class="primary">Zamknij</button></div></div>`;
      const out = ov.querySelector('#lib-out') as HTMLElement;
      ov.querySelector('#l-close')!.addEventListener('click', () => ov.remove());
      ov.querySelector('#l-reload')!.addEventListener('click', async () => { await init(); ctx.changed(); redraw(); });
      ov.querySelector('#l-import')!.addEventListener('click', async () => {
        if (!ctx.inTauri) { out.textContent = 'Import działa w aplikacji'; return; }
        try {
          const f = await openDialog({ filters: [{ name: 'Pakiet urządzeń', extensions: ['json'] }], multiple: false }); if (typeof f !== 'string') return;
          const raw = await readJson(f), plan = planInstall(raw);
          if (!plan.pack || plan.errors.length) { out.innerHTML = `<div style="color:#E53935"><b>Pakiet nie został zaimportowany (nic nie zmieniono):</b></div>${reportHtml(plan.errors, plan.warnings)}`; return; }
          if (BUILTIN_IDS.has(plan.pack.id)) { out.innerHTML = `<div style="color:#E53935">Id „${plan.pack.id}” jest zarezerwowane dla pakietu wbudowanego.</div>`; return; }
          if (plan.status === 'identical') { out.innerHTML = `<div style="color:#FFD54F">Ten sam pakiet („${esc(plan.pack.name)}” ${esc(plan.pack.version)}) jest już wczytany. Nic nie zmieniono.</div>`; return; }
          if (plan.status !== 'new') { const c = await ctx.ask(STATUS_TITLE[plan.status!], installSummary(plan), [['no', 'Anuluj'], ['go', plan.status === 'downgrade' ? 'Zastąp starszą wersją' : 'Zastąp']]); if (c !== 'go') return; }
          const target = `${dir}/${plan.pack.id}.swpack.json`.replace(/\\/g, '/');
          await writeFile(target, JSON.stringify(plan.pack, null, 2) + '\n'); installPack(plan.pack); paths.set(plan.pack.id, target); ctx.changed();
          const msg = `<div style="color:#00C853">Zaimportowano „${esc(plan.pack.name)}” ${esc(plan.pack.version)} (${plan.pack.devices.length} urządzeń${plan.newRegistries.length ? `, nowych wpisów rejestrów: ${plan.newRegistries.length}` : ''}${plan.reusedRegistries.length ? `, współdzielonych: ${plan.reusedRegistries.length}` : ''}).</div>${plan.previous ? '<div style="color:#B0B0B0;font-size:12px">Otwarte projekty nie zostały zmienione. Aktualizację ich definicji wykonasz poniżej, w sekcji „Aktualizacje w projekcie”.</div>' : ''}${reportHtml([], plan.warnings)}`;
          redraw(); (ov.querySelector('#lib-out') as HTMLElement).innerHTML = msg;
        } catch (e) { out.textContent = 'Błąd importu: ' + String(e); }
      });
      ov.querySelector('#l-export')!.addEventListener('click', () => exportUi(out));
      const ups = libraryUpdates(ctx.project());
      for (const b of ov.querySelectorAll<HTMLButtonElement>('.u-new, .u-all')) b.addEventListener('click', () => {
        const u = ups[Number(b.dataset.i)], all = b.classList.contains('u-all');
        try { ctx.apply(`Aktualizuj ${u.model} z biblioteki`, updateFromCatalog(u.defId, all ? 'all' : 'none')); redraw(); (ov.querySelector('#lib-out') as HTMLElement).innerHTML = `<div style="color:#00C853">Utworzono nową rewizję „${esc(u.model)}”${all ? ' i przepięto urządzenia' : '; istniejące urządzenia zostają na starej rewizji (przepniesz je przyciskiem „Aktualizuj” w panelu urządzenia)'}.</div>`; }
        catch (e) { (ov.querySelector('#lib-out') as HTMLElement).innerHTML = `<div style="color:#E53935">${esc(String((e as Error).message))}</div>`; }
      });
    };
    redraw();
  }

  /** Eksport wybranych definicji projektu (poza pochodzącymi z pakietu startowego) do pliku pakietu. */
  function exportUi(out: HTMLElement) {
    const p = ctx.project();
    // własne i zmienione względem pakietu (rewizja > 1); niezmienione z pakietów są już dostępne w programie
    const defs = Object.entries(p.definitions).filter(([, d]) => d.latestRevision > 1 || !d.revisions[String(d.latestRevision)].origin?.packId);
    if (!defs.length) { out.innerHTML = '<div style="color:#FFD54F">W projekcie nie ma własnych ani zmienionych definicji do wyeksportowania (urządzenia z pakietów są już dostępne w programie).</div>'; return; }
    out.innerHTML = `<div class="dlg" style="width:auto;padding:12px;margin-top:8px;border:1px solid #2A2A2A"><b>Eksport do pakietu</b>
      <div style="display:flex;gap:8px;margin:8px 0"><label style="flex:1">Id pakietu<input id="e-id" style="display:block;width:100%" value="moj-pakiet"></label><label style="flex:2">Nazwa<input id="e-name" style="display:block;width:100%" value="Mój pakiet"></label><label style="width:90px">Wersja<input id="e-ver" style="display:block;width:100%" value="1.0.0"></label></div>
      <div style="display:flex;gap:8px;margin-bottom:8px"><label style="flex:1">Autor<input id="e-author" style="display:block;width:100%"></label><label style="flex:2">Licencja / warunki<input id="e-lic" style="display:block;width:100%" value="własne (do użytku wewnętrznego)"></label></div>
      ${defs.map(([id, d], i) => { const r = d.revisions[String(d.latestRevision)]; return `<label class="chk"><input type="checkbox" class="e-def" data-i="${i}" checked> ${esc(r.manufacturer)} ${esc(r.model)} <small style="color:#B0B0B0">(${Object.keys(r.ports).length} portów, rewizja ${d.latestRevision})</small></label>`; }).join('')}
      <div class="btns"><button id="e-go" class="primary">Zapisz pakiet…</button></div><div id="e-out"></div></div>`;
    for (const i of out.querySelectorAll('input')) i.addEventListener('keydown', (ev) => ev.stopPropagation());
    const v = (s: string) => (out.querySelector(s) as HTMLInputElement).value.trim();
    out.querySelector('#e-go')!.addEventListener('click', async () => {
      const eo = out.querySelector('#e-out') as HTMLElement;
      try {
        const picked = [...out.querySelectorAll<HTMLInputElement>('.e-def')].filter((c) => c.checked).map((c) => defs[Number(c.dataset.i)]);
        if (!picked.length) { eo.textContent = 'Zaznacz co najmniej jedno urządzenie'; return; }
        const keys: string[] = [], devices: PackDevice[] = [], revs: DefinitionRevision[] = [];
        for (const [, d] of picked) { const r = d.revisions[String(d.latestRevision)]; const k = deviceKeyFor(r.model, keys); keys.push(k); devices.push(revisionToDevice(r, k)); revs.push(r); }
        const pack: Pack = { format: 'stagewire-pack/1', id: v('#e-id'), name: v('#e-name'), version: v('#e-ver'), ...(v('#e-author') ? { author: v('#e-author') } : {}), license: v('#e-lic'), registries: neededRegistries(p, revs), devices };
        const rep = validatePack(pack, { ...starterRegistries });
        if (!rep.pack) { eo.innerHTML = `<div style="color:#E53935">Pakiet nie przeszedł walidacji:</div>${reportHtml(rep.errors, rep.warnings)}`; return; }
        const target = await saveDialog({ filters: [{ name: 'Pakiet urządzeń', extensions: ['json'] }], defaultPath: `${dir}/${pack.id}.swpack.json` }); if (!target) return;
        await writeFile(target, JSON.stringify(pack, null, 2) + '\n');
        eo.innerHTML = `<div style="color:#00C853">Zapisano ${devices.length} urządzeń.</div>${reportHtml([], rep.warnings)}`;
      } catch (e) { eo.textContent = 'Błąd eksportu: ' + String(e); }
    });
  }

  // ---------- pojedyncze urządzenia: dopisywanie do „Moje urządzenia”, eksport jednego, import z pliku ----------
  const myFile = () => `${dir}/${MY_PACK_ID}.swpack.json`.replace(/\\/g, '/');
  /** Zapisuje pakiet „Moje urządzenia” (tylko ten jeden plik) i wczytuje go do katalogu; przy błędzie nic się nie zmienia. W przeglądarce (bez plików) zmiana obowiązuje do zamknięcia. */
  async function persistMine(pack: Pack): Promise<void> {
    const plan = planInstall(pack);
    if (!plan.pack || plan.errors.length) throw new Error('Pakiet nie przeszedł walidacji:\n' + plan.errors.slice(0, 8).join('\n'));
    if (ctx.inTauri) { if (!dir) await init(); await writeFile(myFile(), JSON.stringify(plan.pack, null, 2) + '\n'); paths.set(MY_PACK_ID, myFile()); }
    installPack(plan.pack); ctx.changed();
  }
  const myPack = (): Pack | undefined => loadedPacks().find((x) => x.id === MY_PACK_ID);
  /** Dodaje urządzenia do „Moje urządzenia” bez ruszania reszty biblioteki. */
  async function saveDevices(devices: PackDevice[], onConflict?: (d: PackDevice) => Conflict): Promise<MergeResult> {
    const res = mergeIntoMine(myPack(), devices, { ...starterRegistries, ...registriesFor(devices, starterRegistries) }, onConflict);
    res.pack.registries = registriesFor(res.pack.devices, { ...starterRegistries, ...(res.pack.registries ?? {}) });
    if (res.added.length || res.replaced.length) await persistMine(res.pack);
    return res;
  }
  /** Dopisuje obudowę (szablon szafy) do „Moje urządzenia”. */
  async function saveEnclosure(enc: import('../src/pack.ts').PackEnclosure): Promise<{ replaced: boolean }> {
    const res = mergeEnclosureIntoMine(myPack(), enc, { ...starterRegistries });
    await persistMine(res.pack); return { replaced: res.replaced };
  }
  async function removeMine(key: string): Promise<void> {
    const mp = myPack(); if (!mp) return;
    await persistMine(removeFromPack(mp, key));
  }
  /** Eksport jednego urządzenia do samowystarczalnego pliku (z rejestrami, autorem i licencją), gotowego do wysłania komuś. */
  async function exportDevice(d: PackDevice, meta: { author?: string; license: string }): Promise<string | undefined> {
    if (!ctx.inTauri) throw new Error('Eksport działa w aplikacji');
    const { pack, report: rep } = singleDevicePack(d, starterRegistries, meta);
    if (!rep.pack) throw new Error('Urządzenia nie da się wyeksportować:\n' + rep.errors.slice(0, 6).join('\n'));
    if (!dir) await init();
    const name = `${d.manufacturer}-${d.model}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    const target = await saveDialog({ filters: [{ name: 'Urządzenie StageWire', extensions: ['json'] }], defaultPath: `${name}.swpack.json` }); if (!target) return undefined;
    await writeFile(target, JSON.stringify(pack, null, 2) + '\n'); return target;
  }
  /** Wybór pliku z jednym lub kilkoma urządzeniami; zwraca sprawdzony pakiet (bez wczytywania go do katalogu). */
  async function pickDevicesFile(): Promise<{ pack?: Pack; errors: string[]; warnings: string[] } | undefined> {
    if (!ctx.inTauri) throw new Error('Import działa w aplikacji');
    const f = await openDialog({ filters: [{ name: 'Urządzenie / pakiet StageWire', extensions: ['json'] }], multiple: false }); if (typeof f !== 'string') return undefined;
    return checkDevicesFile(await readJson(f));
  }
  function checkDevicesFile(raw: unknown): { pack?: Pack; errors: string[]; warnings: string[] } {
    const rep = validatePack(raw, { ...starterRegistries });
    if (rep.pack && !rep.pack.devices.length) return { errors: ['Plik nie zawiera urządzeń (to pakiet samych rejestrów)'], warnings: rep.warnings };
    return rep;
  }

  return { init, openDialogUi, saveToMyLibrary, saveDevices, saveEnclosure, removeMine, exportDevice, pickDevicesFile, checkDevicesFile, myPack, report: () => report, dir: () => dir, defKeyOf };
}
