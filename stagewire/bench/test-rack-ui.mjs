// Test widoku racka w interfejsie: tworzenie racka, przeciąganie z listy i między pozycjami, kolizje, przód/tył, sumy, cofanie, V-003.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5212, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5212/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').replace(/\\/g, '/');
const dev = (key, model, h, wf) => ({ key, manufacturer: 'Fikcyjny', model, category: 'sieć', dimensionsMm: { width: 440, depth: 300, height: 44 * h }, rackUnits: { heightU: h, widthFraction: wf }, weightKg: 3, powerW: 20,
  ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } });
await E(async ([url, p]) => { const m = await import(url); m.installPack(p); window.__editor.store.dispatch('x', m.addFromCatalog('rk-ui/sw', 'Switch A', 'eqi_a')); window.__editor.store.dispatch('x', m.addFromCatalog('rk-ui/sw', 'Switch B', 'eqi_b')); window.__editor.store.dispatch('x', m.addFromCatalog('rk-ui/srv', 'Serwer', 'eqi_s')); window.__editor.store.dispatch('x', m.addFromCatalog('camera_sdi', 'Kamera', 'eqi_c')); },
  [catUrl, { format: 'stagewire-pack/1', id: 'rk-ui', name: 'Rack UI', version: '1.0.0', license: 'własne', devices: [dev('sw', 'Switch 1U', 1, 1), dev('srv', 'Serwer 2U', 2, 1)] }]);
const state = () => E(() => { const s = window.__editor.store.state; return { racks: s.racks ?? {}, mounts: Object.fromEntries(Object.entries(s.equipment).map(([k, v]) => [k, v.mount ? `${v.mount.uStart}${v.mount.face === 'rear' ? 'r' : ''}${v.mount.slot === 'full' ? '' : v.mount.slot}` : null])) }; });
const drag = async (from, to) => { await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up(); };

await page.click('#b-rack'); await page.waitForSelector('#rackview', { state: 'visible' });
check('widok racka otwarty; panel właściwości ukryty', (await E(() => window.__editor.rack.active)) && !(await page.isVisible('#props')));
check('bez racków: komunikat w panelu i wyłączone Zmień/PDF', (await page.textContent('#rackpanel')).includes('Utwórz rack') && (await page.isDisabled('#rk-edit')));

await page.click('#rk-new'); await page.waitForSelector('#rackdialog');
await page.fill('#rf-name', 'Rack FOH'); await page.fill('#rf-units', '10'); await page.fill('#rf-depth', '600'); await page.click('#rf-ok');
let st = await state(); check('rack utworzony (10 U, 600 mm)', Object.values(st.racks).length === 1 && Object.values(st.racks)[0].units === 10 && Object.values(st.racks)[0].depthMm === 600, st.racks);
const lst = await page.textContent('#rackpanel'); check('lista „Poza rackiem” zawiera tylko urządzenia rackowe (3, bez kamery)', lst.includes('Poza rackiem (3)') && !lst.includes('Kamera'), lst.slice(lst.indexOf('Poza')));

// przeciąganie z listy na U3 oraz U1
const li = async (name) => { const b = await page.$(`#rackpanel [data-un="${name}"]`); const r = await b.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const P = (u, f = 0.5) => E(([a, b]) => window.__editor.rack.pointOf(a, b), [u, f]);
await drag(await li('eqi_a'), await P(3)); st = await state(); check('przeciągnięcie z listy: Switch A na U3', st.mounts.eqi_a === '3', st.mounts);
await drag(await li('eqi_s'), await P(6)); st = await state(); check('Serwer 2U upuszczony na U6 zajmuje U5–U6 (uchwyt na górnym U)', st.mounts.eqi_s === '5', st.mounts);
const tot = await page.textContent('#rk-tot'); check('sumy: 3 U zajęte, 7 wolnych, 6 kg, 40 W', tot.includes('Zajęte 3 z 10 U') && tot.includes('wolne 7') && tot.includes('6 kg') && tot.includes('40 W'), tot);

// kolizja: B na zajęte U3
await drag(await li('eqi_b'), await P(3)); st = await state(); check('upuszczenie na zajęte miejsce jest odrzucone, komunikat o zajętości', st.mounts.eqi_b === null && (await page.textContent('#msg')).includes('zajęte'), await page.textContent('#msg'));
// przeniesienie w racku: A z U3 na U8
await drag(await P(3), await P(8)); st = await state(); check('przeciągnięcie zamontowanego Switch A z U3 na U8', st.mounts.eqi_a === '8', st.mounts);
await E(() => window.__editor.store.undo()); await E(() => window.__editor.rack.refresh()); st = await state(); check('cofnięcie przywraca U3', st.mounts.eqi_a === '3', st.mounts);

// przód/tył: ta sama U na tyle jest wolna
await page.click('#rk-face'); check('przełącznik strony pokazuje Tył', (await page.textContent('#rk-face')) === 'Tył');
await drag(await li('eqi_b'), await P(3)); st = await state(); check('na tyle U3 jest wolne: Switch B zamontowany na tyle', st.mounts.eqi_b === '3r', st.mounts);
await page.click('#rk-face');

// zaznaczenie i zdjęcie klawiszem Delete
const [sx, sy] = await P(3); await page.mouse.click(sx, sy);
check('klik w urządzenie zaznacza je w panelu', (await page.textContent('#rackpanel')).includes('Switch A'), (await page.textContent('#rackpanel')).slice(0, 200));
await page.keyboard.press('Delete'); st = await state(); check('Delete zdejmuje z racka (urządzenie zostaje w projekcie)', st.mounts.eqi_a === null && (await E(() => !!window.__editor.store.state.equipment.eqi_a)), st.mounts);

// dodanie z katalogu w widoku racka montuje w pierwszym wolnym
await page.fill('#catalog input', 'Switch 1U'); await page.waitForSelector('#cat-list button[data-cat]'); await page.click('#cat-list button[data-cat]'); await page.fill('#catalog input', '');
st = await state(); const added = Object.entries(st.mounts).find(([k]) => !['eqi_a', 'eqi_b', 'eqi_s', 'eqi_c'].includes(k));
check('dodanie z katalogu w widoku racka od razu montuje urządzenie', !!added && added[1] === '1', st.mounts);

check('rack ma id i nazwę w stanie (kontrola modelu)', Object.keys((await state()).racks).length === 1);

await page.screenshot({ path: path.join(process.env.TEMP || '.', 'sw-rack.png') });
// edycja i usuwanie
await page.click('#rk-edit'); await page.waitForSelector('#rackdialog'); await page.fill('#rf-units', '3'); await page.click('#rf-ok');
check('zmniejszenie racka poniżej zajętego U jest odrzucone z komunikatem', (await page.textContent('#rf-msg')).includes('mniej niż'), await page.textContent('#rf-msg'));
await page.fill('#rf-units', '12'); await page.fill('#rf-name', 'Rack scena'); await page.click('#rf-ok');
st = await state(); check('zmiana nazwy i wysokości racka', Object.values(st.racks)[0].name === 'Rack scena' && Object.values(st.racks)[0].units === 12, st.racks);
await page.click('#rk-edit'); await page.waitForSelector('#rackdialog'); await page.click('#rf-del'); await page.waitForSelector('#dialog'); await page.click('#dialog [data-id="go"]');
st = await state(); check('usunięcie racka zdejmuje urządzenia, nic nie ginie', Object.keys(st.racks).length === 0 && Object.values(st.mounts).every((m) => m === null) && Object.keys(st.mounts).length >= 5, st);

// powrót do schematu
await page.click('#b-rack'); check('powrót do schematu', !(await E(() => window.__editor.rack.active)) && (await page.textContent('#b-rack')) === 'Rack');
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
