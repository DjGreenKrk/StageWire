import type { PackDevice, PackPort, PackLink, PackEnclosure, PackSource } from './pack.ts';

/**
 * Szablony elementów elektrycznych dla kreatora (ADR-064): z kilku parametrów (liczba zacisków, biegunów, tor) powstaje kompletna definicja
 * urządzenia z portami, torami, położeniem zacisków i mostkami wewnętrznymi. Funkcje są czyste i niezależne od interfejsu.
 * Dane producenta (rozstaw, liczba biegunów, długości) podaje człowiek; szablon niczego nie zgaduje.
 */
export type ElKind = 'bar' | 'comb' | 'block' | 'terminal' | 'apparatus' | 'enclosure';
export const EL_KINDS: { kind: ElKind; label: string; hint: string; category: string }[] = [
  { kind: 'bar', label: 'Listwa zaciskowa (N, PE lub inny tor)', hint: 'Wiele zacisków połączonych na stałe w jeden tor, np. listwa N z 10 zaciskami albo listwa PE.', category: 'zasilanie / listwy zaciskowe' },
  { kind: 'comb', label: 'Grzebień (szyna zbiorcza)', hint: 'Zęby leżą na zaciskach sąsiednich aparatów; zęby tego samego toru są połączone. 1P, 2P, 3P albo 4P.', category: 'zasilanie / grzebienie' },
  { kind: 'block', label: 'Blok rozdzielczy', hint: 'Jedno wejście i kilka wyjść na każdy tor (np. L1, L2, L3, N), tory niezależne od siebie.', category: 'zasilanie / bloki rozdzielcze' },
  { kind: 'terminal', label: 'Złączka (przelotowa, wielopoziomowa)', hint: 'Zacisk góra–dół połączony na stałe; poziomy są niezależne, opcjonalnie z mostkiem między poziomami.', category: 'zasilanie / złączki' },
  { kind: 'apparatus', label: 'Aparat modułowy (wyłącznik, rozłącznik, stycznik)', hint: 'Bieguny z zaciskami góra–dół i wejściem pod grzebień; styk jest zależny od stanu aparatu, nie jest mostkiem.', category: 'zasilanie / wyłączniki nadprądowe' },
  { kind: 'enclosure', label: 'Obudowa (szafa, rozdzielnica)', hint: 'Szablon szafy: liczba szyn, moduły na szynie, wymiary i stopień ochrony. Pojawia się w oknie „Nowa szafa”.', category: '' },
];

export const MODULE_MM = 17.5;
const TERM = 'std/din-terminal', SLOT = 'std/din-comb-slot';
export type Signal = 'std/power-ac' | 'std/power-dc';

export interface Generated { ports: PackPort[]; internalLinks: PackLink[]; dinModules: number; placementLayer?: 'busbar'; phaseOrder?: string[]; tags: string[]; summary: string[]; category?: string }
const dims = (modules: number, h = 90, d = 60) => ({ width: Math.round(modules * MODULE_MM * 10) / 10, depth: d, height: h });
const posInt = (n: number, min: number, max: number, name: string) => { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: liczba całkowita ${min}–${max}`); return n; };
const track = (t: string) => { const v = t.trim(); if (!v || v.length > 12) throw new Error('Tor: tekst do 12 znaków (np. N, PE, L1)'); return v; };
const wiresOf = (w?: { minMm2?: number; maxMm2?: number }) => (w && (w.minMm2 || w.maxMm2) ? { wires: { ...(w.minMm2 ? { minMm2: w.minMm2 } : {}), ...(w.maxMm2 ? { maxMm2: w.maxMm2 } : {}) } } : {});
const pad = (n: number) => String(n);

/** Listwa zaciskowa: `count` zacisków jednego toru, wszystkie połączone na stałe. Zaciski rozłożone po `perModule` na moduł. */
export function generateBar(p: { track: string; count: number; capacity: number; perModule?: number; signal?: Signal; wires?: { minMm2?: number; maxMm2?: number } }): Generated {
  const t = track(p.track), n = posInt(p.count, 2, 64, 'Liczba zacisków'), cap = posInt(p.capacity, 1, 64, 'Przewodów na zacisk'), per = posInt(p.perModule ?? 3, 1, 8, 'Zacisków na moduł');
  const sig = p.signal ?? 'std/power-ac', modules = Math.ceil(n / per);
  const ports: PackPort[] = Array.from({ length: n }, (_, i) => ({ key: `z${pad(i + 1)}`, label: `${t}${i + 1}`, connector: TERM, signals: [sig], direction: 'io', capacity: cap, side: 'top' as const, group: `Tor ${t}`, terminal: { track: t, at: Math.floor(i / per), side: 'top' as const, kind: 'screw' as const, ...wiresOf(p.wires) } }));
  return { ports, internalLinks: [{ kind: 'bridge', members: ports.map((q) => q.key) }], dinModules: modules, tags: ['din', 'listwa', t.toLowerCase()], category: 'zasilanie / listwy zaciskowe',
    summary: [`${n} zacisków toru ${t}, wszystkie w jednym węźle (do ${cap} przewodów na zacisk)`] };
}

/** Ciąg torów grzebienia o danej liczbie biegunów (1P: L1, 2P: L1+N, 3P: L1 L2 L3, 4P: L1 L2 L3 N). */
export const combTracks = (poles: 1 | 2 | 3 | 4): string[] => ({ 1: ['L1'], 2: ['L1', 'N'], 3: ['L1', 'L2', 'L3'], 4: ['L1', 'L2', 'L3', 'N'] }[poles]);
/** Grzebień: `teeth` zębów co `pitch` modułów, tory na przemian; zęby tego samego toru połączone mostkami. `fits` = tag zgodności z zaciskami aparatów. */
export function generateComb(p: { poles: 1 | 2 | 3 | 4; teeth: number; pitch?: number; fits: string; signal?: Signal; tracks?: string[] }): Generated {
  const seq = (p.tracks?.length ? p.tracks.map(track) : combTracks(p.poles)), n = posInt(p.teeth, 1, 72, 'Liczba zębów'), pitch = posInt(p.pitch ?? 1, 1, 4, 'Rozstaw (moduły)');
  if (seq.length !== p.poles) throw new Error(`Tory: oczekiwano ${p.poles}, jest ${seq.length}`);
  const fit = p.fits.trim(); if (!fit) throw new Error('Zgodność: podaj tag rozstawu/typu (np. 1mod-16mm2)');
  const sig = p.signal ?? 'std/power-ac';
  const ports: PackPort[] = Array.from({ length: n }, (_, i) => { const tr = seq[i % seq.length]; return { key: `z${pad(i + 1)}`, label: `${tr} (${i + 1})`, connector: SLOT, signals: [sig], direction: 'io' as const, side: 'top' as const, group: 'Zęby', terminal: { track: tr, at: i * pitch, side: 'top' as const, kind: 'comb-slot' as const, fits: [fit] } }; });
  const links: PackLink[] = seq.map((tr) => ({ kind: 'bridge' as const, members: ports.filter((q) => q.terminal?.track === tr).map((q) => q.key) })).filter((l) => l.members!.length >= 2);
  const modules = Math.max(1, n * pitch);
  return { ports, internalLinks: links, dinModules: modules, placementLayer: 'busbar', phaseOrder: [...seq], tags: ['din', 'grzebien', `${p.poles}p`], category: 'zasilanie / grzebienie',
    summary: [`${p.poles}P, ${n} zębów co ${pitch} mod., tory na przemian: ${seq.join(' ')}`, links.length ? `mostki: ${links.map((l) => `${ports.find((q) => q.key === l.members![0])!.terminal!.track} (${l.members!.length} zęby)`).join(', ')}` : 'brak mostków (każdy tor ma tylko jeden ząb)', `szerokość ${modules} mod.`] };
}

/** Blok rozdzielczy: dla każdego toru jedno wejście i `outputs` wyjść, tory niezależne. */
export function generateBlock(p: { tracks: string[]; outputs: number; signal?: Signal; wires?: { minMm2?: number; maxMm2?: number } }): Generated {
  const tr = p.tracks.map(track); if (!tr.length || tr.length > 6) throw new Error('Tory: od 1 do 6'); if (new Set(tr).size !== tr.length) throw new Error('Tory muszą być różne');
  const out = posInt(p.outputs, 1, 24, 'Wyjść na tor'), sig = p.signal ?? 'std/power-ac', ports: PackPort[] = [], links: PackLink[] = [];
  tr.forEach((t, ti) => {
    const k = t.toLowerCase().replace(/[^a-z0-9]/g, ''), keys: string[] = [];
    ports.push({ key: `${k}-in`, label: `${t} IN`, connector: TERM, signals: [sig], direction: 'in', side: 'top', group: `Tor ${t}`, terminal: { track: t, at: ti, side: 'top', kind: 'screw', ...wiresOf(p.wires) } }); keys.push(`${k}-in`);
    for (let i = 1; i <= out; i++) { ports.push({ key: `${k}-o${i}`, label: `${t} OUT${i}`, connector: TERM, signals: [sig], direction: 'out', side: 'bottom', group: `Tor ${t}`, terminal: { track: t, at: ti, side: 'bottom', kind: 'screw', ...wiresOf(p.wires) } }); keys.push(`${k}-o${i}`); }
    links.push({ kind: 'bridge', members: keys });
  });
  const modules = Math.max(2, Math.ceil(tr.length * Math.max(1, out / 3)));
  return { ports, internalLinks: links, dinModules: modules, tags: ['din', 'blok-rozdzielczy'], category: 'zasilanie / bloki rozdzielcze',
    summary: [`${tr.length} niezależnych torów (${tr.join(', ')}), każdy: 1 wejście → ${out} wyjść`, `razem ${ports.length} zacisków`] };
}

/** Złączka: `levels` poziomów, każdy zacisk góra–dół połączony na stałe; opcjonalny mostek konfigurowalny między sąsiednimi poziomami. */
export function generateTerminal(p: { levels: number; track?: string; jumpers?: boolean; signal?: Signal; wires?: { minMm2?: number; maxMm2?: number } }): Generated {
  const lv = posInt(p.levels, 1, 4, 'Poziomy'), sig = p.signal ?? 'std/power-ac', t = p.track?.trim() ? track(p.track) : undefined, ports: PackPort[] = [], links: PackLink[] = [];
  for (let l = 1; l <= lv; l++) {
    const tr = t ? (lv > 1 ? `${t}` : t) : undefined;
    ports.push({ key: `l${l}-a`, label: `${l}A`, connector: TERM, signals: [sig], direction: 'io', side: 'top', group: `Poziom ${l}`, terminal: { ...(tr ? { track: tr } : {}), at: 0, side: 'top', kind: 'screw', ...wiresOf(p.wires) } });
    ports.push({ key: `l${l}-b`, label: `${l}B`, connector: TERM, signals: [sig], direction: 'io', side: 'bottom', group: `Poziom ${l}`, terminal: { ...(tr ? { track: tr } : {}), at: 0, side: 'bottom', kind: 'screw', ...wiresOf(p.wires) } });
    links.push({ kind: 'bridge', a: `l${l}-a`, b: `l${l}-b` });
  }
  if (p.jumpers) for (let l = 1; l < lv; l++) links.push({ kind: 'jumper', a: `l${l}-a`, b: `l${l + 1}-a`, contact: `mostek ${l}-${l + 1}` });
  return { ports, internalLinks: links, dinModules: 1, tags: ['din', 'zlaczka'], category: 'zasilanie / złączki',
    summary: [`${lv} ${lv === 1 ? 'poziom' : 'poziomy'}: zacisk góra–dół połączony na stałe`, p.jumpers && lv > 1 ? 'mostki konfigurowalne między poziomami (włączane w projekcie)' : 'poziomy niezależne'] };
}

export type ApparatusKind = 'mcb' | 'rcd' | 'isolator' | 'contactor';
export const APPARATUS_LABEL: Record<ApparatusKind, { label: string; category: string }> = {
  mcb: { label: 'wyłącznik nadprądowy', category: 'zasilanie / wyłączniki nadprądowe' }, rcd: { label: 'wyłącznik różnicowoprądowy', category: 'zasilanie / wyłączniki różnicowoprądowe' },
  isolator: { label: 'rozłącznik izolacyjny', category: 'zasilanie / rozłączniki izolacyjne' }, contactor: { label: 'stycznik', category: 'zasilanie / styczniki' },
};
/** Aparat modułowy: na każdy biegun wejście (góra), wyjście (dół) i wejście pod grzebień; styk IN→OUT jest zależny od stanu (nie scala węzłów). */
export function generateApparatus(p: { kind: ApparatusKind; poles: number; modulesPerPole?: number; fits?: string; coil?: boolean; tracks?: string[]; signal?: Signal; wires?: { minMm2?: number; maxMm2?: number } }): Generated {
  const poles = posInt(p.poles, 1, 4, 'Bieguny'), mpp = posInt(p.modulesPerPole ?? 1, 1, 4, 'Moduły na biegun'), sig = p.signal ?? 'std/power-ac', fit = p.fits?.trim();
  const ports: PackPort[] = [], links: PackLink[] = [], tr = p.tracks?.length ? p.tracks.map(track) : undefined;
  for (let i = 1; i <= poles; i++) {
    const t = tr?.[i - 1], at = (i - 1) * mpp, name = poles === 1 ? '' : ` P${i}`;
    ports.push({ key: `in-p${i}`, label: `IN${name}`.trim(), connector: TERM, signals: [sig], direction: 'in', side: 'top', group: `Bieguny`, terminal: { ...(t ? { track: t } : {}), at, side: 'top', kind: 'screw', ...wiresOf(p.wires) } });
    if (fit) { ports.push({ key: `cb-p${i}`, label: `IN${name} (grzebień)`.trim(), connector: SLOT, signals: [sig], direction: 'in', side: 'top', group: 'Grzebień', terminal: { ...(t ? { track: t } : {}), at, side: 'top', kind: 'comb-slot', fits: [fit] } }); links.push({ kind: 'bridge', members: [`in-p${i}`, `cb-p${i}`] }); }
    ports.push({ key: `out-p${i}`, label: `OUT${name}`.trim(), connector: TERM, signals: [sig], direction: 'out', side: 'bottom', group: 'Bieguny', terminal: { ...(t ? { track: t } : {}), at, side: 'bottom', kind: 'screw', ...wiresOf(p.wires) } });
    links.push({ kind: 'switched', a: `in-p${i}`, b: `out-p${i}`, contact: p.kind === 'contactor' ? `K${i}` : `Q${i}` });
  }
  if (p.kind === 'contactor' && p.coil) { ports.push({ key: 'a1', label: 'A1', connector: TERM, signals: [sig], direction: 'in', side: 'top', group: 'Cewka' }, { key: 'a2', label: 'A2', connector: TERM, signals: [sig], direction: 'in', side: 'bottom', group: 'Cewka' }); }
  const modules = poles * mpp, info = APPARATUS_LABEL[p.kind];
  return { ports, internalLinks: links, dinModules: modules, tags: ['din', p.kind, `${poles}p`], category: info.category,
    summary: [`${info.label}, ${poles}P, ${modules} mod.`, fit ? `wejścia pod grzebień zgodne z „${fit}” (po jednym na biegun)` : 'bez wejść pod grzebień', 'styk wejście → wyjście zależny od stanu (nie jest mostkiem)'] };
}

/** Składa urządzenie pakietu z wygenerowanej części i danych opisowych. */
export function deviceFromGenerated(g: Generated, meta: { key: string; manufacturer: string; model: string; category?: string; description?: string; source: PackSource; heightMm?: number; depthMm?: number; extraTags?: string[] }): PackDevice {
  return {
    key: meta.key, manufacturer: meta.manufacturer.trim(), model: meta.model.trim(), category: (meta.category?.trim() || g.category || 'zasilanie').trim(),
    tags: [...new Set([...g.tags, ...(meta.extraTags ?? [])])], ...(meta.description?.trim() ? { description: meta.description.trim().slice(0, 400) } : {}),
    dimensionsMm: dims(g.dinModules, meta.heightMm ?? 90, meta.depthMm ?? 60), dinModules: g.dinModules,
    ...(g.placementLayer ? { placementLayer: g.placementLayer } : {}), ...(g.phaseOrder ? { phaseOrder: g.phaseOrder } : {}),
    internalLinks: g.internalLinks, ports: g.ports, source: meta.source,
  };
}

export function buildEnclosure(p: PackEnclosure): PackEnclosure {
  posInt(p.rows, 1, 12, 'Szyny DIN'); posInt(p.modules, 1, 72, 'Moduły na szynie');
  for (const [v, n] of [[p.widthMm, 'Szerokość'], [p.heightMm, 'Wysokość']] as const) if (!(v >= 50 && v <= 5000)) throw new Error(`${n}: 50–5000 mm`);
  if (p.depthMm !== undefined && !(p.depthMm > 0 && p.depthMm <= 2000)) throw new Error('Głębokość: 1–2000 mm');
  return { key: p.key, manufacturer: p.manufacturer.trim(), model: p.model.trim(), widthMm: p.widthMm, heightMm: p.heightMm, ...(p.depthMm ? { depthMm: p.depthMm } : {}), rows: p.rows, modules: p.modules,
    ...(p.ip?.trim() ? { ip: p.ip.trim() } : {}), ...(p.mounting ? { mounting: p.mounting } : {}), ...(p.description?.trim() ? { description: p.description.trim().slice(0, 400) } : {}), source: p.source };
}
