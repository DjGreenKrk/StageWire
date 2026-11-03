// Test uwag z pierwszych prób (projekt1): potwierdzenie niezgodnego połączenia, blokada zajętego portu, kolorowanie, lista uwag,
// połączenie bez kabla, usuwanie z potwierdzeniem, pion trasy.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5201, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5201/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
const counts = () => E(() => window.__editor.counts());
const drag = async (a, pa, b, pb) => {
  const p1 = await E(([i, p]) => window.__editor.portScreen(i, p), [a, pa]), p2 = await E(([i, p]) => window.__editor.portScreen(i, p), [b, pb]);
  await page.mouse.move(p1[0], p1[1]); await page.mouse.down(); await page.mouse.move(p2[0], p2[1], { steps: 10 }); await page.mouse.up();
};
await addAt('laptop', 0, 40); await addAt('camera_sdi', 0, 240); await addAt('camera_sdi', 0, 440); await addAt('video_switcher', 420, 140);
await E(() => window.__editor.look(210, 240, 1));
const [lap, k1, k2, mix] = await E(() => Object.keys(window.__editor.nodes()));

// niezgodne połączenie: pytanie, anulowanie, potwierdzenie
await drag(lap, 'prt_hdmiout', mix, 'prt_sdiin1');
await page.waitForSelector('#dialog');
check('niezgodne połączenie pyta o potwierdzenie i podaje powód', (await page.textContent('#dialog')).includes('Różne złącza') && (await page.textContent('#dialog')).includes('Niezgodne'));
await page.click('#dialog button[data-id="no"]');
check('Anuluj: połączenie nie powstaje', (await counts()).connections === 0);
await drag(lap, 'prt_hdmiout', mix, 'prt_sdiin1'); await page.waitForSelector('#dialog'); await page.click('#dialog button[data-id="go"]');
check('„Połącz mimo to”: połączenie powstaje', (await counts()).connections === 1);
const e0 = await E(() => window.__editor.edgeId(0));
check('krawędź z uwagą jest wyróżniona kolorem (nie niebieska)', ['#FFD54F', '#E53935'].includes(await E((id) => window.__editor.edgeColor(id), e0)), await E((id) => window.__editor.edgeColor(id), e0));
// lista uwag
await page.click('#issues-link'); await page.waitForSelector('#issuesdialog');
const rows = await page.$$eval('#issuesdialog tbody tr', (r) => r.map((x) => x.textContent));
check('lista uwag pokazuje reguły V-010/V-011/V-019 i nazwy urządzeń', rows.length >= 2 && rows.join().includes('Laptop prezentera 1') && rows.join().includes('V-010'), rows);
await page.click('#i-close');

// połączenie bez kabla: panel, przypisanie
const m = await E((id) => window.__editor.edgeMid(id), e0); await page.mouse.click(m[0], m[1]);
check('połączenie bez kabla ma panel z przypisaniem', (await page.textContent('#props')).includes('bez kabla') && (await page.$('#c-assign')) !== null);
await page.selectOption('#c-type', 'std/cable-hdmi'); await page.click('#c-assign');
check('po przypisaniu powstaje kabel i panel pokazuje pola kabla', (await counts()).cables === 1 && (await page.$('#c-len')) !== null);
await page.selectOption('#c-type', 'std/cable-sdi');
check('typ kabla można zmienić na liście', (await E(() => Object.values(window.__editor.store.state.cables)[0].cableTypeKey)) === 'std/cable-sdi');

// zajęty port: blokada bez pytania
await drag(k1, 'prt_sdiout', mix, 'prt_sdiin2');
check('poprawne połączenie bez pytania', (await counts()).connections === 2 && !(await page.$('#dialog')));
await drag(k2, 'prt_sdiout', mix, 'prt_sdiin2');
check('port zajęty: drugi kabel do tego samego gniazda nie powstaje, bez okna', (await counts()).connections === 2 && !(await page.$('#dialog')) && (await page.textContent('#msg')).includes('zajęty'), await page.textContent('#msg'));
check('upuszczenie na nagłówek urządzenia z zajętym portem: wybiera inny wolny port, bez pytania', await (async () => {
  const hd = await E((i) => window.__editor.nodeScreen(i).header, mix), a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), k2);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(hd[0], hd[1], { steps: 8 }); await page.mouse.up();
  const c = await E(() => Object.values(window.__editor.store.state.connections).filter((x) => x.from.instanceId === window.__editor.nodesIds?.k2 || true).length);
  const ports = await E(() => Object.values(window.__editor.store.state.connections).map((x) => x.to.portId + '|' + x.to.instanceId));
  return new Set(ports).size === ports.length && ports.length === 3 && !(await page.$('#dialog'));
})());

// usuwanie urządzenia: zawsze potwierdzenie
const hd2 = await E((i) => window.__editor.nodeScreen(i).header, k2); await page.mouse.click(hd2[0], hd2[1]);
const before = (await counts()).devices;
await page.click('#p-del'); await page.waitForSelector('#dialog');
check('usuwanie pyta o potwierdzenie', (await page.textContent('#dialog')).includes('Usunąć'));
await page.click('#dialog button[data-id="no"]');
check('Anuluj: urządzenie zostaje', (await counts()).devices === before);
await page.click('#p-del'); await page.waitForSelector('#dialog'); await page.click('#dialog button[data-id="go"]');
check('potwierdzenie usuwa urządzenie', (await counts()).devices === before - 1);
check('po potwierdzeniu da się cofnąć', (await (async () => { await page.keyboard.press('Control+z'); return (await counts()).devices === before; })()));

// pion trasy
await page.click('#b-mode'); await page.click('#b-space'); await page.fill('#s-w', '20'); await page.fill('#s-d', '10'); await page.click('#s-save');
await page.click('#b-route');
const sc = (x, y) => E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]);
let [sx, sy] = await sc(2000, 2000); await page.mouse.click(sx, sy);
[sx, sy] = await sc(8000, 2000); await page.mouse.click(sx, sy);
await page.fill('#rt-h', '5'); await page.press('#rt-h', 'Enter'); await page.click('#b-riser');
[sx, sy] = await sc(8000, 7000); await page.mouse.click(sx, sy);
await page.keyboard.press('Enter');
const pts = await E(() => Object.values(Object.values(window.__editor.store.state.spaces)[0].cableRoutes)[0].points);
check('trasa z pionem: odcinek poziomy na 0, pion w tym samym miejscu, dalej na 5 m', JSON.stringify(pts) === '[[2000,2000,0],[8000,2000,0],[8000,2000,5000],[8000,7000,5000]]', pts);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
