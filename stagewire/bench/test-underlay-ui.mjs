// Test: podkład z pliku (DXF ze znaną skalą, PDF ze skalą rysunku, PNG/SVG wyskalowany dwoma punktami), wyprostowanie, przesuwanie, DWG odrzucony, rysowanie sali na podkładzie. Zrzuty ekranu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { PDFDocument, rgb } from 'pdf-lib';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SHOTS || process.env.TEMP || '.';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-under-'));
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5224, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('KONSOLA', m.text().slice(0, 160)); });
await page.goto('http://localhost:5224/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const E = (fn, arg) => page.evaluate(fn, arg);
const under = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state.underlays ?? {})));
const state = () => E(() => JSON.parse(JSON.stringify(window.__editor.store.state)));
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');

// pliki testowe
const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n40\n20\n0\n10\n40\n20\n20\n10\n0\n20\n20\n0\nLINE\n10\n15\n20\n0\n11\n15\n21\n20\n0\nLINE\n10\n0\n20\n8\n11\n15\n21\n8\n0\nCIRCLE\n10\n30\n20\n10\n40\n4\n0\nENDSEC\n0\nEOF\n`;
fs.writeFileSync(path.join(tmp, 'budynek.dxf'), dxf);
fs.writeFileSync(path.join(tmp, 'rysunek.dwg'), Buffer.from('AC1027binary'));
fs.writeFileSync(path.join(tmp, 'zly.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
fs.writeFileSync(path.join(tmp, 'rzut.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect x="10" y="10" width="780" height="380" fill="none" stroke="black" stroke-width="4"/><line x1="300" y1="10" x2="300" y2="390" stroke="black" stroke-width="3"/></svg>');
const pdfDoc = await PDFDocument.create(); const pg = pdfDoc.addPage([841.89, 595.28]); pg.drawRectangle({ x: 40, y: 40, width: 760, height: 500, borderColor: rgb(0, 0, 0), borderWidth: 2 }); pg.drawLine({ start: { x: 300, y: 40 }, end: { x: 300, y: 540 }, thickness: 2 });
fs.writeFileSync(path.join(tmp, 'rzut.pdf'), await pdfDoc.save());
const pngUrl = await E(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 500); g.strokeStyle = '#000'; g.lineWidth = 6; g.strokeRect(20, 20, 960, 460); g.beginPath(); g.moveTo(100, 250); g.lineTo(600, 250); g.stroke(); return c.toDataURL('image/png'); });
fs.writeFileSync(path.join(tmp, 'skan.png'), Buffer.from(pngUrl.split(',')[1], 'base64'));

const importFile = async (name, extra = {}) => {
  await page.click('#b-under'); await page.waitForSelector('#underdialog');
  await page.setInputFiles('#u-file', path.join(tmp, name));
  if (extra.den) await page.fill('#u-den', String(extra.den));
  await page.click('#u-import');
  if (extra.expectError) { await page.waitForFunction(() => document.querySelector('#u-info .warn')); return await page.textContent('#u-info'); }
  await page.waitForSelector('#underdialog', { state: 'detached', timeout: 30000 });
};

await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
// DWG i SVG ze skryptem są odrzucane
console.log(await E(() => { const b = document.getElementById('b-under'); const r = b.getBoundingClientRect(); return JSON.stringify([r.x, r.y, r.width, r.height, document.getElementById('planbar').style.display, getComputedStyle(document.getElementById('planbar')).display, document.elementFromPoint(r.x + 5, r.y + 5)?.id]); }));
let msg = await importFile('rysunek.dwg', { expectError: true }); check('DWG jest odrzucony z podpowiedzią (zapisz jako DXF/PDF)', msg.includes('DXF'), msg.slice(0, 80)); await page.click('#u-close');
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.setInputFiles('#u-file', path.join(tmp, 'zly.svg')); await page.click('#u-import'); await page.waitForFunction(() => document.querySelector('#u-info .warn'));
check('SVG ze skryptem jest odrzucony', (await page.textContent('#u-info')).includes('skrypt')); await page.click('#u-close');
check('odrzucone pliki nie dodały podkładów', Object.keys(await under()).length === 0);

// DXF: skala znana z jednostek (m)
await importFile('budynek.dxf');
let un = Object.values(await under()); const dx = un[0];
check('DXF: podkład ze znaną skalą, szerokość ≈ 40 m, wysokość ≈ 20 m, bez odwracania kolorów', dx.kind === 'dxf' && dx.scaleKnown && Math.abs(dx.widthPx * dx.mmPerPx - 40000) < 400 && Math.abs(dx.heightPx * dx.mmPerPx - 20000) < 400 && !dx.invert, [dx.widthPx * dx.mmPerPx, dx.heightPx * dx.mmPerPx]);
check('DXF: obraz w projekcie jako data URL PNG', dx.image.startsWith('data:image/png;base64,'));
await page.screenshot({ path: path.join(out, 'sw-podklad-1-dxf.png') });

// rysowanie sali na podkładzie (prostokąt 15–40 m × 0–20 m = prawa część budynku)
await page.click('#b-addroom'); await page.waitForSelector('#spacedialog'); await page.fill('#s-name', 'Sala widowiskowa'); await page.selectOption('#s-shape', 'poly'); await page.click('#s-draw');
for (const [x, y] of [[15000, 0], [40000, 0], [40000, 20000], [15000, 20000]]) { const [sx, sy] = await E(([x, y]) => window.__editor.plan.toScreen(x, y), [x, y]); await page.mouse.click(sx, sy); }
await page.keyboard.press('Enter');
let st = await state(); const room = Object.values(st.spaces)[0];
check('sala narysowana na podkładzie leży w jego współrzędnych (początek 15 m × 0 m, wymiary ≈ 25 × 20 m)', Math.abs(room.origin[0] - 15000) <= 200 && Math.abs(room.origin[1]) <= 200 && Math.abs(room.boundary[1][0] - 25000) <= 300 && Math.abs(room.boundary[2][1] - 20000) <= 300, [room.origin, room.boundary]);
await E(() => window.__editor.plan.fitAll()); await page.click('#b-fitall');
await page.screenshot({ path: path.join(out, 'sw-podklad-2-sala-na-dxf.png') });

// PDF ze skalą rysunku 1:100 (A4 poziomo 297 mm → 29,7 m)
await importFile('rzut.pdf', { den: 100 });
un = Object.entries(await under()); const pdfU = un.find(([, v]) => v.kind === 'pdf')?.[1];
check('PDF: skala z 1:100, szerokość ≈ 29,7 m (A4 poziomo)', !!pdfU && pdfU.scaleKnown && Math.abs(pdfU.widthPx * pdfU.mmPerPx - 29700) < 300, pdfU && pdfU.widthPx * pdfU.mmPerPx);

// PNG: skala nieznana → wyskalowanie dwoma punktami: odcinek (100,250)-(600,250) px ma 25 m → 50 mm/px
await importFile('skan.png');
let [pid, pngU] = Object.entries(await under()).find(([, v]) => v.kind === 'image');
check('obraz: skala nieznana, invert włączony', !pngU.scaleKnown && pngU.invert);
await page.click('#b-under'); await page.waitForSelector('#underdialog');
const card = page.locator(`.uc[data-id="${pid}"]`); await card.locator('.u-scale').click(); await page.waitForSelector('#underdialog', { state: 'detached' });
const S = (px, py) => E(([pid, px, py, uu]) => { return import(uu).then((m) => { const un = window.__editor.store.state.underlays[pid], w = m.imageToWorld(un, px, py), a = window.__editor.plan.debug(); const sid = window.__editor.plan.spaceId(); const o = window.__editor.store.state.spaces[sid].origin ?? [0, 0]; return window.__editor.plan.toScreen(w[0] - o[0], w[1] - o[1]); }); }, [pid, px, py, u('underlay.ts')]);
await E((pid) => window.__editor.plan.fitAll(), pid);
// kamera na obrazie: użyj „Pokaż na planie”
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-show`).click();
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-scale`).click();
const p1 = await S(100, 250), p2 = await S(600, 250); await page.mouse.click(p1[0], p1[1]); await page.mouse.move(p2[0], p2[1], { steps: 4 }); await page.mouse.click(p2[0], p2[1]);
await page.waitForSelector('#pickdialog'); await page.fill('#pk-len', '25'); await page.click('#pk-ok');
pngU = (await under())[pid]; check('wyskalowanie dwoma punktami: 500 px = 25 m → 50 mm/px', Math.abs(pngU.mmPerPx - 50) < 0.5 && pngU.scaleKnown, pngU.mmPerPx);
await page.screenshot({ path: path.join(out, 'sw-podklad-3-skala.png') });

// wyprostowanie: obrót o 10°, potem „Wyprostuj” po odcinku poziomym
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-rot`).fill('10'); await page.locator(`.uc[data-id="${pid}"] .u-rot`).press('Enter'); await page.locator(`.uc[data-id="${pid}"] .u-show`).click();
check('obrót podkładu ustawiony na 10°', (await under())[pid].rotationDeg === 10);
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-level`).click();
const q1 = await S(100, 250), q2 = await S(600, 250); await page.mouse.click(q1[0], q1[1]); await page.mouse.click(q2[0], q2[1]);
check('„Wyprostuj” sprowadza odcinek do poziomu (obrót ≈ 0°)', Math.abs((await under())[pid].rotationDeg) < 0.2, (await under())[pid].rotationDeg);

// przesuwanie myszą
const before = (await under())[pid]; await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-move`).click();
await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(760, 440, { steps: 5 }); await page.mouse.up();
const after = (await under())[pid]; check('przeciągnięcie przesuwa podkład (X rośnie, Y maleje)', after.x > before.x && after.y < before.y, [before.x, after.x, before.y, after.y]);
// ukrycie, blokada
await page.click('#b-under'); await page.waitForSelector('#underdialog'); await page.locator(`.uc[data-id="${pid}"] .u-lock`).check();
check('zablokowany podkład ma wyłączone narzędzia przesuwania', await page.locator(`.uc[data-id="${pid}"] .u-move`).isDisabled());
await page.locator(`.uc[data-id="${pid}"] .u-vis`).uncheck(); check('ukrycie podkładu zapisuje się w modelu', (await under())[pid].visible === false);
await page.locator(`.uc[data-id="${pid}"] .u-del`).click(); check('usunięcie podkładu', !(await under())[pid]);
// cofanie
await page.click('#u-close'); await E(() => window.__editor.store.undo()); check('cofnięcie przywraca usunięty podkład', !!(await under())[pid]);
await browser.close(); await server.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
