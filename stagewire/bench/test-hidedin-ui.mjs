// Test: ukrywanie osprzętu zamontowanego w szafach na schemacie blokowym (nowy projekt: domyślnie ukryty; przycisk; aktualizacja starszego projektu).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5237, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5237/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const catUrl = '/@fs/' + path.join(root, 'src', 'catalog', 'index.ts').split(path.sep).join('/');
const cabUrl = '/@fs/' + path.join(root, 'src', 'cabinets.ts').split(path.sep).join('/');
const pack = { format: 'stagewire-pack/1', id: 'hd-ui', name: 'Ukrywanie UI', version: '1.0.0', license: 'własne', devices: [
  { key: 'psu', manufacturer: 'Fikcyjny', model: 'Zasilacz', category: 'zasilanie', dinModules: 2, dimensionsMm: { width: 35, depth: 60, height: 90 }, ports: [{ key: 'o', label: 'OUT', connector: 'std/din-terminal', signals: ['std/power-dc'], direction: 'out' }], source: { kind: 'custom' } },
  { key: 'led', manufacturer: 'Fikcyjny', model: 'Sterownik', category: 'zasilanie', dinModules: 3, dimensionsMm: { width: 52, depth: 60, height: 90 }, ports: [{ key: 'i', label: 'IN', connector: 'std/din-terminal', signals: ['std/power-dc'], direction: 'in' }], source: { kind: 'custom' } },
] };
await E(async ([c, k, p]) => { const m = await import(c), cab = await import(k); m.installPack(p); const d = window.__editor.store.dispatch.bind(window.__editor.store);
  d('s', cab.cabCmd.addCabinet('cab_ui', { name: 'Szafa', widthMm: 300, heightMm: 350, rows: 2, modules: 12 }));
  d('a', m.addFromCatalog('hd-ui/psu', 'Zasilacz 1', 'eqi_p')); d('a', m.addFromCatalog('hd-ui/led', 'Sterownik 1', 'eqi_l')); d('a', m.addFromCatalog('hd-ui/led', 'Sterownik 2', 'eqi_x'));
  d('m', cab.cabCmd.mount('eqi_p', { cabinetId: 'cab_ui', row: 1, at: 1 })); d('m', cab.cabCmd.mount('eqi_l', { cabinetId: 'cab_ui', row: 1, at: 4 })); }, [catUrl, cabUrl, pack]);
await page.keyboard.press('Escape');
// przebudowa schematu: przełącz tryb tam i z powrotem
const rebuildView = async () => { await page.click('#b-cab'); await page.click('#b-cab'); await page.waitForTimeout(150); };
const nodes = () => E(() => [...new Set(window.__editor.dl().filter((p) => p.t === 'rect' && p.id.startsWith('eqi_')).map((p) => p.id))].sort());
await rebuildView();
check('nowy projekt: przycisk pokazuje „Osprzęt DIN: ukryty”', (await page.textContent('#b-din')) === 'Osprzęt DIN: ukryty');
check('nowy projekt: osprzęt z szafy (zasilacz, sterownik 1) nie jest na schemacie, niezamontowany jest', JSON.stringify(await nodes()) === JSON.stringify(['eqi_x']), await nodes());
await page.click('#b-din');
check('przycisk włącza widoczność osprzętu z szaf', (await page.textContent('#b-din')) === 'Osprzęt DIN: widoczny' && (await nodes()).length === 3, await nodes());
await page.keyboard.press('Control+z');
check('cofnięcie (Ctrl+Z) ukrywa go z powrotem i przywraca podpis przycisku', (await page.textContent('#b-din')) === 'Osprzęt DIN: ukryty' && (await nodes()).length === 1);

// starszy projekt: ustawienie i znacznik „zastosowane” usunięte (jak plik sprzed tej wersji)
await E(() => window.__editor.store.dispatch('stary', (d) => { delete d.settings.hideMountedDin; delete d.ext; }));
await rebuildView();
check('starszy projekt: osprzęt widoczny, bez zmiany wyglądu', (await nodes()).length === 3 && (await page.textContent('#b-din')) === 'Osprzęt DIN: widoczny');
await page.click('#b-burger'); await page.click('#b-upgrade'); await page.waitForSelector('#upgdialog');
check('okno aktualizacji proponuje „Ukryj osprzęt z szaf na schemacie blokowym”', (await page.textContent('#upgdialog')).includes('Ukryj osprzęt z szaf na schemacie blokowym'));
await page.click('#up-apply'); await page.waitForTimeout(150);
check('po zastosowaniu okno pokazuje, że projekt jest aktualny', (await page.textContent('#upgdialog')).includes('Projekt jest aktualny'));
await page.click('#up-close'); await rebuildView();
check('po zastosowaniu osprzęt z szafy jest ukryty', JSON.stringify(await nodes()) === JSON.stringify(['eqi_x']), await nodes());
console.log(`\nhidedin: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
