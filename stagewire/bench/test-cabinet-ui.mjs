// Test widoku szafy DIN: tworzenie, układanie osprzętu przeciąganiem, opinanie portów, terminale, kolizje. Zapisuje zrzuty.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5214, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5214/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').replace(/\\/g, '/');
const T = (key, label, signal, direction) => ({ key, label, connector: 'std/din-terminal', signals: [signal], direction });
const dev = (key, manufacturer, model, mod, cat, ports, p = 3) => ({ key, manufacturer, model, category: cat, dimensionsMm: { width: 17.5 * mod, depth: 60, height: 90 }, dinModules: mod, weightKg: 0.1 * mod, powerW: p, ports, source: { kind: 'custom' } });
const pack = { format: 'stagewire-pack/1', id: 'cab-ui', name: 'Szafa UI', version: '1.0.0', license: 'własne', devices: [
  dev('mcb', 'Fikcyjny', 'Wyłącznik 1P B16', 1, 'zasilanie', [T('in', 'L in', 'std/power-ac', 'in'), T('out', 'L out', 'std/power-ac', 'out')], 0),
  dev('psu', 'Fikcyjny', 'Zasilacz 24 V / 5 A', 3, 'zasilanie', [T('in', 'L/N', 'std/power-ac', 'in'), T('out', '+24 V', 'std/power-dc', 'out')], 12),
  dev('dim', 'Fikcyjny', 'Sterownik PX-4 (DMX/Art-Net)', 6, 'oświetlenie', [T('in', '+24 V', 'std/power-dc', 'in'), T('dmx', 'DMX in', 'std/dmx', 'in'), T('o1', 'Wyj. 1', 'std/power-dc', 'out'), T('o2', 'Wyj. 2', 'std/power-dc', 'out')], 8),
  dev('led', 'Fikcyjny', 'Sterownik LED', 4, 'oświetlenie', [T('in', '+24 V', 'std/power-dc', 'in'), T('dmx', 'DMX', 'std/dmx', 'in')], 5),
] };
await E(async ([url, p]) => { const m = await import(url); m.installPack(p); const d = (l, f) => window.__editor.store.dispatch(l, f);
  for (const [k, n, id] of [['mcb', 'Bezpiecznik 1', 'eqi_f1'], ['mcb', 'Bezpiecznik 2', 'eqi_f2'], ['psu', 'Zasilacz 1', 'eqi_p1'], ['psu', 'Zasilacz 2', 'eqi_p2'], ['dim', 'PX-4', 'eqi_px'], ['led', 'Sterownik LED', 'eqi_led']]) d('add', m.addFromCatalog('cab-ui/' + k, n, id)); }, [catUrl, pack]);
const state = () => E(() => { const s = window.__editor.store.state; return { cabs: s.cabinets ?? {}, din: Object.fromEntries(Object.entries(s.equipment).map(([k, v]) => [k, v.din ? `${v.din.row}:${v.din.at}` : null])), cnx: Object.keys(s.connections).length, cables: Object.values(s.cables).map((c) => c.cableTypeKey) }; });
const drag = async (from, to) => { await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up(); };
const li = async (name) => { const b = await page.$(`#cabpanel [data-un="${name}"]`); const r = await b.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const C = (row, at) => E(([r, a]) => window.__editor.cab.cellPoint(r, a), [row, at]);
const port = (id, label) => E(([i, l]) => { const s = window.__editor.store.state, rev = s.definitions[s.equipment[i].definitionId].revisions['1']; const pid = Object.entries(rev.ports).find(([, p]) => p.label === l)[0]; return window.__editor.cab.portPoint(i, pid); }, [id, label]);
const clickAt = async (p) => { await page.mouse.click(p[0], p[1]); };

await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' });
check('widok szafy otwarty; przycisk wraca do Schematu', (await page.textContent('#b-cab')) === 'Schemat' && !(await page.isVisible('#props')));
check('bez szaf: komunikat i wyłączone „Zmień”', (await page.textContent('#cabpanel')).includes('Utwórz szafę') && (await page.isDisabled('#cb-edit')));

await page.click('#cb-new'); await page.waitForSelector('#cabdialog');
await page.selectOption('#cf-preset', 'din3x18'); await page.fill('#cf-name', 'Rozdzielnica sceny');
check('preset wypełnia wymiary (3 × 18 mod.)', (await page.inputValue('#cf-rows')) === '3' && (await page.inputValue('#cf-mods')) === '18');
await page.fill('#cf-mods', '20'); await page.click('#cf-ok');
let st = await state(); const cab = Object.values(st.cabs)[0];
check('szafa utworzona: 400 × 500 × 150, 3 szyny × 20 mod.', Object.keys(st.cabs).length === 1 && cab.widthMm === 400 && cab.rows === 3 && cab.modules === 20, cab);
check('lista „Poza szafą” zawiera tylko osprzęt DIN (6)', (await page.textContent('#cabpanel')).includes('Poza szafą (6)'));

// układanie: rząd 1: Bezpiecznik 1 (1), Bezpiecznik 2 (2), Zasilacz 1 (3-5), Zasilacz 2 (6-8); rząd 2: PX-4 (1-6), LED (8-11)
await drag(await li('eqi_f1'), await C(1, 1)); await drag(await li('eqi_f2'), await C(1, 2)); await drag(await li('eqi_p1'), await C(1, 3)); await drag(await li('eqi_p2'), await C(1, 6));
await drag(await li('eqi_px'), await C(2, 1)); await drag(await li('eqi_led'), await C(2, 8));
st = await state(); check('osprzęt ułożony przeciąganiem z listy', st.din.eqi_f1 === '1:1' && st.din.eqi_f2 === '1:2' && st.din.eqi_p1 === '1:3' && st.din.eqi_p2 === '1:6' && st.din.eqi_px === '2:1' && st.din.eqi_led === '2:8', st.din);
const tot = await page.textContent('#cb-tot'); check('sumy: 18 z 60 modułów', tot.includes('Zajęte 18 z 60'), tot.slice(0, 60));

// kolizja: przeciągnij Zasilacz 2 na zajęte (1:3) – odrzucone
await drag(await C(1, 7), await C(1, 4)); st = await state(); check('upuszczenie na zajęte miejsce odrzucone', st.din.eqi_p2 === '1:6', st.din);
// przesunięcie: Sterownik LED z 2:8 na 3:2
await drag(await C(2, 9), await C(3, 3)); st = await state(); check('przeniesienie Sterownika LED na szynę 3', st.din.eqi_led === '3:2', st.din);

// opinanie: F1.out → P1.L/N, P1.+24V → PX-4.+24V, P2.... , F2.out → P2.L/N, P2.+24V → LED.+24V
const wire = async (a, la, b, lb) => { await clickAt(await port(a, la)); await clickAt(await port(b, lb)); };
await wire('eqi_f1', 'L out', 'eqi_p1', 'L/N'); await wire('eqi_p1', '+24 V', 'eqi_px', '+24 V'); await wire('eqi_f2', 'L out', 'eqi_p2', 'L/N'); await wire('eqi_p2', '+24 V', 'eqi_led', '+24 V');
st = await state(); check('4 przewody z kablem „przewód w szafie”', st.cnx === 4 && st.cables.every((c) => c === 'std/cable-wire'), st);
await wire('eqi_f1', 'L in', 'eqi_f1', 'L in'); // klik tego samego portu dwa razy = odznaczenie, bez połączenia
st = await state(); check('podwójny klik w ten sam port nie tworzy połączenia', st.cnx === 4);
await wire('eqi_px', 'DMX in', 'eqi_p1', 'L/N'); st = await state(); check('niezgodne sygnały: połączenia nie ma', st.cnx === 4, await page.textContent('#msg'));
// pojemność: drugi przewód na zajęty port
await wire('eqi_f2', 'L out', 'eqi_p1', 'L/N'); st = await state(); check('zajęty port (pojemność 1) odrzuca drugi przewód', st.cnx === 4 && (await page.textContent('#msg')).includes('zajęty'), await page.textContent('#msg'));

// terminale: PX-4 DMX in oraz F1 L in oraz F2 L in
for (const [id, label] of [['eqi_f1', 'L in'], ['eqi_f2', 'L in'], ['eqi_px', 'DMX in']]) {
  await clickAt(await C(...(id === 'eqi_f1' ? [1, 1] : id === 'eqi_f2' ? [1, 2] : [2, 3])));
  const pid = await E(([i, l]) => { const s = window.__editor.store.state, rev = s.definitions[s.equipment[i].definitionId].revisions['1']; return Object.entries(rev.ports).find(([, p]) => p.label === l)[0]; }, [id, label]);
  await page.check(`#cabpanel [data-term="${pid}"]`);
}
st = await state(); check('3 terminale zapisane w szafie', (Object.values(st.cabs)[0].terminals ?? []).length === 3, Object.values(st.cabs)[0].terminals);
const tx = await page.textContent('#cb-tot'); check('panel: 4 wewnętrzne, 0 wychodzących, 3 terminale', tx.includes('4 wewnętrznych') && tx.includes('terminali: 3'), tx.slice(-90));
await clickAt(await C(1, 1)); await page.fill('#cabpanel [data-grp]', '230 V'); await page.press('#cabpanel [data-grp]', 'Enter');
st = await state(); check('nazwa grupy terminala zapisana z panelu', (Object.values(st.cabs)[0].terminals ?? []).some((t) => t.group === '230 V'), Object.values(st.cabs)[0].terminals);
check('lista podpowiedzi grup zawiera „230 V”', (await page.innerHTML('#cb-groups')).includes('230 V'));
await clickAt([700, 600]); await page.keyboard.press('Escape');
await page.screenshot({ path: path.join(out, 'sw-szafa-1-widok.png') });

// zaznaczenie przewodu i usunięcie
const cid = await E(() => Object.keys(window.__editor.store.state.connections)[0]);
const mid = await E((c) => window.__editor.cab.wireMid(c), cid); await clickAt(mid);
check('klik w przewód pokazuje panel „Przewód”', (await page.textContent('#cabpanel')).includes('Usuń przewód'));
await page.click('#cb-delw'); st = await state(); check('usunięcie przewodu przyciskiem', st.cnx === 3, st.cnx);
await E(() => window.__editor.store.undo()); st = await state(); check('cofnięcie przywraca przewód', st.cnx === 4);

// zdjęcie z szyny zdejmuje terminale; edycja szafy: nie można zmniejszyć poniżej zajętego
await clickAt(await C(1, 1)); await page.keyboard.press('Delete'); st = await state();
check('Delete zdejmuje z szyny i kasuje jego terminal', st.din.eqi_f1 === null && (Object.values(st.cabs)[0].terminals ?? []).length === 2, st.din.eqi_f1);
await page.click('#cb-edit'); await page.waitForSelector('#cabdialog'); await page.fill('#cf-rows', '2'); await page.click('#cf-ok');
check('zmniejszenie szyn poniżej zajętych odrzucone', (await page.textContent('#cf-msg')).includes('mniej niż'), await page.textContent('#cf-msg'));
await page.click('#cf-cancel');

// walidacja V-028 po ręcznej edycji i powrót do schematu
await E(() => window.__editor.store.dispatch('hack', (d) => { d.equipment.eqi_p2.din = { cabinetId: Object.keys(d.cabinets)[0], row: 1, at: 4 }; }));
const valUrl = '/@fs/' + path.join(root, 'src', 'validation.ts').split(path.sep).join('/');
check('walidacja zgłasza nakładanie (V-028)', await E(async (u) => { const v = (await import(u)).validate(window.__editor.store.state); return v.some((i) => i.ruleId === 'V-028' && i.level === 'error'); }, valUrl));
await page.click('#b-cab'); check('powrót do schematu', !(await E(() => window.__editor.cab.active)) && (await page.textContent('#b-cab')) === 'Szafa');
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
