// Test: kreator elementów elektrycznych (listwa, grzebień, aparat, obudowa): parametry → podgląd → zapis → użycie w szafie z poprawnymi torami.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5239, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5239/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const mine = () => E(async (cu) => { const m = await import(cu); return m.catalogEntries.filter((e) => e.packId === 'moje-urzadzenia').map((e) => e.model); }, u('catalog/index.ts'));
const fill = async (id, v) => { await page.fill('#' + id, v); };

{ const ms = await E(async () => { const t = performance.now(); document.getElementById('b-newel').click(); while (!document.getElementById('elbuilder')) await new Promise((r) => requestAnimationFrame(r)); return Math.round(performance.now() - t); }); console.log('czas otwarcia kreatora [ms]:', ms); check('kreator otwiera się w < 400 ms', ms < 400, ms); await page.keyboard.press('Escape'); await page.waitForTimeout(150); check('Esc zamyka kreator', !(await page.$('#elbuilder'))); }
// wejścia do kreatora
await page.click('#b-newel'); await page.waitForSelector('#elbuilder');
check('przycisk „+ Element elektryczny…” w panelu katalogu otwiera kreator', await page.isVisible('#elbuilder'));
check('przycisk zapisu zablokowany, dopóki brak modelu i producenta', await page.isDisabled('#el-save'));
const kinds = await page.$$eval('[id^="el-kind-"]', (o) => o.map((x) => x.id.replace('el-kind-', ''))); check('rodzaje: listwa, grzebień, blok, złączka, aparat, obudowa', ['bar', 'comb', 'block', 'terminal', 'apparatus', 'enclosure'].every((k) => kinds.includes(k)), kinds);

// listwa N
await fill('el-model', 'Listwa N 10'); await fill('el-manufacturer', 'Własne'); await fill('el-barcount', '10'); await fill('el-barcap', '2');
check('listwa: podgląd opisuje 10 zacisków toru N w jednym węźle', (await page.textContent('#el-pv')).includes('10 zacisków toru N'), (await page.textContent('#el-pv')).slice(0, 120));
check('po wypełnieniu zapis jest odblokowany', !(await page.isDisabled('#el-save')));
await page.click('#el-save'); await page.waitForTimeout(300);
check('listwa zapisana w „Moje urządzenia”', (await mine()).includes('Listwa N 10'), await mine());

// grzebień 3P
await page.click('#b-burger'); await page.click('#b-newel2'); await page.waitForSelector('#elbuilder');
await page.click('#el-kind-comb'); await fill('el-model', 'Grzebień 3P 6'); await fill('el-manufacturer', 'Własne'); await fill('el-teeth', '6');
check('grzebień bez tagu zgodności: komunikat i zapis zablokowany', (await page.isDisabled('#el-save')) && (await page.textContent('#el-check')).includes('Zgodność'));
await fill('el-fits', 'x1');
const pv = await page.textContent('#el-pv'); check('grzebień: podgląd pokazuje tory L1 L2 L3 i mostki', pv.includes('L1 L2 L3') && pv.includes('mostki'), pv.slice(0, 160));
await page.screenshot({ path: path.join(out, 'sw-kreator-elektryczny.png') });
await page.click('#el-save'); await page.waitForTimeout(250);

// aparat 1P z wejściem pod grzebień, zapis i dodanie do projektu
await page.click('#b-newel'); await page.waitForSelector('#elbuilder');
await page.click('#el-kind-apparatus'); await fill('el-model', 'Wyłącznik 1P'); await fill('el-manufacturer', 'Własne'); await fill('el-appfits', 'x1');
await page.click('#el-saveadd'); await page.waitForTimeout(350);
check('aparat dodany do projektu z biblioteki', (await E(() => Object.values(window.__editor.store.state.equipment).map((e) => e.name))).some((n) => n.startsWith('Wyłącznik 1P')));

// użycie w szafie: trzy aparaty pod grzebieniem mają tory L1, L2, L3
const res = await E(async ([cu, cabu, nu]) => {
  const m = await import(cu), cab = await import(cabu), nets = await import(nu), st = window.__editor.store, d = (l, f) => st.dispatch(l, f);
  d('s', cab.cabCmd.addCabinet('cab_e', { name: 'Szafa', widthMm: 300, heightMm: 350, rows: 1, modules: 12 }));
  const ids = Object.entries(st.state.equipment).filter(([, e]) => e.name.startsWith('Wyłącznik 1P')).map(([k]) => k);
  for (let i = ids.length; i < 3; i++) { const id = 'eqi_x' + i; d('a', m.addFromCatalog(m.catalogEntries.find((e) => e.model === 'Wyłącznik 1P').key, 'Wyłącznik 1P ' + (i + 1), id)); ids.push(id); }
  d('a', m.addFromCatalog(m.catalogEntries.find((e) => e.model === 'Grzebień 3P 6').key, 'Grzebień', 'eqi_comb'));
  ids.slice(0, 3).forEach((id, i) => d('m', cab.cabCmd.mount(id, { cabinetId: 'cab_e', row: 1, at: i + 1 }))); d('m', cab.cabCmd.mount('eqi_comb', { cabinetId: 'cab_e', row: 1, at: 1 }));
  const n = nets.electricalNets(st.state); const pid = (id) => { const e = st.state.equipment[id]; return Object.keys(st.state.definitions[e.definitionId].revisions[String(e.definitionRevision)].ports).find((p) => p === 'prt_inp1'); };
  return ids.slice(0, 3).map((id) => n.netOf({ instanceId: id, portId: pid(id) })?.tracks.join(''));
}, [u('catalog/index.ts'), u('cabinets.ts'), u('nets.ts')]);
check('trzy aparaty z kreatora pod grzebieniem z kreatora dostają tory L1, L2, L3', JSON.stringify(res) === JSON.stringify(['L1', 'L2', 'L3']), res);

// obudowa
await page.keyboard.press('g').catch(() => {}); await page.waitForTimeout(200);
if (await page.isVisible('#browsedialog')) { await page.click('#bw-newel'); } else { await page.click('#b-newel'); }
await page.waitForSelector('#elbuilder'); await page.click('#el-kind-enclosure');
await fill('el-model', 'Obudowa 2x12'); await fill('el-ew', '320'); await fill('el-eh', '410'); await fill('el-erows', '2'); await fill('el-emods', '12'); await fill('el-eip', 'IP65');
check('obudowa: podgląd pokazuje 2 × 12 = 24 moduły', (await page.textContent('#el-pv')).includes('2 × 12 mod. = 24'));
await page.click('#el-save'); await page.waitForTimeout(250);
const encs = await E(async (cu) => { const m = await import(cu); return m.catalogEnclosures().map((e) => e.enclosure.model); }, u('catalog/index.ts'));
check('obudowa zapisana i dostępna w katalogu obudów', encs.includes('Obudowa 2x12'), encs);
await page.click('#b-cab'); await page.waitForSelector('#cabview', { state: 'visible' }); await page.click('#cb-new'); await page.waitForSelector('#cabdialog');
check('obudowa z kreatora jest typem w oknie „Nowa szafa”', (await page.$$eval('#cf-preset option', (o) => o.map((x) => x.textContent))).some((t) => t.includes('Obudowa 2x12')));
console.log(`\nelbuilder: ${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
await browser.close(); await server.close(); process.exit(checks.every((c) => c.ok) ? 0 : 1);
