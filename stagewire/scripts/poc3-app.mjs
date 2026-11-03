// Samotest aplikacji Tauri: benchmark renderera w WebView2/WebKitGTK i eksport PDF z zapisem atomowym przez Rust.
// Użycie: node scripts/poc3-app.mjs [--exe=...] [--tmp=katalog]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const exe = args.exe ?? path.join(root, 'src-tauri/target/release', process.platform === 'win32' ? 'stagewire.exe' : 'stagewire');
const dir = fs.mkdtempSync(path.join(args.tmp ?? os.tmpdir(), 'sw-app-'));
const out = { platform: `${process.platform} ${os.release()}`, runs: [] };

async function run(name, cfg) {
  const resultFile = path.join(dir, `${name}.json`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const c = spawn(exe, [], { env: { ...process.env, STAGEWIRE_SELFTEST: JSON.stringify(cfg), STAGEWIRE_RESULT: resultFile }, stdio: 'ignore' });
    const kill = setTimeout(() => c.kill('SIGKILL'), 180000);
    c.on('exit', (cd) => { clearTimeout(kill); resolve(cd); });
  });
  const res = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { error: 'brak pliku wyniku' };
  out.runs.push({ name, exit: code, wallMs: Date.now() - t0, ...res });
  const b = res.bench;
  console.log(`${name.padEnd(24)} exit=${code} ${res.error ? 'BŁĄD ' + String(res.error).slice(0, 120) : ''}` + (b ? ` fps=${b.fpsMedian} p95=${b.p95FrameMs}ms js=${b.avgJsMs}ms prims=${b.prims} drawn=${b.drawnAvg}` : '') + (res.pdf ? ` pdf=${res.pdf.bytes}B gen=${res.pdf.generateMs}ms` : ''));
  if (res.userAgent && name === 'pdf') console.log('  ' + res.userAgent);
}

await run('pdf', { pdf: { out: path.join(dir, 'plan.pdf'), devices: 300, scale: 200 } });
for (const [view, devices] of [['plan', 1000], ['plan', 2000], ['diagram', 1000], ['diagram', 2000]]) {
  await run(`bench-${view}-${devices}`, { bench: { backend: 'canvas', view, devices, ms: 4000 } });
}
const pdf = path.join(dir, 'plan.pdf');
out.pdfFile = fs.existsSync(pdf) ? { path: pdf, bytes: fs.statSync(pdf).size, header: fs.readFileSync(pdf).subarray(0, 8).toString('latin1') } : null;
if (out.pdfFile) fs.copyFileSync(pdf, path.join(root, 'bench/results', `poc3-plan-${process.platform}.pdf`));
fs.mkdirSync(path.join(root, 'bench/results'), { recursive: true });
const file = path.join(root, 'bench/results', `poc3-app-${process.platform}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log('\nZapisano ' + file);
