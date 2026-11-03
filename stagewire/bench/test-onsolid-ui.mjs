// Test: rysowanie trasy „po bryle” na planie (stopnie i kostka wymuszają piony), włącznik „Po bryle”. Zrzut ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5222, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5222/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
await E(async ([planu, stageu]) => {
  const { plan } = await import(planu), { stageCmd } = await import(stageu), st = window.__editor.store, d = (l, f) => st.dispatch(l, f);
  d('s', plan.addSpace('spc_h', 'Hala', 20000, 10000, 8000));
  d('o', stageCmd.addObject('sob_s', { name: 'Widownia', widthMm: 4000, depthMm: 2000, heightMm: 1000, shape: 'stairs', steps: 4, color: '#7a5a8a' })); d('p', plan.placeRack('sob_s', 'spc_h', 10000, 5000, 0, 0));
  d('o2', stageCmd.addObject('sob_c', { name: 'Kostka', widthMm: 2000, depthMm: 2000, heightMm: 800 })); d('p2', plan.placeRack('sob_c', 'spc_h', 15000, 5000, 0, 0));
}, [u('plan.ts'), u('stage.ts')]);
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
await E(() => window.__editor.plan.fit()); await page.waitForTimeout(100);
const S = (x, y) => E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]);
await page.click('#b-route'); await page.click('#b-onsolid');
check('włącznik „Po bryle” świeci', (await page.getAttribute('#b-onsolid', 'class'))?.includes('on'));
for (const [x, y] of [[10000, 2000], [10000, 8000], [18000, 8000]]) { const [sx, sy] = await S(x, y); await page.mouse.click(sx, sy); }
// trasa: start na podłodze, wejście na schody (stopnie y = 4000..6000), zejście, dalej po podłodze
await page.keyboard.press('Enter');
const rts = await E(() => Object.values(window.__editor.store.state.spaces.spc_h.cableRoutes));
check('powstała jedna trasa', rts.length === 1, rts.length);
const pts = rts[0].points;
check('trasa wchodzi po stopniach: wysokości 250, 500, 750, 1000 i z powrotem 0', [250, 500, 750, 1000].every((z) => pts.some((q) => q[2] === z)) && pts.at(-1)[2] === 0 && pts[0][2] === 0, pts.map((q) => q.join(',')));
check('piony na krawędziach (kolejne punkty z tym samym x, y i różnym z)', pts.some((q, i) => i && q[0] === pts[i - 1][0] && q[1] === pts[i - 1][1] && q[2] !== pts[i - 1][2]));
// bez włącznika trasa jest płaska
await page.click('#b-route'); await page.click('#b-onsolid');
for (const [x, y] of [[13000, 3000], [17000, 3000], [17000, 7000]]) { const [sx, sy] = await S(x, y); await page.mouse.click(sx, sy); }
await page.keyboard.press('Enter');
const r2 = await E(() => Object.values(window.__editor.store.state.spaces.spc_h.cableRoutes));
check('bez „Po bryle” trasa jest płaska (wszystkie punkty na tej samej wysokości)', r2.length === 2 && new Set(r2[1].points.map((q) => q[2])).size === 1, r2[1]?.points);
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' }); await page.click('#v3-top'); await page.click('#v3-iso');
await page.screenshot({ path: path.join(out, 'sw-trasa-po-bryle-3d.png') });
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
