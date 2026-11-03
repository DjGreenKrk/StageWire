// Test menu plików edytora: Nowy / Dodaj urządzenie / Zapisz jako / Otwórz / ochrona niezapisanych zmian.
// Okna systemowe (plugin dialog) i polecenia Tauri zastąpione atrapą; natywnych okien nie da się tu automatyzować.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-fm-'));
const fileA = path.join(dir, 'a.sw'), fileB = path.join(dir, 'b.sw');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5195, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = [];
const check = (name, ok, info) => { checks.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info !== undefined ? ' — ' + JSON.stringify(info) : ''}`); };
let saveTarget = fileA, openTarget = fileA;
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
await page.exposeFunction('__nodeInvoke', (cmd, a) => {
  if (cmd === 'save_project' || cmd === 'save_autosave') { fs.writeFileSync(a.path, Buffer.from(a.data)); return 'ok'; }
  if (cmd === 'read_file') return fs.existsSync(a.path) ? { bytes: [...fs.readFileSync(a.path)], mtime_ms: fs.statSync(a.path).mtimeMs } : null;
  if (cmd === 'remove_file') { fs.rmSync(a.path, { force: true }); return null; }
  if (cmd === 'selftest_config') return {};
  if (cmd === 'startup_project') return null;
  if (cmd === 'plugin:dialog|save') return saveTarget;
  if (cmd === 'plugin:dialog|open') return openTarget;
  throw new Error('nieobsługiwane polecenie ' + cmd);
});
await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.__nodeInvoke(cmd, args), transformCallback: () => 0 }; });
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
const ready = () => page.waitForFunction(() => window.__editor?.ready, null, { timeout: 15000 });
const counts = () => page.evaluate(() => window.__editor.counts());
const title = () => page.title();

// start bez projektu = „Nowy” (okno bez ścieżki)
await page.goto('http://localhost:5195/editor.html?new=1'); await ready();
check('nowy projekt jest pusty', (await counts()).devices === 0);
check('katalog zawiera 22 urządzenia (14 ogólnych + 8 Blackmagic)', (await page.$$('#cat-list button[data-cat]')).length === 22);
await page.click('#cat-list button[data-cat="camera_sdi"]');
await page.evaluate(() => window.__editor.look(400, 110, 1));
await page.click('#cat-list button[data-cat="monitor_hdmi"]');
check('dodano 2 urządzenia (jedna transakcja każde, cofalne)', (await counts()).devices === 2);
check('tytuł: nowy projekt, niezapisany', (await title()).startsWith('●') && (await title()).includes('Nowy projekt'));
await page.keyboard.press('Control+z'); check('cofnięcie usuwa ostatnie urządzenie', (await counts()).devices === 1);
await page.keyboard.press('Control+y');

// Zapisz jako (okno systemowe zwraca ścieżkę)
await page.click('#b-burger'); await page.click('#b-save'); await page.waitForFunction(() => document.getElementById('msg').textContent === 'Zapisano');
check('Zapisz bez ścieżki otwiera „Zapisz jako” i tworzy plik', fs.existsSync(fileA));
check('tytuł: nazwa pliku, bez znacznika', (await title()) === 'a.sw — StageWire', await title());

// niezapisana zmiana + Nowy: pytanie; Anuluj zostaje
await page.click('#cat-list button[data-cat="camera_sdi"]');
await page.click('#b-burger'); await page.click('#b-new'); await page.waitForSelector('#dialog');
await page.click('#dialog button[data-id="cancel"]');
check('Anuluj: nadal ten sam projekt z 3 urządzeniami', (await counts()).devices === 3 && (await page.$('#dialog')) === null);

// Zapisz jako… do innego pliku
saveTarget = fileB; await page.click('#b-burger'); await page.click('#b-saveas'); await page.waitForFunction(() => document.title.startsWith('b.sw'));
check('Zapisz jako: nowy plik, stary nietknięty (2 urządzenia)', fs.existsSync(fileB) && fs.statSync(fileA).size !== fs.statSync(fileB).size);

// Nowy → „Nie zapisuj” po zmianie
await page.click('#cat-list button[data-cat="monitor_hdmi"]');
await page.click('#b-burger'); await page.click('#b-new'); await page.waitForSelector('#dialog');
await page.click('#dialog button[data-id="drop"]'); await ready();
check('Nie zapisuj: otwarty pusty nowy projekt', (await counts()).devices === 0);

// Otwórz… (okno systemowe zwraca ścieżkę)
openTarget = fileA; await page.click('#b-burger'); await page.click('#b-open'); await page.waitForFunction(() => document.title.startsWith('a.sw')); await ready();
check('Otwórz: wczytano a.sw z 2 urządzeniami', (await counts()).devices === 2, await counts());
openTarget = fileB; await page.click('#b-burger'); await page.click('#b-open'); await page.waitForFunction(() => document.title.startsWith('b.sw')); await ready();
check('Otwórz: wczytano b.sw z 3 urządzeniami', (await counts()).devices === 3, await counts());

// ścieżka do nieistniejącego pliku = pusty projekt; plik uszkodzony = komunikat i brak nadpisania
const fileC = path.join(dir, 'nowy.sw');
await page.goto('http://localhost:5195/editor.html?project=' + encodeURIComponent(fileC)); await ready();
check('nieistniejący plik: pusty projekt (nie dane demo)', (await counts()).devices === 0 && (await page.title()).includes('nowy.sw'));
const bad = path.join(dir, 'zly.sw'); fs.writeFileSync(bad, 'to nie jest projekt');
await page.goto('http://localhost:5195/editor.html?project=' + encodeURIComponent(bad)); await page.waitForSelector('#dialog');
check('uszkodzony plik: komunikat o błędzie', (await page.textContent('#dialog')).includes('Nie można otworzyć pliku'));
await page.click('#dialog button[data-id="ok"]'); await ready();
await page.click('#cat-list button[data-cat="camera_sdi"]'); saveTarget = path.join(dir, 'inny.sw');
await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.getElementById('msg').textContent === 'Zapisano');
check('uszkodzony plik nietknięty, zapis idzie do nowej nazwy', fs.readFileSync(bad, 'utf8') === 'to nie jest projekt' && fs.existsSync(saveTarget));

await browser.close(); await server.close();
fs.writeFileSync(path.join(root, 'bench/results/poc3-file-menu.json'), JSON.stringify({ checks }, null, 2));
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(checks.every((c) => c.ok) ? 0 : 1);
