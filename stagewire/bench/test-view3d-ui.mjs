// Test widoku 3D sali: otwarcie z planu, obrót, przesuwanie, zoom, zaznaczanie, przełączniki, powrót do planu. Zrzuty ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5219, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5219/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const T = (key, label, signal, direction) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const pack = { format: 'stagewire-pack/1', id: 'v3-ui', name: 'Widok 3D UI', version: '1.0.0', license: 'własne', devices: [
  { key: 'led', manufacturer: 'Fikcyjny', model: 'Ściana LED', category: 'wideo', dimensionsMm: { width: 4000, depth: 400, height: 2250 }, ports: [{ key: 'in', label: 'IN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'in' }], source: { kind: 'custom' } },
  { key: 'mixer', manufacturer: 'Fikcyjny', model: 'Mikser FOH', category: 'audio', dimensionsMm: { width: 1000, depth: 700, height: 300 }, ports: [{ key: 'out', label: 'OUT', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'out' }], source: { kind: 'custom' } },
  { key: 'sw', manufacturer: 'Fikcyjny', model: 'Switch 1U', category: 'sieć', rackUnits: { heightU: 1, widthFraction: 1 }, dimensionsMm: { width: 440, depth: 300, height: 44 }, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'custom' } },
  { key: 'psu', manufacturer: 'Fikcyjny', model: 'Zasilacz', category: 'zasilanie', dinModules: 3, ports: [T('out', '+24 V', 'std/power-dc', 'out')], source: { kind: 'custom' } },
] };
await E(async ([cat, planu, racku, cabu, routeu, cmdu, pack]) => {
  const c = await import(cat), { plan } = await import(planu), { rackCmd } = await import(racku), { cabCmd } = await import(cabu), { routeCmd } = await import(routeu), { cmd } = await import(cmdu), st = window.__editor.store; c.installPack(pack); const d = (l, f) => st.dispatch(l, f);
  d('s', plan.addSpace('spc_h', 'Hala', 20000, 12000, 8000));
  d('a', c.addFromCatalog('v3-ui/led', 'Ściana LED', 'eqi_led')); d('a', c.addFromCatalog('v3-ui/mixer', 'Mikser FOH', 'eqi_mx')); d('a', c.addFromCatalog('v3-ui/sw', 'Switch', 'eqi_sw')); d('a', c.addFromCatalog('v3-ui/psu', 'Zasilacz', 'eqi_psu'));
  d('p', plan.place('eqi_led', 'spc_h', 10000, 11000, 0, 500)); d('p', plan.place('eqi_mx', 'spc_h', 10000, 3000, 0, 0));
  d('r', rackCmd.addRack('rck_a', { name: 'Rack scena', units: 12, depthMm: 800 })); d('m', rackCmd.mount('eqi_sw', { rackId: 'rck_a', uStart: 10, face: 'front', slot: 'full' })); d('pr', plan.placeRack('rck_a', 'spc_h', 2500, 10000, 90, 0));
  d('c', cabCmd.addCabinet('cab_a', { name: 'Rozdzielnica', widthMm: 600, heightMm: 900, depthMm: 250, rows: 3, modules: 24 })); d('m', cabCmd.mount('eqi_psu', { cabinetId: 'cab_a', row: 1, at: 1 })); d('pc', plan.placeRack('cab_a', 'spc_h', 17500, 10000, 0, 300));
  d('t', routeCmd.addRoute('spc_h', 'rte_1', 'Trasa główna', [[2500, 10000, 2800], [10000, 10000, 2800], [10000, 3000, 2800]]));
  d('w', cmd.connect({ instanceId: 'eqi_mx', portId: Object.keys(st.state.definitions[st.state.equipment.eqi_mx.definitionId].revisions['1'].ports)[0] }, { instanceId: 'eqi_led', portId: Object.keys(st.state.definitions[st.state.equipment.eqi_led.definitionId].revisions['1'].ports)[0] }, 'std/ethernet'));
}, [u('catalog/index.ts'), u('plan.ts'), u('racks.ts'), u('cabinets.ts'), u('routes.ts'), u('commands.ts'), pack]);

await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
check('w widoku planu jest przycisk „Widok 3D”', (await page.textContent('#b-3d')) === 'Widok 3D');
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' });
check('widok 3D otwarty, przycisk zmienia się na „Widok 2D”', (await E(() => window.__editor.view3d.active)) && (await page.textContent('#b-3d')) === 'Widok 2D');
const ids = await E(() => window.__editor.view3d.scene().boxes.map((b) => b.id).sort());
check('scena ma 4 bryły: ściana LED, mikser, rack, szafa (osprzęt w rack/szafie bez osobnych brył)', JSON.stringify(ids) === JSON.stringify(['cab_a', 'eqi_led', 'eqi_mx', 'rck_a']), ids);
await page.screenshot({ path: path.join(out, 'sw-3d-1-iso.png') });

// obrót myszą
const cam0 = await E(() => window.__editor.view3d.camera());
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(800, 420, { steps: 6 }); await page.mouse.up();
const cam1 = await E(() => window.__editor.view3d.camera()); check('przeciągnięcie obraca kamerę (yaw i pitch się zmieniają)', cam1.yaw !== cam0.yaw && cam1.pitch !== cam0.pitch, { cam0, cam1 });
// przesuwanie Shift
await page.keyboard.down('Shift'); await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(640, 480, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Shift');
const cam2 = await E(() => window.__editor.view3d.camera()); check('Shift + przeciągnięcie przesuwa cel kamery', cam2.tx !== cam1.tx || cam2.ty !== cam1.ty, { cam1, cam2 });
// zoom
await page.mouse.move(700, 450); await page.mouse.wheel(0, -300); const cam3 = await E(() => window.__editor.view3d.camera()); check('kółko przybliża (dystans maleje)', cam3.dist < cam2.dist, [cam2.dist, cam3.dist]);
// zaznaczanie
await page.click('#v3-iso'); const sp = await E(() => window.__editor.view3d.boxScreen('eqi_led'));
await page.mouse.click(sp[0], sp[1] + 6);
check('klik w bryłę zaznacza ją i pokazuje panel z nazwą i wymiarami', (await E(() => window.__editor.view3d.selected())) === 'eqi_led' && (await page.textContent('#v3info')).includes('Ściana LED') && (await page.textContent('#v3info')).includes('4 × 0,4 × 2,25 m'), await page.textContent('#v3info'));
check('panel pokazuje wysokość podstawy 0,5 m', (await page.textContent('#v3info')).includes('wysokość podstawy 0,5'));
await page.screenshot({ path: path.join(out, 'sw-3d-2-zaznaczona.png') });
await page.keyboard.press('Escape'); check('Esc zdejmuje zaznaczenie', (await E(() => window.__editor.view3d.selected())) === undefined);
// kabel po trasie
const lk = await E(() => window.__editor.view3d.scene().links); check('połączenie w scenie idzie po trasie (kilka punktów, metoda route)', lk.length === 1 && lk[0].method === 'route' && lk[0].pts.length >= 5, lk[0]?.method);
await page.click('#v3-links'); await page.click('#v3-iso'); await page.screenshot({ path: path.join(out, 'sw-3d-4-kable-po-trasie.png') }); await page.click('#v3-links');
// łączenie tras na różnych wysokościach
await E(async ([routeu]) => { const { routeCmd } = await import(routeu); window.__editor.store.dispatch('t2', routeCmd.addRoute('spc_h', 'rte_2', 'Trasa przy podłodze', [[10000, 3000, 0], [14000, 3000, 0], [14000, 6000, 0]])); window.__editor.view3d.refresh(); }, [u('routes.ts')]);
const nr0 = await E(() => Object.keys(window.__editor.store.state.spaces.spc_h.cableRoutes).length);
await page.click('#v3-iso'); await page.click('#v3-join');
check('tryb łączenia tras włączony (przycisk podświetlony)', (await page.getAttribute('#v3-join', 'class'))?.includes('on'));
const s1 = await E(() => window.__editor.view3d.pointScreen([10000, 3000, 2800])), s2 = await E(() => window.__editor.view3d.pointScreen([14000, 3000, 0]));
await page.mouse.move(s1[0], s1[1]); await page.mouse.click(s1[0], s1[1]); await page.mouse.move(s2[0], s2[1], { steps: 4 });
await page.screenshot({ path: path.join(out, 'sw-3d-5-laczenie-tras.png') });
await page.mouse.click(s2[0], s2[1]);
const rts = await E(() => window.__editor.store.state.spaces.spc_h.cableRoutes);
check('dwa kliknięcia na trasach o różnych wysokościach dodają trasę „Pion” z punktami z obu tras', Object.keys(rts).length === nr0 + 1 && Object.values(rts).some((r) => r.name.startsWith('Pion') && JSON.stringify(r.points) === JSON.stringify([[10000, 3000, 2800], [14000, 3000, 0]])), Object.values(rts).map((r) => r.name));
check('po połączeniu tryb się wyłącza', !(await page.getAttribute('#v3-join', 'class'))?.includes('on'));
await page.click('#v3-join'); await page.keyboard.press('Escape'); check('Esc wyłącza tryb łączenia', !(await page.getAttribute('#v3-join', 'class'))?.includes('on'));
// przełączniki
await page.click('#v3-links'); await page.click('#v3-routes'); await page.click('#v3-labels');
check('przełączniki Połączenia/Trasy/Etykiety zmieniają stan przycisków', (await page.getAttribute('#v3-links', 'class'))?.includes('on') && !(await page.getAttribute('#v3-routes', 'class'))?.includes('on') && !(await page.getAttribute('#v3-labels', 'class'))?.includes('on'));
await page.click('#v3-links'); await page.click('#v3-routes'); await page.click('#v3-labels');
await page.click('#v3-top'); const top = await E(() => window.__editor.view3d.camera()); check('„Z góry” ustawia niemal pionowy widok', top.pitch > 1.4, top.pitch);
await page.screenshot({ path: path.join(out, 'sw-3d-3-z-gory.png') });
await page.click('#v3-iso');

// klawisze planu wstrzymane: zaznacz rack na planie (przez API), wróć do 3D i naciśnij R
await page.click('#b-3d'); const rot0 = await E(() => window.__editor.store.state.placements.plc_rckA?.rotationDeg ?? window.__editor.store.state.placements[Object.keys(window.__editor.store.state.placements).find((k) => window.__editor.store.state.placements[k].targetKind === 'rack')].rotationDeg);
await page.click('#b-3d'); await page.keyboard.press('r');
const rot1 = await E(() => window.__editor.store.state.placements[Object.keys(window.__editor.store.state.placements).find((k) => window.__editor.store.state.placements[k].targetKind === 'rack')].rotationDeg);
check('w widoku 3D klawisz R nie obraca obiektów planu', rot0 === rot1, [rot0, rot1]);
// zmiana modelu odświeża scenę
await E(async (planu) => { const { plan } = await import(planu); window.__editor.store.dispatch('mv', plan.place('eqi_mx', 'spc_h', 14000, 3000, 0, 0)); window.__editor.plan.refresh(); }, u('plan.ts'));
await page.waitForTimeout(100);
// powrót
await page.click('#b-3d'); check('powrót do planu: widok 3D ukryty, przycisk „Widok 3D”', !(await E(() => window.__editor.view3d.active)) && (await page.textContent('#b-3d')) === 'Widok 3D');
await page.click('#b-3d'); await page.click('#b-mode');
check('przejście na schemat zamyka też widok 3D', !(await E(() => window.__editor.view3d.active)) && !(await page.isVisible('#view3d')));
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
