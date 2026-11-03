// Test edycji definicji w interfejsie: zaznaczenie, panel właściwości, nowa rewizja, wpływ na połączenia, aktualizacja instancji, cofanie.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5193, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5193/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const counts = () => E(() => window.__editor.counts());
const addAt = async (key, x, y) => { await E(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };

await addAt('camera_sdi', 0, 40); await addAt('camera_sdi', 0, 240); await addAt('video_switcher', 420, 120);
await E(() => window.__editor.look(210, 140, 1));
const ids = await E(() => Object.keys(window.__editor.nodes()));
const [k1, k2, mix] = ids;
for (const [k, port] of [[k1, 'prt_sdiin1'], [k2, 'prt_sdiin2']]) {
  const a = await E((i) => window.__editor.portScreen(i, 'prt_sdiout'), k), b = await E(([i, p]) => window.__editor.portScreen(i, p), [mix, port]);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up();
}
check('przygotowanie: 3 urządzenia, 2 połączenia', (await counts()).devices === 3 && (await counts()).connections === 2, await counts());

// zaznaczenie (klik w nagłówek) i zmiana nazwy
const hd = await E((i) => window.__editor.nodeScreen(i).header, mix);
await page.mouse.click(hd[0], hd[1]);
check('klik w nagłówek zaznacza urządzenie i pokazuje panel', await page.isVisible('#props') && (await page.inputValue('#p-name')) === 'Mikser wizji 1');
await page.fill('#p-name', 'Mikser A'); await page.keyboard.press('Enter');
check('zmiana nazwy zapisana (krok cofania)', (await E((i) => window.__editor.store.state.equipment[i].name, mix)) === 'Mikser A');

// nowa rewizja: dodanie portu i zmiana nazwy portu, aktualizacja wszystkich
await page.click('#p-edit'); await page.waitForSelector('#defdialog');
const nRows0 = await page.$$eval('#defdialog .prow', (r) => r.length);
await page.click('#d-add'); await page.fill('#defdialog .prow:last-child .f-label', 'Dodatkowy'); await page.fill('#defdialog .prow:nth-child(1) .f-label', 'CAM 1');
await page.click('#d-save');
const rev = await E(([m]) => ({ r: window.__editor.revisionOf(m), ports: Object.keys(window.__editor.store.state.definitions[Object.keys(window.__editor.store.state.definitions).find((d) => d.endsWith('videoswitcher'))].revisions['2'].ports).length }), [mix]);
check('zapis tworzy rewizję 2 z dodatkowym portem, urządzenie przepięte', nRows0 === 13 && rev.r === 2 && rev.ports === 14, { nRows0, ...rev });
check('połączenia zachowane po dodaniu portu', (await counts()).connections === 2);

// usunięcie połączonego portu, bez aktualizacji instancji
await page.click('#p-edit'); await page.waitForSelector('#defdialog');
await page.click('#defdialog .prow:nth-child(1) .f-del');
check('okno ostrzega o skutku (zerwie 1 połączenie)', (await page.textContent('#defdialog .imp')).includes('zerwie 1 połączeń'), await page.textContent('#defdialog .imp'));
await page.uncheck('#d-all'); await page.click('#d-save');
check('rewizja 3 zapisana, urządzenie zostało na rewizji 2, połączenia nietknięte', (await E((m) => window.__editor.revisionOf(m), mix)) === 2 && (await counts()).connections === 2);
check('panel pokazuje nieaktualną rewizję i przycisk aktualizacji', (await page.textContent('#props')).includes('najnowsza: 3') && (await page.$('#p-upg')) !== null);

// aktualizacja ze zrywaniem połączenia: potwierdzenie, potem cofnięcie
await page.click('#p-upg'); await page.waitForSelector('#dialog');
check('aktualizacja pyta o zerwanie połączenia', (await page.textContent('#dialog')).includes('1 połączeń'));
await page.click('#dialog button[data-id="go"]');
check('po aktualizacji: rewizja 3, 1 połączenie', (await E((m) => window.__editor.revisionOf(m), mix)) === 3 && (await counts()).connections === 1, await counts());
await page.keyboard.press('Control+z');
check('cofnięcie przywraca rewizję 2 i połączenie', (await E((m) => window.__editor.revisionOf(m), mix)) === 2 && (await counts()).connections === 2);

// usuwanie urządzenia z potwierdzeniem
await page.click('#p-del'); await page.waitForSelector('#dialog');
check('usuwanie pyta o skutki (2 połączenia)', (await page.textContent('#dialog')).includes('2 połączeń'));
await page.click('#dialog button[data-id="go"]');
check('usunięto urządzenie z kaskadą', (await counts()).devices === 2 && (await counts()).connections === 0, await counts());
await page.keyboard.press('Control+z');
check('cofnięcie usuwania przywraca urządzenie i połączenia', (await counts()).devices === 3 && (await counts()).connections === 2);
check('wskaźnik uwag walidacji bez błędów', (await E(() => window.__editor.issues())) === 0);

// pola z pakietów: moc maksymalna, adres źródła, rewizja sprzętu, wygenerowane, grupa portu i drugi sygnał
const hd2 = await E((i) => window.__editor.nodeScreen(i).header, mix); await page.mouse.click(hd2[0], hd2[1]);
await page.click('#p-edit'); await page.waitForSelector('#defdialog'); await page.click('#d-more summary');
await page.fill('#m-power', '20'); await page.fill('#m-powermax', '45'); await page.fill('#m-srcurl', 'https://example.com/karta'); await page.fill('#m-hwrev', 'rev B'); await page.check('#m-generated');
await page.fill('#defdialog .prow:nth-child(1) .f-grp', 'SDI wejścia');
await page.click('#defdialog .prow:nth-child(1) .f-sigadd'); await page.click('#defdialog .prow:nth-child(1) .f-sigadd');
check('„+ sygnał” dodaje kolejne sygnały (3 selecty: pierwszy + 2 dodatkowe)', (await page.$$eval('#defdialog .prow:nth-child(1) .f-sigx', (x) => x.length)) === 2);
check('port sygnałowy (SDI) nie pokazuje pól napięć i mocy', (await page.$$('#defdialog .prow:nth-child(1) .f-umin')).length === 0);
await page.selectOption('#defdialog .prow:nth-child(1) .f-sigx >> nth=0', 'std/poe');
check('po dodaniu sygnału zasilającego (PoE) pola napięć i mocy się pojawiają', (await page.$$('#defdialog .prow:nth-child(1) .f-umin')).length === 1);
await page.fill('#defdialog .prow:nth-child(1) .f-umin', '5'); await page.fill('#defdialog .prow:nth-child(1) .f-umax', '12'); await page.fill('#defdialog .prow:nth-child(1) .f-pmax', '15.4');
await page.screenshot({ path: (process.env.SHOTS || process.env.TEMP) + '/sw-definicja-pola.png' });
await page.click('#d-save');
const meta = await E(() => { const s = window.__editor.store.state, d = s.definitions[Object.keys(s.definitions).find((k) => k.endsWith('videoswitcher'))], r = d.revisions[String(d.latestRevision)], p0 = Object.values(r.ports).sort((a, b) => a.order - b.order)[0]; return { powerMaxW: r.powerMaxW, sourceUrl: r.sourceUrl, hardwareRevision: r.hardwareRevision, sourceGenerated: r.sourceGenerated, group: p0.group, sigs: p0.signalKeys.length, el: p0.electrical }; });
check('pola z pakietów zapisane w nowej rewizji (moc maks., adres, rewizja sprzętu, wygenerowane, grupa, 3 sygnały, napięcia i moc portu)', meta.powerMaxW === 45 && meta.sourceUrl === 'https://example.com/karta' && meta.hardwareRevision === 'rev B' && meta.sourceGenerated === true && meta.group === 'SDI wejścia' && meta.sigs === 3 && meta.el?.voltageMinV === 5 && meta.el?.voltageMaxV === 12 && meta.el?.maxW === 15.4, meta);
await page.click('#p-edit'); await page.waitForSelector('#defdialog'); await page.click('#d-more summary');
check('okno pokazuje zapisane wartości przy ponownym otwarciu', (await page.inputValue('#m-powermax')) === '45' && (await page.inputValue('#m-hwrev')) === 'rev B' && (await page.isChecked('#m-generated')) && (await page.inputValue('#defdialog .prow:nth-child(1) .f-grp')) === 'SDI wejścia');
await page.fill('#m-powermax', '5'); await page.click('#d-save');
check('moc maksymalna mniejsza od typowej: odrzucone, okno zostaje', (await page.isVisible('#defdialog')) && (await page.textContent('#msg')).includes('mniejszy'), await page.textContent('#msg'));
check('okno pokazuje napięcia portu i usuwanie dodatkowego sygnału działa', (await page.inputValue('#defdialog .prow:nth-child(1) .f-umax')) === '12');
await page.selectOption('#defdialog .prow:nth-child(1) .f-sigx >> nth=1', ''); check('wybór „usuń sygnał” zdejmuje sygnał', (await page.$$eval('#defdialog .prow:nth-child(1) .f-sigx', (x) => x.length)) === 1);
await page.fill('#defdialog .prow:nth-child(1) .f-umin', '50'); await page.fill('#m-powermax', '60'); await page.click('#d-save');
check('napięcie minimalne większe od maksymalnego: odrzucone', (await page.isVisible('#defdialog')) && (await page.textContent('#msg')).includes('minimalne większe'), await page.textContent('#msg'));
await page.click('#d-cancel');
await page.screenshot({ path: path.join(process.env.TEMP, 'sw-definicja.png') });
await browser.close(); await server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
