import { syntheticProject } from '../src/synthetic.ts';
import { planDrawList, diagramDrawList, gridLayout, bboxOf, type DrawList } from '../src/render/drawlist.ts';
import { CanvasBackend } from './canvasBackend.ts';
import { SvgBackend } from './svgBackend.ts';
import type { Backend, Camera } from './types.ts';

const q = new URLSearchParams(location.search);
const backendName = q.get('backend') ?? 'canvas';
const view = (q.get('view') ?? 'plan') as 'plan' | 'diagram';
const devices = Number(q.get('devices') ?? 1000);
const scenario = q.get('scenario') ?? 'pan';
const W = 1366, H = 768; // wymiar projektowy laptopa (UX-WORKFLOWS §2.1)
const DURATION_MS = Number(q.get('ms') ?? 4000);

const ms = () => performance.now();
const out: Record<string, unknown> = { backend: backendName, view, devices, scenario };

async function main() {
  const host = document.getElementById('stage')!;
  // model syntetyczny „lokalny”: połączenia między sąsiadami (jak w prawdziwych projektach)
  let t = ms();
  const p = syntheticProject(devices, Math.round(devices * 2.5), 1, true);
  out.modelMs = round(ms() - t);

  t = ms();
  const dl: DrawList = view === 'plan' ? planDrawList(p, { cables: true }) : diagramDrawList(p, gridLayout(p));
  out.drawListMs = round(ms() - t);
  out.prims = dl.prims.length;
  out.edges = dl.prims.filter((x) => x.t === 'line').length;

  const backend: Backend = backendName === 'canvas' ? new CanvasBackend(host, W, H) : new SvgBackend(host, W, H, backendName === 'svg-culled');
  t = ms();
  backend.load(dl);
  out.loadMs = round(ms() - t);

  // kamera dopasowana do zawartości
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pr of dl.prims) { const b = bboxOf(pr); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const zFit = Math.min(W / bw, H / bh) * 0.92, zMax = zFit * 20;
  const flipY = dl.unit === 'mm';
  const cam: Camera = { x: cx, y: cy, zoom: zFit, flipY };

  t = ms();
  backend.render(cam);
  await nextFrame();
  out.firstRenderMs = round(ms() - t);

  const frames: number[] = [], js: number[] = [], drawn: number[] = [];
  let dragIdx: number[] = [];
  if (scenario === 'drag') {
    dragIdx = dl.prims.map((pr, i) => (pr.t === 'rect' ? i : -1)).filter((i) => i >= 0).slice(0, 100);
    out.dragged = dragIdx.length;
    cam.zoom = zFit * 4; // średnie przybliżenie
  }

  const start = ms();
  let last = start, frame = 0, dir = 1;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const el = now - start;
      if (frame > 0) frames.push(now - last);
      last = now; frame++;
      if (scenario === 'pan') {
        const ph = (el / DURATION_MS) * Math.PI * 2;
        const k = (1 - Math.cos(ph)) / 2;
        cam.zoom = Math.exp(Math.log(zFit) + (Math.log(zMax) - Math.log(zFit)) * k);
        cam.x = cx + Math.sin(ph) * bw * 0.35 * (1 - k * 0.6);
        cam.y = cy + Math.cos(ph * 0.7) * bh * 0.35 * (1 - k * 0.6);
      }
      const j0 = ms();
      if (scenario === 'drag') { backend.move(dragIdx, 2 * dir / cam.zoom * 0.5, 1 * dir / cam.zoom * 0.5); if (frame % 60 === 0) dir = -dir; }
      backend.render(cam);
      js.push(ms() - j0); drawn.push(backend.drawn);
      if (el < DURATION_MS || frame < 8) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });

  const sorted = [...frames].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  out.frames = frames.length;
  out.fpsMedian = round(1000 / med);
  out.p95FrameMs = round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  out.maxFrameMs = round(sorted[sorted.length - 1] ?? 0);
  out.avgJsMs = round(js.reduce((a, b) => a + b, 0) / js.length);
  out.maxJsMs = round(Math.max(...js));
  out.drawnAvg = Math.round(drawn.reduce((a, b) => a + b, 0) / drawn.length);

  // hit-test (tylko canvas: R-drzewo); w SVG trafienia daje przeglądarka (elementFromPoint)
  if (backendName === 'canvas' && scenario === 'pan') {
    const idx = (backend as CanvasBackend).index();
    t = ms(); let hits = 0;
    for (let i = 0; i < 2000; i++) { if (idx.hit(x0 + Math.random() * bw, y0 + Math.random() * bh, 20 / zFit) >= 0) hits++; }
    out.hit2000Ms = round(ms() - t); out.hitFound = hits;
  } else if (backendName !== 'canvas' && scenario === 'pan') {
    t = ms(); for (let i = 0; i < 2000; i++) document.elementFromPoint(Math.random() * W, Math.random() * H); out.hit2000Ms = round(ms() - t);
  }
  (window as any).__result = out;
}

const round = (n: number) => Math.round(n * 10) / 10;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
main().catch((e) => { (window as any).__result = { ...out, error: String(e?.stack ?? e) }; });
