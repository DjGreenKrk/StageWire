// Benchmark rendererów w prawdziwej przeglądarce (Edge z okienkiem, żeby użyć GPU). Uruchom: node bench/run-browser.mjs
// Nie dotykaj myszy/klawiatury ani nie zasłaniaj okna podczas pomiaru (przeglądarka ogranicza renderowanie w tle).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const channel = args.channel ?? 'msedge';
const sizes = (args.sizes ?? '200,1000,2000').split(',').map(Number);
const backends = (args.backends ?? 'canvas,svg-naive,svg-culled').split(',');
const views = (args.views ?? 'plan,diagram').split(',');
const scenarios = (args.scenarios ?? 'pan,drag').split(',');
const ms = args.ms ?? 4000;
const throttle = Number(args.cpu ?? 1); // CDP: spowolnienie CPU (np. 4 = 4x wolniej) do symulacji starszego sprzętu

const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5199, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({
  channel, headless: false,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1400,900'],
});
const version = browser.version();
const results = [];
for (const view of views) for (const size of sizes) for (const scenario of scenarios) for (const backend of backends) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (throttle > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  const url = `http://localhost:5199/?backend=${backend}&view=${view}&devices=${size}&scenario=${scenario}&ms=${ms}`;
  let r;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
    r = await page.evaluate(() => window.__result);
  } catch (e) { r = { backend, view, devices: size, scenario, error: 'timeout/błąd: ' + String(e).slice(0, 120) }; }
  results.push(r);
  console.log(`${view.padEnd(7)} ${String(size).padStart(5)} ${scenario.padEnd(5)} ${backend.padEnd(11)} ` +
    (r.error ? 'BŁĄD ' + r.error.slice(0, 100) : `prims=${r.prims} load=${r.loadMs}ms fps=${r.fpsMedian} p95=${r.p95FrameMs}ms js=${r.avgJsMs}ms drawn=${r.drawnAvg}`));
  await ctx.close();
}
await browser.close();
await server.close();
fs.mkdirSync(path.join(root, 'bench/results'), { recursive: true });
const file = path.join(root, 'bench/results', `poc2-${channel}-cpu${throttle}.json`);
fs.writeFileSync(file, JSON.stringify({ browser: `${channel} ${version}`, cpuThrottle: throttle, viewport: '1366x768', date: new Date().toISOString(), results }, null, 2));
console.log('\nZapisano ' + file);
