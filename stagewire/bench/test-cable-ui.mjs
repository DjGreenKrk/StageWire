// Test opisywania kabla w widoku głównym: klik kabla, panel, nazwa, długość, duplikat, cofanie.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5195, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5195/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
await addAt('camera_sdi', 0, 40); await addAt('camera_sdi', 0, 240); await addAt('video_switcher', 420, 120);
await E(() => window.__editor.look(210, 140, 1));
const [k1, k2, mix] = await E(() => Object.keys(window.__editor.nodes()));
for (const [k, port] of [[k1, 'prt_sdiin1'], [k2, 'prt_sdiin2']]) {
  const a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), k), b = await E(([i, p]) => window.__editor.portScreen(i, p), [mix, port]);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up();
}
const e0 = await E(() => window.__editor.edgeId(0)), e1 = await E(() => window.__editor.edgeId(1));
const clickEdge = async (id) => { const m = await E((i) => window.__editor.edgeMid(i), id); await page.mouse.click(m[0], m[1]); };
await clickEdge(e0);
check('klik kabla pokazuje panel kabla', await page.isVisible('#props') && (await page.textContent('#props')).includes('Kabel') && (await page.$('#c-num')) !== null);
await page.fill('#c-lbl', 'Kamera 1 PGM'); await page.press('#c-lbl', 'Enter');
await page.fill('#c-num', 'Kamera 1'); await page.press('#c-num', 'Enter');
await page.fill('#c-len', '30'); await page.press('#c-len', 'Enter');
const cab = await E((id) => { const s = window.__editor.store.state; return s.cables[s.connections[id].cableId]; }, e0);
check('etykieta zapisana w połączeniu', (await E((id) => window.__editor.store.state.connections[id].label, e0)) === 'Kamera 1 PGM');
check('numer i długość zapisane', cab.number === 'Kamera 1' && cab.lengthMm === 30000, cab);
await clickEdge(e1);
await page.fill('#c-num', 'Kamera 1'); await page.press('#c-num', 'Enter');
const cab1 = await E((id) => { const s = window.__editor.store.state; return s.cables[s.connections[id].cableId]; }, e1);
check('duplikat nazwy odrzucony, pole wraca do poprzedniej wartości', cab1.number === undefined && (await page.inputValue('#c-num')) === '', { cab1 });
await page.fill('#c-num', 'Kamera 2'); await page.press('#c-num', 'Enter');
await page.mouse.click(700, 600); // tło
check('klik w tło chowa panel', !(await page.isVisible('#props')));
await page.screenshot({ path: path.join(process.env.TEMP, 'sw-kabel.png') });
await clickEdge(e0); await page.keyboard.press('Control+z');
check('Ctrl+Z cofa ostatnią zmianę (nazwa Kamera 2)', (await E((id) => { const s = window.__editor.store.state; return s.cables[s.connections[id].cableId].number; }, e1)) === undefined);
check('bez błędów walidacji', (await E(() => window.__editor.issues())) === 0);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
