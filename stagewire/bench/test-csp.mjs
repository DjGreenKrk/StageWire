// Test polityki CSP (ADR-054): front z dist-web serwowany z nagłówkiem CSP z tauri.conf.json; zbieramy naruszenia podczas typowych czynności.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-web');
const csp = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp;
if (!csp || typeof csp !== 'string') { console.log('FAIL brak polityki CSP w tauri.conf.json'); process.exit(1); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]); const f = path.join(dist, url === '/' ? 'editor.html' : url);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nie ma'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Content-Security-Policy': csp }); fs.createReadStream(f).pipe(res);
}).listen(5230);
const checks = []; const check = (n, ok, i) => { checks.push({ name: n, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${i !== undefined ? ' — ' + JSON.stringify(i) : ''}`); };
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const violations = [], errors = [];
page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push(t.slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
await page.goto('http://localhost:5230/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
check('aplikacja startuje pod CSP', true);
// typowe czynności: katalog, schemat, plan, rack, szafa, 3D, okno definicji, PDF
const addAt = async (key, x, y) => { await page.evaluate(([x, y]) => window.__editor.look(x, y, 1), [x, y]); await page.click(`#cat-list button[data-cat="${key}"]`); };
await addAt('camera_sdi', 0, 40); await addAt('video_switcher', 420, 120);
const mix = await page.evaluate(() => Object.keys(window.__editor.nodes())[1]);
const hd = await page.evaluate((i) => window.__editor.nodeScreen(i).header, mix); await page.mouse.click(hd[0], hd[1]);
await page.click('#p-edit'); await page.waitForSelector('#defdialog'); await page.click('#d-more summary'); await page.click('#d-cancel');
await page.click('#b-mode'); await page.waitForSelector('#plan', { state: 'visible' });
await page.click('#b-space'); await page.waitForSelector('#spacedialog'); await page.click('#s-save');
await page.click('#b-3d'); await page.waitForSelector('#view3d', { state: 'visible' }); await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 430, { steps: 4 }); await page.mouse.up(); await page.click('#b-3d');
// PDF planu i schematu: generowane w przeglądarce (pdf-lib + czcionki z pakietu)
const pdf = await page.evaluate(async () => { try { const r = await window.__editor.plan.buildPdf('A3', undefined, true); return { ok: r.bytes.length > 1000 }; } catch (e) { return { err: String(e) }; } });
check('PDF planu generuje się pod CSP (czcionki z własnego źródła)', pdf.ok === true, pdf);
await page.click('#b-mode'); await page.click('#b-rack'); await page.click('#rk-new'); await page.waitForSelector('#rackdialog'); await page.click('#rf-ok'); await page.click('#b-rack');
await page.click('#b-cab'); await page.click('#cb-new'); await page.waitForSelector('#cabdialog'); await page.click('#cf-ok'); await page.click('#b-cab');
await page.waitForTimeout(300);
const inPage = await page.evaluate(() => window.__csp);
check('brak naruszeń CSP (zdarzenia securitypolicyviolation)', inPage.length === 0, inPage);
check('brak komunikatów konsoli o blokadach CSP', violations.length === 0, violations);
check('brak błędów strony podczas przejścia', errors.length === 0, errors);
// polityka rzeczywiście działa: wstrzyknięty inline-skrypt i zewnętrzny zasób są blokowane
const blocked = await page.evaluate(async () => {
  const r = { inline: 'wykonano', external: 'załadowano' };
  const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.appendChild(s); r.inline = (window).__x === 1 ? 'wykonano' : 'zablokowano';
  try { await fetch('https://example.com/', { mode: 'no-cors' }); r.external = 'załadowano'; } catch { r.external = 'zablokowano'; }
  return r;
});
check('polityka blokuje wstrzyknięty skrypt inline i połączenia z zewnętrznymi adresami', blocked.inline === 'zablokowano' && blocked.external === 'zablokowano', blocked);
await browser.close(); server.close();
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} kontroli`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
