// Test modułu DIN 3U w racku: szafa z wysokością w U pojawia się na liście „Poza rackiem”, da się ją przeciągnąć na rack, sumy liczą jej osprzęt.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5216, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5216/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const T = (key, label, signal, direction) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const pack = { format: 'stagewire-pack/1', id: 'cr-ui', name: 'Moduł 3U UI', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'Fikcyjny', model: 'Zasilacz 24 V', category: 'zasilanie', dinModules: 3, weightKg: 0.4, powerW: 12, ports: [T('in', 'L/N', 'std/power-ac', 'in')], source: { kind: 'custom' } },
  { key: 'sw', manufacturer: 'Fikcyjny', model: 'Switch 1U', category: 'sieć', rackUnits: { heightU: 1, widthFraction: 1 }, weightKg: 3, powerW: 20, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } },
] };
await E(async ([cat, cabu, racku, pack]) => {
  const c = await import(cat), { cabCmd } = await import(cabu), { rackCmd } = await import(racku), st = window.__editor.store; c.installPack(pack); const d = (l, f) => st.dispatch(l, f);
  d('r', rackCmd.addRack('rck_a', { name: 'Rack FOH', units: 8 }));
  d('a', c.addFromCatalog('cr-ui/psu', 'Zasilacz 1', 'eqi_p')); d('a', c.addFromCatalog('cr-ui/sw', 'Switch', 'eqi_s'));
}, [u('catalog/index.ts'), u('cabinets.ts'), u('racks.ts'), pack]);

// szafę 3U tworzymy przez okno w widoku Szafa (wzór „Moduł 3U do racka”)
await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' });
await page.click('#cb-new'); await page.waitForSelector('#cabdialog');
await page.selectOption('#cf-preset', 'rack3u'); await page.fill('#cf-name', 'Moduł DIN 3U');
check('wzór „Moduł 3U do racka” ustawia 3 U', (await page.inputValue('#cf-ru')) === '3');
await page.click('#cf-ok');
const cabId = await E(() => Object.keys(window.__editor.store.state.cabinets)[0]);
await E(async ([cabu, id]) => { const { cabCmd } = await import(cabu); window.__editor.store.dispatch('m', cabCmd.mount('eqi_p', { cabinetId: id, row: 1, at: 1 })); }, [u('cabinets.ts'), cabId]);
await page.click('#b-cab');

await page.click('#b-rack'); await page.waitForSelector('#rackview', { state: 'visible' });
let panel = await page.textContent('#rackpanel');
check('lista „Poza rackiem (2)” zawiera moduł 3U i switch', panel.includes('Poza rackiem (2)') && panel.includes('Moduł DIN 3U') && panel.includes('3 U'), panel.slice(panel.indexOf('Poza')));
const li = async (name) => { const b = await page.$(`#rackpanel [data-un="${name}"]`); const r = await b.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const P = (u2) => E((a) => window.__editor.rack.pointOf(a, 0.5), u2);
const drag = async (from, to) => { await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up(); };
await drag(await li(cabId), await P(4));
const mnt = () => E((id) => { const s = window.__editor.store.state; return { cab: s.cabinets[id].mount ?? null, sw: s.equipment.eqi_s.mount ?? null }; }, cabId);
let m = await mnt(); check('przeciągnięcie modułu na rack: uchwyt na górnym U zajmuje U2–U4', m.cab?.uStart === 2 && m.cab?.rackId === 'rck_a', m);
await drag(await li('eqi_s'), await P(3)); m = await mnt(); check('switch na zajęte miejsce modułu odrzucony', m.sw === null, m);
await drag(await li('eqi_s'), await P(6)); m = await mnt(); check('switch na wolne U6', m.sw?.uStart === 6, m);
const tot = await page.textContent('#rk-tot'); check('sumy racka: 4 U, 3,4 kg, 32 W (osprzęt szafy wliczony)', tot.includes('Zajęte 4 z 8 U') && tot.includes('3,4 kg') && tot.includes('32 W'), tot);
await page.screenshot({ path: path.join(out, 'sw-rack-4-modul3u.png') });
const [sx, sy] = await P(3); await page.mouse.click(sx, sy); await page.keyboard.press('Delete'); m = await mnt();
check('Delete zdejmuje moduł z racka (szafa zostaje w projekcie)', m.cab === null && (await E((id) => !!window.__editor.store.state.cabinets[id], cabId)), m);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
