// Test tras kablowych w interfejsie: rysowanie, przyciąganie, zaznaczanie, nazwa, usuwanie, cofanie, długości po trasach.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5199, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5199/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
await addAt('camera_sdi', 0, 40); await addAt('video_switcher', 420, 120);
await E(() => window.__editor.look(210, 140, 1));
const [k1, mix] = await E(() => Object.keys(window.__editor.nodes()));
{ const a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), k1), b = await E(([i, p]) => window.__editor.portScreen(i, p), [mix, 'prt_sdiin1']);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up(); }
await page.click('#b-mode'); await page.click('#b-space'); await page.fill('#s-w', '20'); await page.fill('#s-d', '10'); await page.click('#s-save');
await E(([k1, mix]) => { const s = window.__editor.store; const sid = Object.keys(s.state.spaces)[0]; const key = (i) => 'plc_' + i.slice(i.indexOf('_') + 1);
  s.dispatch('t', (d) => { d.placements ??= {}; d.placements[key(mix)] = { spaceId: sid, targetKind: 'equipment', targetId: mix, position: { x: 10000, y: 5000, z: 0 }, rotationDeg: 0 };
    d.placements[key(k1)] = { spaceId: sid, targetKind: 'equipment', targetId: k1, position: { x: 2000, y: 1000, z: 0 }, rotationDeg: 0 }; }); window.__editor.plan.refresh(); }, [k1, mix]);
const sc = (x, y) => E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]);
const routes = () => E(() => Object.values(window.__editor.store.state.spaces)[0].cableRoutes ?? {});

// rysowanie trasy: (0;0,5) → (10;0,5) → (10;5)
await page.click('#b-route');
check('tryb rysowania włączony', (await page.textContent('#b-route')).includes('Zakończ'));
for (const [x, y] of [[0, 500], [10000, 500], [10000, 5000]]) { const [sx, sy] = await sc(x, y); await page.mouse.move(sx, sy); await page.mouse.click(sx, sy); }
await page.keyboard.press('Enter');
const r1 = Object.values(await routes());
check('trasa zapisana: 3 punkty na siatce', r1.length === 1 && JSON.stringify(r1[0].points) === '[[0,500,0],[10000,500,0],[10000,5000,0]]', r1);
check('po zakończeniu trasa jest zaznaczona i ma panel', await page.isVisible('#rt-name') && (await page.inputValue('#rt-name')) === 'Trasa 1');
await page.fill('#rt-name', 'Korytko główne'); await page.press('#rt-name', 'Enter');
check('nazwa trasy zmieniona', Object.values(await routes())[0].name === 'Korytko główne');

await page.fill('#rt-z', '5'); await page.press('#rt-z', 'Enter');
check('wysokość trasy 5 m ustawiona dla wszystkich punktów', Object.values(await routes())[0].points.every((q) => q[2] === 5000));
// Esc anuluje trasę w toku, Backspace usuwa punkt
await page.click('#b-route'); { const [a, b] = await sc(1000, 8000); await page.mouse.click(a, b); const [c, d] = await sc(3000, 8000); await page.mouse.click(c, d); }
await page.keyboard.press('Backspace'); await page.keyboard.press('Escape');
check('Esc anuluje rysowanie bez zapisu trasy', Object.keys(await routes()).length === 1 && (await page.textContent('#b-route')) === 'Rysuj trasę');

// długości po trasie
await page.click('#b-lengths'); await page.waitForSelector('#lendialog'); await page.fill('#l-slack', '1'); await page.dispatchEvent('#l-slack', 'input'); await page.click('#l-go');
const cab = (await E(() => Object.values(window.__editor.store.state.cables)))[0];
check('długość po trasie 3D: dojścia 0,5 + 5 (pion), trasa 8 + 4,5, pion 5 + zapas 1 = 24 m', cab.lengthMm === 24000 && cab.estimateBasis?.method === 'route', cab);
await page.screenshot({ path: path.join(process.env.TEMP, 'sw-trasy.png') });

// klik w trasę zaznacza, Delete usuwa, Ctrl+Z przywraca
await page.mouse.click(5, 5); // tło/menu — nic
const [mx, my] = await sc(5000, 500); await page.mouse.click(mx, my);
check('klik w trasę zaznacza ją', (await E(() => window.__editor.plan.selectedRoute())) !== undefined);
await page.keyboard.press('Delete');
check('Delete usuwa trasę', Object.keys(await routes()).length === 0);
await page.keyboard.press('Control+z');
check('Ctrl+Z przywraca trasę', Object.keys(await routes()).length === 1);
check('bez błędów walidacji', (await E(() => window.__editor.issues())) === 0);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
