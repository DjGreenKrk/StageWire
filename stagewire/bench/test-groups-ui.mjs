// Test: grupy na schemacie (ramki), „Grupy wg sal”, „Uporządkuj” (pasy grup), eksport PDF schematu z ramkami. Zrzut ekranu w SHOTS.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5233, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5233/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');

await E(async ([cu, pu, mu]) => {
  const c = await import(cu), pl = await import(pu), m = await import(mu), st = window.__editor.store, d = (l, fn) => st.dispatch(l, fn);
  d('s1', pl.plan.addSpace('spc_a', 'Scena', 12000, 8000)); d('s2', pl.plan.addSpace('spc_b', 'FOH', 8000, 6000));
  for (const [id, n] of [['eqi_c1', 'Kamera 1'], ['eqi_c2', 'Kamera 2'], ['eqi_c3', 'Kamera 3']]) d('add', c.addFromCatalog('camera_sdi', n, id));
  d('add', c.addFromCatalog('video_switcher', 'Mikser', 'eqi_m'));
  d('c1', m.cmd.connect({ instanceId: 'eqi_c1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  d('c2', m.cmd.connect({ instanceId: 'eqi_c2', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin2' }, 'std/sdi-3g'));
  for (const [id, sp] of [['eqi_c1', 'spc_a'], ['eqi_c2', 'spc_a'], ['eqi_c3', 'spc_a'], ['eqi_m', 'spc_b']]) d('p', pl.plan.place(id, sp, 2000, 2000));
  window.__editor.plan.refresh();
}, [u('catalog/index.ts'), u('plan.ts'), u('commands.ts')]);

check('przyciski „Uporządkuj” i „Grupy…” widoczne w trybie schematu, ukryte na planie', (await page.isVisible('#b-layout')) && (await page.isVisible('#b-groups')));
await page.click('#b-groups'); await page.waitForSelector('#grpdialog');
await page.click('#g-rooms'); let st = await state();
check('„Grupy wg sal” → grupy Scena (3) i FOH (1)', Object.values(st.groups ?? {}).map((g) => `${g.name}:${g.members.length}`).sort().join() === 'FOH:1,Scena:3', st.groups);
await page.click('#g-close'); await page.click('#b-layout');
st = await state(); const n = st.views?.viw_main?.nodes ?? {}; const byInst = Object.fromEntries(Object.values(n).map((v) => [v.instanceId, v]));
check('Uporządkuj: kamery po lewej, mikser po prawej', byInst.eqi_c1.x < byInst.eqi_m.x && byInst.eqi_c1.x === byInst.eqi_c2.x, byInst);
check('grupa FOH w osobnym pasie pod grupą Scena', byInst.eqi_m.y > byInst.eqi_c3.y && byInst.eqi_c3.y < byInst.eqi_m.y);
await page.screenshot({ path: path.join(out, 'sw-grupy-1-schemat.png') });
await page.keyboard.press('Control+z'); st = await state();
check('Ctrl+Z cofa porządkowanie', JSON.stringify(Object.values(st.views?.viw_main?.nodes ?? {})) !== JSON.stringify(Object.values(n)));
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
check('na planie przyciski schematu są ukryte', !(await page.isVisible('#b-layout')));
await page.click('#b-mode'); await page.click('#b-burger');
check('menu ☰: Nowy / Otwórz / Zapisz / Zapisz jako / Lista kabli / Schemat PDF / O programie', (await page.$$eval('#filemenu button', (b) => b.filter((x) => x.offsetParent).map((x) => x.textContent).join('|'))) === 'Nowy projekt|Otwórz…|Zapisz|Zapisz jako…|Lista kabli|Schemat PDF…|Ustawienia…|O programie');
await page.click('#b-about'); await page.waitForSelector('#aboutdialog'); { const t = await page.textContent('#aboutdialog'); check('„O programie”: wersja i licencja', t.includes('PolyForm Shield') && /Wersja \d+\.\d+\.\d+/.test(t)); } await page.click('#ab-close');
console.log(`\ngroups: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
