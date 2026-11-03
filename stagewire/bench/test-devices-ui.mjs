// Test urządzeń w interfejsie: katalog z producentem, okno definicji z danymi urządzenia, fork, okno biblioteki.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5205, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5205/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
check('wiersz katalogu pokazuje producenta i liczbę portów', (await page.textContent('#cat-list button[data-cat="video_switcher"] small')).includes('Generic'), await page.textContent('#cat-list button[data-cat="video_switcher"] small'));
await page.fill('#catalog input', 'generic mikser');
check('wyszukiwanie po producencie i modelu', (await page.$$('#cat-list button[data-cat]')).length === 2 || (await page.$$('#cat-list button[data-cat]')).length === 1, (await page.$$('#cat-list button[data-cat]')).length);
await page.fill('#catalog input', '');

await page.click('#cat-list button[data-cat="video_switcher"]');
const [id] = await E(() => Object.keys(window.__editor.nodes()));
const hd = await E((i) => window.__editor.nodeScreen(i).header, id); await page.mouse.click(hd[0], hd[1]);
await page.click('#p-edit'); await page.waitForSelector('#defdialog');
await page.click('#d-more summary');
await page.fill('#m-manufacturer', 'Acme'); await page.fill('#m-category', 'wideo / miksery');
await page.fill('#m-w', '483'); await page.fill('#m-d', '300'); await page.fill('#m-h', '88'); await page.fill('#m-weight', '4,2'); await page.fill('#m-power', '60');
await page.fill('#m-ru', '2'); await page.fill('#m-tags', 'mikser, sdi'); await page.fill('#m-notes', 'Mikser wizji 8 wejść');
await page.selectOption('#m-srckind', 'datasheet'); await page.click('#d-save');
check('datasheet bez odnośnika jest odrzucony (okno zostaje)', await page.isVisible('#defdialog') && (await page.textContent('#msg')).includes('odnośnik'), await page.textContent('#msg'));
await page.fill('#m-srcref', 'Acme MX8 Datasheet rev. C'); await page.fill('#m-srcver', '2026-11-02'); await page.click('#d-save');
const rev = await E(() => { const s = window.__editor.store.state; const d = Object.values(s.definitions).find((x) => x.revisions[x.latestRevision].manufacturer === 'Acme'); return d && d.revisions[d.latestRevision]; });
check('zapis ustawia producenta, wymiary, masę, rack, tagi i źródło', rev && rev.manufacturer === 'Acme' && rev.dimensionsMm?.width === 483 && rev.weightKg === 4.2 && rev.powerW === 60 && rev.rackUnits?.heightU === 2 && rev.tags?.join() === 'mikser,sdi' && rev.sourceKind === 'datasheet' && rev.origin?.source === 'Acme MX8 Datasheet rev. C' && rev.changeClass === 'cosmetic', rev);

// fork
await E((i) => window.__editor.selectNode(i), id);
await page.click('#p-edit'); await page.waitForSelector('#defdialog');
await page.fill('#m-model', 'MX8 Plus'); await page.click('#d-fork');
const info = await E((i) => { const s = window.__editor.store.state; return { defs: Object.keys(s.definitions).length, inst: s.equipment[i].definitionId, derived: s.definitions[s.equipment[i].definitionId].revisions['1'].origin?.derivedFrom?.definitionId, model: s.definitions[s.equipment[i].definitionId].revisions['1'].model }; }, id);
check('fork: nowa definicja, urządzenie przepięte, pochodzenie zapisane', info.defs === 2 && info.model === 'MX8 Plus' && !!info.derived && info.inst !== info.derived, info);
check('lista „W tym projekcie” zawiera zmienione i nowe urządzenie', (await page.$$('#cat-list button[data-def]')).length === 2, (await page.$$('#cat-list button[data-def]')).length);
await page.keyboard.press('Control+z');
check('Ctrl+Z cofa fork jednym krokiem', (await E(() => Object.keys(window.__editor.store.state.definitions).length)) === 1);

// „Do mojej biblioteki” poza aplikacją: czytelny komunikat
await E((i) => window.__editor.selectNode(i), id); await page.click('#p-edit'); await page.waitForSelector('#defdialog'); await page.click('#d-lib');
await page.waitForSelector('#dialog'); check('zapis do biblioteki poza aplikacją: komunikat, bez wyjątku', (await page.textContent('#dialog')).includes('w aplikacji'));
await page.click('#dialog button[data-id="ok"]'); await page.click('#d-cancel');

// okno biblioteki
await page.click('#b-library'); await page.waitForSelector('#libdialog');
const rows = await page.$$eval('#libdialog tbody tr', (r) => r.map((x) => x.textContent));
check('okno biblioteki pokazuje pakiety wbudowane (ogólne 14, rejestry, Blackmagic 8)', rows.length === 3 && rows[0].includes('Urządzenia ogólne') && rows[0].includes('14') && rows[0].includes('wbudowany') && rows[1].includes('złącza') && rows[2].includes('Blackmagic') && rows[2].includes('8'), rows);
await page.click('#l-export');
check('eksport: zmienione urządzenie projektu (rewizja 2) jest na liście do wyboru', (await page.$$('#libdialog .e-def')).length === 1, (await page.$$('#libdialog .e-def')).length);
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
