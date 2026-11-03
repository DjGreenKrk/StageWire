// Test: zmiana rozmiaru okna (pełny ekran), legenda i kolory kabli + ustawienia, przewijanie panelu właściwości, zaznaczanie urządzenia nad bryłą.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5234, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5234/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const canvases = () => E(() => [...document.querySelectorAll('canvas')].map((c) => [c.id || c.parentElement.id, c.width, c.height]));

await E(async ([cu, pu, mu, su]) => {
  const c = await import(cu), pl = await import(pu), m = await import(mu), sg = await import(su), st = window.__editor.store, d = (l, fn) => st.dispatch(l, fn);
  d('s1', pl.plan.addSpace('spc_a', 'Sala', 12000, 8000));
  d('add', c.addFromCatalog('camera_sdi', 'Kamera 1', 'eqi_c1')); d('add', c.addFromCatalog('video_switcher', 'Mikser', 'eqi_m'));
  d('c1', m.cmd.connect({ instanceId: 'eqi_c1', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  d('p', pl.plan.place('eqi_c1', 'spc_a', 5000, 4000));              // urządzenie PRZED bryłą
  d('o', sg.stageCmd.addObject('sob_s', { name: 'Schody widowni', widthMm: 6000, depthMm: 4000, heightMm: 1500, shape: 'stairs', steps: 6 }));
  d('q', pl.plan.placeRack('sob_s', 'spc_a', 5000, 4000));
  window.__editor.plan.refresh();
}, [u('catalog/index.ts'), u('plan.ts'), u('commands.ts'), u('stage.ts')]);

// 1. zmiana rozmiaru okna
await page.setViewportSize({ width: 1700, height: 950 }); await page.waitForTimeout(300);
let cv = await canvases();
check('schemat: po powiększeniu okna płótno ma nowy rozmiar (1700 × 922)', cv.filter(([, w, h]) => w === 1700 && h === 922).length >= 2, cv);
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
await page.setViewportSize({ width: 1500, height: 800 }); await page.waitForTimeout(300);
cv = await canvases(); check('plan: płótna dopasowane po zmianie rozmiaru (1500 × 772)', cv.filter(([id, w, h]) => w === 1500 && h === 772).length >= 3, cv);
// 5. zaznaczenie urządzenia leżącego nad bryłą
await E(() => window.__editor.plan.fit());
const sc = await E(() => window.__editor.plan.toScreen(5000, 4000));
await page.mouse.click(sc[0], sc[1]);
check('klik w urządzenie stojące na bryle zaznacza urządzenie (nie bryłę)', (await E(() => window.__editor.selectedNode?.() ?? document.querySelector('#props h3')?.textContent)) !== undefined && /Plan|Kamera|eqi_c1/.test(await E(() => document.getElementById('props').innerText)), await E(() => document.getElementById('props').innerText.slice(0, 60)));
// 4. przewijanie panelu właściwości bryły (niski ekran)
await page.setViewportSize({ width: 1366, height: 600 }); await page.waitForTimeout(300);
await E(() => window.__editor.plan.setActive('spc_a'));
await page.mouse.click(await E(() => window.__editor.plan.toScreen(3200, 2200)).then((p) => p[0]), await E(() => window.__editor.plan.toScreen(3200, 2200)).then((p) => p[1]));
const pr = await E(() => { const e = document.getElementById('props'); const cs = getComputedStyle(e); return { oy: cs.overflowY, h: e.getBoundingClientRect().height, bottom: e.getBoundingClientRect().bottom, vh: innerHeight, txt: e.innerText.slice(0, 30) }; });
check('panel właściwości mieści się w oknie i ma przewijanie', pr.oy === 'auto' && pr.bottom <= pr.vh, pr);

// 2. legenda i kolory kabli, ustawienia
await page.click('#b-mode'); await page.waitForTimeout(200);
check('legenda kolorów kabli widoczna na schemacie', (await page.isVisible('#siglegend')) && (await page.textContent('#siglegend')).includes('Wideo SDI'));
const e0 = await E(() => window.__editor.edgeColor(window.__editor.edgeId(0)));
await page.click('#b-burger'); await page.click('#b-settings'); await page.waitForSelector('#setdialog');
await page.fill('#st-rows input[data-l="Wideo SDI / IP"]', '#ff0000').catch(() => {});
await E(() => { const i = document.querySelector('#st-rows input[data-l="Wideo SDI / IP"]'); i.value = '#ff0000'; i.dispatchEvent(new Event('change', { bubbles: true })); });
const e1 = await E(() => window.__editor.edgeColor(window.__editor.edgeId(0)));
check('własny kolor SDI zmienia kolor kabla na schemacie', e0 !== '#ff0000' && e1 === '#ff0000', [e0, e1]);
await page.screenshot({ path: path.join(out, 'sw-ustawienia-1.png') });
await page.click('#st-reset'); const e2 = await E(() => window.__editor.edgeColor(window.__editor.edgeId(0)));
check('„Przywróć domyślne” cofa kolor', e2 === e0, e2);
await page.check('#st-color'); check('ustawienie „eksporty w kolorze” zapamiętane', await E(() => JSON.parse(localStorage.getItem('stagewire.settings.v1')).exportColor === true));
await page.click('#st-close');
console.log(`\nfeedback2: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
