// Test szafy DIN na planie sali: postawienie, panel, przeciąganie, obrót, ukrycie osprzętu, długość kabla od szaf. Zrzut ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5218, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5218/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const T = (key, label, signal, direction) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const pack = { format: 'stagewire-pack/1', id: 'cp-ui', name: 'Szafa plan UI', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'Fikcyjny', model: 'Zasilacz 24 V', category: 'zasilanie', dinModules: 3, ports: [T('out', '+24 V', 'std/power-dc', 'out')], source: { kind: 'custom' } },
  { key: 'led', manufacturer: 'Fikcyjny', model: 'Sterownik LED', category: 'oświetlenie', dinModules: 4, ports: [T('in', '+24 V', 'std/power-dc', 'in')], source: { kind: 'custom' } },
] };
await E(async ([cat, cabu, planu, cmdu, pack]) => {
  const c = await import(cat), { cabCmd } = await import(cabu), { plan } = await import(planu), { cmd } = await import(cmdu), st = window.__editor.store; c.installPack(pack); const d = (l, f) => st.dispatch(l, f);
  d('s', plan.addSpace('spc_h', 'Hala', 24000, 14000, 8000));
  d('c', cabCmd.addCabinet('cab_a', { name: 'Rozdzielnica A', widthMm: 600, heightMm: 800, depthMm: 250, rows: 3, modules: 24 }));
  d('c', cabCmd.addCabinet('cab_b', { name: 'Rozdzielnica B', widthMm: 600, heightMm: 800, depthMm: 250, rows: 3, modules: 24 }));
  d('a', c.addFromCatalog('cp-ui/psu', 'Zasilacz', 'eqi_p')); d('a', c.addFromCatalog('cp-ui/led', 'Sterownik', 'eqi_l'));
  d('m', cabCmd.mount('eqi_p', { cabinetId: 'cab_a', row: 1, at: 1 })); d('m', cabCmd.mount('eqi_l', { cabinetId: 'cab_b', row: 2, at: 1 }));
  const port = (id, l) => { const s = st.state, rev = s.definitions[s.equipment[id].definitionId].revisions['1']; return Object.entries(rev.ports).find(([, p]) => p.label === l)[0]; };
  d('w', cmd.connect({ instanceId: 'eqi_p', portId: port('eqi_p', '+24 V') }, { instanceId: 'eqi_l', portId: port('eqi_l', '+24 V') }, 'std/power-dc'));
}, [u('catalog/index.ts'), u('cabinets.ts'), u('plan.ts'), u('commands.ts'), pack]);
const st = () => E(() => Object.fromEntries(Object.entries(window.__editor.store.state.placements ?? {}).map(([k, v]) => [k, `${v.targetKind}:${v.position.x},${v.position.y},${v.rotationDeg}`])));

await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
check('przycisk „Postaw rack/szafę (2)” aktywny', (await page.textContent('#b-rackput')) === 'Postaw rack/szafę (2)' && !(await page.isDisabled('#b-rackput')), await page.textContent('#b-rackput'));
await page.click('#b-rackput'); let s = await st();
check('szafa stoi na planie (typ cabinet)', Object.values(s).filter((v) => v.startsWith('cabinet:')).length === 1, s);
check('panel szafy: nazwa, szyny × moduły, współrzędne', (await page.textContent('#props')).includes('Szafa: Rozdzielnica A') && (await page.textContent('#props')).includes('3 szyn × 24 mod.'), (await page.textContent('#props')).slice(0, 70));
await page.fill('#rp-x', '5'); await page.fill('#rp-y', '4'); await page.press('#rp-y', 'Enter'); s = await st(); check('współrzędne z panelu: 5,0 × 4,0 m', s.plc_cabA === undefined ? Object.values(s).includes('cabinet:5000,4000,0') : true && Object.values(s).includes('cabinet:5000,4000,0'), s);
await page.click('#b-rackput'); await page.fill('#rp-x', '15'); await page.fill('#rp-y', '9'); await page.press('#rp-y', 'Enter'); s = await st();
check('druga szafa osobno (licznik zszedł do 0)', Object.values(s).includes('cabinet:15000,9000,0') && (await page.textContent('#b-rackput')) === 'Postaw rack/szafę' && (await page.isDisabled('#b-rackput')));
check('osprzęt w szafach nie ma własnych punktów (tylko 2 położenia)', Object.keys(s).length === 2, s);
// przeciągnięcie myszą
const from = await E(() => window.__editor.plan.toScreen(5000, 4000)), to = await E(() => window.__editor.plan.toScreen(7000, 6000));
await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up();
s = await st(); check('przeciągnięcie szafy myszą', Object.values(s).includes('cabinet:7000,6000,0'), s);
await page.keyboard.press('r'); s = await st(); check('R obraca szafę o 90°', Object.values(s).includes('cabinet:7000,6000,90'), s);
// kabel od szaf: 8 m poziomo + 3 m w pionie (różnica wysokości szyn 1 i 2 = 266 mm) + zapas
const len = await E(async (lu) => { const L = await import(lu), r = L.estimateLengths(window.__editor.store.state, 1000); return { n: r.estimates.length, len: r.estimates[0]?.lengthMm, noPlacement: r.noPlacement }; }, u('lengths.ts'));
check('estymata kabla liczy od położeń szaf', len.n === 1 && len.noPlacement === 0 && len.len >= 8000 + 3000 + 1000, len);
await page.click('#b-fit'); await page.mouse.click(5, 5); await page.screenshot({ path: path.join(out, 'sw-szafa-3-plan.png') });
// zdjęcie z planu i cofnięcie
const sc = await E(() => window.__editor.plan.toScreen(7000, 6000)); await page.mouse.click(sc[0], sc[1]); await page.click('#rp-off'); s = await st();
check('„Zdejmij z planu” kasuje położenie szafy, licznik wraca', Object.keys(s).length === 1 && (await page.textContent('#b-rackput')) === 'Postaw rack/szafę (1)', s);
await E(() => window.__editor.store.undo()); s = await st(); check('cofnięcie przywraca szafę na planie', Object.keys(s).length === 2, s);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
