// Test: budowanie rozdzielnicy i racka wprost z katalogu po lewej: filtr „pasujące do widoku”, przeciąganie z katalogu na wskazane miejsce, skrót G.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5236, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5236/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').split(path.sep).join('/');
const base = { manufacturer: 'Fikcyjny', category: 'test', source: { kind: 'custom' } };
const pack = { format: 'stagewire-pack/1', id: 'cb-ui', name: 'Budowa UI', version: '1.0.0', license: 'własne', devices: [
  { ...base, key: 'mcb', model: 'Wyłącznik DIN', dinModules: 1, dimensionsMm: { width: 17.5, depth: 60, height: 90 }, ports: [{ key: 'in', label: 'IN', connector: 'std/din-terminal', signals: ['std/power-ac'], direction: 'in' }] },
  { ...base, key: 'sw', model: 'Switch 1U', rackUnits: { heightU: 1, widthFraction: 1 }, dimensionsMm: { width: 440, depth: 300, height: 44 }, ports: [{ key: 'lan', label: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }] },
] };
await E(async ([u, p]) => { const m = await import(u); m.installPack(p); window.__editor.store.dispatch('x', (d) => { d.cabinets = d.cabinets ?? {}; }); }, [catUrl, pack]);
const names = () => E(() => Object.values(window.__editor.store.state.equipment).map((e) => e.name));
const listText = () => page.textContent('#cat-list');
const dnd = async (sel, to) => { const h = await page.$(sel); await h.scrollIntoViewIfNeeded(); const b = await h.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 100, b.y + 20, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300); };

// --- szafa ---
await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' });
await page.click('#cb-new'); await page.waitForSelector('#cabdialog'); await page.selectOption('#cf-preset', 'din3x18'); await page.fill('#cf-name', 'RS'); await page.click('#cf-ok');
check('w widoku szafy pojawia się przełącznik „tylko na szynę DIN”, domyślnie włączony', (await page.isVisible('#cat-fit')) && (await page.isChecked('#cat-fit-cb')));
let t = await listText(); check('domyślnie lista pokazuje tylko osprzęt DIN', t.includes('Wyłącznik DIN') && !t.includes('Switch 1U') && !t.includes('Kamera SDI'), t.slice(0, 80));
await page.click('#cat-fit-cb'); t = await listText(); check('po wyłączeniu filtra widać wszystko', t.includes('Switch 1U') && t.includes('Kamera SDI'));
await page.click('#cat-fit-cb');
await dnd('#cat-list [data-cat$="mcb"]', await E(() => window.__editor.cab.cellPoint(2, 5)).then(async (p) => { const r = await (await page.$('#cabview canvas')).boundingBox(); return [r.x + p[0], r.y + p[1]]; }));
let st = await E(() => Object.values(window.__editor.store.state.equipment).map((e) => ({ n: e.name, din: e.din })));
check('przeciągnięcie z katalogu na szynę 2, pozycję 5 montuje nowy osprzęt dokładnie tam', st.length === 1 && st[0].din?.row === 2 && st[0].din?.at === 5, st);
await page.click('#cat-list [data-cat$="mcb"]'); st = await E(() => Object.values(window.__editor.store.state.equipment).map((e) => e.din));
check('zwykłe kliknięcie nadal montuje w pierwszym wolnym miejscu', st.length === 2 && st.some((d) => d?.row === 1 && d?.at === 1), st);
await page.keyboard.press('g'); check('skrót G otwiera przeglądarkę biblioteki także w widoku szafy', await page.isVisible('#browsedialog')); await page.keyboard.press('Escape'); if (await page.isVisible('#browsedialog')) await page.click('#bw-close').catch(() => {});

// --- rack ---
await page.click('#b-cab'); await page.click('#b-rack'); await page.waitForSelector('#rackview', { state: 'visible' });
await page.click('#rk-new'); await page.waitForSelector('#rackdialog'); await page.fill('#rf-name', 'R1'); await page.fill('#rf-units', '10'); await page.click('#rf-ok');
t = await listText(); check('w widoku racka domyślnie tylko urządzenia rackowe', t.includes('Switch 1U') && !t.includes('Wyłącznik DIN') && !t.includes('Kamera SDI'), t.slice(0, 80));
const rc = await (await page.$('#rackview canvas')).boundingBox(), rp = await E(() => window.__editor.rack.pointOf(7));
await dnd('#cat-list [data-cat$="/sw"]', [rc.x + rp[0], rc.y + rp[1]]);
st = await E(() => Object.values(window.__editor.store.state.equipment).filter((e) => e.mount).map((e) => e.mount));
check('przeciągnięcie z katalogu na U7 montuje nowy switch na U7', st.length === 1 && st[0].uStart === 7, st);
await page.click('#b-rack'); await page.waitForTimeout(100);
check('po powrocie do schematu przełącznik filtra znika, a lista pokazuje wszystko', !(await page.isVisible('#cat-fit')) && (await listText()).includes('Kamera SDI'));
await page.click('#b-cab'); await page.click('#b-cab');
console.log(`\ncatalogbuild: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
