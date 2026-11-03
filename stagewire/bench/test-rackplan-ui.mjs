// Test racka na planie sali: postawienie, przeciąganie, panel, obrót, długości kabli od racka. Robi też zrzuty przykładowego racka.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5213, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5213/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').replace(/\\/g, '/');
const racksUrl = '/@fs/' + path.join(root, 'src', 'racks.ts').replace(/\\/g, '/');
const cmdUrl = '/@fs/' + path.join(root, 'src', 'commands.ts').replace(/\\/g, '/');
const planUrl = '/@fs/' + path.join(root, 'src', 'plan.ts').replace(/\\/g, '/');
const dev = (key, model, h, wf, w = 440, p = 40) => ({ key, manufacturer: 'Fikcyjny', model, category: 'sieć', dimensionsMm: { width: w, depth: 300, height: 44 * h }, rackUnits: { heightU: h, widthFraction: wf }, weightKg: 2 + h, powerW: p,
  ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } });
await E(async ([cu, ru, mu, pu, pack]) => {
  const c = await import(cu), r = await import(ru), m = await import(mu), pl = await import(pu), st = window.__editor.store;
  c.installPack(pack);
  const d = (l, fn) => st.dispatch(l, fn);
  d('rack', r.rackCmd.addRack('rck_foh', { name: 'Rack FOH', units: 12, depthMm: 800 }));
  d('rack', r.rackCmd.addRack('rck_stage', { name: 'Rack scena', units: 8 }));
  d('space', pl.plan.addSpace('spc_hall', 'Hala', 24000, 14000, 8000));
  const items = [['sw', 'Switch główny', 'eqi_sw', 'rck_foh', 12, 'full'], ['pt', 'Patchpanel', 'eqi_pp', 'rck_foh', 11, 'full'], ['srv', 'Serwer grafiki', 'eqi_srv', 'rck_foh', 8, 'full'], ['mx', 'Mikser cyfrowy', 'eqi_mx', 'rck_foh', 5, 'full'],
    ['ha', 'Odtwarzacz A', 'eqi_pa', 'rck_foh', 3, 'left'], ['hb', 'Odtwarzacz B', 'eqi_pb', 'rck_foh', 3, 'right'], ['sw2', 'Switch scena', 'eqi_s2', 'rck_stage', 7, 'full'], ['pt', 'Patchpanel scena', 'eqi_p2', 'rck_stage', 6, 'full']];
  for (const [k, n, id, rk, u, slot] of items) { d('add', c.addFromCatalog('rk-plan/' + k, n, id)); d('mount', r.rackCmd.mount(id, { rackId: rk, uStart: u, face: 'front', slot })); }
  d('add', c.addFromCatalog('camera_sdi', 'Kamera 1', 'eqi_cam'));
}, [catUrl, racksUrl, cmdUrl, planUrl, { format: 'stagewire-pack/1', id: 'rk-plan', name: 'Rack plan', version: '1.0.0', license: 'własne', devices: [dev('sw', 'Switch 1U', 1, 1), dev('sw2', 'Switch 1U b', 1, 1), dev('pt', 'Patchpanel 1U', 1, 1, 440, 0), dev('srv', 'Serwer 2U', 2, 1, 440, 350), dev('mx', 'Mikser 3U', 3, 1, 440, 120), dev('ha', 'Odtwarzacz 1U', 1, 0.5, 220, 25), dev('hb', 'Odtwarzacz 1U b', 1, 0.5, 220, 25)] }]);
const st = () => E(() => { const s = window.__editor.store.state; return { pl: Object.fromEntries(Object.entries(s.placements ?? {}).map(([k, v]) => [k, `${v.targetKind}:${v.position.x},${v.position.y},${v.rotationDeg}`])) }; });

// zrzuty widoku racka
await page.click('#b-rack'); await page.waitForSelector('#rackview', { state: 'visible' });
await page.screenshot({ path: path.join(out, 'sw-rack-1-przod.png') });
await page.click('#rk-sel'); await page.selectOption('#rk-sel', { label: 'Rack scena' }).catch(() => {});
await page.selectOption('#rk-sel', { label: 'Rack FOH' }).catch(() => {});
await page.click('#rk-face'); await page.screenshot({ path: path.join(out, 'sw-rack-2-tyl.png') }); await page.click('#rk-face');
await page.click('#b-rack');

// plan
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
check('przycisk „Postaw rack/szafę (2)” aktywny', (await page.textContent('#b-rackput')) === 'Postaw rack/szafę (2)' && !(await page.isDisabled('#b-rackput')), await page.textContent('#b-rackput'));
await page.click('#b-rackput'); let s = await st();
check('rack stoi na planie (typ rack, w środku widoku)', Object.values(s.pl).filter((v) => v.startsWith('rack:')).length === 1, s.pl);
check('panel racka ze współrzędnymi i licznik przycisku', (await page.textContent('#props')).includes('Rack FOH') && (await page.textContent('#b-rackput')) === 'Postaw rack/szafę (1)', (await page.textContent('#props')).slice(0, 80));
// przesuń X/Y z panelu
await page.fill('#rp-x', '6'); await page.fill('#rp-y', '4'); await page.press('#rp-y', 'Enter');
s = await st(); check('współrzędne z panelu: 6,0 × 4,0 m', s.pl.plc_rckfoh === 'rack:6000,4000,0', s.pl);
await page.click('#b-rackput'); await page.fill('#rp-x', '12'); await page.fill('#rp-y', '4'); await page.press('#rp-y', 'Enter');
s = await st(); check('drugi rack postawiony osobno', s.pl.plc_rckstage === 'rack:12000,4000,0', s.pl);
// przeciąganie myszą
const scr = await E(() => window.__editor.plan.toScreen(6000, 4000)); const to = await E(() => window.__editor.plan.toScreen(8000, 7000));
await page.mouse.move(scr[0], scr[1]); await page.mouse.down(); await page.mouse.move((scr[0] + to[0]) / 2, (scr[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up();
s = await st(); check('przeciągnięcie racka myszą (siatka 100 mm)', s.pl.plc_rckfoh === 'rack:8000,7000,0', s.pl);
await page.keyboard.press('r'); s = await st(); check('klawisz R obraca zaznaczony rack o 90°', s.pl.plc_rckfoh === 'rack:8000,7000,90', s.pl);
check('urządzenia w racku nie są osobnymi bryłami (tylko 2 racki + brak kamery)', await E(() => window.__editor.plan && window.__editor.store.state.placements && Object.values(window.__editor.store.state.placements).length === 2));

// długości kabli od racka
const len = await E(async ([cu, cmdu, ru]) => {
  const { cmd } = await import(cmdu), L = await import(ru.replace('racks', 'lengths')), st = window.__editor.store;
  const eq = st.state.equipment, port = (id) => Object.keys(st.state.definitions[eq[id].definitionId].revisions[String(eq[id].definitionRevision)].ports)[0];
  st.dispatch('c', cmd.connect({ instanceId: 'eqi_sw', portId: port('eqi_sw') }, { instanceId: 'eqi_s2', portId: port('eqi_s2') }, 'std/ethernet'));
  const r = L.estimateLengths(st.state, 1000); return { n: r.estimates.length, len: r.estimates[0]?.lengthMm, noPlacement: r.noPlacement };
}, [catUrl, cmdUrl, racksUrl]);
check('kabel między urządzeniami w dwóch rackach liczony z położeń racków', len.n === 1 && len.len > 4000 && len.noPlacement === 0, len);
await page.click('#b-fit'); await page.click('#b-cables');
await page.mouse.click(5, 5); await page.screenshot({ path: path.join(out, 'sw-rack-3-plan.png') });

// zdjęcie z planu
await page.click('#b-rackput').catch(() => {});
const sc2 = await E(() => window.__editor.plan.toScreen(8000, 7000)); await page.mouse.click(sc2[0], sc2[1]);
await page.click('#rp-off'); s = await st(); check('„Zdejmij z planu” kasuje położenie racka', s.pl.plc_rckfoh === undefined, s.pl);
await E(() => window.__editor.store.undo()); s = await st(); check('cofnięcie przywraca rack na planie', s.pl.plc_rckfoh !== undefined, s.pl);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
