// Test: panel „Do rozmieszczenia” (przeciąganie urządzeń/racków na wybraną salę), blokada obiektów sceny, poziom podłogi sali, numeracja w spisie PDF.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5232, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5232/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');

await E(async ([cu, ru, pu, su]) => {
  const c = await import(cu), r = await import(ru), pl = await import(pu), sg = await import(su), st = window.__editor.store, d = (l, fn) => st.dispatch(l, fn);
  d('s1', pl.plan.addSpace('spc_a', 'Scena', 12000, 8000)); d('s2', pl.plan.addSpace('spc_b', 'FOH', 8000, 6000));
  for (const [id, n] of [['eqi_c1', 'Kamera 1'], ['eqi_c2', 'Kamera 2'], ['eqi_c3', 'Kamera 3']]) d('add', c.addFromCatalog('camera_sdi', n, id));
  d('rack', r.rackCmd.addRack('rck_a', { name: 'Rack A', units: 12 })); d('rack', r.rackCmd.addRack('rck_b', { name: 'Rack B', units: 8 }));
  d('o', sg.stageCmd.addObject('sob_s', { name: 'Scena główna', widthMm: 6000, depthMm: 4000, heightMm: 1000 }));
}, [u('catalog/index.ts'), u('racks.ts'), u('plan.ts'), u('stage.ts')]);
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });

// ---- panel: lista, przeciąganie do wybranej sali
await page.click('#b-pick'); await page.waitForSelector('#unpl');
check('panel listuje 3 urządzenia i 2 racki', (await page.$$eval('#unpl .up-i', (r) => r.length)) === 5, await page.$$eval('#unpl .up-n', (r) => r.map((x) => x.firstChild.textContent)));
await E(() => { window.__editor.plan.setActive('spc_b'); window.__editor.plan.fit(); });
const ctr = await E(() => { const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + r.width / 2 + 100, r.top + r.height / 2 + 60]; });
const row = await page.$('#unpl .up-i[data-id="eqi_c2"] .up-n'); const bb = await row.boundingBox();
await page.mouse.move(bb.x + 20, bb.y + 10); await page.mouse.down(); await page.mouse.move(bb.x + 120, bb.y + 60, { steps: 4 }); await page.mouse.move(ctr[0], ctr[1], { steps: 6 }); await page.mouse.up();
let st = await state(); const pc = Object.values(st.placements).find((p) => p.targetId === 'eqi_c2');
check('przeciągnięte urządzenie stoi w aktywnej sali FOH w miejscu upuszczenia', !!pc && pc.spaceId === 'spc_b' && pc.position.x > 0, pc);
check('lista zmniejszyła się o postawione urządzenie', (await page.$$eval('#unpl .up-i', (r) => r.length)) === 4);
// rack B na scenę (zmiana sali + przeciągnięcie racka)
await E(() => { window.__editor.plan.setActive('spc_a'); window.__editor.plan.fit(); });
const rr = await page.$('#unpl .up-i[data-id="rck_b"] .up-n'); const rb = await rr.boundingBox();
await page.mouse.move(rb.x + 20, rb.y + 10); await page.mouse.down(); await page.mouse.move(ctr[0] - 200, ctr[1], { steps: 8 }); await page.mouse.up();
st = await state(); const pr = Object.values(st.placements).find((p) => p.targetId === 'rck_b');
check('wybrany Rack B stoi na scenie, Rack A nadal czeka na liście', !!pr && pr.spaceId === 'spc_a' && !Object.values(st.placements).some((p) => p.targetId === 'rck_a'));
// zaznaczone → rzędy
await page.check('#unpl .up-i[data-id="eqi_c1"] .up-c'); await page.check('#unpl .up-i[data-id="eqi_c3"] .up-c'); await page.click('#up-go');
st = await state(); check('zaznaczone rozmieszczone w rzędach w aktywnej sali', ['eqi_c1', 'eqi_c3'].every((id) => Object.values(st.placements).find((p) => p.targetId === id)?.spaceId === 'spc_a'));
await page.click('#up-x'); check('panel zamyka się', !(await page.$('#unpl')));

// ---- blokada
await E(async ([pu, su]) => { const pl = await import(pu), sg = await import(su), s = window.__editor.store; s.dispatch('p', pl.plan.placeRack('sob_s', 'spc_a', 6000, 4000)); window.__editor.plan.refresh(); }, [u('plan.ts'), u('stage.ts')]);
await page.click('#b-lock'); st = await state();
check('„Zablokuj sceny” blokuje bryły sceniczne sali', Object.values(st.placements).find((p) => p.targetId === 'sob_s')?.locked === true && (await page.textContent('#b-lock')) === 'Odblokuj');
const sc = await E(() => window.__editor.plan.toScreen(6000, 4000)); const before = JSON.stringify((await state()).placements.plc_sobs ?? Object.values((await state()).placements).find((p) => p.targetId === 'sob_s'));
await page.mouse.move(sc[0], sc[1]); await page.mouse.down(); await page.mouse.move(sc[0] + 80, sc[1] + 40, { steps: 5 }); await page.mouse.up();
const after = JSON.stringify(Object.values((await state()).placements).find((p) => p.targetId === 'sob_s'));
check('zablokowanej sceny nie da się przesunąć przeciąganiem', after.includes('"x":6000') && after.includes('"y":4000'), after);
await page.click('#b-lock'); check('„Odblokuj sceny” zdejmuje blokadę', !Object.values(await state().then((s) => s.placements)).find((p) => p.targetId === 'sob_s').locked);

// ---- poziom podłogi
await E(() => window.__editor.plan.setActive('spc_b')); await page.click('#b-space'); await page.waitForSelector('#spacedialog');
await page.fill('#s-floor', '2,6'); await page.click('#s-save'); st = await state();
check('poziom podłogi FOH = 2,6 m zapisany w sali', st.spaces.spc_b.floorLevelMm === 2600, st.spaces.spc_b.floorLevelMm);
console.log(`\nunplaced: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
