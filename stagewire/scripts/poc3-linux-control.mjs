// Kontrola WebKitGTK: czy niskie fps pochodzi z renderera, czy z prezentacji klatek (WSLg/RDP, sterownik GL)?
// Uruchamia samotest z pustą/małą sceną i różnymi zmiennymi środowiskowymi WebKit/Mesa.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const exe = args.exe ?? path.join(root, 'src-tauri/target/release/stagewire');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ctl-'));
const variants = {
  domyslne: {},
  'bez-kompozycji': { WEBKIT_DISABLE_COMPOSITING_MODE: '1' },
  'bez-dmabuf': { WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  'GL-programowe': { LIBGL_ALWAYS_SOFTWARE: '1' },
  'bez-dmabuf+bez-kompozycji': { WEBKIT_DISABLE_DMABUF_RENDERER: '1', WEBKIT_DISABLE_COMPOSITING_MODE: '1' },
  'x11': { GDK_BACKEND: 'x11' },
};
const scenes = [['plan', 20], ['plan', 1000], ['diagram', 1000]];
const rows = [];
for (const [vname, env] of Object.entries(variants)) for (const [view, devices] of scenes) {
  const rf = path.join(dir, `${vname}-${view}-${devices}.json`);
  const cfg = { bench: { backend: 'canvas', view, devices, ms: 3000 } };
  const code = await new Promise((resolve) => {
    const c = spawn(exe, [], { env: { ...process.env, ...env, STAGEWIRE_SELFTEST: JSON.stringify(cfg), STAGEWIRE_RESULT: rf }, stdio: 'ignore' });
    const k = setTimeout(() => c.kill('SIGKILL'), 90000);
    c.on('exit', (cd) => { clearTimeout(k); resolve(cd); });
  });
  const r = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : { error: 'brak wyniku' };
  const b = r.bench;
  rows.push({ variant: vname, view, devices, exit: code, fps: b?.fpsMedian, p95: b?.p95FrameMs, js: b?.avgJsMs, error: r.error });
  console.log(`${vname.padEnd(28)} ${view.padEnd(8)} ${String(devices).padStart(5)}  exit=${code} fps=${b?.fpsMedian} p95=${b?.p95FrameMs}ms js=${b?.avgJsMs}ms ${r.error ? 'BŁĄD ' + String(r.error).slice(0, 80) : ''}`);
}
fs.mkdirSync(path.join(root, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'bench/results', `poc3-linux-control.json`), JSON.stringify({ platform: `${process.platform} ${os.release()}`, rows }, null, 2));
