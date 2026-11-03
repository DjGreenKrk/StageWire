// Testy odpornościowe zapisu atomowego (PoC-3, TS-04). Uruchamiają binarkę StageWire w trybie --cli.
// Użycie: node scripts/poc3-persist.mjs [--exe=ścieżka] [--kills=150]
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const exe = args.exe ?? path.join(root, 'src-tauri/target/release', process.platform === 'win32' ? 'stagewire.exe' : 'stagewire');
const KILLS = Number(args.kills ?? 150);
const dir = fs.mkdtempSync(path.join(args.tmp ?? os.tmpdir(), 'sw-persist-'));
const proj = path.join(dir, 'p.stagewire');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = () => (fs.existsSync(proj) ? sha(fs.readFileSync(proj)) : null);
const results = { platform: `${process.platform} ${os.release()}`, exe, fs: dir, checks: [], killTest: null };
let failures = 0;
const check = (name, ok, detail = '') => { results.checks.push({ name, ok, detail }); if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'BŁĄD'} ${name}${detail ? ' — ' + detail : ''}`); };
const payload = (n) => crypto.randomBytes(n);
const pfile = (b, i = 0) => { const f = path.join(dir, `payload-${i}.bin`); fs.writeFileSync(f, b); return f; };
const run = (argv) => spawnSync(exe, ['--cli', ...argv], { encoding: 'utf8' });
const tmpFiles = () => fs.readdirSync(dir).filter((f) => f.startsWith('p.stagewire.tmp-'));
const cleanTmp = () => tmpFiles().forEach((f) => fs.rmSync(path.join(dir, f)));

// 1. zwykły zapis
const v1 = payload(300_000);
let r = run(['save', proj, pfile(v1)]);
check('zapis v1 kończy się sukcesem', r.status === 0 && r.stdout.trim() === sha(v1), `status=${r.status}`);
check('plik == v1, brak plików tymczasowych', fileSha() === sha(v1) && tmpFiles().length === 0);

// 2. awaria w każdym punkcie zapisu v2: stary plik ma pozostać nienaruszony (poza after_rename, gdzie nowy jest już kompletny)
const v2 = payload(2_000_000);
for (const point of ['mid_write', 'after_tmp_write', 'after_verify', 'before_rename']) {
  r = run(['save', proj, pfile(v2), `--crash-at=${point}`]);
  check(`awaria w punkcie ${point}: proces przerwany`, r.status !== 0, `kod=${r.status} sygnał=${r.signal}`);
  check(`awaria w punkcie ${point}: plik nadal == v1`, fileSha() === sha(v1));
  check(`awaria w punkcie ${point}: pozostaje wykrywalny plik tymczasowy`, tmpFiles().length >= 1, `${tmpFiles().length}`);
  const rec = JSON.parse(run(['recover', proj]).stdout);
  check(`awaria w punkcie ${point}: skan odzyskiwania widzi osierocone pliki`, rec.tmp_files.length >= 1);
  cleanTmp();
}
r = run(['save', proj, pfile(v2), '--crash-at=after_rename']);
check('awaria po zamianie: plik == v2 (kompletny)', fileSha() === sha(v2));
const backups = fs.existsSync(proj + '.backups') ? fs.readdirSync(proj + '.backups').length : 0;
check('kopie zapasowe powstają przed zamianą', backups >= 1, `${backups}`);
const bk = fs.readdirSync(proj + '.backups').sort().map((f) => sha(fs.readFileSync(path.join(proj + '.backups', f))));
check('najnowsza kopia == poprzednia wersja (v1)', bk.at(-1) === sha(v1));
cleanTmp();

// 3. blokada doradcza
run(['lock', proj]);
const lk = run(['lock', proj]).stdout.trim();
check('blokada doradcza: druga próba widzi poprzednią', lk.includes('"pid"'), lk.slice(0, 60));

// 4. zabijanie procesu w losowych momentach zapisu (najsilniejszy test)
{
  const known = new Set([fileSha()]);
  const stats = { oldKept: 0, newCommitted: 0, corrupt: 0, finishedBeforeKill: 0, orphanTmpMax: 0 };
  for (let i = 0; i < KILLS; i++) {
    const size = 100_000 + Math.floor(Math.random() * 8_000_000);
    const b = payload(size);
    const h = sha(b);
    const f = pfile(b, 1);
    const before = fileSha();
    const delay = Math.random() * Number(args.maxdelay ?? 40);
    const exited = await new Promise((resolve) => {
      const c = spawn(exe, ['--cli', 'save', proj, f, '--keep=3'], { stdio: 'ignore' });
      let done = false;
      c.on('exit', (code) => { done = true; resolve(code === 0 ? 'ok' : 'killed'); });
      setTimeout(() => { if (!done) c.kill('SIGKILL'); }, delay);
    });
    known.add(h);
    const now = fileSha();
    if (exited === 'ok') stats.finishedBeforeKill++;
    if (now === h) stats.newCommitted++;
    else if (now === before) stats.oldKept++;
    else stats.corrupt++; // plik nie jest ani starą, ani nową kompletną wersją
    stats.orphanTmpMax = Math.max(stats.orphanTmpMax, tmpFiles().length);
    cleanTmp();
  }
  results.killTest = { iterations: KILLS, ...stats };
  check(`zabijanie procesu w ${KILLS} losowych momentach: 0 uszkodzonych plików`, stats.corrupt === 0, JSON.stringify(stats));
}

// 5. dwa równoległe zapisy różnych wersji: wynik = dokładnie jedna z nich, nic nie uszkodzone
{
  let corrupt = 0;
  for (let i = 0; i < 20; i++) {
    const a = payload(1_500_000), b = payload(1_500_000);
    const fa = pfile(a, 2), fb = pfile(b, 3);
    await Promise.all([fa, fb].map((f) => new Promise((res) => spawn(exe, ['--cli', 'save', proj, f], { stdio: 'ignore' }).on('exit', res))));
    const now = fileSha();
    if (now !== sha(a) && now !== sha(b)) corrupt++;
    cleanTmp();
  }
  check('20 par równoległych zapisów: wynik zawsze == jedna z wersji', corrupt === 0, `uszkodzonych: ${corrupt}`);
}

// 6. brak uprawnień do zapisu: plik poprzedni nietknięty, błąd zgłoszony (nie panika)
{
  const keep = fileSha();
  let denied = null;
  try {
    if (process.platform === 'win32') {
      fs.chmodSync(proj, 0o444); // atrybut tylko do odczytu
      r = run(['save', proj, pfile(payload(1000), 4)]);
      denied = r.status === 1 && fileSha() === keep;
      fs.chmodSync(proj, 0o666);
    } else if (process.getuid && process.getuid() !== 0) {
      fs.chmodSync(dir, 0o555);
      let enforced = true;
      try { fs.writeFileSync(path.join(dir, '.probe'), 'x'); fs.rmSync(path.join(dir, '.probe')); enforced = false; } catch {}
      if (enforced) {
        r = run(['save', proj, pfile(payload(1000), 4)]);
        denied = r.status === 1 && fileSha() === keep;
      }
      fs.chmodSync(dir, 0o755);
    }
  } catch (e) { denied = null; }
  if (denied === null) check('brak uprawnień: pominięto (środowisko nie pozwala, np. root)', true, 'POMINIĘTE');
  else check('brak uprawnień: kontrolowany błąd, plik nietknięty', denied === true, `status=${r.status} ${r.stderr.trim().slice(0, 80)}`);
  cleanTmp();
}

results.failures = failures;
const outDir = path.join(root, 'bench/results');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `poc3-persist-${process.platform}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\n${failures === 0 ? 'WSZYSTKO OK' : failures + ' BŁĘDÓW'} → ${out}`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
