// Test wydajności: podkład 8k (8192 × 5120) – czas klatki planu przy oddaleniu i przybliżeniu.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5231, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1400,900'] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
await page.goto('http://localhost:5231/editor.html?new=1'); await page.waitForFunction(() => window.__editor?.ready);
const u = (f) => '/@fs/' + path.join(root, 'src', f).split(path.sep).join('/');
const res = await page.evaluate(async (uurl) => {
  const { underlayCmd } = await import(uurl);
  const c = document.createElement('canvas'); c.width = 8192; c.height = 5120; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000'; g.lineWidth = 3;
  for (let i = 0; i < 4000; i++) { g.beginPath(); g.moveTo(Math.random() * 8192, Math.random() * 5120); g.lineTo(Math.random() * 8192, Math.random() * 5120); g.stroke(); }
  const image = c.toDataURL('image/jpeg', 0.7);
  const E = window.__editor; E.plan.show();
  E.store.dispatch('podkład', underlayCmd.add('und_perf', { name: 'duży', kind: 'image', image, mime: 'image/jpeg', widthPx: 8192, heightPx: 5120, x: 0, y: 0, mmPerPx: 5, rotationDeg: 0, opacity: 0.8, invert: true, visible: true, locked: false, scaleKnown: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const t = async (label, n = 30) => { await raf(); const t0 = performance.now(); for (let i = 0; i < n; i++) { document.getElementById('b-fitall').click(); await raf(); } return { label, msPerFrame: Math.round((performance.now() - t0) / n * 10) / 10 }; };
  const out = [await t('z mipmapami'), await t('z mipmapami')];
  window.__noMip = true; out.push(await t('BEZ mipmap (stary sposób)'));
  return { out, kb: Math.round(image.length / 1024) };
}, u('underlay.ts'));
console.log(JSON.stringify(res, null, 1));
await browser.close(); await server.close();
