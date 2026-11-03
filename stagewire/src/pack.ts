import type { DefinitionRevision, Direction, PortDefinition, RegistryEntry } from './types.ts';

/**
 * Pakiet urządzeń (baza urządzeń): plik JSON `*.swpack.json` z listą urządzeń, ich portów i (opcjonalnie) wpisów rejestrów.
 * Format jest przeznaczony do ręcznego i półautomatycznego tworzenia bazy; każde urządzenie niesie źródło danych (ADR-020, ADR-049).
 * Walidacja jest wyczerpująca i zwraca polskie komunikaty z ścieżką do błędu, tak aby autor pakietu mógł je poprawić bez znajomości kodu.
 */
export const PACK_FORMAT = 'stagewire-pack/1';
export type SourceKind = 'datasheet' | 'manual' | 'measured' | 'estimated' | 'generic' | 'custom';
export const SOURCE_KINDS: SourceKind[] = ['datasheet', 'manual', 'measured', 'estimated', 'generic', 'custom'];
export const DIRECTIONS: Direction[] = ['in', 'out', 'io', 'loop'];
export const SIDES = ['left', 'right', 'top', 'bottom', 'auto'] as const;

/**
 * Źródło danych urządzenia. `verified` (data) znaczy: człowiek porównał dane z dokumentem `ref`; bez niej dane są niezweryfikowane.
 * `generated: true` oznacza dane wytworzone automatycznie (skrypt, model językowy): nigdy nie są uznawane za zweryfikowane same z siebie.
 */
export interface PackSource { kind: SourceKind; ref?: string; url?: string; note?: string; verified?: string; hardwareRevision?: string; generated?: boolean }
/** Parametry elektryczne portu zasilania (zakres napięć, moc). Samo połączenie zasilania to zwykły port i zwykłe połączenie. */
export interface PortElectrical { voltageMinV?: number; voltageMaxV?: number; maxW?: number }
export interface PackPort { key: string; label: string; connector: string; signals: string[]; direction: Direction; capacity?: number; side?: (typeof SIDES)[number]; note?: string; group?: string; electrical?: PortElectrical }
export interface PackDevice {
  key: string; manufacturer: string; model: string; category: string; tags?: string[]; description?: string; kind?: 'physical' | 'virtual';
  dimensionsMm?: { width: number; depth: number; height: number }; weightKg?: number; powerW?: number; powerMaxW?: number;
  rackUnits?: { heightU: number; widthFraction: number };
  dinModules?: number;
  ports: PackPort[]; source: PackSource;
}
export interface Pack { format: typeof PACK_FORMAT; id: string; name: string; version: string; author?: string; license: string; description?: string; registries?: Record<string, RegistryEntry>; devices: PackDevice[] }

export interface PackReport { errors: string[]; warnings: string[]; pack?: Pack }

const TOP_FIELDS = ['$schema', 'format', 'id', 'name', 'version', 'author', 'license', 'description', 'registries', 'devices'];
const DEV_FIELDS = ['key', 'manufacturer', 'model', 'category', 'tags', 'description', 'kind', 'dimensionsMm', 'weightKg', 'powerW', 'powerMaxW', 'dinModules', 'rackUnits', 'ports', 'source'];
const PORT_FIELDS = ['key', 'label', 'connector', 'signals', 'direction', 'capacity', 'side', 'note', 'group', 'electrical'];
const SRC_FIELDS = ['kind', 'ref', 'url', 'note', 'verified', 'hardwareRevision', 'generated'];

/** Wiarygodność danych urządzenia: verified = człowiek sprawdził z dokumentem; unverified = źródło wskazane, ale bez daty weryfikacji lub wygenerowane; approximate = szacunek; generic = urządzenie ogólne. */
export type Trust = 'verified' | 'unverified' | 'approximate' | 'generic';
export function sourceTrust(s: { kind?: string; verified?: string; generated?: boolean } | undefined): Trust {
  if (!s) return 'unverified';
  if (s.kind === 'generic') return 'generic';
  if (s.kind === 'estimated') return 'approximate';
  if (s.kind === 'custom') return s.verified && !s.generated ? 'verified' : 'unverified';
  return s.verified ? 'verified' : 'unverified'; // datasheet, manual, measured: data weryfikacji ustawia człowiek
}
export const TRUST_LABEL: Record<Trust, string> = { verified: 'zweryfikowane', unverified: 'niezweryfikowane', approximate: 'szacunkowe', generic: 'ogólne' };

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/, PACK_ID_RE = /^[a-z][a-z0-9-]{2,39}$/, VER_RE = /^\d+\.\d+\.\d+$/, REG_RE = /^(std|user)\/[0-9a-z][0-9a-z._-]*$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Identyfikatory w pliku projektu mają wzorzec `prefiks_alfanumeryczne` (jedno podkreślenie). */
export const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const definitionIdOf = (packId: string, devKey: string) => `eqd_${alnum(packId)}${alnum(devKey)}`;
export const portIdOf = (portKey: string) => `prt_${alnum(portKey)}`;
export const defKeyOf = (packId: string, devKey: string) => `${packId}/${devKey}`;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Sprawdza pakiet. `known` to wpisy rejestrów dostępne poza pakietem (np. wbudowane); złącza i sygnały portów muszą być w `registries` pakietu lub w `known`.
 * Zwraca błędy (pakiet nie zostanie wczytany) i ostrzeżenia (pakiet działa, ale dane budzą wątpliwości).
 */
export function validatePack(raw: unknown, known: Record<string, RegistryEntry> = {}): PackReport {
  const errors: string[] = [], warnings: string[] = [];
  const err = (m: string) => errors.push(m), warn = (m: string) => warnings.push(m);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['Plik nie jest obiektem JSON pakietu'], warnings };
  const p = raw as Record<string, any>;
  for (const k of Object.keys(p)) if (!TOP_FIELDS.includes(k)) warn(`${k}: nieznane pole pakietu (literówka lub pole z nowszej wersji formatu; zostanie pominięte)`);
  if (p.format !== PACK_FORMAT) err(`format: oczekiwano "${PACK_FORMAT}", jest ${JSON.stringify(p.format)}`);
  if (!isStr(p.id) || !PACK_ID_RE.test(p.id)) err('id: małe litery, cyfry i myślniki, 3–40 znaków, zaczyna się od litery (np. "moje-urzadzenia")');
  if (!isStr(p.name)) err('name: wymagana nazwa pakietu');
  if (!isStr(p.version) || !VER_RE.test(p.version)) err('version: wymagany numer w postaci 1.0.0');
  if (!isStr(p.license)) err('license: wymagana licencja/warunki użycia danych pakietu (np. "własne", "CC0")');
  const reg: Record<string, any> = p.registries ?? {};
  if (p.registries !== undefined && (typeof reg !== 'object' || Array.isArray(reg))) err('registries: oczekiwano obiektu klucz → wpis');
  const all: Record<string, any> = { ...known, ...(typeof reg === 'object' ? reg : {}) };
  for (const [k, r] of Object.entries<any>(typeof reg === 'object' && !Array.isArray(reg) ? reg : {})) {
    if (!REG_RE.test(k)) err(`registries["${k}"]: klucz musi mieć postać std/… lub user/… (małe litery, cyfry, . _ -)`);
    if (!r || !['connector', 'signal', 'cable'].includes(r.kind)) err(`registries["${k}"].kind: connector, signal lub cable`);
    if (!isStr(r?.name)) err(`registries["${k}"].name: wymagana nazwa`);
    if (r?.kind === 'cable') {
      if (!Array.isArray(r.endPairs) || !r.endPairs.length) warn(`registries["${k}"]: kabel bez endPairs (zgodności złączy nie da się oceniać)`);
      else for (const pr of r.endPairs) for (const c of pr ?? []) if (all[c]?.kind !== 'connector') err(`registries["${k}"].endPairs: "${c}" nie jest znanym złączem`);
      if (!Array.isArray(r.carriesSignals) || !r.carriesSignals.length) warn(`registries["${k}"]: kabel bez carriesSignals`);
      else for (const s of r.carriesSignals) if (all[s]?.kind !== 'signal') err(`registries["${k}"].carriesSignals: "${s}" nie jest znanym sygnałem`);
    }
  }
  const hasRegs = typeof reg === 'object' && !Array.isArray(reg) && Object.keys(reg).length > 0;
  if (Array.isArray(p.devices) && !p.devices.length && hasRegs) { if (errors.length) return { errors, warnings }; return { errors, warnings, pack: p as Pack }; } // pakiet samych rejestrów (wspólne złącza/sygnały dla innych pakietów)
  if (!Array.isArray(p.devices) || !p.devices.length) { err('devices: wymagana niepusta lista urządzeń (albo pakiet samych rejestrów: devices = [] i niepuste registries)'); return { errors, warnings }; }
  const keys = new Set<string>(), defIds = new Set<string>(), missing = new Set<string>();
  p.devices.forEach((d: any, i: number) => {
    const at = `devices[${i}]${isStr(d?.key) ? ` (${d.key})` : ''}`;
    if (!d || typeof d !== 'object') { err(`${at}: oczekiwano obiektu`); return; }
    if (!isStr(d.key) || !KEY_RE.test(d.key)) err(`${at}.key: małe litery, cyfry, - lub _ (np. "mikser-8sdi")`);
    else { if (keys.has(d.key)) err(`${at}.key: duplikat klucza`); keys.add(d.key); const id = definitionIdOf(String(p.id ?? ''), d.key); if (defIds.has(id)) err(`${at}.key: po usunięciu znaków specjalnych koliduje z innym urządzeniem (${id})`); defIds.add(id); }
    for (const k of Object.keys(d)) if (!DEV_FIELDS.includes(k)) warn(`${at}.${k}: nieznane pole urządzenia (zostanie pominięte)`);
    for (const f of ['manufacturer', 'model', 'category']) if (!isStr(d[f])) err(`${at}.${f}: wymagane`);
    if (d.tags !== undefined && (!Array.isArray(d.tags) || d.tags.some((t: unknown) => !isStr(t)))) err(`${at}.tags: lista niepustych tekstów`);
    if (d.description !== undefined && (typeof d.description !== 'string' || d.description.length > 400)) err(`${at}.description: tekst do 400 znaków (własnymi słowami, bez kopiowania opisów katalogowych)`);
    if (d.kind !== undefined && !['physical', 'virtual'].includes(d.kind)) err(`${at}.kind: physical lub virtual`);
    const virtual = d.kind === 'virtual';
    if (d.dimensionsMm !== undefined) { const m = d.dimensionsMm; for (const f of ['width', 'depth', 'height']) if (!isNum(m?.[f]) || m[f] <= 0 || m[f] > 20000) err(`${at}.dimensionsMm.${f}: liczba w mm, 1–20000`); }
    else if (!virtual) warn(`${at}: brak dimensionsMm (urządzenie bez wymiarów nie trafi na plan w skali)`);
    if (d.weightKg !== undefined && (!isNum(d.weightKg) || d.weightKg < 0 || d.weightKg > 5000)) err(`${at}.weightKg: liczba 0–5000`);
    if (d.powerW !== undefined && (!isNum(d.powerW) || d.powerW < 0 || d.powerW > 200000)) err(`${at}.powerW: liczba 0–200000 (pobór typowy)`);
    if (d.powerMaxW !== undefined && (!isNum(d.powerMaxW) || d.powerMaxW < 0 || d.powerMaxW > 200000)) err(`${at}.powerMaxW: liczba 0–200000 (pobór maksymalny)`);
    if (isNum(d.powerW) && isNum(d.powerMaxW) && d.powerMaxW < d.powerW) err(`${at}.powerMaxW: nie może być mniejsze od powerW`);
    if (d.dinModules !== undefined && (!Number.isInteger(d.dinModules) || d.dinModules < 1 || d.dinModules > 72)) err(`${at}.dinModules: całkowita liczba modułów 1–72`);
    if (d.rackUnits !== undefined) { const r = d.rackUnits; if (!Number.isInteger(r?.heightU) || r.heightU < 1 || r.heightU > 60) err(`${at}.rackUnits.heightU: całkowite 1–60`); if (![1, 0.5, 0.33].includes(r?.widthFraction)) err(`${at}.rackUnits.widthFraction: 1, 0.5 lub 0.33`); }
    // źródło danych
    const s = d.source;
    if (!s || typeof s !== 'object') err(`${at}.source: wymagane źródło danych {kind, ref, …}`);
    else {
      if (!SOURCE_KINDS.includes(s.kind)) err(`${at}.source.kind: jedno z ${SOURCE_KINDS.join(', ')}`);
      if ((s.kind === 'datasheet' || s.kind === 'manual') && !isStr(s.ref)) err(`${at}.source.ref: dla ${s.kind} wymagany odnośnik (nazwa dokumentu producenta, numer, adres)`);
      if (s.kind === 'measured' && !isStr(s.ref) && !isStr(s.note)) err(`${at}.source.note: dla measured opisz, skąd pochodzą dane (np. "egzemplarz własny, sprawdzony 2026-11-02")`);
      for (const k of Object.keys(s)) if (!SRC_FIELDS.includes(k)) warn(`${at}.source.${k}: nieznane pole źródła (zostanie pominięte)`);
      if (s.url !== undefined && (typeof s.url !== 'string' || !/^https?:\/\/\S+$/.test(s.url))) err(`${at}.source.url: adres http(s) bez spacji`);
      if (s.hardwareRevision !== undefined && !isStr(s.hardwareRevision)) err(`${at}.source.hardwareRevision: niepusty tekst (np. "rev B")`);
      if (s.generated !== undefined && typeof s.generated !== 'boolean') err(`${at}.source.generated: true lub false`);
      if (s.generated === true && s.verified) warn(`${at}: dane wygenerowane automatycznie mają datę weryfikacji; upewnij się, że człowiek porównał je z dokumentem`);
      if (s.generated === true && !s.verified) warn(`${at}: dane wygenerowane automatycznie i niezweryfikowane (traktuj jako robocze)`);
      else if (!s.verified && (s.kind === 'datasheet' || s.kind === 'manual' || s.kind === 'measured')) warn(`${at}: źródło bez daty weryfikacji (source.verified): dane niezweryfikowane`);
      if (s.kind === 'estimated') warn(`${at}: dane oznaczone jako szacunkowe: zweryfikuj z dokumentacją`);
      if (s.verified !== undefined && (typeof s.verified !== 'string' || !DATE_RE.test(s.verified))) err(`${at}.source.verified: data RRRR-MM-DD`);
      if (String(d.manufacturer).trim().toLowerCase() !== 'generic' && (s.kind === 'generic')) err(`${at}.source.kind: "generic" jest tylko dla producenta "Generic"`);
      if (String(d.manufacturer).trim().toLowerCase() === 'generic' && !['generic', 'custom'].includes(s.kind)) warn(`${at}: producent "Generic" zwykle ma source.kind generic lub custom`);
    }
    // porty
    if (!Array.isArray(d.ports) || (!d.ports.length && !virtual)) { err(`${at}.ports: wymagana niepusta lista portów`); return; }
    const pk = new Set<string>(), pids = new Set<string>(), labels = new Map<string, number>();
    d.ports.forEach((q: any, j: number) => {
      const pa = `${at}.ports[${j}]${isStr(q?.key) ? ` (${q.key})` : ''}`;
      if (!q || typeof q !== 'object') { err(`${pa}: oczekiwano obiektu`); return; }
      for (const k of Object.keys(q)) if (!PORT_FIELDS.includes(k)) warn(`${pa}.${k}: nieznane pole portu (zostanie pominięte)`);
      if (q.group !== undefined && !isStr(q.group)) err(`${pa}.group: niepusty tekst (nazwa grupy portów, np. "SDI IN")`);
      if (q.electrical !== undefined) {
        const e = q.electrical;
        if (!e || typeof e !== 'object' || Array.isArray(e)) err(`${pa}.electrical: oczekiwano obiektu {voltageMinV, voltageMaxV, maxW}`);
        else {
          for (const f of ['voltageMinV', 'voltageMaxV', 'maxW']) if (e[f] !== undefined && (!isNum(e[f]) || e[f] < 0 || e[f] > 100000)) err(`${pa}.electrical.${f}: liczba 0–100000`);
          if (isNum(e.voltageMinV) && isNum(e.voltageMaxV) && e.voltageMinV > e.voltageMaxV) err(`${pa}.electrical: voltageMinV większe od voltageMaxV`);
        }
      }
      if (!isStr(q.key) || !KEY_RE.test(q.key)) err(`${pa}.key: małe litery, cyfry, - lub _ (np. "sdi-in-1")`);
      else { if (pk.has(q.key)) err(`${pa}.key: duplikat w urządzeniu`); pk.add(q.key); const id = portIdOf(q.key); if (pids.has(id)) err(`${pa}.key: po usunięciu znaków specjalnych koliduje z innym portem (${id})`); pids.add(id); }
      if (!isStr(q.label)) err(`${pa}.label: wymagana etykieta`); else labels.set(q.label, (labels.get(q.label) ?? 0) + 1);
      if (!isStr(q.connector) || all[q.connector]?.kind !== 'connector') { err(`${pa}.connector: "${q.connector}" nie jest znanym złączem (zdefiniuj je w registries pakietu)`); if (isStr(q.connector)) missing.add(q.connector); }
      if (!Array.isArray(q.signals) || !q.signals.length) err(`${pa}.signals: wymagana niepusta lista sygnałów`);
      else for (const sg of q.signals) if (all[sg]?.kind !== 'signal') { err(`${pa}.signals: "${sg}" nie jest znanym sygnałem (zdefiniuj go w registries pakietu)`); missing.add(String(sg)); }
      if (!DIRECTIONS.includes(q.direction)) err(`${pa}.direction: ${DIRECTIONS.join(', ')}`);
      if (q.capacity !== undefined && (!Number.isInteger(q.capacity) || q.capacity < 1 || q.capacity > 64)) err(`${pa}.capacity: całkowite 1–64`);
      if (q.side !== undefined && !(SIDES as readonly string[]).includes(q.side)) err(`${pa}.side: ${SIDES.join(', ')}`);
    });
    for (const [l, n] of labels) if (n > 1) warn(`${at}: etykieta portu "${l}" występuje ${n} razy`);
  });
  if (missing.size) errors.unshift(`Brakujące wpisy rejestrów (${missing.size}): ${[...missing].sort().join(', ')}. Dodaj je do registries tego pakietu albo do pakietu rejestrów, który jest już wczytany`);
  if (errors.length) return { errors, warnings };
  return { errors, warnings, pack: p as Pack };
}

/** Rewizja definicji z urządzenia pakietu (rewizja 1; pola wg DOMAIN-MODEL §5.3). */
export function deviceToRevision(pack: Pack, d: PackDevice): DefinitionRevision {
  const ports: Record<string, PortDefinition> = {};
  d.ports.forEach((q, i) => {
    ports[portIdOf(q.key)] = { label: q.label, order: i + 1, connectorKey: q.connector, signalKeys: [...q.signals], direction: q.direction, side: q.side ?? 'auto', capacity: q.capacity ?? 1, ...(q.note ? { notes: q.note } : {}), ...(q.group ? { group: q.group } : {}), ...(q.electrical ? { electrical: { ...q.electrical } } : {}) };
  });
  const custom = d.source.kind === 'generic' || d.source.kind === 'custom';
  const rev: DefinitionRevision = {
    manufacturer: d.manufacturer, model: d.model, category: d.category, kind: d.kind ?? 'physical',
    symbol: { icon: alnum(d.category.split('/')[0]), color: '#444444' },
    origin: { ...(custom ? { custom: true } : {}), packId: pack.id, packVersion: pack.version, license: pack.license, source: d.source.ref ?? d.source.kind },
    ports,
    key: defKeyOf(pack.id, d.key), sourceKind: d.source.kind,
  };
  if (d.dimensionsMm) rev.dimensionsMm = { ...d.dimensionsMm };
  if (d.rackUnits) rev.rackUnits = { ...d.rackUnits };
  if (d.dinModules) rev.dinModules = d.dinModules;
  if (d.tags?.length) rev.tags = [...d.tags];
  if (d.weightKg !== undefined) rev.weightKg = d.weightKg;
  if (d.powerW !== undefined) rev.powerW = d.powerW;
  if (d.powerMaxW !== undefined) rev.powerMaxW = d.powerMaxW;
  if (d.description) rev.notes = d.description;
  if (d.source.verified) rev.sourceVerified = d.source.verified;
  if (d.source.url) rev.sourceUrl = d.source.url;
  if (d.source.hardwareRevision) rev.hardwareRevision = d.source.hardwareRevision;
  if (d.source.generated) rev.sourceGenerated = true;
  return rev;
}

/** Urządzenie pakietu z rewizji definicji projektu (do eksportu); klucze portów wynikają z identyfikatorów. */
export function revisionToDevice(rev: DefinitionRevision, key: string): PackDevice {
  const ports: PackPort[] = Object.entries(rev.ports).sort((a, b) => a[1].order - b[1].order).map(([id, p]) => ({
    key: id.replace(/^prt_/, ''), label: p.label, connector: p.connectorKey, signals: [...p.signalKeys], direction: p.direction, ...(p.capacity !== 1 ? { capacity: p.capacity } : {}),
    ...(p.side && p.side !== 'auto' ? { side: p.side } : {}), ...(p.notes ? { note: p.notes } : {}),
    ...(typeof p.group === 'string' && p.group ? { group: p.group } : {}), ...(p.electrical && typeof p.electrical === 'object' ? { electrical: { ...(p.electrical as PortElectrical) } } : {}),
  }));
  const src = (rev.sourceKind as SourceKind | undefined) ?? 'custom';
  const d: PackDevice = {
    key, manufacturer: rev.manufacturer, model: rev.model, category: rev.category, ports,
    source: { kind: src, ...(rev.origin?.source && rev.origin.source !== src ? { ref: rev.origin.source } : {}), ...(rev.sourceVerified ? { verified: String(rev.sourceVerified) } : {}),
      ...(typeof rev.sourceUrl === 'string' ? { url: rev.sourceUrl } : {}), ...(typeof rev.hardwareRevision === 'string' ? { hardwareRevision: rev.hardwareRevision } : {}), ...(rev.sourceGenerated === true ? { generated: true } : {}) },
  };
  if (rev.kind === 'virtual') d.kind = 'virtual';
  if (rev.dimensionsMm) d.dimensionsMm = { ...rev.dimensionsMm };
  if (rev.rackUnits) d.rackUnits = { ...rev.rackUnits };
  if (rev.dinModules) d.dinModules = rev.dinModules;
  if (Array.isArray(rev.tags) && rev.tags.length) d.tags = [...(rev.tags as string[])];
  if (typeof rev.weightKg === 'number') d.weightKg = rev.weightKg;
  if (typeof rev.powerW === 'number') d.powerW = rev.powerW;
  if (typeof rev.powerMaxW === 'number') d.powerMaxW = rev.powerMaxW;
  if (typeof rev.notes === 'string' && rev.notes) d.description = rev.notes.slice(0, 400);
  return d;
}

/** Klucz urządzenia z modelu: małe litery i myślniki; unikalny względem `taken`. */
export function deviceKeyFor(model: string, taken: Iterable<string>): string {
  const used = new Set(taken), base = model.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'urzadzenie';
  let k = base, n = 2; while (used.has(k)) k = `${base}-${n++}`; return k;
}
