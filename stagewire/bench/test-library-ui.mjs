// Test aktualizacji definicji z biblioteki w interfejsie: nowsza wersja pakietu nie zmienia projektu, okno biblioteki pokazuje różnice,
// „Nowa rewizja” tworzy rewizję bez przepinania, „i przepnij” przepina; wiarygodność danych w katalogu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5211, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5211/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').replace(/\\/g, '/');

const pack = (version, ports, model) => ({
  format: 'stagewire-pack/1', id: 'ui-lib', name: 'Pakiet UI', version, license: 'własne',
  devices: [{ key: 'konw', manufacturer: 'Fikcyjny', model, category: 'wideo / konwertery', dimensionsMm: { width: 100, depth: 80, height: 25 }, ports, source: { kind: 'datasheet', ref: 'Dokument testowy' } }],
});
const P = (key, label, connector, signal, direction) => ({ key, label, connector, signals: [signal], direction });
const v1 = pack('1.0.0', [P('sdi-in', 'SDI IN', 'std/bnc-75', 'std/sdi-3g', 'in'), P('hdmi-out', 'HDMI OUT', 'std/hdmi-a', 'std/hdmi', 'out')], 'K-1');
const v2 = pack('1.1.0', [P('sdi-in', 'SDI IN', 'std/bnc-75', 'std/sdi-3g', 'in'), P('usb', 'USB', 'std/usb-b', 'std/usb', 'io')], 'K-1');

const inst = await E(async ([url, p]) => { const m = await import(url); const r = m.installPack(p); window.__editor.refreshCatalog?.(); return { errors: r.errors, status: r.status }; }, [catUrl, v1]);
check('pakiet v1 wczytany z poziomu strony (moduł współdzielony z edytorem)', inst.errors.length === 0 && inst.status === 'new', inst);
await E(async (url) => { const m = await import(url); const { addFromCatalog } = m; window.__editor.store.dispatch('Dodaj', addFromCatalog('ui-lib/konw', 'K 1', 'eqi_ui1')); }, catUrl);
const state = () => E(() => { const s = window.__editor.store.state; const d = Object.values(s.definitions).find((x) => x.revisions['1'].key === 'ui-lib/konw'); return { rev: d.latestRevision, pinned: Object.values(s.equipment).map((e) => e.definitionRevision), json: JSON.stringify(s) }; });
const s0 = await state(); check('urządzenie z pakietu dodane do projektu (rewizja 1)', s0.rev === 1 && s0.pinned.join() === '1', s0.pinned);

await page.click('#b-library'); await page.waitForSelector('#libdialog');
check('okno biblioteki bez aktualizacji, gdy pakiet jest zgodny z projektem', !(await page.textContent('#libdialog')).includes('Aktualizacje w projekcie'));
await page.click('#l-close');

await E(async ([url, p]) => { const m = await import(url); window.__plan = m.installPack(p).status; }, [catUrl, v2]);
check('nowsza wersja pakietu zainstalowana (upgrade)', (await E(() => window.__plan)) === 'upgrade');
const s1 = await state(); check('sam import nowej wersji nie zmienia projektu', s1.json === s0.json);

await page.click('#b-library'); await page.waitForSelector('#libdialog');
const txt = await page.textContent('#libdialog');
check('okno biblioteki pokazuje aktualizację z różnicami portów', txt.includes('Aktualizacje w projekcie (1)') && txt.includes('1.0.0 → 1.1.0') && txt.includes('USB') && txt.includes('HDMI OUT'), txt.slice(txt.indexOf('Aktualizacje'), txt.indexOf('Aktualizacje') + 200));
await page.click('.u-new');
const s2 = await state(); check('„Nowa rewizja”: rewizja 2, instancja nadal na rewizji 1', s2.rev === 2 && s2.pinned.join() === "1", { rev: s2.rev, pinned: s2.pinned });
check('po aktualizacji sekcja aktualizacji znika', !(await page.textContent('#libdialog')).includes('Aktualizacje w projekcie'));
await page.click('#l-close');
// cofnięcie jednym krokiem
await E(() => window.__editor.store.undo()); const s3 = await state(); check('cofnięcie przywraca stan sprzed aktualizacji', s3.json === s0.json || s3.rev === 1, s3.rev);
await page.click('#b-library'); await page.waitForSelector('#libdialog');
await page.click('.u-all');
const s4 = await state(); check('„Nowa rewizja i przepnij”: instancja na rewizji 2', s4.rev === 2 && s4.pinned.join() === "2", { rev: s4.rev, pinned: s4.pinned });
await page.click('#l-close');

// znacznik wiarygodności
const mark = await E(async (url) => { const m = await import(url); m.installPack({ format: 'stagewire-pack/1', id: 'ui-lib2', name: 'Pakiet UI 2', version: '1.0.0', license: 'własne', devices: [{ key: 'x', manufacturer: 'Fikcyjny', model: 'Bez weryfikacji', category: 'inne', dimensionsMm: { width: 10, depth: 10, height: 10 }, ports: [{ key: 'p', label: 'P', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }], source: { kind: 'datasheet', ref: 'Karta' } }] }); window.__editor.refreshCatalog?.(); return true; }, catUrl);
await page.fill('#catalog input', 'bez weryfikacji');
await page.waitForSelector('#cat-list button[data-cat]');
check('wiersz katalogu oznacza dane niezweryfikowane', (await page.textContent('#cat-list button[data-cat]')).includes('niezweryfikowane'), await page.textContent('#cat-list button[data-cat]'));
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
