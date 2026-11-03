import { invoke } from '@tauri-apps/api/core';
import latinUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import latinExtUrl from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url';
import { syntheticProject } from '../src/synthetic.ts';
import { planDrawList } from '../src/render/drawlist.ts';
import { Autosaver, checkRecovery, type AutosaveIO, type Kind } from '../src/autosave.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { packProject, openProject } from '../src/format.ts';
import { exportPlanPdf } from '../src/render/pdfExport.ts';

/**
 * Samotest w oknie Tauri (PoC-3). Konfiguracja z Rust (STAGEWIRE_SELFTEST), wynik do pliku (STAGEWIRE_RESULT).
 *  - bench: ten sam benchmark rendera co w przeglądarce (web/main.ts), tu w WebView2 (Windows) / WebKitGTK (Linux)
 *  - pdf:   eksport PDF w skali z polskimi znakami, zapis atomowy przez polecenie Rust
 */
const log = (s: string) => { document.getElementById('log')!.textContent += '\n' + s; };
const result: Record<string, unknown> = { userAgent: navigator.userAgent, dpr: devicePixelRatio, screen: `${innerWidth}x${innerHeight}` };

async function main() {
  const cfg: any = await invoke('selftest_config');
  result.cfg = cfg;

  if (cfg.pdf) {
    const t0 = performance.now();
    const fonts = {
      latin: new Uint8Array(await (await fetch(latinUrl)).arrayBuffer()),
      latinExt: new Uint8Array(await (await fetch(latinExtUrl)).arrayBuffer()),
    };
    const p = syntheticProject(cfg.pdf.devices ?? 200, 500, 1, true);
    const dl = planDrawList(p, { cables: true });
    const bytes = await exportPlanPdf(dl, { scale: cfg.pdf.scale ?? 200, paperWidthMm: 420, paperHeightMm: 297, fonts, title: 'Plan', titleBlock: ['Zażółć gęślą jaźń — StageWire', 'Skala 1:' + (cfg.pdf.scale ?? 200)] });
    const genMs = performance.now() - t0;
    const sha: string = await invoke('save_project', { path: cfg.pdf.out, data: Array.from(bytes) });
    result.pdf = { bytes: bytes.length, generateMs: Math.round(genMs), sha256: sha, prims: dl.prims.length };
    log('PDF ok ' + bytes.length);
  }

  if (cfg.autosave) {
    // Scenariusze autozapisu w prawdziwej aplikacji: edit (edycja + autozapis, bez zapisu użytkownika), recover (decyzja przy otwarciu), save (zapis użytkownika)
    const a = cfg.autosave, paths: Record<Kind, string> = { main: a.path, autosave: a.path + '.autosave' };
    const io: AutosaveIO = {
      read: async (k) => { const r: any = await invoke('read_file', { path: paths[k] }); return r ? { bytes: new Uint8Array(r.bytes), mtimeMs: r.mtime_ms } : undefined; },
      write: async (k, b) => { await invoke(k === 'main' ? 'save_project' : 'save_autosave', { path: paths[k], data: Array.from(b) }); },
      remove: async (k) => { await invoke('remove_file', { path: paths[k] }); },
    };
    const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: unknown) => clearTimeout(h as number) };
    const loadMain = async () => { const m = await io.read('main'); const r = m ? openProject(m.bytes) : undefined; return r?.status === 'ok' ? r.project : undefined; };
    if (a.mode === 'init') {
      await io.write('main', packProject(syntheticProject(8, 8, 1, true)));
      result.autosave = { mode: 'init', ok: true };
    } else if (a.mode === 'edit') {
      const store = new Store((await loadMain())!); const as = new Autosaver(store, io, clock, { idleMs: 300, maxMs: 2000 });
      const ids = Object.keys(store.state.equipment);
      for (let k = 0; k < 3; k++) { store.dispatch('e' + k, cmd.connect({ instanceId: ids[0], portId: `prt_out${4 + k}` }, { instanceId: ids[1], portId: `prt_in${4 + k}` }, 'std/sdi-3g')); as.notify(); }
      await new Promise((r) => setTimeout(r, 1200));
      result.autosave = { mode: 'edit', connections: Object.keys(store.state.connections).length, dirty: as.dirty, lastError: as.lastError ?? null, autosaveExists: !!(await io.read('autosave')) };
      if (a.hang) { await invoke('write_result', { json: JSON.stringify(result) }); await new Promise(() => {}); } // symulacja awarii: proces zostanie zabity z zewnątrz, bez zapisu użytkownika
    } else if (a.mode === 'recover') {
      const r = await checkRecovery(io);
      result.autosave = { mode: 'recover', kind: r.kind, connections: r.kind === 'offer' ? Object.keys(r.project.connections).length : null, reason: (r as any).reason ?? null };
      if (r.kind === 'offer' && a.accept) { await io.write('main', packProject(r.project)); await io.remove('autosave'); result.autosave = { ...(result.autosave as object), accepted: true, mainAfter: Object.keys((await loadMain())!.connections).length, autosaveLeft: !!(await io.read('autosave')) }; }
    }
  }

  if (cfg.bench) {
    const b = cfg.bench;
    history.replaceState(null, '', `?backend=${b.backend ?? 'canvas'}&view=${b.view ?? 'diagram'}&devices=${b.devices ?? 1000}&scenario=pan&ms=${b.ms ?? 4000}`);
    await import('./main.ts');
    await new Promise<void>((resolve, reject) => {
      const t = setInterval(() => { if ((window as any).__result) { clearInterval(t); resolve(); } }, 100);
      setTimeout(() => { clearInterval(t); reject(new Error('timeout benchmarku')); }, 120000);
    });
    result.bench = (window as any).__result;
    log('bench ok');
  }
}

main()
  .catch((e) => { result.error = String(e?.stack ?? e); })
  .finally(async () => {
    await invoke('write_result', { json: JSON.stringify(result) });
    await invoke('exit_app');
  });
