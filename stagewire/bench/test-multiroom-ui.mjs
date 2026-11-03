// Test: kilka pomieszczeń: dodawanie sal, lista sal, przełączanie aktywnej (lista i klik w obrys), położenie w budynku, rysowanie nowej sali na planie, usuwanie, PDF i 3D aktywnej sali.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5223, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5223/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');

await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
// sala 1: scena (prostokąt 12 × 8)
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.fill('#s-name', 'Scena'); await page.fill('#s-w', '12'); await page.fill('#s-d', '8'); await page.click('#s-save');
check('lista sal ukryta przy jednej sali', !(await page.isVisible('#b-room')));
// sala 2: foyer (6 × 5) przez „+ Sala”
await page.click('#b-addroom'); await page.waitForSelector('#spacedialog');
check('okno „Nowa sala” (bez przycisku usuwania)', (await page.textContent('#spacedialog h2')) === 'Nowa sala' && !(await page.$('#s-del')));
await page.fill('#s-name', 'Foyer'); await page.fill('#s-w', '6'); await page.fill('#s-d', '5'); await page.click('#s-save');
let st = await state(); const ids = Object.keys(st.spaces); const [a, b2] = ids;
check('są dwie sale; druga leży obok pierwszej (początek 14 m = 12 m + odstęp 2 m)', ids.length === 2 && st.spaces[b2].origin?.[0] === 14000 && !st.spaces[a].origin, st.spaces[b2].origin);
check('lista sal pokazuje obie, aktywna jest nowa (Foyer)', (await page.isVisible('#b-room')) && (await page.$$eval('#b-room option', (o) => o.length)) === 2 && (await page.inputValue('#b-room')) === b2);
// obiekt w foyer
await page.click('#b-obj'); await page.waitForSelector('#objdialog'); await page.click('#o-add'); await page.waitForSelector('#so-w');
st = await state(); check('obiekt trafił do aktywnej sali (Foyer)', Object.values(st.placements).every((p) => p.spaceId === b2) && Object.keys(st.placements).length === 1);
await page.screenshot({ path: path.join(out, 'sw-sale-1-dwie.png') });
// przełączenie listą
await page.selectOption('#b-room', a); check('przełączenie listą zmienia aktywną salę', (await E(() => window.__editor.plan.spaceId())) === a);
// klik w obrys drugiej sali przełącza
const [fx, fy] = await E(([id]) => { const st = window.__editor.store.state; const o = st.spaces[id].origin; return window.__editor.plan.toScreen(o[0] + 500, o[1] + 4500); }, [b2]);
await page.mouse.click(fx, fy); check('klik w obrys innej sali przełącza aktywną salę', (await E(() => window.__editor.plan.spaceId())) === b2);
// widok 3D pokazuje tylko aktywną salę
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' });
let sc = await E(() => window.__editor.view3d.scene()); check('3D: aktywna sala Foyer (6 × 5 m, 1 bryła)', sc.spaceName === 'Foyer' && sc.w === 6000 && sc.boxes.length === 1, [sc.spaceName, sc.w]);
await page.click('#b-3d'); await page.selectOption('#b-room', a); await page.click('#b-3d'); sc = await E(() => window.__editor.view3d.scene());
check('3D po przełączeniu: Scena (12 × 8 m, bez brył)', sc.spaceName === 'Scena' && sc.w === 12000 && sc.boxes.length === 0, [sc.spaceName, sc.w]); await page.click('#b-3d');
// położenie w budynku
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.fill('#s-ox', '30'); await page.fill('#s-oy', '2'); await page.click('#s-save');
st = await state(); check('„Początek sali w budynku” zapisuje origin', st.spaces[a].origin?.[0] === 30000 && st.spaces[a].origin?.[1] === 2000, st.spaces[a].origin);
// rysowanie nowej sali na planie (względem aktywnej)
await page.click('#b-addroom'); await page.waitForSelector('#spacedialog'); await page.fill('#s-name', 'Garderoba'); await page.selectOption('#s-shape', 'poly'); await page.click('#s-draw');
await E(() => window.__editor.plan.look(-3000, 3000, 0.04)); // kamera na miejscu rysowania (poza panelami)
for (const [x, y] of [[-5000, 1000], [-1000, 1000], [-1000, 5000], [-5000, 5000]]) { const [sx, sy] = await E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]); await page.mouse.click(sx, sy); }
await page.keyboard.press('Enter');
st = await state(); const g = Object.entries(st.spaces).find(([, s]) => s.name === 'Garderoba');
check('narysowana sala ma początek względem aktywnej (30 − 5 = 25 m, 2 + 1 = 3 m)', !!g && g[1].origin?.[0] === 25000 && g[1].origin?.[1] === 3000 && g[1].boundary.length === 4, g?.[1].origin);
check('po narysowaniu nowa sala jest aktywna', !!g && (await E(() => window.__editor.plan.spaceId())) === g[0]);
await page.click('#b-fitall'); await page.screenshot({ path: path.join(out, 'sw-sale-2-trzy.png') });
check('„Cały budynek” pokazuje wszystkie sale (przybliżenie mniejsze niż dla jednej sali)', (await E(() => window.__editor.plan.debug().cam.zoom)) < 0.04);
// PDF aktywnej sali
const pdf = await E(async () => { const r = await window.__editor.plan.buildPdf('A3', undefined, false); return { len: r.bytes.length, scale: r.scale }; });
check('PDF aktywnej sali powstaje (skala dobrana do małej sali)', pdf.len > 1000 && pdf.scale <= 50, pdf);
// usuwanie sali (dwa kliknięcia)
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.click('#s-del'); check('pierwszy klik „Usuń salę” prosi o potwierdzenie', (await page.textContent('#s-del')).includes('Na pewno')); await page.click('#s-del');
st = await state(); check('po potwierdzeniu sala znika, zostają dwie', Object.keys(st.spaces).length === 2 && !Object.values(st.spaces).some((s) => s.name === 'Garderoba'));
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
