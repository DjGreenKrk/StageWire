// Autozapis i odzyskiwanie w prawdziwej aplikacji Tauri, z zabiciem procesu (symulacja awarii).
// Użycie: node scripts/poc3-autosave.mjs [--exe=...] [--tmp=katalog]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const exe = args.exe ?? path.join(root, 'src-tauri/target/release', process.platform === 'win32' ? 'stagewire.exe' : 'stagewire');
const dir = fs.mkdtempSync(path.join(args.tmp ?? os.tmpdir(), 'sw-as-'));
const proj = path.join(dir, 'projekt.sw'), auto = proj + '.autosave';
let n = 0;
const checks = [];
const check = (name, ok, info) => { checks.push({ name, ok, info }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + JSON.stringify(info) : ''}`); };

async function run(cfg, { killAfterResult = false } = {}) {
  const rf = path.join(dir, `r${n++}.json`);
  const c = spawn(exe, [], { env: { ...process.env, STAGEWIRE_SELFTEST: JSON.stringify({ autosave: { path: proj, ...cfg } }), STAGEWIRE_RESULT: rf }, stdio: 'ignore' });
  const done = new Promise((r) => c.on('exit', (cd, sig) => r({ code: cd, sig })));
  const t0 = Date.now();
  while (!fs.existsSync(rf) && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
  if (killAfterResult) c.kill('SIGKILL');
  const ex = await Promise.race([done, new Promise((r) => setTimeout(() => { c.kill('SIGKILL'); r({ code: 'timeout' }); }, 30000))]);
  const res = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : { error: 'brak wyniku' };
  return { ...res, exit: ex };
}

const r0 = await run({ mode: 'init' });
check('utworzenie projektu', fs.existsSync(proj) && !r0.error, r0.error);
const mainBefore = fs.readFileSync(proj);

const r1 = await run({ mode: 'edit', hang: true }, { killAfterResult: true });
check('edycja + autozapis przed awarią (proces zabity)', r1.autosave?.autosaveExists === true && r1.autosave?.dirty === true, r1.autosave ?? r1.error);
check('plik projektu NIE został zmieniony przez autozapis', Buffer.compare(mainBefore, fs.readFileSync(proj)) === 0);
check('autozapis jest w pliku', fs.existsSync(auto));

// przed odzyskaniem: wymuś, by autozapis był nowszy niż projekt (rozdzielczość mtime)
const later = new Date(Date.now() + 2000); fs.utimesSync(auto, later, later);
const r2 = await run({ mode: 'recover' });
check('po awarii: oferta odzyskania z 11 połączeniami', r2.autosave?.kind === 'offer' && r2.autosave?.connections === 11, r2.autosave ?? r2.error);

const r3 = await run({ mode: 'recover', accept: true });
check('przyjęcie odzyskania: projekt ma 11 połączeń, autozapis usunięty', r3.autosave?.accepted && r3.autosave?.mainAfter === 11 && r3.autosave?.autosaveLeft === false, r3.autosave ?? r3.error);
const r4 = await run({ mode: 'recover' });
check('kolejne otwarcie: brak oferty', r4.autosave?.kind === 'none', r4.autosave);

// uszkodzony autozapis (urwany zapis)
fs.writeFileSync(auto, fs.readFileSync(proj).subarray(0, 40));
const mainNow = fs.readFileSync(proj);
const r5 = await run({ mode: 'recover' });
check('uszkodzony autozapis: pominięty, projekt nietknięty', r5.autosave?.kind === 'discard' && Buffer.compare(mainNow, fs.readFileSync(proj)) === 0, r5.autosave ?? r5.error);

fs.mkdirSync(path.join(root, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'bench/results', `poc3-autosave-${process.platform}.json`), JSON.stringify({ platform: `${process.platform} ${os.release()}`, checks }, null, 2));
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
