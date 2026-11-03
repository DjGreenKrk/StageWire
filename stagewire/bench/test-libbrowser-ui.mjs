// Test: przeglądarka biblioteki z filtrami, kreator urządzenia, zapis/import/usuwanie pojedynczych urządzeń w „Moje urządzenia”.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5235, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5235/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const nEq = () => E(() => Object.keys(window.__editor.store.state.equipment).length);
const counts = async () => { const t = await page.textContent('#bw-count'); const m = /(\d+) z (\d+)/.exec(t); return [Number(m[1]), Number(m[2])]; };

// 1. otwarcie i filtry
await page.keyboard.press('g'); await page.waitForSelector('#browsedialog');
let [shown, total] = await counts(); check('skrót G otwiera przeglądarkę; pokazuje wszystkie urządzenia', shown === total && total >= 10, [shown, total]);
const facetNames = await page.$$eval('.bw-fh', (e) => e.map((x) => x.textContent)); check('filtry: kategoria, producent, wejścia, wyjścia, dane, pakiet', ['Kategoria', 'Producent', 'Wejścia', 'Wyjścia'].every((f) => facetNames.includes(f)), facetNames);
const firstCount = Number(await page.textContent('.bw-f:first-child .bw-v small'));
await page.click('.bw-f:first-child .bw-v input'); [shown] = await counts(); check('wybranie wartości filtra zawęża listę do jej licznika', shown === firstCount && (await page.$$('.bw-r')).length === shown, [shown, firstCount]);
await page.click('#bw-clear'); [shown] = await counts(); check('„Wyczyść filtry” przywraca całość', shown === total);
await page.fill('#bw-q', 'kamera sdi'); [shown] = await counts(); check('wyszukiwarka tekstowa zawęża (bez wielkości liter)', shown > 0 && shown < total, shown);
// filtr po wyjściach SDI
await page.fill('#bw-q', '');
const sdiSel = '.bw-f:has(.bw-fh:text-is("Wyjścia")) label:has(span:text-matches("SDI")) input';
if (await page.$(sdiSel)) { await page.click(sdiSel); [shown] = await counts(); check('filtr „Wyjścia: SDI” zostawia tylko urządzenia z wyjściem SDI', shown > 0 && shown < total && (await page.$$eval('.bw-r', (r) => r.length)) === shown, shown); await page.click('#bw-clear'); }
else check('filtr wyjść ma wartość SDI', false);

// 2. karta i dodanie do projektu
await page.fill('#bw-q', 'kamera sdi'); await page.click('.bw-r:first-child'); await page.waitForSelector('#bw-add');
check('karta urządzenia pokazuje porty i dane', (await page.textContent('#bw-detail')).includes('Porty') && (await page.textContent('#bw-detail')).includes('Dane:'));
const n0 = await nEq(); await page.click('#bw-add'); check('„Dodaj do projektu” dodaje urządzenie', (await nEq()) === n0 + 1);
await page.screenshot({ path: path.join(out, 'sw-biblioteka-1-przegladarka.png') });

// 3. kreator
await page.click('#bw-new'); await page.waitForSelector('#builddialog');
check('kreator: przycisk zapisu zablokowany, dopóki brakuje danych', await page.isDisabled('#bd-save'), await page.textContent('#b-check'));
await page.fill('#b-model', 'Konwerter Testowy'); await page.fill('#b-manufacturer', 'Moja Firma'); await page.fill('#b-category', 'Konwertery');
await page.selectOption('#b-preset', 'hdmi-in'); await page.fill('#b-pcount', '2'); await page.click('#b-padd');
await page.selectOption('#b-preset', 'sdi-out'); await page.fill('#b-pcount', '1'); await page.click('#b-padd');
check('zestawy portów: 2 × HDMI wejście + 1 × SDI wyjście = 3 wiersze z numeracją', (await page.$$eval('.prow .f-label', (i) => i.map((x) => x.value))).join('|') === 'HDMI IN 1|HDMI IN 2|SDI OUT 1');
check('podgląd bloku pokazuje porty', (await page.textContent('#b-pv')).includes('HDMI IN 2') && (await page.textContent('#b-pv')).includes('SDI OUT 1'));
check('kreator: poprawne dane odblokowują zapis', !(await page.isDisabled('#bd-save')));
await page.screenshot({ path: path.join(out, 'sw-biblioteka-2-kreator.png') });
const n1 = await nEq(); await page.click('#bd-saveadd'); await page.waitForTimeout(300);
const st = await E(() => ({ eq: Object.values(window.__editor.store.state.equipment).map((e) => e.name), mine: window.__editor.libBrowser && true }));
check('„Zapisz i dodaj do projektu”: urządzenie jest w projekcie', (await nEq()) === n1 + 1 && st.eq.some((n) => n.startsWith('Konwerter Testowy')), st.eq.slice(-2));

// 4. Moje urządzenia: filtr po pakiecie, usuwanie
await page.keyboard.press('g'); await page.waitForSelector('#browsedialog'); await page.click('#bw-clear');
const mineSel = '.bw-f:has(.bw-fh:text-is("Pakiet")) label:has(span:text-is("Moje urządzenia")) input'; check('filtr „Pakiet” zawiera Moje urządzenia', !!(await page.$(mineSel)));
await page.click(mineSel); [shown] = await counts(); check('po filtrze pakietu: 1 urządzenie i znacznik „moje”', shown === 1 && (await page.textContent('.bw-r')).includes('moje'));
await page.click('.bw-r'); check('własne urządzenie ma akcje Edytuj i Usuń z moich', !!(await page.$('#bw-edit')) && !!(await page.$('#bw-del')));
await page.click('#bw-del'); await page.click('#bw-del'); await page.waitForTimeout(200);
check('usunięcie z moich zdejmuje urządzenie z biblioteki', (await E(() => window.__editor && true)) && !(await page.$('.bw-r')) );
await page.click('#bw-clear');

// 5. import pojedynczego urządzenia (jak z pliku od kolegi)
const raw = await E(async ([bu, cu]) => {
  const b = await import(bu), c = await import(cu);
  const d = b.buildDevice({ manufacturer: 'Kolega', model: 'Splitter 1x4', category: 'Wideo', ports: [...b.expandPreset(b.presetsAvailable(c.starterRegistries).find((p) => p.id === 'hdmi-in'), 1, []), ...b.expandPreset(b.presetsAvailable(c.starterRegistries).find((p) => p.id === 'hdmi-out'), 4, [])], source: { kind: 'custom' } });
  return b.singleDevicePack(d, c.starterRegistries, { author: 'Kolega', license: 'CC0 (domena publiczna)' }).pack;
}, [u('deviceBuild.ts'), u('catalog/index.ts')]);
await E((r) => window.__editor.libBrowser.importDevicesPack(r), raw); await page.waitForSelector('#bi-go');
check('import: lista pokazuje urządzenie jako nowe, z licencją i autorem', (await page.textContent('#bw-msg')).includes('nowe') && (await page.textContent('#bw-msg')).includes('CC0'));
await page.click('#bi-go'); await page.waitForTimeout(200);
await E((r) => window.__editor.libBrowser.importDevicesPack(r), raw); await page.waitForSelector('#bi-go');
check('ponowny import tego samego: „już masz”, nic do dodania', (await page.textContent('#bw-msg')).includes('już masz') && (await page.$$('.bi:checked')).length === 0);
await page.fill('#bw-q', 'splitter'); [shown] = await counts(); check('zaimportowane urządzenie jest w bibliotece i szukalne', shown === 1, shown);
console.log(`\nlibbrowser: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
