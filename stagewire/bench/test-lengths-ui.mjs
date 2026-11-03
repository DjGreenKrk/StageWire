// Test długości kabli z planu: okno, podsumowanie, zapis jako oszacowane, ślad w liście kabli i panelu kabla, cofanie.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5198, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5198/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
await addAt('camera_sdi', 0, 40); await addAt('camera_sdi', 0, 240); await addAt('video_switcher', 420, 120);
await E(() => window.__editor.look(210, 140, 1));
const [k1, k2, mix] = await E(() => Object.keys(window.__editor.nodes()));
for (const [k, port] of [[k1, 'prt_sdiin1'], [k2, 'prt_sdiin2']]) {
  const a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), k), b = await E(([i, p]) => window.__editor.portScreen(i, p), [mix, port]);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up();
}
await page.click('#b-mode'); await page.click('#b-space'); await page.fill('#s-w', '20'); await page.fill('#s-d', '10'); await page.click('#s-save');
// ustaw ręcznie: mikser (10;5), kamera 1 (2;1); kamera 2 zostaje poza planem
await E(([k1, mix]) => { const s = window.__editor.store; const sid = Object.keys(s.state.spaces)[0];
  const key = (i) => 'plc_' + i.slice(i.indexOf('_') + 1);
  s.dispatch('t', (d) => { d.placements ??= {}; d.placements[key(mix)] = { spaceId: sid, targetKind: 'equipment', targetId: mix, position: { x: 10000, y: 5000, z: 0 }, rotationDeg: 0 };
    d.placements[key(k1)] = { spaceId: sid, targetKind: 'equipment', targetId: k1, position: { x: 2000, y: 1000, z: 0 }, rotationDeg: 0 }; }); window.__editor.plan.refresh(); }, [k1, mix]);
await page.click('#b-lengths'); await page.waitForSelector('#lendialog');
check('podsumowanie: 1 kabel do policzenia, 1 bez rozmieszczenia', (await page.textContent('#l-sum')).includes('1') && (await page.textContent('#l-sum')).includes('bez obu urządzeń'), await page.textContent('#l-sum'));
await page.fill('#l-slack', '2'); await page.dispatchEvent('#l-slack', 'input'); await page.click('#l-go');
const cabs = await E(() => Object.values(window.__editor.store.state.cables));
const est = cabs.filter((c) => c.lengthSource === 'estimated');
check('jeden kabel oszacowany: 8 + 4 + 2 = 14 m', est.length === 1 && est[0].lengthMm === 14000, cabs);
check('zapas zapisany w ustawieniach projektu', (await E(() => window.__editor.store.state.settings.defaultCableSlackMm)) === 2000);
await page.click('#b-mode'); await page.click('#b-burger'); await page.click('#b-report'); await page.waitForSelector('#reportdialog');
check('lista kabli oznacza długość jako oszacowaną (~)', (await page.$$('#reportdialog .warn[title="oszacowana z planu"]')).length === 1);
const val = await page.$$eval('#reportdialog .f-len', (i) => i.map((x) => x.value));
check('lista kabli pokazuje 14 m', val.includes('14'), val);
await page.click('#r-close');
await page.keyboard.press('Control+z');
check('Ctrl+Z cofa liczenie długości', (await E(() => Object.values(window.__editor.store.state.cables).filter((c) => c.lengthSource === 'estimated').length)) === 0);
check('bez błędów walidacji', (await E(() => window.__editor.issues())) === 0);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
