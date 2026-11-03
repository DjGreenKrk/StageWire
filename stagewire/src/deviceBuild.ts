// Budowanie urządzeń dla człowieka: gotowe zestawy portów, składanie urządzenia z formularza, dopisywanie pojedynczych urządzeń do pakietu „Moje urządzenia”
// (bez przepisywania całej bazy) i pakiety jednourządzeniowe do udostępniania.
import type { RegistryEntry } from './types.ts';
import { validatePack, deviceKeyFor, PACK_FORMAT, type Pack, type PackDevice, type PackPort, type PackSource, type PackReport, type PackEnclosure } from './pack.ts';

export const MY_PACK_ID = 'moje-urzadzenia';
export interface PortPreset { id: string; label: string; base: string; connector: string; signals: string[]; direction: PackPort['direction']; group?: string }
/** Najczęstsze porty: wybór „8 × XLR wejście” zamiast ręcznego dodawania ośmiu wierszy. Zestaw jest filtrowany do wpisów, które są w rejestrach. */
export const PORT_PRESETS: PortPreset[] = [
  { id: 'hdmi-in', label: 'HDMI wejście', base: 'HDMI IN', connector: 'std/hdmi-a', signals: ['std/hdmi'], direction: 'in' },
  { id: 'hdmi-out', label: 'HDMI wyjście', base: 'HDMI OUT', connector: 'std/hdmi-a', signals: ['std/hdmi'], direction: 'out' },
  { id: 'sdi-in', label: 'SDI wejście (BNC)', base: 'SDI IN', connector: 'std/bnc-75', signals: ['std/sdi-3g'], direction: 'in' },
  { id: 'sdi-out', label: 'SDI wyjście (BNC)', base: 'SDI OUT', connector: 'std/bnc-75', signals: ['std/sdi-3g'], direction: 'out' },
  { id: 'dp-in', label: 'DisplayPort wejście', base: 'DP IN', connector: 'std/dp', signals: ['std/displayport'], direction: 'in' },
  { id: 'dp-out', label: 'DisplayPort wyjście', base: 'DP OUT', connector: 'std/dp', signals: ['std/displayport'], direction: 'out' },
  { id: 'lan', label: 'LAN (RJ45)', base: 'LAN', connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' },
  { id: 'xlr-in', label: 'XLR wejście (audio)', base: 'XLR IN', connector: 'std/xlr-3', signals: ['std/audio-analog'], direction: 'in' },
  { id: 'xlr-out', label: 'XLR wyjście (audio)', base: 'XLR OUT', connector: 'std/xlr-3', signals: ['std/audio-analog'], direction: 'out' },
  { id: 'jack-in', label: 'Jack 6,3 mm wejście', base: 'JACK IN', connector: 'std/jack-6-35', signals: ['std/audio-analog'], direction: 'in' },
  { id: 'jack-out', label: 'Jack 6,3 mm wyjście', base: 'JACK OUT', connector: 'std/jack-6-35', signals: ['std/audio-analog'], direction: 'out' },
  { id: 'dmx-in', label: 'DMX wejście (XLR 5)', base: 'DMX IN', connector: 'std/xlr-5', signals: ['std/dmx'], direction: 'in' },
  { id: 'dmx-out', label: 'DMX wyjście (XLR 5)', base: 'DMX OUT', connector: 'std/xlr-5', signals: ['std/dmx'], direction: 'out' },
  { id: 'usb-a', label: 'USB-A', base: 'USB', connector: 'std/usb-a', signals: ['std/usb'], direction: 'io' },
  { id: 'iec-in', label: 'Zasilanie IEC C14 (wejście)', base: 'AC IN', connector: 'std/iec-c14', signals: ['std/power-ac'], direction: 'in' },
  { id: 'powercon-in', label: 'Zasilanie powerCON (wejście)', base: 'POWER IN', connector: 'std/powercon', signals: ['std/power-ac'], direction: 'in' },
  { id: 'speakon', label: 'Speakon (wyjście głośnikowe)', base: 'SPK OUT', connector: 'std/speakon', signals: ['std/audio-speaker'], direction: 'out' },
  { id: 'fiber', label: 'Światłowód LC', base: 'FIBER', connector: 'std/lc-duplex', signals: ['std/fiber'], direction: 'io' },
];
export const presetsAvailable = (reg: Record<string, RegistryEntry | undefined>): PortPreset[] =>
  PORT_PRESETS.filter((p) => reg[p.connector]?.kind === 'connector' && p.signals.every((s) => reg[s]?.kind === 'signal'));

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'port';

/** `count` kolejnych portów z zestawu; numeracja ciągnie dalej, jeśli urządzenie ma już porty o tej etykiecie bazowej (np. po XLR IN 1–4 dodanie 4 daje 5–8). */
export function expandPreset(p: PortPreset, count: number, existing: PackPort[]): PackPort[] {
  const n = Math.max(1, Math.min(64, Math.floor(count))), used = new Set(existing.map((e) => e.key));
  const same = existing.filter((e) => e.label === p.base || new RegExp(`^${p.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(e.label)).length;
  const out: PackPort[] = [];
  for (let i = 0; i < n; i++) {
    const num = same + i + 1, label = `${p.base} ${num}`;
    let key = slug(label), k = 2; while (used.has(key)) key = `${slug(label)}-${k++}`; used.add(key);
    out.push({ key, label, connector: p.connector, signals: [...p.signals], direction: p.direction, ...(p.group ? { group: p.group } : {}) });
  }
  return out;
}

export interface DeviceForm {
  manufacturer: string; model: string; category: string; tags?: string[]; description?: string;
  dimensionsMm?: { width: number; depth: number; height: number } | null; weightKg?: number | null; powerW?: number | null; powerMaxW?: number | null;
  rackUnits?: { heightU: number; widthFraction: number } | null; dinModules?: number | null;
  ports: PackPort[]; source: PackSource;
}
/** Składa urządzenie z formularza (puste pola opcjonalne są pomijane); klucz urządzenia z modelu, unikalny wśród `takenKeys`. */
export function buildDevice(f: DeviceForm, takenKeys: Iterable<string> = [], fixedKey?: string): PackDevice {
  const d: PackDevice = {
    key: fixedKey ?? deviceKeyFor(f.model.trim(), takenKeys), manufacturer: f.manufacturer.trim(), model: f.model.trim(), category: f.category.trim(),
    ...(f.tags?.length ? { tags: f.tags } : {}), ...(f.description?.trim() ? { description: f.description.trim() } : {}),
    ...(f.dimensionsMm ? { dimensionsMm: f.dimensionsMm } : {}), ...(f.weightKg != null ? { weightKg: f.weightKg } : {}),
    ...(f.powerW != null ? { powerW: f.powerW } : {}), ...(f.powerMaxW != null ? { powerMaxW: f.powerMaxW } : {}),
    ...(f.rackUnits ? { rackUnits: f.rackUnits } : {}), ...(f.dinModules != null ? { dinModules: f.dinModules } : {}),
    ports: f.ports.map((p) => ({ ...p, signals: [...p.signals] })), source: { ...f.source },
  };
  return d;
}

/** Wpisy rejestrów używane przez porty urządzeń (złącza i sygnały) wzięte z `known`: dzięki nim plik z jednym urządzeniem jest samowystarczalny. */
export function registriesFor(devices: PackDevice[], known: Record<string, RegistryEntry>): Record<string, RegistryEntry> {
  const out: Record<string, RegistryEntry> = {};
  for (const d of devices) for (const p of d.ports) for (const k of [p.connector, ...p.signals]) if (known[k] && !out[k]) out[k] = JSON.parse(JSON.stringify(known[k]));
  return out;
}

const bump = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.1'; };
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export type Conflict = 'replace' | 'keep-both' | 'skip';
export interface MergeResult { pack: Pack; added: string[]; replaced: string[]; skipped: string[]; renamed: [string, string][] }
/**
 * Dopisuje urządzenia do pakietu „Moje urządzenia” (tworzy go, jeśli nie ma) bez ruszania pozostałych urządzeń. Identyczne urządzenie (ten sam klucz i treść) jest pomijane.
 * Przy tym samym kluczu, ale innej treści: `replace` podmienia, `keep-both` dodaje pod nowym kluczem, `skip` pomija. Rejestry są sumowane (istniejące wpisy mają pierwszeństwo).
 */
export function mergeIntoMine(existing: Pack | undefined, devices: PackDevice[], regs: Record<string, RegistryEntry>, onConflict: (d: PackDevice) => Conflict = () => 'keep-both'): MergeResult {
  const pack: Pack = existing ? JSON.parse(JSON.stringify(existing)) : { format: PACK_FORMAT, id: MY_PACK_ID, name: 'Moje urządzenia', version: '1.0.0', license: 'własne (do użytku wewnętrznego)', description: 'Urządzenia utworzone lub dodane w StageWire.', devices: [] };
  const res: MergeResult = { pack, added: [], replaced: [], skipped: [], renamed: [] };
  for (const d of devices) {
    const i = pack.devices.findIndex((x) => x.key === d.key), copy: PackDevice = JSON.parse(JSON.stringify(d));
    if (i < 0) { pack.devices.push(copy); res.added.push(d.key); continue; }
    if (canon(pack.devices[i]) === canon(copy)) { res.skipped.push(d.key); continue; }
    const c = onConflict(d);
    if (c === 'skip') res.skipped.push(d.key);
    else if (c === 'replace') { pack.devices[i] = copy; res.replaced.push(d.key); }
    else { const nk = deviceKeyFor(d.key, pack.devices.map((x) => x.key)); copy.key = nk; pack.devices.push(copy); res.added.push(nk); res.renamed.push([d.key, nk]); }
  }
  pack.registries = { ...regs, ...(pack.registries ?? {}) };
  if (res.added.length || res.replaced.length) pack.version = bump(pack.version);
  return res;
}
/** Dopisuje obudowę (szablon szafy) do pakietu „Moje urządzenia”; ten sam klucz = podmiana. */
export function mergeEnclosureIntoMine(existing: Pack | undefined, enc: PackEnclosure, regs: Record<string, RegistryEntry>): { pack: Pack; replaced: boolean } {
  const pack: Pack = existing ? JSON.parse(JSON.stringify(existing)) : { format: PACK_FORMAT, id: MY_PACK_ID, name: 'Moje urządzenia', version: '1.0.0', license: 'własne (do użytku wewnętrznego)', description: 'Urządzenia i obudowy utworzone w programie.', devices: [] };
  pack.enclosures ??= []; const i = pack.enclosures.findIndex((e) => e.key === enc.key), replaced = i >= 0;
  if (replaced) pack.enclosures[i] = JSON.parse(JSON.stringify(enc)); else pack.enclosures.push(JSON.parse(JSON.stringify(enc)));
  pack.registries = { ...regs, ...(pack.registries ?? {}) }; pack.version = bump(pack.version);
  return { pack, replaced };
}
/** Usunięcie urządzenia z pakietu użytkownika. */
export function removeFromPack(pack: Pack, key: string): Pack { const p: Pack = JSON.parse(JSON.stringify(pack)); p.devices = p.devices.filter((d) => d.key !== key); p.version = bump(p.version); return p; }

/** Pakiet z jednym urządzeniem do udostępnienia (z rejestrami, autorem i licencją). Id pakietu: `urz-<klucz>`. */
export function singleDevicePack(d: PackDevice, regs: Record<string, RegistryEntry>, meta: { author?: string; license: string }): { pack: Pack; report: PackReport } {
  const pack: Pack = { format: PACK_FORMAT, id: `urz-${slug(d.key)}`.slice(0, 40), name: `${d.manufacturer} ${d.model}`.trim(), version: '1.0.0', ...(meta.author?.trim() ? { author: meta.author.trim() } : {}), license: meta.license.trim(), description: d.description?.slice(0, 400), registries: registriesFor([d], regs), devices: [JSON.parse(JSON.stringify(d))] };
  if (!pack.description) delete pack.description;
  return { pack, report: validatePack(pack, {}) };
}

/** Sprawdzenie samego urządzenia (do podpowiedzi w kreatorze): zwraca błędy i ostrzeżenia z walidatora pakietów. */
export function checkDevice(d: PackDevice, regs: Record<string, RegistryEntry>): PackReport {
  return validatePack({ format: PACK_FORMAT, id: MY_PACK_ID, name: 'x', version: '1.0.0', license: 'x', registries: {}, devices: [d] }, regs);
}
