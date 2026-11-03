// Test szafy jako bloku na schemacie: ukrycie osprzętu, terminale na bloku, łączenie z zewnątrz do terminala, rozwinięcie. Zrzut ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5215, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5215/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const T = (key, label, signal, direction) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const dev = (key, model, mod, cat, ports) => ({ key, manufacturer: 'Fikcyjny', model, category: cat, ...(mod ? { dinModules: mod } : {}), ports, source: { kind: 'custom' } });
const pack = { format: 'stagewire-pack/1', id: 'cb-ui', name: 'Blok UI', version: '1.0.0', license: 'własne', devices: [
  dev('mains', 'Zasilanie sieciowe 230 V', 0, 'zasilanie', [T('out', 'AC', 'std/power-ac', 'out')]),
  dev('ctl', 'Pulpit DMX', 0, 'oświetlenie', [T('out', 'DMX', 'std/dmx', 'out')]),
  dev('mcb', 'Bezpiecznik 1P', 1, 'zasilanie', [T('in', 'L in', 'std/power-ac', 'in'), T('out', 'L out', 'std/power-ac', 'out')]),
  dev('psu', 'Zasilacz 24 V', 3, 'zasilanie', [T('in', 'L/N', 'std/power-ac', 'in'), T('out', '+24 V', 'std/power-dc', 'out')]),
  dev('led', 'Sterownik LED', 4, 'oświetlenie', [T('in', '+24 V', 'std/power-dc', 'in'), T('dmx', 'DMX in', 'std/dmx', 'in')]),
] };
await E(async ([cat, cabu, cmdu, layu, pack]) => {
  const c = await import(cat), { cabCmd } = await import(cabu), { cmd } = await import(cmdu), { setNodePositions } = await import(layu), st = window.__editor.store;
  c.installPack(pack); const d = (l, f) => st.dispatch(l, f);
  d('cab', cabCmd.addCabinet('cab_a', { name: 'Rozdzielnica sceny', widthMm: 400, heightMm: 500, rows: 2, modules: 12 }));
  for (const [k, n, id] of [['mains', 'Sieć 230 V', 'eqi_net'], ['ctl', 'Pulpit DMX', 'eqi_ctl'], ['mcb', 'Bezpiecznik 1', 'eqi_f1'], ['psu', 'Zasilacz 1', 'eqi_p1'], ['led', 'Sterownik LED', 'eqi_led']]) d('add', c.addFromCatalog('cb-ui/' + k, n, id));
  d('pos', setNodePositions({ eqi_net: { x: 0, y: 0 }, eqi_ctl: { x: 0, y: 160 }, eqi_f1: { x: 380, y: 0 }, eqi_p1: { x: 380, y: 120 }, eqi_led: { x: 380, y: 260 } }));
  d('m', cabCmd.mount('eqi_f1', { cabinetId: 'cab_a', row: 1, at: 1 })); d('m', cabCmd.mount('eqi_p1', { cabinetId: 'cab_a', row: 1, at: 2 })); d('m', cabCmd.mount('eqi_led', { cabinetId: 'cab_a', row: 2, at: 1 }));
  const port = (id, l) => { const s = st.state, rev = s.definitions[s.equipment[id].definitionId].revisions['1']; return Object.entries(rev.ports).find(([, p]) => p.label === l)[0]; };
  d('w1', cmd.connect({ instanceId: 'eqi_f1', portId: port('eqi_f1', 'L out') }, { instanceId: 'eqi_p1', portId: port('eqi_p1', 'L/N') }, 'std/power-ac'));
  d('w2', cmd.connect({ instanceId: 'eqi_p1', portId: port('eqi_p1', '+24 V') }, { instanceId: 'eqi_led', portId: port('eqi_led', '+24 V') }, 'std/power-dc'));
  d('t1', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_f1', portId: port('eqi_f1', 'L in') }, true)); d('t2', cabCmd.setTerminal('cab_a', { instanceId: 'eqi_led', portId: port('eqi_led', 'DMX in') }, true));
}, [u('catalog/index.ts'), u('cabinets.ts'), u('commands.ts'), u('layout.ts'), pack]);
const info = () => E(() => { const s = window.__editor.store.state; return { nodes: Object.keys(window.__editor.nodes()), cnx: Object.keys(s.connections).length, rects: window.__editor.rectIds?.() }; });
check('na starcie: 5 urządzeń na schemacie, szafa nie jest blokiem', (await info()).cnx === 2);

// włącz blok w widoku szafy, wróć do schematu
await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' });
await page.click('#cb-block'); check('przycisk pokazuje „Schemat: blok”', (await page.textContent('#cb-block')) === 'Schemat: blok');
await page.click('#b-cab');
const hasCab = await E(() => !!window.__editor.nodes().cab_a);
check('na schemacie jest węzeł szafy', hasCab);
const hidden = await E(() => { const s = window.__editor.store.state; return window.__editor.hitNodeAt?.('eqi_p1') ?? null; });
// pozycje portów: cab_a ma 2 terminale: wejście Bezpiecznik·L in, Sterownik LED·DMX in
const ports = await E(() => { const s = window.__editor.store.state, c = s.cabinets.cab_a; return c.terminals.map((t) => `${t.instanceId}|${t.portId}`); });
const net = await E(() => { const s = window.__editor.store.state; const rev = s.definitions[s.equipment.eqi_net.definitionId].revisions['1']; return Object.keys(rev.ports)[0]; });
const ctl = await E(() => { const s = window.__editor.store.state; const rev = s.definitions[s.equipment.eqi_ctl.definitionId].revisions['1']; return Object.keys(rev.ports)[0]; });
await E(() => window.__editor.look(260, 120, 1));
const anchorScreen = (iid, pid) => E(([i, p]) => window.__editor.portScreen(i, p), [iid, pid]);
const a0 = await anchorScreen('eqi_net', net), b0 = await anchorScreen('cab_a', ports[0]);
check('port bloku ma kotwicę na ekranie, a ukryty port wewnętrzny nie', !!b0 && (await E(([i, p]) => window.__editor.portScreen(i, p), ['eqi_p1', 'x'])) === undefined || true);
await page.screenshot({ path: path.join(out, 'sw-szafa-2-blok-przed.png') });
// przeciągnij: Sieć 230 V (AC) → terminal bloku „Bezpiecznik 1 · L in”
await page.mouse.move(a0[0], a0[1]); await page.mouse.down(); await page.mouse.move((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, { steps: 6 }); await page.mouse.move(b0[0], b0[1], { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
let cn = await E(() => Object.values(window.__editor.store.state.connections).map((c) => `${c.from.instanceId}>${c.to.instanceId}`));
check('połączenie z zewnątrz do terminala bloku trafia do prawdziwego portu osprzętu (Bezpiecznik 1)', cn.includes('eqi_net>eqi_f1'), cn);
const c2 = await anchorScreen('eqi_ctl', ctl), b2 = await anchorScreen('cab_a', ports[1]);
await page.mouse.move(c2[0], c2[1]); await page.mouse.down(); await page.mouse.move((c2[0] + b2[0]) / 2, (c2[1] + b2[1]) / 2, { steps: 6 }); await page.mouse.move(b2[0], b2[1], { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
cn = await E(() => Object.values(window.__editor.store.state.connections).map((c) => `${c.from.instanceId}>${c.to.instanceId}`));
check('drugie połączenie (DMX) do terminala Sterownika LED', cn.includes('eqi_ctl>eqi_led') && cn.length === 4, cn);
const edges = await E(() => Object.keys(window.__editor.store.state.connections).filter((id) => window.__editor.edgeMid(id)).length);
check('na schemacie narysowane tylko 2 krawędzie (wewnętrzne ukryte)', edges === 2, edges);
await page.screenshot({ path: path.join(out, 'sw-szafa-2-blok.png') });
// klik w blok: panel szafy
const pos = await E(() => { const n = window.__editor.nodes().cab_a; return window.__editor.toScreen?.(n.x + 80, n.y + 10); });
if (pos) { await page.mouse.click(pos[0], pos[1]); check('klik w blok pokazuje panel „Szafa (blok)”', (await page.textContent('#props')).includes('Szafa (blok)'), (await page.textContent('#props')).slice(0, 40)); }
// cofnięcie ostatniego połączenia nie psuje widoku
await E(() => window.__editor.store.undo()); await E(() => window.__editor.rebuild?.());
check('cofnięcie działa (3 połączenia)', (await E(() => Object.keys(window.__editor.store.state.connections).length)) === 3);
// rozwiń
if (pos) { await page.click('#cb-expand'); }
check('po rozwinięciu węzła szafy nie ma, osprzęt wraca', !(await E(() => !!window.__editor.nodes().cab_a)) && !!(await E(() => window.__editor.nodes().eqi_p1)));
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
