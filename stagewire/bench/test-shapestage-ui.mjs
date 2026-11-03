// Test: sala o dowolnym kształcie (okno sali, rysowanie obrysu) i obiekty sceniczne (kostki, podesty) na planie i w 3D. Zrzuty ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5221, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5221/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));

await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
// 1. okno sali: kształt L z gotowego wzoru
await page.click('#b-space'); await page.waitForSelector('#spacedialog');
await page.selectOption('#s-shape', 'poly'); await page.click('.s-preset[data-k="L"]');
check('okno sali pokazuje liczbę wierzchołków i pole wybranego wzoru', (await page.textContent('#s-info')).includes('6 wierzchołków'), await page.textContent('#s-info'));
await page.fill('#s-h', '6'); await page.screenshot({ path: path.join(out, 'sw-sala-1-okno.png') });
await page.click('#s-save');
let st = await state(); const sid = Object.keys(st.spaces)[0];
check('zapisana sala ma obrys L z 6 wierzchołkami i wysokość 6 m', st.spaces[sid].boundary.length === 6 && st.spaces[sid].ceilingHeightMm === 6000, st.spaces[sid].boundary);
await page.screenshot({ path: path.join(out, 'sw-sala-2-plan-L.png') });

// nieprawidłowy obrys (kokardka) jest odrzucany
await page.click('#b-space'); await page.waitForSelector('#spacedialog');
await page.fill('#s-pts', '0; 0\n4; 4\n4; 0\n0; 4'); check('okno ostrzega o krzyżujących się bokach', (await page.textContent('#s-info')).includes('przecinają'));
const before = JSON.stringify((await state()).spaces[sid].boundary); await page.click('#s-save');
check('zapis nieprawidłowego obrysu jest odrzucony, sala bez zmian', JSON.stringify((await state()).spaces[sid].boundary) === before && (await page.isVisible('#spacedialog')));
await page.click('#s-cancel');

// 2. rysowanie obrysu na planie (nowy kształt: trapez)
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.selectOption('#s-shape', 'poly'); await page.click('#s-draw');
check('tryb rysowania obrysu włączony', await E(() => !!window.__editor.plan.shapeDrawing()));
await E(() => window.__editor.plan.look(8000, 4000, 0.04)); // widok z dala od paska narzędzi (jest coraz dłuższy)
const pts = [[1000, 1000], [15000, 1000], [12000, 9000], [4000, 9000]];
for (const [x, y] of pts) { const [sx, sy] = await E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]); await page.mouse.click(sx, sy); }
await page.screenshot({ path: path.join(out, 'sw-sala-3-rysowanie.png') });
await page.keyboard.press('Enter');
st = await state(); const b2 = st.spaces[sid].boundary;
check('Enter zamyka obrys; zapisany trapez (przesunięty do 0,0)', b2.length === 4 && Math.min(...b2.map((q) => q[0])) === 0 && Math.min(...b2.map((q) => q[1])) === 0 && b2.some((q) => q[0] === 14000 && q[1] === 0), b2);
check('rysowanie zakończone', await E(() => !window.__editor.plan.shapeDrawing()));

// 3. obiekty sceniczne
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.selectOption('#s-shape', 'poly'); await page.click('.s-preset[data-k="L"]'); await page.click('#s-save');
await page.click('#b-obj'); await page.waitForSelector('#objdialog');
await page.selectOption('#o-preset', 'riser'); check('wzór „Podest” wypełnia wymiary w oknie', (await page.inputValue('#o-w')) === '2' && (await page.inputValue('#o-h')) === '0,4', [await page.inputValue('#o-name')]);
await page.click('#o-add'); st = await state();
const sobs = Object.entries(st.stageObjects ?? {});
check('dodano obiekt „Podest” z wymiarami 2 × 1 × 0,4 m i położeniem na planie', sobs.length === 1 && sobs[0][1].footprint.widthMm === 2000 && sobs[0][1].footprint.heightMm === 400 && Object.values(st.placements).some((p) => p.targetKind === 'stageObject'), sobs[0]?.[1]);
await page.waitForSelector('#so-w'); check('panel obiektu pokazuje wymiary i kolor', (await page.inputValue('#so-w')) === '2');
await page.fill('#so-h', '0,6'); await page.press('#so-h', 'Enter');
check('zmiana wysokości w panelu zapisuje się w modelu', (await state()).stageObjects[sobs[0][0]].footprint.heightMm === 600);
// druga bryła: kostka na podeście (Z = 0,6)
await page.click('#b-obj'); await page.waitForSelector('#objdialog'); await page.click('#o-add'); await page.waitForSelector('#so-w');
await page.fill('#rp-z', '0,6'); await page.press('#rp-z', 'Enter');
st = await state(); const cube = Object.entries(st.stageObjects).find(([, o]) => o.name === 'Kostka')[0];
check('kostka stoi na wysokości 0,6 m (na podeście)', st.placements['plc_' + cube.replace('_', '')].position.z === 600);
await page.click('#so-dup'); st = await state();
check('„Powiel” robi kopię kostki obok', Object.keys(st.stageObjects).length === 3 && Object.values(st.stageObjects).some((o) => o.name === 'Kostka (kopia)'));
await page.screenshot({ path: path.join(out, 'sw-sala-4-obiekty.png') });

// obiekt poza obrysem (we wcięciu litery L) daje ostrzeżenie V-030
await E(async ([planu, cube]) => { const { plan } = await import(planu); const sid = Object.keys(window.__editor.store.state.spaces)[0]; window.__editor.store.dispatch('x', plan.placeRack(cube, sid, 9000, 9000)); window.__editor.plan.refresh(); }, ['/@fs/' + path.join(root, 'src', 'plan.ts').split(path.sep).join('/'), cube]);
const issues = await E(async (v) => { const { validate } = await import(v); return validate(window.__editor.store.state).filter((i) => i.ruleId === 'V-030').map((i) => i.message); }, '/@fs/' + path.join(root, 'src', 'validation.ts').split(path.sep).join('/'));
check('V-030: obiekt poza obrysem sali jest zgłaszany', issues.length === 1 && issues[0].includes('Kostka'), issues);
await E(async ([planu, cube]) => { const { plan } = await import(planu); const sid = Object.keys(window.__editor.store.state.spaces)[0]; window.__editor.store.dispatch('x', plan.placeRack(cube, sid, 3000, 2000)); window.__editor.plan.refresh(); }, ['/@fs/' + path.join(root, 'src', 'plan.ts').split(path.sep).join('/'), cube]);

// Delete usuwa zaznaczony obiekt
const cube2 = Object.entries((await state()).stageObjects).find(([, o]) => o.name === 'Kostka (kopia)')[0];
await E((id) => window.__editor.plan.selectRack?.(id), cube2);
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' });
const sc = await E(() => window.__editor.view3d.scene());
check('widok 3D: obrys L (6 wierzchołków) i 3 bryły sceniczne w kolorach', sc.boundary.length === 6 && sc.boxes.filter((b) => b.kind === 'stage').length === 3, sc.boundary.length);
await page.click('#v3-iso'); await page.screenshot({ path: path.join(out, 'sw-sala-5-3d.png') });
await page.click('#b-3d');

// 4. schody (widownia) i walec
await page.click('#b-obj'); await page.waitForSelector('#objdialog'); await page.selectOption('#o-preset', 'audience');
check('wzór „Widownia” ustawia kształt Schody i 8 stopni', (await page.inputValue('#o-shape')) === 'stairs' && (await page.inputValue('#o-steps')) === '8' && (await page.inputValue('#o-name')) === 'Widownia', await page.inputValue('#o-name'));
await page.click('#o-add'); await page.waitForSelector('#so-steps');
let st2 = await state(); const aud = Object.entries(st2.stageObjects).find(([, o]) => o.shape === 'stairs');
check('dodano schody z 8 stopniami; panel pokazuje stopnie i wymiar stopnia', !!aud && aud[1].steps === 8 && (await page.textContent('#props')).includes('stopień'), aud?.[1]);
await page.fill('#so-steps', '5'); await page.press('#so-steps', 'Enter'); check('zmiana liczby stopni w panelu', (await state()).stageObjects[aud[0]].steps === 5);
await page.click('#so-rot');
await page.click('#b-obj'); await page.waitForSelector('#objdialog'); await page.selectOption('#o-preset', 'column'); await page.click('#o-add'); await page.waitForSelector('#so-w');
st2 = await state(); check('dodano walec (kolumna Ø 0,6 m)', Object.values(st2.stageObjects).some((o) => o.shape === 'cylinder' && o.footprint.widthMm === 600));
await page.screenshot({ path: path.join(out, 'sw-sala-6-schody-walec-plan.png') });
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' });
const sc2 = await E(() => window.__editor.view3d.scene());
check('3D: 5 stopni jako osobne bryły i walec o 28 bokach', sc2.boxes.filter((b) => b.step !== undefined).length === 5 && sc2.boxes.some((b) => b.sides === 28), sc2.boxes.length);
await page.click('#v3-iso'); await page.screenshot({ path: path.join(out, 'sw-sala-7-schody-walec-3d.png') });
await page.click('#b-3d');

await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
