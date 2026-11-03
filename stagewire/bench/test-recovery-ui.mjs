// Test okna odzyskiwania w edytorze (Edge, prawdziwy interfejs). Polecenia Tauri zastąpione atrapą opartą o system plików Node.
// Uruchom: node bench/test-recovery-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ui-')), proj = path.join(dir, 'p.sw'), auto = proj + '.autosave';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5197, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = [];
const check = (name, ok, info) => { checks.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info !== undefined ? ' — ' + JSON.stringify(info) : ''}`); };
const URL = `http://localhost:5197/editor.html?devices=40&project=${encodeURIComponent(proj)}&autosaveIdle=300&autosaveMax=1000`;

async function open(url = URL) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.exposeFunction('__nodeInvoke', (cmd, a) => {
    if (cmd === 'save_project' || cmd === 'save_autosave') { fs.writeFileSync(a.path, Buffer.from(a.data)); return 'ok'; }
    if (cmd === 'read_file') return fs.existsSync(a.path) ? { bytes: [...fs.readFileSync(a.path)], mtime_ms: fs.statSync(a.path).mtimeMs } : null;
    if (cmd === 'remove_file') { fs.rmSync(a.path, { force: true }); return null; }
    if (cmd === 'selftest_config') return {};
    if (cmd === 'startup_project') return null;
    if (cmd === 'plugin:dialog|save') return proj;
    throw new Error('nieobsługiwane polecenie ' + cmd);
  });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.__nodeInvoke(cmd, args), transformCallback: () => 0 }; });
  page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
  await page.goto(url);
  return { ctx, page };
}
const ready = (page) => page.waitForFunction(() => window.__editor?.ready, null, { timeout: 15000 });
const conns = (page) => page.evaluate(() => window.__editor.counts().connections);
async function connectOne(page, k) {
  const ids = await page.evaluate(() => Object.keys(window.__editor.nodes()));
  const j = 12 + k; const s = ids[2 * j], d = ids[2 * j + 1];
  await page.evaluate(([s, d]) => { const n = window.__editor.nodes(); window.__editor.look((n[s].x + n[d].x) / 2 + 85, (n[s].y + n[d].y) / 2 + 60, 1); }, [s, d]);
  const a = await page.evaluate(([s]) => window.__editor.portScreen(s, 'prt_out6'), [s]), b = await page.evaluate(([d]) => window.__editor.portScreen(d, 'prt_in6'), [d]);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up();
}

// 0. przygotowanie: projekt demo (40 urządzeń) zapisany przez „Zapisz jako”
{ const seed = await open(`http://localhost:5197/editor.html?devices=40`); await ready(seed.page); await seed.page.keyboard.press('Control+s'); await seed.page.waitForFunction(() => document.getElementById('msg').textContent === 'Zapisano'); await seed.ctx.close(); }
fs.rmSync(auto, { force: true });
// 1. otwarcie zapisanego projektu, Ctrl+S, edycja, autozapis, „awaria” (zamknięcie karty bez zapisu)
let { ctx, page } = await open(); await ready(page);
check('brak okna przy pierwszym otwarciu', (await page.$('#dialog')) === null);
await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.getElementById('msg').textContent === 'Zapisano');
const base = await conns(page);
check('Ctrl+S tworzy plik projektu', fs.existsSync(proj));
await connectOne(page, 0);
check('wskaźnik niezapisanych zmian w pasku', (await page.textContent('#stat')).includes('niezapisane'));
await page.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 900));
check('autozapis powstał, projekt nietknięty', fs.existsSync(auto) && (await conns(page)) === base + 1);
await ctx.close();

// 2. ponowne otwarcie: okno odzyskiwania → Przywróć
({ ctx, page } = await open());
await page.waitForSelector('#dialog');
check('okno odzyskiwania widoczne po awarii', (await page.textContent('#dialog')).includes('Odzyskać niezapisane zmiany?'));
const btnH = await page.$$eval('#dialog button', (b) => Math.min(...b.map((x) => x.getBoundingClientRect().height)));
check('przyciski okna ≥ 44 px', btnH >= 44, btnH);
await page.click('#dialog button[data-id="restore"]'); await ready(page);
check('po przywróceniu jest edytowany stan i znacznik niezapisanych', (await conns(page)) === base + 1 && (await page.textContent('#stat')).includes('niezapisane'));

// 3. zapis kasuje autozapis; kolejne otwarcie bez okna
await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.getElementById('msg').textContent === 'Zapisano');
check('zapis usuwa autozapis', !fs.existsSync(auto));
await ctx.close();
({ ctx, page } = await open()); await ready(page);
check('po zapisie: brak okna, stan zachowany', (await page.$('#dialog')) === null && (await conns(page)) === base + 1);

// 4. „Odrzuć”: kolejna awaria, odrzucenie usuwa autozapis i otwiera zapisany projekt
await connectOne(page, 1); await new Promise((r) => setTimeout(r, 900)); await ctx.close();
({ ctx, page } = await open()); await page.waitForSelector('#dialog');
await page.click('#dialog button[data-id="discard"]'); await ready(page);
check('Odrzuć: autozapis usunięty, otwarty zapisany projekt', !fs.existsSync(auto) && (await conns(page)) === base + 1);

// 5. „Zachowaj”: awaria, wybór „otwórz zapisany”, autozapis zostaje
await connectOne(page, 2); await new Promise((r) => setTimeout(r, 900)); await ctx.close();
({ ctx, page } = await open()); await page.waitForSelector('#dialog');
await page.click('#dialog button[data-id="later"]'); await ready(page);
check('Zachowaj: otwarty zapisany projekt, autozapis nadal jest', fs.existsSync(auto) && (await conns(page)) === base + 1);
await ctx.close();

// 6. uszkodzony autozapis: brak okna, projekt otwarty
fs.writeFileSync(auto, fs.readFileSync(proj).subarray(0, 30));
({ ctx, page } = await open()); await ready(page);
check('uszkodzony autozapis: brak okna, projekt otwarty', (await page.$('#dialog')) === null && (await conns(page)) === base + 1);
await ctx.close();

await browser.close(); await server.close();
fs.writeFileSync(path.join(root, 'bench/results/poc3-recovery-ui.json'), JSON.stringify({ checks }, null, 2));
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(checks.every((c) => c.ok) ? 0 : 1);
