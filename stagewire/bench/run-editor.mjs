// Pomiar gestu „port → port” w prawdziwej przeglądarce (Edge z okienkiem). Prawdziwe zdarzenia myszy z Playwright.
// Uruchom: node bench/run-editor.mjs [--sizes=200,1000,2000] [--cpu=4]. Nie dotykaj myszy podczas pomiaru.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const sizes = (args.sizes ?? '200,1000,2000').split(',').map(Number);
const cpu = Number(args.cpu ?? 1);
const channel = args.channel ?? 'msedge';

const server = await createServer({ root: path.join(root, 'web'), configFile: false, logLevel: 'error', server: { port: 5198, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch({ channel, headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1400,900'] });
const stats = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); const r = (n) => Math.round(n * 100) / 100; return { n: s.length, median: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s.at(-1)) }; };
const results = [];

for (const size of sizes) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  page.on('pageerror', (e) => console.log('BŁĄD STRONY', String(e).slice(0, 200)));
  await page.goto(`http://localhost:5198/editor.html?devices=${size}&magnet=${args.magnet ?? 1}`);
  await page.waitForFunction(() => window.__editor?.ready);
  const ids = await page.evaluate(() => Object.keys(window.__editor.nodes()));
  const cols = Math.ceil(Math.sqrt(size));
  const out = { devices: size, cpu, scenarios: {} };

  // pary (źródło, odbiornik) sąsiadujące w siatce i NIEpołączone (połączenia lokalne zajmują początek listy)
  const free = [];
  for (let j = Math.ceil(size * 0.3125) + 2; free.length < 60 && 2 * j + 1 < size; j++) if ((2 * j) % cols !== cols - 1) free.push([ids[2 * j], ids[2 * j + 1]]);
  const clear = () => page.evaluate(() => { for (const k in window.__editor.metrics) window.__editor.metrics[k].length = 0; });
  const metrics = (k) => page.evaluate((k) => [...window.__editor.metrics[k]], k);
  const counts = () => page.evaluate(() => window.__editor.counts());
  const look = (a, b, zoom) => page.evaluate(([a, b, zoom]) => {
    const n = window.__editor.nodes(); window.__editor.look((n[a].x + n[b].x) / 2 + 85, (n[a].y + n[b].y) / 2 + 60, zoom);
  }, [a, b, zoom]);
  const port = (iid, pid) => page.evaluate(([i, p]) => window.__editor.portScreen(i, p), [iid, pid]);
  const drag = async ([x1, y1], [x2, y2], steps = 14) => {
    await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps }); await page.mouse.up();
  };
  const undo = async () => { await page.keyboard.press('Control+z'); };
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // A. połączenie wolnego wyjścia z wolnym wejściem, zoom 1, 30 powtórzeń (z cofnięciem)
  await clear();
  let okCount = 0;
  for (let k = 0; k < 30; k++) {
    const [s, d] = free[k % free.length], pi = 5 + (k % 3);
    await look(s, d, 1);
    const a = await port(s, `prt_out${pi}`), b = await port(d, `prt_in${pi}`);
    const c0 = (await counts()).connections;
    await drag(a, b); await settle();
    const c1 = await counts();
    const last = await page.evaluate(() => { const c = window.__editor.store.state.connections; const k = Object.keys(c).at(-1); return c[k]; });
    if (c1.connections === c0 + 1 && last.from.instanceId === s && last.from.portId === `prt_out${pi}` && last.to.instanceId === d && last.to.portId === `prt_in${pi}`) okCount++;
    await undo(); await settle();
  }
  out.scenarios.A_drag_connect = { attempts: 30, correct: okCount, move: stats(await metrics('move')), gestureStart: stats(await metrics('gestureStart')), commit: stats(await metrics('commit')), commitToFrame: stats(await metrics('commitToFrame')), rebuild: stats(await metrics('rebuild')), validate: stats(await metrics('validate')) };

  // B. trafność trafienia przy różnych zoomach, rozrzut ±5 px na obu końcach
  out.scenarios.B_hit_by_zoom = {};
  for (const zoom of [0.4, 0.6, 0.8, 1, 1.5, 2]) {
    let okB = 0; const N = 30;
    for (let k = 0; k < N; k++) {
      const [s, d] = free[k % free.length], pi = 5 + (k % 3);
      await look(s, d, zoom);
      const a = await port(s, `prt_out${pi}`), b = await port(d, `prt_in${pi}`);
      const j = () => (Math.random() * 10 - 5);
      const c0 = (await counts()).connections;
      await drag([a[0] + j(), a[1] + j()], [b[0] + j(), b[1] + j()]); await settle();
      const last = await page.evaluate(() => { const c = window.__editor.store.state.connections; return c[Object.keys(c).at(-1)]; });
      if ((await counts()).connections === c0 + 1 && last.from.portId === `prt_out${pi}` && last.to.portId === `prt_in${pi}` && last.from.instanceId === s && last.to.instanceId === d) okB++;
      else if ((await counts()).connections === c0 + 1) {} // połączono zły port
      if ((await counts()).connections === c0 + 1) await undo();
      await settle();
    }
    out.scenarios.B_hit_by_zoom[zoom] = { rowPx: Math.round(16 * zoom * 10) / 10, correct: okB, of: N };
  }

  // C. upuszczenie na korpus urządzenia (auto-wybór portu) i D. port zajęty (uwaga zamiast blokady)
  {
    const [s, d] = free[0]; await look(s, d, 1);
    const a = await port(s, 'prt_out5');
    const body = await page.evaluate((d) => window.__editor.nodeScreen(d).body, d);
    await drag(a, body); await settle();
    const c = await page.evaluate(() => { const cs = window.__editor.store.state.connections; return cs[Object.keys(cs).at(-1)]; });
    out.scenarios.C_drop_on_body = { toPort: c?.to?.portId, expected: 'prt_in0 (pierwszy wolny)' };
    const i0 = await page.evaluate(() => window.__editor.issues());
    const a2 = await port(s, 'prt_out6'), occupied = await port(d, c.to.portId);
    await drag(a2, occupied); await settle();
    const i1 = await page.evaluate(() => window.__editor.issues());
    out.scenarios.D_occupied_port = { connectionsNow: (await counts()).connections, issuesBefore: i0, issuesAfter: i1, message: await page.textContent('#msg') };
    await undo(); await undo(); await settle();
  }

  // E. „klik, klik” zamiast przeciągania
  {
    const [s, d] = free[1]; await look(s, d, 1);
    const a = await port(s, 'prt_out7'), b = await port(d, 'prt_in7');
    const c0 = (await counts()).connections;
    await page.mouse.click(a[0], a[1]); await page.mouse.click(b[0], b[1]); await settle();
    out.scenarios.E_click_click = { connected: (await counts()).connections === c0 + 1 };
    await undo(); await settle();
  }

  // F. przeciąganie węzła (krawędzie podążają za nim), 80 ruchów
  {
    await clear();
    const [s, d] = free[2]; await look(s, d, 1);
    const hd = await page.evaluate((s) => window.__editor.nodeScreen(s).header, s);
    await page.mouse.move(hd[0], hd[1]); await page.mouse.down();
    for (let k = 0; k < 80; k++) { await page.mouse.move(hd[0] + k * 2, hd[1] + k, { steps: 1 }); }
    await page.mouse.up(); await settle();
    out.scenarios.F_node_drag = { frame: stats(await metrics('nodeDragFrame')), rebuild: stats(await metrics('rebuild')) };
  }

  // G. zaznaczenie kabla i usunięcie, cofnięcie
  {
    const [s, d] = free[3]; await look(s, d, 1);
    const a = await port(s, 'prt_out5'), b = await port(d, 'prt_in5');
    await drag(a, b); await settle();
    const cid = await page.evaluate(() => Object.keys(window.__editor.store.state.connections).at(-1));
    const mid = await page.evaluate((id) => window.__editor.edgeMid(id), cid);
    const c0 = (await counts()).connections;
    await page.mouse.click(mid[0], mid[1]); await page.keyboard.press('Delete'); await settle();
    const c1 = (await counts()).connections;
    await undo(); await settle();
    const c2 = (await counts()).connections;
    out.scenarios.G_select_delete_undo = { before: c0, afterDelete: c1, afterUndo: c2, ok: c1 === c0 - 1 && c2 === c0 };
    await undo(); await settle();
  }

  results.push(out);
  const A = out.scenarios.A_drag_connect;
  console.log(`\n=== ${size} urządzeń, CPU×${cpu} ===`);
  console.log(`A  poprawnych połączeń: ${A.correct}/${A.attempts}`);
  console.log(`   ruch (obsługa pointermove) mediana ${A.move?.median} ms, p95 ${A.move?.p95} ms, max ${A.move?.max} ms`);
  console.log(`   start gestu (statusy portów) ${A.gestureStart?.median} ms; zatwierdzenie ${A.commit?.median} ms (p95 ${A.commit?.p95}); do klatki ${A.commitToFrame?.median} ms (p95 ${A.commitToFrame?.p95}); walidacja ${A.validate?.median} ms`);
  console.log('B  trafność wg zoomu: ' + Object.entries(out.scenarios.B_hit_by_zoom).map(([z, v]) => `${z}→${v.correct}/${v.of} (rząd ${v.rowPx}px)`).join(' · '));
  console.log('C ', JSON.stringify(out.scenarios.C_drop_on_body), '\nD ', JSON.stringify(out.scenarios.D_occupied_port));
  console.log('E ', JSON.stringify(out.scenarios.E_click_click), '\nF  klatka przeciągania węzła', JSON.stringify(out.scenarios.F_node_drag.frame), '\nG ', JSON.stringify(out.scenarios.G_select_delete_undo));
  await ctx.close();
}
const version = browser.version();
await browser.close(); await server.close();
fs.mkdirSync(path.join(root, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'bench/results', `poc3b-editor-cpu${cpu}-magnet${args.magnet ?? 1}.json`), JSON.stringify({ browser: `${channel} ${version}`, results }, null, 2));
