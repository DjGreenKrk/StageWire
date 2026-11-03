// Test edycji punktów trasy w interfejsie: przesunięcie, dodanie z uchwytu środka, zaznaczenie i usunięcie punktu, cofanie.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5204, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5204/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
await page.click('#b-mode'); await page.click('#b-space'); await page.fill('#s-w', '20'); await page.fill('#s-d', '10'); await page.click('#s-save');
const sc = (x, y) => E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]);
const pts = async () => (await E(() => Object.values(Object.values(window.__editor.store.state.spaces)[0].cableRoutes)[0].points));
await page.click('#b-route');
for (const [x, y] of [[2000, 2000], [8000, 2000], [8000, 6000]]) { const [sx, sy] = await sc(x, y); await page.mouse.click(sx, sy); }
await page.keyboard.press('Enter');
check('trasa narysowana, 3 punkty', (await pts()).length === 3);

// przesunięcie wierzchołka (8000;2000) → (8000;3000) z przyciąganiem do siatki
let [vx, vy] = await E(() => window.__editor.plan.handleScreen('v', 1));
await page.mouse.move(vx, vy); await page.mouse.down(); const [tx, ty] = await sc(8000, 3040); await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up();
let p = await pts();
check('przeciągnięcie punktu: nowa pozycja na siatce 100 mm, z zachowane', p.length === 3 && p[1][0] === 8000 && p[1][1] === 3000 && p[1][2] === 0, p);
await page.keyboard.press('Control+z');
check('Ctrl+Z cofa przesunięcie punktu', (await pts())[1][1] === 2000);
await page.keyboard.press('Control+y');

// dodanie punktu z uchwytu środka odcinka 1 (między punktem 0 i 1)
const [mx, my] = await E(() => window.__editor.plan.handleScreen('m', 1));
await page.mouse.click(mx, my);
p = await pts();
check('klik w kółko środka dodaje punkt (4 punkty)', p.length === 4, p);
check('nowy punkt leży między sąsiadami', p[1][0] > 2000 && p[1][0] < 8000, p[1]);

// zaznaczony punkt: Delete usuwa punkt, nie całą trasę
check('po dodaniu nowy punkt jest zaznaczony', (await E(() => window.__editor.plan.selectedVertex()))?.idx === 1);
await page.keyboard.press('Delete');
check('Delete usuwa zaznaczony punkt, trasa zostaje (3 punkty)', (await pts()).length === 3);
await page.keyboard.press('Delete');
check('Delete bez zaznaczonego punktu usuwa trasę', (await E(() => Object.keys(Object.values(window.__editor.store.state.spaces)[0].cableRoutes ?? {}).length)) === 0);
await page.keyboard.press('Control+z');
check('Ctrl+Z przywraca trasę', (await pts()).length === 3);
check('bez błędów walidacji', (await E(() => window.__editor.issues())) === 0);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
