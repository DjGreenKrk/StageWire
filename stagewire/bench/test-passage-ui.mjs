// Test: przejścia kablowe między salami (FOH ↔ scena) + układ pasków narzędzi (grupy, brak nakładania na katalog i panele).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5231, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5231/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));
const rect = (sel) => E((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);

// schemat: kamera → mikser
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
await addAt('camera_sdi', 0, 40); await addAt('video_switcher', 420, 120);
await E(() => window.__editor.look(210, 100, 1));
const [cam, mix] = await E(() => Object.keys(window.__editor.nodes()));
{ const a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), cam), b = await E((i) => window.__editor.portScreen(i, 'prt_sdiin1'), mix);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up(); }

// układ pasków w widoku schematu
let menu = await rect('#menu');
check('pasek menu: przycisk ☰ Menu + grupy Tryb / Schemat (grupy planu ukryte poza planem)', (await page.$$eval('#menu .grp .gl', (e) => e.filter((x) => x.offsetParent).map((x) => x.textContent))).join() === 'Tryb,Schemat');
check('katalog zaczyna się pod paskiem menu', (await rect('#catalog')).t >= menu.b, [menu.b, (await rect('#catalog')).t]);

// plan: dwie sale
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.fill('#s-name', 'FOH'); await page.fill('#s-w', '20'); await page.fill('#s-d', '10'); await page.click('#s-save');
await page.click('#b-addroom'); await page.waitForSelector('#spacedialog'); await page.fill('#s-name', 'Scena'); await page.fill('#s-w', '15'); await page.fill('#s-d', '8'); await page.click('#s-save');
const sp = Object.keys((await state()).spaces); const [foh, scena] = sp;
await E(([cam, mix, foh, scena]) => { const s = window.__editor.store; const key = (i) => 'plc_' + i.slice(i.indexOf('_') + 1);
  s.dispatch('t', (d) => { d.placements ??= {}; d.placements[key(mix)] = { spaceId: foh, targetKind: 'equipment', targetId: mix, position: { x: 10000, y: 5000, z: 0 }, rotationDeg: 0 };
    d.placements[key(cam)] = { spaceId: scena, targetKind: 'equipment', targetId: cam, position: { x: 2000, y: 1000, z: 0 }, rotationDeg: 0 }; }); window.__editor.plan.refresh(); }, [cam, mix, foh, scena]);

// układ planu: grupy, brak nakładania, wszystko w oknie
const groups = await page.$$eval('#planbar .grp .gl', (e) => e.map((x) => x.textContent));
check('pasek planu: grupy Sala / Wstaw w drugim rzędzie; Kable i Widok w górnym', groups.join() === 'Sala,Wstaw' && (await page.$$eval('#menu .grp.plan-only .gl', (e) => e.filter((x) => x.offsetParent).map((x) => x.textContent))).join() === 'Kable,Widok', groups);
const pb = await rect('#planbar'), cat = await rect('#catalog'), mn = await rect('#menu');
check('pasek planu leży pod paskiem menu (bez nakładania)', pb.t >= mn.b - 2, [mn.b, pb.t]);
check('1366 px: oba paski razem mają dwa rzędy (do 130 px)', pb.b <= 130, pb.b);
check('katalog i panel właściwości zaczynają się pod paskami', cat.t >= pb.b, [pb.b, cat.t]);
const btns = await page.$$eval('#planbar button, #planbar select', (e) => e.filter((x) => x.offsetParent).map((x) => { const r = x.getBoundingClientRect(); return { id: x.id, r: r.right, l: r.left }; }));
check('wszystkie przyciski paska planu mieszczą się w oknie 1366 px', btns.every((b) => b.l >= 0 && b.r <= 1366), btns.filter((b) => b.r > 1366));
await page.screenshot({ path: path.join(out, 'sw-ui-1-plan.png') });

// brak przejścia: długości pomijają kabel
await page.click('#b-lengths'); await page.waitForSelector('#lendialog');
check('długości: kabel między salami bez przejścia jest pominięty i opisany', (await page.textContent('#l-sum')).includes('bez przejścia'), await page.textContent('#l-sum'));
await page.click('#l-cancel');

// przejścia
await page.click('#b-pass'); await page.waitForSelector('#passdialog');
check('okno przejść ostrzega o kablu bez przejścia', (await page.textContent('#pa-warn')).includes('bez przejścia'), await page.textContent('#pa-warn'));
await page.click('#pa-new');
check('tryb wskazywania przejścia włączony, widok pokazuje cały budynek', (await E(() => window.__editor.plan.pickState()?.kind)) === 'passage');
const act = await E(() => window.__editor.plan.spaceId());
const at = (sid, x, y) => E(([sid, x, y, act]) => { const st = window.__editor.store.state; const o = st.spaces[sid].origin ?? [0, 0], a = st.spaces[act].origin ?? [0, 0]; return window.__editor.plan.toScreen(o[0] + x - a[0], o[1] + y - a[1]); }, [sid, x, y, act]);
let pt = await at(scena, 700, 1000); await page.mouse.click(pt[0], pt[1]);
check('po pierwszym kliknięciu tryb trwa', (await E(() => window.__editor.plan.pickState()?.ends?.length)) === 1);
pt = await at(scena, 3000, 4000); await page.mouse.click(pt[0], pt[1]);
check('drugi koniec w tej samej sali jest odrzucony', (await E(() => window.__editor.plan.pickState()?.ends?.length)) === 1);
pt = await at(foh, 18000, 5000); await page.mouse.click(pt[0], pt[1]);
await page.waitForSelector('#passdialog');
let st = await state(); const pas = Object.entries(st.passages ?? {});
check('powstało przejście FOH ↔ Scena; okno otworzyło się ponownie', pas.length === 1 && new Set([pas[0][1].a.spaceId, pas[0][1].b.spaceId]).size === 2, pas);
const ends = pas[0][1]; const eS = ends.a.spaceId === scena ? ends.a : ends.b, eF = ends.a.spaceId === foh ? ends.a : ends.b;
check('końce mają współrzędne lokalne swoich sal', Math.abs(eS.x - 700) < 120 && Math.abs(eF.x - 18000) < 120 && Math.abs(eF.y - 5000) < 120, [eS, eF]);
check('ostrzeżenie zniknęło (kabel ma przejście)', (await page.textContent('#pa-warn')).trim() === '');
await page.fill('.pa-name', 'Multicore'); await page.press('.pa-name', 'Enter');
await page.fill('.pa-len', '30'); await page.press('.pa-len', 'Enter');
st = await state(); const p1 = Object.values(st.passages)[0];
check('nazwa i ręczna długość przejścia zapisane (30 m)', p1.name === 'Multicore' && p1.lengthMm === 30000, p1);
await page.fill('.pa-len', ''); await page.press('.pa-len', 'Enter');
check('puste pole = długość z planu', (await state()).passages && Object.values((await state()).passages)[0].lengthMm === undefined);
await page.click('#pa-close');
await E(() => window.__editor.plan.fitAll());
await page.screenshot({ path: path.join(out, 'sw-przejscie-1-plan.png') });

// długości przez przejście
await page.click('#b-lengths'); await page.waitForSelector('#lendialog');
check('długości: kabel policzony przez przejście', (await page.textContent('#l-sum')).includes('przez przejście') && !(await page.textContent('#l-sum')).includes('bez przejścia'), await page.textContent('#l-sum'));
await page.fill('#l-slack', '1'); await page.dispatchEvent('#l-slack', 'input'); await page.click('#l-go');
const cab = (await E(() => Object.values(window.__editor.store.state.cables)))[0];
// FOH: 2500 + |10000 − eF.x| + |5000 − eF.y|; przejście liczone z planu; scena: 2500 + |eS.x − 2000| + |eS.y − 1000|
const wF = [eF.x, eF.y], wS = [eS.x + 22000, eS.y];
const expect = Math.ceil((2500 + Math.abs(10000 - eF.x) + Math.abs(5000 - eF.y) + (Math.abs(wF[0] - wS[0]) + Math.abs(wF[1] - wS[1])) + 2500 + Math.abs(eS.x - 2000) + Math.abs(eS.y - 1000) + 1000) / 100) * 100;
check('długość kabla = dojście FOH + przejście + dojście na scenie + zapas', cab.lengthMm === expect && cab.estimateBasis?.passage === pas[0][0], [cab.lengthMm, expect, cab.estimateBasis]);

// cofanie
await page.keyboard.press('Control+z');
check('Ctrl+Z cofa liczenie długości', (await E(() => Object.values(window.__editor.store.state.cables)))[0].lengthSource !== 'estimated');

// duże okno: nadal bez nakładania
await page.setViewportSize({ width: 1920, height: 1000 }); await page.waitForTimeout(150);
const pb2 = await rect('#planbar'), cat2 = await rect('#catalog');
check('1920 px: pasek planu w jednym rzędzie i katalog pod nim', pb2.h < 80 && cat2.t >= pb2.b, [pb2.h, pb2.b, cat2.t]);
await page.setViewportSize({ width: 1100, height: 768 }); await page.waitForTimeout(150);
const pb3 = await rect('#planbar'), cat3 = await rect('#catalog');
check('1100 px: pasek się zawija, katalog nadal pod nim', cat3.t >= pb3.b, [pb3.b, cat3.t]);
await page.setViewportSize({ width: 1366, height: 768 });

await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
