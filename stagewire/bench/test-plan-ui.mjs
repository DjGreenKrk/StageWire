// Test planu sali w interfejsie: sala, rozmieszczenie, przeciąganie z przyciąganiem, obrót, pozycja liczbowa, cofanie.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5197, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5197/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => { const s = window.__editor.store.state; return { spaces: s.spaces, placements: s.placements ?? {}, eq: Object.keys(s.equipment) }; });
await page.click('#cat-list button[data-cat="camera_sdi"]'); await page.click('#cat-list button[data-cat="video_switcher"]'); await page.click('#cat-list button[data-cat="monitor_hdmi"]');
check('trzy urządzenia w schemacie, żadnego na planie', (await state()).eq.length === 3 && Object.keys((await state()).placements).length === 0);

await page.click('#b-mode');
check('plan: widoczny pasek planu, brak sali', await page.isVisible('#planbar') && (await page.textContent('#b-mode')) === 'Schemat' && !(await state()).spaces?.spc_x);
check('„Rozmieść brakujące” nieaktywny bez sali', await page.isDisabled('#b-placeall'));
await page.click('#b-space'); await page.waitForSelector('#spacedialog');
await page.fill('#s-w', '0,5'); await page.click('#s-save');
check('za mała sala odrzucona (okno zostaje)', await page.isVisible('#spacedialog'));
await page.fill('#s-name', 'Sala główna'); await page.fill('#s-w', '20'); await page.fill('#s-d', '12,5'); await page.click('#s-save');
const sp = await E(() => Object.values(window.__editor.store.state.spaces)[0]);
check('sala 20 × 12,5 m zapisana', sp.boundary[2][0] === 20000 && sp.boundary[2][1] === 12500, sp.boundary);
check('„Rozmieść brakujące (3)” aktywny', (await page.textContent('#b-placeall')).includes('(3)') && !(await page.isDisabled('#b-placeall')));
await page.click('#b-placeall');
const pl = (await state()).placements;
check('wszystkie 3 na planie, w obrębie sali', Object.keys(pl).length === 3 && Object.values(pl).every((p) => p.position.x > 0 && p.position.x < 20000 && p.position.y > 0 && p.position.y < 12500), pl);

// przeciąganie pierwszego urządzenia
const first = Object.values(pl)[0], id = first.targetId;
const sc = (x, y) => E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]);
const [sx, sy] = await sc(first.position.x, first.position.y);
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 117, sy - 61, { steps: 8 }); await page.mouse.up();
const moved = (await state()).placements[Object.keys(pl)[0]];
check('przeciągnięcie przesuwa urządzenie, pozycja przyciągnięta do 100 mm', moved.position.x !== first.position.x && moved.position.x % 100 === 0 && moved.position.y % 100 === 0, { from: first.position, to: moved.position });
check('po kliknięciu urządzenie jest zaznaczone i panel pokazuje sekcję Plan', await page.isVisible('#pl-x') && (await page.inputValue('#p-name')) !== '');
await page.keyboard.press('Control+z');
check('Ctrl+Z cofa przesunięcie', (await state()).placements[Object.keys(pl)[0]].position.x === first.position.x);
await page.keyboard.press('Control+y');

// obrót i pozycja liczbowa
await page.keyboard.press('r');
check('R obraca o 90°', (await state()).placements[Object.keys(pl)[0]].rotationDeg === 90);
await page.fill('#pl-x', '4,2'); await page.fill('#pl-y', '3'); await page.press('#pl-y', 'Enter');
const np = (await state()).placements[Object.keys(pl)[0]].position;
check('pozycja wpisana w metrach (4,2 × 3)', np.x === 4200 && np.y === 3000, np);
await page.fill('#pl-z', '5,5'); await page.press('#pl-z', 'Enter');
check('wysokość Z wpisana w metrach (5,5 m), X i Y bez zmian', (await state()).placements[Object.keys(pl)[0]].position.z === 5500 && (await state()).placements[Object.keys(pl)[0]].position.x === 4200);
check('klik w obróconym urządzeniu trafia (hit-test z obrotem)', (await E(([x, y]) => window.__editor.plan.hitAt(...[x, y]), await sc(4200, 3000))) === id);

// nowe urządzenie z katalogu w planie trafia na plan
await page.click('#cat-list button[data-cat="laptop"]');
const st = await state();
check('urządzenie dodane w planie od razu stoi na planie', st.eq.length === 4 && Object.keys(st.placements).length === 4);
// zdjęcie z planu
await page.click('#pl-off');
check('„Zdejmij z planu” usuwa rozmieszczenie, urządzenie zostaje w projekcie', Object.keys((await state()).placements).length === 3 && (await state()).eq.length === 4);
await page.screenshot({ path: path.join(process.env.TEMP, 'sw-plan.png') });

await page.click('#b-mode');
check('powrót do schematu', (await page.textContent('#b-mode')) === 'Plan sali' && !(await page.isVisible('#planbar')));
check('bez błędów walidacji', (await E(() => window.__editor.issues())) === 0);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
