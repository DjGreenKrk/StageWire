import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { stageCmd } from '../src/stage.ts';
import { planDrawList, diagramDrawList, gridLayout, signalColor, signalLegend, setSignalColors, SIGNAL_FAMILY_DEFAULTS } from '../src/render/drawlist.ts';
import { planPdf } from '../src/planPdf.ts';
import { diagramPdf } from '../src/diagramPdf.ts';
import { syntheticProject } from '../src/synthetic.ts';

const font = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource/roboto/files/${f}`, import.meta.url))));
const fonts = { latin: font('roboto-latin-400-normal.woff'), latinExt: font('roboto-latin-ext-400-normal.woff') };
const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  s.dispatch('a', addFromCatalog('camera_sdi', 'Kamera', 'eqi_k')); s.dispatch('b', addFromCatalog('video_switcher', 'Mikser', 'eqi_m'));
  s.dispatch('c', cmd.connect({ instanceId: 'eqi_k', portId: 'prt_sdiout' }, { instanceId: 'eqi_m', portId: 'prt_sdiin1' }, 'std/sdi-3g'));
  s.dispatch('s', plan.addSpace('spc_a', 'Sala', 20000, 12000));
  s.dispatch('p', plan.place('eqi_k', 'spc_a', 5000, 5000));            // urządzenie dodane PRZED bryłą
  s.dispatch('o', stageCmd.addObject('sob_s', { name: 'Podest', widthMm: 6000, depthMm: 4000, heightMm: 500 })); s.dispatch('q', plan.placeRack('sob_s', 'spc_a', 5000, 5000));
  return s;
};

describe('kolory kabli, kolejność rysowania, kolorowy PDF', () => {
  it('kolor wg rodziny sygnału; własny kolor z ustawień nadpisuje domyślny', () => {
    expect(signalColor('std/sdi-3g')).not.toBe(signalColor('std/hdmi')); expect(signalColor('std/ethernet')).not.toBe(signalColor('std/dmx'));
    expect(signalColor('std/czegos-nowego')).toBe(SIGNAL_FAMILY_DEFAULTS.at(-1)!.color);
    setSignalColors({ 'Wideo SDI / IP': '#ff0000' }); expect(signalColor('std/sdi-12g')).toBe('#ff0000'); setSignalColors({}); expect(signalColor('std/sdi-12g')).not.toBe('#ff0000');
    const s = mk(); expect(signalLegend(s.state).map((x) => x.label)).toEqual(['Wideo SDI / IP']);
    const v = gridLayout(s.state); expect(diagramDrawList(s.state, v).prims.find((x) => x.t === 'line')!.t === 'line' && (diagramDrawList(s.state, v).prims.find((x) => x.t === 'line') as any).stroke).toBe(signalColor('std/sdi-3g'));
  });
  it('bryła rysowana pod urządzeniem, także gdy urządzenie dodano wcześniej', () => {
    const rects = planDrawList(mk().state, { spaceId: 'spc_a' }).prims.filter((p) => p.t === 'rect').map((p) => p.id);
    expect(rects.indexOf('sob_s')).toBeLessThan(rects.indexOf('eqi_k'));
  });
  it('PDF kolorowy planu i schematu generuje się; jest większy od czarno-białego (kolory) i ma legendę', async () => {
    const s = mk();
    const a = await planPdf(s.state, { paper: 'A3', cables: true, fonts, projectName: 'K' }), b = await planPdf(s.state, { paper: 'A3', cables: true, color: true, fonts, projectName: 'K' });
    expect(b.bytes.length).toBeGreaterThan(a.bytes.length);
    const pt = (await (await (await pdfjs.getDocument({ data: b.bytes.slice(), useSystemFonts: false }).promise).getPage(1)).getTextContent()).items.map((i: any) => i.str).join('').replace(/\s+/g, '');
    expect(pt).toContain('Kable:'); expect(pt).toContain('WideoSDI');
    const d = await diagramPdf(s.state, gridLayout(s.state), { fonts, projectName: 'K', color: true });
    const doc = await pdfjs.getDocument({ data: d.bytes.slice(), useSystemFonts: false }).promise, t = (await (await doc.getPage(1)).getTextContent()).items.map((i: any) => i.str).join('').replace(/\s+/g, '');
    expect(t).toContain('WideoSDI');
  });
});
