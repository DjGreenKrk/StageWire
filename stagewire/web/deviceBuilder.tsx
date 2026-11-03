// Kreator urządzenia (React): nowe urządzenie od zera albo na wzór istniejącego, gotowe zestawy portów („8 × XLR wejście”), podgląd bloku na żywo,
// sprawdzanie na bieżąco i zapis do „Moje urządzenia” (pojedynczo, bez przepisywania reszty biblioteki). Wygląd: biblioteka `ui/`.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { Button, Chip, Dialog, Field, Input, Notice, Panel, Row, Section, Select } from '../ui/index.ts';
import { starterRegistries, catalogEntries } from '../src/catalog/index.ts';
import { SOURCE_KINDS, type PackDevice, type PackPort, type SourceKind } from '../src/pack.ts';
import { buildDevice, checkDevice, expandPreset, presetsAvailable, MY_PACK_ID, type DeviceForm } from '../src/deviceBuild.ts';

type Lib = { saveDevices(d: PackDevice[], onConflict?: () => 'replace' | 'keep-both' | 'skip'): Promise<{ added: string[]; replaced: string[]; skipped: string[]; pack: { devices: PackDevice[] } }> };
export interface BuilderCtx {
  library: Lib; say(m: string): void;
  /** Po zapisie: dodanie urządzenia do projektu (klucz w katalogu: `moje-urzadzenia/<klucz>`). */
  addToProject?(entryKey: string, model: string): void;
  /** Urządzenie wyjściowe (kopia istniejącego) i klucz, który ma zostać zastąpiony przy zapisie (edycja własnego urządzenia). */
  prefill?: PackDevice; editKey?: string;
}
const DIRS: [PackPort['direction'], string][] = [['in', 'wejście'], ['out', 'wyjście'], ['io', 'wej./wyj.'], ['loop', 'przelot']];
const KIND_LABEL: Record<string, string> = { datasheet: 'karta katalogowa producenta', manual: 'instrukcja producenta', measured: 'zmierzone / sprawdzone na egzemplarzu', estimated: 'szacunek (do weryfikacji)', generic: 'urządzenie ogólne', custom: 'własne opracowanie' };
const numOrNull = (s: string): number | null => { const t = s.trim().replace(',', '.'); if (!t) return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };
const FIELD: Record<string, string> = { manufacturer: 'Producent', model: 'Model', category: 'Kategoria', ports: 'Porty', dimensionsMm: 'Wymiary', weightKg: 'Masa', powerW: 'Moc typowa', powerMaxW: 'Moc maksymalna', source: 'Źródło danych', description: 'Opis', rackUnits: 'Rack', dinModules: 'Moduły DIN', tags: 'Tagi', key: 'Klucz' };
/** Komunikaty walidatora pakietów w zwykłym języku: bez ścieżek typu devices[0] (klucz).pole. */
const human = (m: string): string => {
  if (/brak dimensionsMm/.test(m)) return 'Brak wymiarów: urządzenie nie trafi na plan w skali (uzupełnij w „Wymiary, masa…”).';
  let t = m.replace(/^devices\[0\]( \([^)]*\))?/, '').replace(/^\./, '');
  t = t.replace(/^ports\[(\d+)\]( \([^)]*\))?\.?/, (_x, i) => `Port ${Number(i) + 1}: `);
  t = t.replace(/^(\w+)(\.\w+)?: /, (_x, f) => `${FIELD[f] ?? f}: `).replace(/^[:\s]+/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const rnd = () => Math.random().toString(36).slice(2, 5);
const reg = starterRegistries;
const regOptions = (kind: string): [string, string][] => Object.entries(reg).filter(([, r]) => r.kind === kind).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl')).map(([k, r]) => [k, r.name]);

function Dlg({ c, onClose }: { c: BuilderCtx; onClose(): void }) {
  const pre = c.prefill;
  const [st, setSt] = useState({
    manufacturer: pre?.manufacturer ?? '', model: pre?.model ?? '', category: pre?.category ?? '', tags: (pre?.tags ?? []).join(', '), description: pre?.description ?? '',
    w: String(pre?.dimensionsMm?.width ?? ''), d: String(pre?.dimensionsMm?.depth ?? ''), h: String(pre?.dimensionsMm?.height ?? ''),
    weight: pre?.weightKg !== undefined ? String(pre.weightKg) : '', power: pre?.powerW !== undefined ? String(pre.powerW) : '', powerMax: pre?.powerMaxW !== undefined ? String(pre.powerMaxW) : '',
    ru: String(pre?.rackUnits?.heightU ?? ''), ruFrac: String(pre?.rackUnits?.widthFraction ?? 1), din: String(pre?.dinModules ?? ''),
    srcKind: (pre?.source.kind ?? 'custom') as SourceKind, srcRef: pre?.source.ref ?? '', srcUrl: pre?.source.url ?? '', srcVerified: pre?.source.verified ?? '', srcNote: pre?.source.note ?? '',
  });
  const [ports, setPorts] = useState<PackPort[]>(() => (pre?.ports ?? []).map((p) => ({ ...p, signals: [...p.signals] })));
  const [presetSel, setPresetSel] = useState(''), [presetCount, setPresetCount] = useState(8), [failure, setFailure] = useState('');
  const set = (k: keyof typeof st, v: string) => setSt((s) => ({ ...s, [k]: v }));
  const presets = useMemo(() => presetsAvailable(reg), []);
  const conns = useMemo(() => regOptions('connector'), []), sigs = useMemo(() => regOptions('signal'), []);
  const sigName = (k: string) => reg[k]?.name ?? k;
  const manufacturers = useMemo(() => [...new Set(catalogEntries.map((e) => e.manufacturer))].sort(), []);
  const categories = useMemo(() => [...new Set(catalogEntries.map((e) => e.category))].sort(), []);
  const takenKeys = () => (c.library as { takenKeys?(): string[] }).takenKeys?.() ?? catalogEntries.filter((e) => e.packId === MY_PACK_ID).map((e) => e.devKey);

  const form = (): DeviceForm | string => {
    const dims = [numOrNull(st.w), numOrNull(st.d), numOrNull(st.h)], ru = numOrNull(st.ru), din = numOrNull(st.din), wt = numOrNull(st.weight), pw = numOrNull(st.power), pm = numOrNull(st.powerMax);
    if ([...dims, ru, din, wt, pw, pm].some((x) => Number.isNaN(x))) return 'Pola liczbowe: wpisz liczbę (np. 482 albo 2,5)';
    if (dims.some((x) => x === null) && dims.some((x) => x !== null)) return 'Wymiary: podaj wszystkie trzy (szerokość, głębokość, wysokość) albo żadnego';
    return {
      manufacturer: st.manufacturer, model: st.model, category: st.category, tags: st.tags.split(',').map((t) => t.trim()).filter(Boolean), description: st.description,
      dimensionsMm: dims[0] === null ? null : { width: dims[0]!, depth: dims[1]!, height: dims[2]! }, weightKg: wt, powerW: pw, powerMaxW: pm,
      rackUnits: ru === null ? null : { heightU: ru!, widthFraction: Number(st.ruFrac) }, dinModules: din, ports,
      source: { kind: st.srcKind, ...(st.srcRef.trim() ? { ref: st.srcRef.trim() } : {}), ...(st.srcUrl.trim() ? { url: st.srcUrl.trim() } : {}), ...(st.srcVerified.trim() ? { verified: st.srcVerified.trim() } : {}), ...(st.srcNote.trim() ? { note: st.srcNote.trim() } : {}) },
    };
  };
  const cur = useMemo((): { device?: PackDevice; errors: string[]; warnings: string[] } => {
    const f = form(); if (typeof f === 'string') return { errors: [f], warnings: [] };
    const device = buildDevice(f, c.editKey ? [] : takenKeys(), c.editKey), rep = checkDevice(device, { ...reg });
    return { device, errors: rep.errors, warnings: rep.warnings };
  }, [st, ports]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchPort = (i: number, patch: Partial<PackPort>) => setPorts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const movePort = (i: number, to: number) => setPorts((ps) => { const a = [...ps]; [a[i], a[to]] = [a[to], a[i]]; return a; });
  const save = async (andAdd: boolean) => {
    if (!cur.device || cur.errors.length) return;
    try {
      const res = await c.library.saveDevices([cur.device], () => 'replace'); onClose();
      c.say(res.skipped.length ? 'Takie urządzenie już jest w Moich urządzeniach' : `Zapisano „${cur.device.model}” w Moich urządzeniach`);
      if (andAdd) c.addToProject?.(`${MY_PACK_ID}/${cur.device.key}`, cur.device.model);
    } catch (e) { setFailure(String((e as Error).message)); }
  };

  const left = ports.filter((p) => p.direction === 'in' || p.direction === 'loop'), right = ports.filter((p) => p.direction === 'out'), io = ports.filter((p) => p.direction === 'io');
  const txt = (k: keyof typeof st, id: string, label: string, o: { required?: boolean; list?: string; hint?: string; minWidth?: number } = {}) => (
    <Field label={label} required={o.required} hint={o.hint} minWidth={o.minWidth}><Input id={id} value={st[k]} list={o.list} onChange={(e) => set(k, e.target.value)} /></Field>);
  const title = c.editKey ? 'Edytuj urządzenie' : pre ? 'Nowe urządzenie na wzór istniejącego' : 'Nowe urządzenie';
  const details = (open: boolean) => ({ open: open || undefined });

  return (
    <Dialog id="builddialog" title={title} onClose={onClose} footer={<>
      <div className="sw-grow">{failure ? <Notice kind="error">{failure}</Notice> : (
        <div id="b-check">{cur.errors.length ? <Notice kind="error"><div><b>Do poprawienia:</b><ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{cur.errors.slice(0, 6).map((e) => <li key={e}>{human(e)}</li>)}</ul></div></Notice>
          : <Notice kind={cur.warnings.length ? 'warn' : 'ok'}>{cur.warnings.length ? <div>{cur.warnings.slice(0, 3).map((w) => <div key={w}>{human(w)}</div>)}</div> : 'Dane poprawne.'}</Notice>}</div>)}</div>
      <Button id="bd-cancel" variant="ghost" onClick={onClose}>Anuluj</Button>
      {c.addToProject && <Button id="bd-saveadd" disabled={cur.errors.length > 0} onClick={() => void save(true)}>Zapisz i dodaj do projektu</Button>}
      <Button id="bd-save" variant="primary" disabled={cur.errors.length > 0} onClick={() => void save(false)}>Zapisz w Moich urządzeniach</Button></>}>
      <datalist id="b-mf">{manufacturers.map((m) => <option key={m} value={m} />)}</datalist><datalist id="b-cat">{categories.map((m) => <option key={m} value={m} />)}</datalist>
      <Row>{txt('model', 'b-model', 'Model', { required: true, minWidth: 200 })}{txt('manufacturer', 'b-manufacturer', 'Producent', { required: true, list: 'b-mf', minWidth: 160 })}{txt('category', 'b-category', 'Kategoria', { required: true, list: 'b-cat', hint: 'np. wideo / konwertery', minWidth: 180 })}{txt('tags', 'b-tags', 'Tagi (po przecinku)')}</Row>
      <div className="sw-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) 230px' }}>
        <div>
          <Section>Porty</Section>
          <div className="sw-panel" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
            <Field label="Liczba" minWidth={70}><Input id="b-pcount" type="number" min={1} max={64} value={presetCount} onChange={(e) => setPresetCount(Number(e.target.value) || 1)} style={{ width: 76 }} /></Field>
            <Field label="Rodzaj portu" grow={1} minWidth={200}><Select id="b-preset" value={presetSel || presets[0]?.id} options={presets.map((p) => [p.id, p.label] as [string, string])} onChange={(e) => setPresetSel(e.target.value)} /></Field>
            <Button id="b-padd" variant="primary" onClick={() => { const p = presets.find((x) => x.id === (presetSel || presets[0]?.id)); if (p) setPorts((ps) => [...ps, ...expandPreset(p, presetCount, ps)]); }}>Dodaj</Button>
            <Button id="b-pblank" title="Pusty wiersz do ręcznego wypełnienia" onClick={() => setPorts((ps) => [...ps, { key: `port-${ps.length + 1}-${rnd()}`, label: `Port ${ps.length + 1}`, connector: 'std/rj45', signals: ['std/ethernet'], direction: 'io' }])}>+ Własny port</Button></div>
          <div id="b-rows" style={{ maxHeight: '34vh', overflow: 'auto' }}>{ports.map((p, i) => (
            <div className="prow sw-prow" key={p.key} data-i={i}>
              <Input className="f-label" value={p.label} aria-label="Nazwa portu" onChange={(e) => patchPort(i, { label: e.target.value })} />
              <Select className="f-conn" aria-label="Złącze" value={p.connector} options={conns} onChange={(e) => patchPort(i, { connector: e.target.value })} />
              <Select className="f-sig" aria-label="Sygnał" value={p.signals[0]} title={p.signals.length > 1 ? `Port ma więcej sygnałów: ${p.signals.map(sigName).join(', ')}` : ''} options={sigs} onChange={(e) => patchPort(i, { signals: [e.target.value, ...p.signals.slice(1).filter((s) => s !== e.target.value)] })} />
              <Select className="f-dir" aria-label="Kierunek" value={p.direction} options={DIRS.map(([v, l]) => [v, l])} onChange={(e) => patchPort(i, { direction: e.target.value as PackPort['direction'] })} />
              <Button className="f-up" size="sm" icon variant="ghost" aria-label="W górę" disabled={i === 0} onClick={() => movePort(i, i - 1)}>▲</Button>
              <Button className="f-dn" size="sm" icon variant="ghost" aria-label="W dół" disabled={i === ports.length - 1} onClick={() => movePort(i, i + 1)}>▼</Button>
              <Button className="f-dup" size="sm" icon variant="ghost" aria-label="Powiel" title="Powiel port" onClick={() => setPorts((ps) => { const q = ps[i]; const a = [...ps]; a.splice(i + 1, 0, { ...q, signals: [...q.signals], key: `${q.key}-k${rnd()}`, label: `${q.label} (kopia)` }); return a; })}>⧉</Button>
              <Button className="f-del" size="sm" icon variant="ghost" aria-label="Usuń" title="Usuń port" onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))}>✕</Button>
            </div>))}</div>
          {!ports.length && <p className="sw-hint">Dodaj porty gotowym zestawem (np. „8 × XLR wejście”) albo pojedynczo.</p>}
        </div>
        <div><div className="sw-hint" style={{ marginBottom: 4 }}>Podgląd bloku</div>
          <div id="b-pv"><Panel title={st.model || 'Nowe urządzenie'}>
            <div className="sw-hint" style={{ marginTop: -4, marginBottom: 6 }}>{st.manufacturer || 'producent'}</div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'space-between' }}>
              <div className="sw-chips" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>{[...left, ...io].map((p) => <Chip key={p.key} label={p.label} color="#00C853" />)}</div>
              <div className="sw-chips" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>{right.map((p) => <Chip key={p.key} label={p.label} color="#FFD54F" />)}</div></div></Panel></div></div>
      </div>
      <details id="b-more" {...details(!!pre?.dimensionsMm || !!pre?.rackUnits)} style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer', color: '#00C853', margin: '4px 0 8px' }}>Wymiary, masa, zasilanie, rack, opis</summary>
        <Row>{txt('w', 'b-w', 'Szerokość [mm]')}{txt('d', 'b-d', 'Głębokość [mm]')}{txt('h', 'b-h', 'Wysokość [mm]')}{txt('weight', 'b-weight', 'Masa [kg]')}</Row>
        <Row>{txt('power', 'b-power', 'Pobór typowy [W]')}{txt('powerMax', 'b-powermax', 'Pobór maksymalny [W]')}{txt('din', 'b-din', 'Moduły DIN')}</Row>
        <Row>{txt('ru', 'b-ru', 'Rack [U] (puste = nie do racka)')}
          <Field label="Szerokość w racku"><Select id="b-rufrac" value={st.ruFrac} options={[['1', 'pełna'], ['0.5', 'połowa'], ['0.33', 'trzecia część']]} onChange={(e) => set('ruFrac', e.target.value)} /></Field></Row>
        <Row>{txt('description', 'b-desc', 'Opis (własnymi słowami, do 400 znaków)', { minWidth: 300 })}</Row></details>
      <details id="b-src" open style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: '#00C853', margin: '4px 0 8px' }}>Skąd te dane?</summary>
        <Row><Field label="Źródło" minWidth={220}><Select id="b-srckind" value={st.srcKind} options={(SOURCE_KINDS as readonly string[]).map((k) => [k, KIND_LABEL[k] ?? k] as [string, string])} onChange={(e) => set('srcKind', e.target.value)} /></Field>
          {txt('srcRef', 'b-srcref', 'Dokument / odnośnik')}{txt('srcUrl', 'b-srcurl', 'Adres (https://…)')}{txt('srcVerified', 'b-srcver', 'Sprawdzono (RRRR-MM-DD)')}</Row>
        <p className="sw-hint">Dane wpisuj własnymi słowami i wskaż dokument producenta; nie kopiuj cudzych baz ani opisów. Bez daty sprawdzenia dane są oznaczone jako niezweryfikowane.</p></details>
    </Dialog>);
}

export function openDeviceBuilder(c: BuilderCtx) {
  document.getElementById('builddialog-root')?.remove();
  const host = document.createElement('div'); host.id = 'builddialog-root'; document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Dlg c={c} onClose={() => { root.unmount(); host.remove(); }} />);
}
