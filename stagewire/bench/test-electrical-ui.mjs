// Test: grzebień nad aparatami w widoku szafy, płyta montażowa dla elementów bez DIN, obudowy z pakietów w oknie „Nowa szafa”.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5238, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5238/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const port = (key, label, dir, extra = {}) => ({ key, label, connector: 'std/din-terminal', signals: ['std/power-ac'], direction: dir, ...extra });
const base = { manufacturer: 'Fikcyjny', category: 'zasilanie', source: { kind: 'custom' } };
const teeth = Array.from({ length: 6 }, (_, i) => { const t = ['L1', 'L2', 'L3'][i % 3]; return port('t' + (i + 1), t, 'io', { connector: 'std/din-comb-slot', terminal: { track: t, at: i, side: 'top', kind: 'comb-slot', fits: ['p1'] } }); });
const pack = { format: 'stagewire-pack/1', id: 'el-ui', name: 'Elektryka UI', version: '1.0.0', license: 'własne',
  enclosures: [{ key: 've212', manufacturer: 'Fikcyjny', model: 'Obudowa 2x12', widthMm: 320, heightMm: 410, depthMm: 140, rows: 2, modules: 12, ip: 'IP65', source: { kind: 'custom' } }],
  devices: [
    { ...base, key: 'mcb', model: 'Wyłącznik 1P', dinModules: 1, dimensionsMm: { width: 17.5, depth: 60, height: 90 }, ports: [port('in', 'IN', 'in', { terminal: { at: 0, side: 'top', kind: 'screw' } }), port('ic', 'IN (grzebień)', 'in', { connector: 'std/din-comb-slot', terminal: { at: 0, side: 'top', kind: 'comb-slot', fits: ['p1'] } }), port('out', 'OUT', 'out')], internalLinks: [{ kind: 'bridge', members: ['in', 'ic'] }] },
    { ...base, key: 'comb', model: 'Grzebień 3P', dinModules: 6, placementLayer: 'busbar', dimensionsMm: { width: 105, depth: 20, height: 10 }, ports: teeth, internalLinks: [{ kind: 'bridge', members: ['t1', 't4'] }, { kind: 'bridge', members: ['t2', 't5'] }, { kind: 'bridge', members: ['t3', 't6'] }] },
    { ...base, key: 'psu', model: 'Zasilacz na płytę', dimensionsMm: { width: 100, depth: 50, height: 60 }, ports: [port('o', 'OUT', 'out')] },
  ] };
await E(async ([c, k, p]) => { const m = await import(c), cab = await import(k); m.installPack(p); const d = window.__editor.store.dispatch.bind(window.__editor.store);
  d('s', cab.cabCmd.addCabinet('cab_ui', { name: 'Szafa', widthMm: 300, heightMm: 350, rows: 2, modules: 12 }));
  for (const [key, id] of [['mcb', 'eqi_a'], ['mcb', 'eqi_b'], ['mcb', 'eqi_c'], ['comb', 'eqi_cb']]) d('a', m.addFromCatalog('el-ui/' + key, id, id));
  for (const [id, at] of [['eqi_a', 1], ['eqi_b', 2], ['eqi_c', 3], ['eqi_cb', 1]]) d('m', cab.cabCmd.mount(id, { cabinetId: 'cab_ui', row: 1, at })); }, [u('catalog/index.ts'), u('cabinets.ts'), pack]);

await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' });
const layer = await E(() => window.__editor.store.state.equipment.eqi_cb.din.layer);
check('grzebień zamontowany w warstwie „busbar” (nie zajmuje modułów aparatów)', layer === 'busbar');
const tot = await page.textContent('#cb-tot'); check('suma modułów liczy tylko aparaty (3 z 24)', tot.includes('Zajęte 3 z 24'), tot.slice(0, 40));
const pA = await E(() => window.__editor.cab.deviceCenter('eqi_a')), pC = await E(() => window.__editor.cab.deviceCenter('eqi_cb'));
check('pasek grzebienia leży nad rzędem aparatów (wyżej niż aparat)', pC[1] < pA[1], [pA, pC]);
await page.mouse.click(...pC); { const t = await page.textContent('#cabpanel'); check('klik w pasek zaznacza grzebień, a nie aparat pod nim', t.includes('Zaznaczone') && t.includes('eqi_cb')); }
await page.mouse.click(...pA); { const t = await page.textContent('#cabpanel'); check('klik w aparat zaznacza aparat', t.includes('Zaznaczone') && t.includes('eqi_a') && !t.includes('eqi_cb')); }
await page.screenshot({ path: path.join(out, 'sw-szafa-grzebien.png') });
const issues = await E(async (v) => { const m = await import(v); return m.validate(window.__editor.store.state).filter((i) => /V-04|V-05/.test(i.ruleId)).map((i) => i.ruleId); }, u('validation.ts'));
check('walidacja: zęby 4–6 bez aparatu to tylko informacje V-050', issues.length === 3 && issues.every((x) => x === 'V-050'), issues);

// element bez DIN na płycie
await page.click('#cat-fit-cb');
await page.fill('#catalog input[type=search]', 'Zasilacz na płytę'); await page.click('#cat-list [data-cat$="/psu"]');
const plate = await E(() => Object.values(window.__editor.store.state.equipment).find((e) => e.name.startsWith('Zasilacz'))?.plate);
check('dodanie z katalogu elementu bez DIN w widoku szafy przykręca go do płyty', !!plate && plate.cabinetId === 'cab_ui', plate);
check('panel pokazuje sekcję „Na płycie montażowej (1)”', (await page.textContent('#cabpanel')).includes('Na płycie montażowej (1)'));

// obudowy z pakietów
await page.click('#cb-new'); await page.waitForSelector('#cabdialog');
const opts = await page.$$eval('#cf-preset option', (o) => o.map((x) => x.textContent));
check('okno „Nowa szafa” zawiera obudowę z pakietu', opts.some((t) => t.includes('Obudowa 2x12') && t.includes('IP65')), opts.slice(-2));
await page.selectOption('#cf-preset', { label: opts.find((t) => t.includes('Obudowa 2x12')) });
check('wybór obudowy wypełnia wymiary i nazwę', (await page.inputValue('#cf-w')) === '320' && (await page.inputValue('#cf-rows')) === '2' && (await page.inputValue('#cf-mods')) === '12' && (await page.inputValue('#cf-name')).includes('Obudowa 2x12'));
await page.click('#cf-cancel');
console.log(`\nelectrical: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
