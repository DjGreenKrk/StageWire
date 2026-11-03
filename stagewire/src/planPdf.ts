import type { Project } from './types.ts';
import { planDrawList, signalLegend, type DrawList, type Prim } from './render/drawlist.ts';
import { exportPlanPdf, type PdfFonts } from './render/pdfExport.ts';
import { spaceSize, inPlacedHolder, effectivePosition, rackFootprint } from './plan.ts';

/** Papier poziomy, mm. */
export const PAPERS: Record<string, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
export const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
const MARGIN = 10, TITLE_H = 24; // mm: margines i miejsce na tabliczkę u góry

export interface PlanPdfOptions { spaceId?: string; paper: keyof typeof PAPERS | string; scale?: number; cables: boolean; /** kolorowy eksport */ color?: boolean; fonts: PdfFonts; projectName: string; date?: string }
export interface PlanPdfResult { bytes: Uint8Array; scale: number; fits: boolean; hiddenLabels: number; entries: PlanEntry[] }
export interface PlanEntry { n: number; id: string; name: string; kind: 'urządzenie' | 'rack' | 'szafa'; model: string; where: string; x?: number; y?: number; d?: number }

/** Najmniejszy standardowy mianownik skali, przy którym sala mieści się na papierze (z marginesem i tabliczką). */
export function autoScale(widthMm: number, depthMm: number, paper: string): number {
  const [pw, ph] = PAPERS[paper] ?? PAPERS.A3;
  const availW = pw - 2 * MARGIN, availH = ph - 2 * MARGIN - TITLE_H;
  return SCALES.find((s) => widthMm / s <= availW && depthMm / s <= availH) ?? SCALES.at(-1)!;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' });

/** Elementy sali do numeracji: najpierw widoczne na planie (urządzenia, racki, szafy), potem urządzenia schowane w rackach i szafach. Numery wg nazwy (naturalna kolejność). */
export function planEntries(p: Project, spaceId?: string): PlanEntry[] {
  const vis: Omit<PlanEntry, 'n'>[] = [], inside: Omit<PlanEntry, 'n'>[] = [];
  const revOf = (id: string) => { const i = p.equipment[id]; return i ? p.definitions[i.definitionId]?.revisions[String(i.definitionRevision)] : undefined; };
  const modelOf = (id: string) => { const r = revOf(id) as any; return r ? [r.manufacturer, r.model].filter(Boolean).join(' ') : ''; };
  for (const pl of Object.values<any>(p.placements ?? {})) {
    if (spaceId && pl.spaceId !== spaceId) continue;
    if (pl.targetKind === 'rack' && p.racks?.[pl.targetId]) { const r: any = p.racks[pl.targetId]; vis.push({ id: pl.targetId, name: r.name, kind: 'rack', model: `rack 19" ${r.units} U`, where: '', x: pl.position.x, y: pl.position.y, d: rackFootprint(p, pl.targetId).d }); }
    else if (pl.targetKind === 'cabinet' && p.cabinets?.[pl.targetId] && !(p.cabinets[pl.targetId] as any).mount) { const c: any = p.cabinets[pl.targetId]; vis.push({ id: pl.targetId, name: c.name, kind: 'szafa', model: `szafa ${c.widthMm}×${c.heightMm} mm`, where: '', x: pl.position.x, y: pl.position.y, d: c.depthMm ?? 300 }); }
    else if (pl.targetKind === 'equipment' && p.equipment[pl.targetId] && !inPlacedHolder(p, pl.targetId)) vis.push({ id: pl.targetId, name: p.equipment[pl.targetId].name, kind: 'urządzenie', model: modelOf(pl.targetId), where: '', x: pl.position.x, y: pl.position.y, d: (revOf(pl.targetId) as any)?.dimensionsMm?.depth ?? 300 });
  }
  for (const [id, i] of Object.entries<any>(p.equipment)) {
    if (!inPlacedHolder(p, id)) continue;
    const ep = effectivePosition(p, id); if (!ep || (spaceId && ep.spaceId !== spaceId)) continue;
    const holderId = i.mount?.rackId ?? i.din?.cabinetId, holder: any = p.racks?.[holderId] ?? p.cabinets?.[holderId];
    inside.push({ id, name: i.name, kind: 'urządzenie', model: modelOf(id), where: `${holder?.name ?? ''}${i.mount ? ' · ' + i.mount.uStart + ' U' : ''}` });
  }
  vis.sort(byName); inside.sort(byName);
  return [...vis, ...inside].map((e, k) => ({ ...e, n: k + 1 }));
}

/** Numery na planie: obok urządzenia „n nazwa” (czcionka ok. 6 pt) z unikaniem nakładania; gdy nazwa się nie mieści, sam numer w środku. Zwraca prymitywy tekstu i liczbę pominiętych nazw. */
function labelPrims(entries: PlanEntry[], scale: number): { prims: Prim[]; hidden: number } {
  const size = 2.1 * scale, boxes: number[][] = [], prims: Prim[] = []; let hidden = 0;
  const hit = (box: number[]) => boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
  for (const e of entries) {
    if (e.x === undefined || e.y === undefined) continue;
    const txt = `${e.n} ${e.name}`, w = size * 0.52 * txt.length, x = e.x - w / 2, y = e.y - (e.d ?? 300) / 2 - size * 1.3;
    const box = [x, y - size * 0.2, x + w, y + size];
    if (!hit(box)) { boxes.push(box); prims.push({ t: 'text', id: e.id, x, y, s: txt, size, color: '#000' }); continue; }
    hidden++;
    const nw = size * 0.52 * String(e.n).length, nb = [e.x - nw / 2, e.y - size * 0.5, e.x + nw / 2, e.y + size * 0.7];
    boxes.push(nb); prims.push({ t: 'text', id: e.id, x: e.x - nw / 2, y: e.y - size * 0.35, s: String(e.n), size, color: '#000' });
  }
  return { prims, hidden };
}

/** Plan sali do PDF w skali: obrys, urządzenia, trasy, kable (opcjonalnie), etykiety bez nakładania, tabliczka. */
export async function planPdf(p: Project, o: PlanPdfOptions): Promise<PlanPdfResult> {
  const withContent = Object.keys(p.spaces ?? {}).find((id) => Object.values<any>(p.placements ?? {}).some((x) => x.spaceId === id)), sid = o.spaceId && p.spaces?.[o.spaceId] ? o.spaceId : withContent ?? Object.keys(p.spaces ?? {})[0], sz = sid ? spaceSize(p, sid) : undefined;
  const [pw, ph] = PAPERS[o.paper] ?? PAPERS.A3;
  const scale = o.scale ?? (sz ? autoScale(sz.widthMm, sz.depthMm, String(o.paper)) : 100);
  const base = planDrawList(p, { cables: o.cables, labels: false, spaceId: sid, bySignal: !!o.color });
  const entries = planEntries(p, sid), labels = labelPrims(entries, scale);
  const dl: DrawList = { prims: [...base.prims, ...labels.prims], unit: 'mm' };
  const fits = !sz || (sz.widthMm / scale <= pw - 2 * MARGIN && sz.depthMm / scale <= ph - 2 * MARGIN - TITLE_H);
  const onPlan = Object.keys(p.equipment).filter((id) => effectivePosition(p, id)).length, bigOnPlan = Object.values<any>(p.placements ?? {}).filter((x) => x.targetKind === 'rack' || x.targetKind === 'cabinet').length;
  const routes = sid ? Object.keys(p.spaces![sid].cableRoutes ?? {}).length : 0;
  const title = [
    `${o.projectName}${sid ? ' — ' + p.spaces![sid].name : ''}`,
    `Skala 1:${scale} · papier ${o.paper} poziomo${sz ? ` · sala ${Math.round(sz.widthMm / 10) / 100} × ${Math.round(sz.depthMm / 10) / 100} m` : ''}`,
    `Urządzeń na planie: ${onPlan}${bigOnPlan ? ` (w tym w rackach i szafach; racków i szaf: ${bigOnPlan})` : ''} · tras kablowych: ${routes}${o.cables ? ' · kable narysowane po trasach (bez trasy: prosto)' : ''}${labels.hidden ? ` · numer bez nazwy (brak miejsca): ${labels.hidden}` : ''}${o.date ? ' · ' + o.date : ''}`,
  ];
  const bytes = await exportPlanPdf(dl, { scale, paperWidthMm: pw, paperHeightMm: ph, marginMm: MARGIN, origin: [0, 0], fonts: o.fonts, title: o.projectName, titleBlock: title, color: o.color, cableLegend: o.color && o.cables ? signalLegend(p) : undefined,
    legend: { title: `Spis elementów — ${o.projectName}${sid ? ' — ' + p.spaces![sid].name : ''}`, headers: ['Nr', 'Nazwa', 'Rodzaj', 'Producent i model', 'Zamontowane w'], widths: [12, 80, 24, 100, 60], rows: entries.map((e) => [String(e.n), e.name, e.kind, e.model, e.where]) } });
  return { bytes, scale, fits, hiddenLabels: labels.hidden, entries };
}
