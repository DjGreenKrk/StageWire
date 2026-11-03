// Kreator elementów elektrycznych (ADR-064) w React: wybór rodzaju, kilka parametrów, żywy podgląd torów i mostków, zapis do „Moje urządzenia”.
// Definicję składa `src/electricalTemplates.ts`; wygląd z biblioteki `ui/` (pilotaż React, ADR-066).
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { Button, ChoiceCards, Checkbox, Dialog, Field, Input, Notice, Panel, Row, Section, Select, Chip } from '../ui/index.ts';
import { catalogEntries, catalogEnclosures, starterRegistries } from '../src/catalog/index.ts';
import { deviceKeyFor, SOURCE_KINDS, type PackDevice, type PackSource, type SourceKind } from '../src/pack.ts';
import { checkDevice, MY_PACK_ID } from '../src/deviceBuild.ts';
import { EL_KINDS, APPARATUS_LABEL, combTracks, generateBar, generateComb, generateBlock, generateTerminal, generateApparatus, deviceFromGenerated, buildEnclosure, type ElKind, type ApparatusKind, type Generated } from '../src/electricalTemplates.ts';

export interface ElectricalCtx {
  library: { saveDevices(d: PackDevice[], onConflict?: () => 'replace'): Promise<{ skipped: string[] }>; saveEnclosure(e: unknown): Promise<{ replaced: boolean }>; takenKeys?(): string[] };
  say(m: string): void;
  addToProject?(entryKey: string, model: string): void;
}

const TRACK_COLOR: Record<string, string> = { L1: '#A1887F', L2: '#B0BEC5', L3: '#78909C', N: '#42A5F5', PE: '#66BB6A' };
const trackColor = (t?: string) => (t ? TRACK_COLOR[t] ?? '#FFB300' : '#666');
const SRC_LABEL: Record<string, string> = { datasheet: 'karta katalogowa producenta', manual: 'instrukcja producenta', measured: 'zmierzone na egzemplarzu', estimated: 'szacunek (do weryfikacji)', generic: 'urządzenie ogólne', custom: 'własne opracowanie' };
const KIND_ICON: Record<ElKind, string> = { bar: '▤', comb: '⫴', block: '⊞', terminal: '⊟', apparatus: '⏻', enclosure: '▭' };
const KIND_TITLE: Record<ElKind, string> = { bar: 'Listwa zaciskowa', comb: 'Grzebień', block: 'Blok rozdzielczy', terminal: 'Złączka', apparatus: 'Aparat modułowy', enclosure: 'Obudowa' };
const num = (s: string): number => Number(String(s).trim().replace(',', '.'));
const plain = (m: string) => m.replace(/^devices\[0\]( \([^)]*\))?\.?/, '').replace(/^ports\[(\d+)\]( \([^)]*\))?\.?/, (_x, i) => `Port ${Number(i) + 1}: `);

interface State {
  kind: ElKind; manufacturer: string; model: string; category: string; description: string; height: string; depth: string; srcKind: SourceKind; srcRef: string; srcVerified: string;
  barTrack: string; barCount: string; barCap: string; barPer: string; wMin: string; wMax: string;
  poles: string; teeth: string; pitch: string; fits: string;
  blkTracks: string; blkOut: string;
  levels: string; tbTrack: string; tbJump: boolean;
  appKind: ApparatusKind; appPoles: string; appMpp: string; appFits: string; appCoil: boolean;
  eW: string; eH: string; eD: string; eRows: string; eMods: string; eIp: string; eMount: string;
}
const INITIAL: State = { kind: 'bar', manufacturer: '', model: '', category: '', description: '', height: '90', depth: '60', srcKind: 'custom', srcRef: '', srcVerified: '',
  barTrack: 'N', barCount: '10', barCap: '2', barPer: '3', wMin: '', wMax: '', poles: '3', teeth: '12', pitch: '1', fits: '', blkTracks: 'L1, L2, L3, N', blkOut: '4',
  levels: '1', tbTrack: '', tbJump: false, appKind: 'mcb', appPoles: '1', appMpp: '1', appFits: '', appCoil: true, eW: '', eH: '', eD: '', eRows: '2', eMods: '12', eIp: '', eMount: '' };

type Built = { gen?: Generated; device?: PackDevice; enclosure?: ReturnType<typeof buildEnclosure>; error?: string };

function build(st: State, takenKeys: string[]): Built {
  try {
    if (!st.model.trim()) return { error: 'Wpisz model' };
    const wires = (() => { const a = st.wMin.trim() ? num(st.wMin) : undefined, b = st.wMax.trim() ? num(st.wMax) : undefined; return a || b ? { minMm2: a, maxMm2: b } : undefined; })();
    const source: PackSource = { kind: st.srcKind, ...(st.srcRef.trim() ? { ref: st.srcRef.trim() } : {}), ...(st.srcVerified.trim() ? { verified: st.srcVerified.trim() } : {}) };
    if (st.kind === 'enclosure') {
      const keys = catalogEnclosures().filter((e) => e.packId === MY_PACK_ID).map((e) => e.enclosure.key);
      return { enclosure: buildEnclosure({ key: deviceKeyFor(st.model, keys), manufacturer: st.manufacturer || 'Własne', model: st.model, widthMm: num(st.eW), heightMm: num(st.eH), ...(st.eD.trim() ? { depthMm: num(st.eD) } : {}), rows: num(st.eRows), modules: num(st.eMods), ...(st.eIp.trim() ? { ip: st.eIp } : {}), ...(st.eMount ? { mounting: st.eMount as 'surface' } : {}), ...(st.description.trim() ? { description: st.description } : {}), source }) };
    }
    if (!st.manufacturer.trim()) return { error: 'Wpisz producenta (może być „Własne”)' };
    let gen: Generated;
    if (st.kind === 'bar') gen = generateBar({ track: st.barTrack === 'inny' ? '' : st.barTrack, count: num(st.barCount), capacity: num(st.barCap), perModule: num(st.barPer), wires });
    else if (st.kind === 'comb') gen = generateComb({ poles: num(st.poles) as 1 | 2 | 3 | 4, teeth: num(st.teeth), pitch: num(st.pitch), fits: st.fits });
    else if (st.kind === 'block') gen = generateBlock({ tracks: st.blkTracks.split(',').map((x) => x.trim()).filter(Boolean), outputs: num(st.blkOut), wires });
    else if (st.kind === 'terminal') gen = generateTerminal({ levels: num(st.levels), track: st.tbTrack || undefined, jumpers: st.tbJump, wires });
    else gen = generateApparatus({ kind: st.appKind, poles: num(st.appPoles), modulesPerPole: num(st.appMpp), fits: st.appFits || undefined, coil: st.appCoil, wires });
    const device = deviceFromGenerated(gen, { key: deviceKeyFor(st.model, takenKeys), manufacturer: st.manufacturer, model: st.model, category: st.category, description: st.description, source, heightMm: num(st.height) || 90, depthMm: num(st.depth) || 60 });
    const rep = checkDevice(device, { ...starterRegistries });
    if (rep.errors.length) return { gen, device, error: rep.errors.slice(0, 3).map(plain).join('; ') };
    return { gen, device };
  } catch (e) { return { error: (e as Error).message }; }
}

function Preview({ r }: { r: Built }) {
  if (r.enclosure) {
    const e = r.enclosure;
    return (<Panel title="Podgląd obudowy">
      {Array.from({ length: Math.min(e.rows, 8) }, (_, i) => <div key={i} className="sw-din" style={{ margin: '8px 0', height: 14 }}>{Array.from({ length: Math.min(e.modules, 48) }, (_, j) => <i key={j} />)}</div>)}
      <ul className="sw-list"><li>{e.rows} × {e.modules} mod. = {e.rows * e.modules} modułów</li><li>{e.widthMm} × {e.heightMm}{e.depthMm ? ` × ${e.depthMm}` : ''} mm{e.ip ? ` · ${e.ip}` : ''}</li></ul>
    </Panel>);
  }
  if (!r.gen || !r.device) return <Panel title="Podgląd"><span className="sw-hint">Uzupełnij parametry, aby zobaczyć podgląd.</span></Panel>;
  const groups = new Map<string, PackDevice['ports']>();
  for (const p of r.device.ports) { const g = p.group ?? 'Porty'; (groups.get(g) ?? groups.set(g, []).get(g)!).push(p); }
  const isComb = r.device.placementLayer === 'busbar';
  return (<Panel title="Podgląd">
    {isComb && <div className="sw-teeth" aria-label="Zęby grzebienia">{r.device.ports.map((p) => <span key={p.key} className="sw-tooth" style={{ '--c': trackColor(p.terminal?.track) } as React.CSSProperties} title={`${p.label} · tor ${p.terminal?.track}`}>{p.terminal?.track}</span>)}</div>}
    {!isComb && [...groups].slice(0, 8).map(([g, ps]) => (
      <div key={g} style={{ margin: '8px 0' }}><div className="sw-hint" style={{ marginBottom: 4 }}>{g}</div>
        <div className="sw-chips">{ps.slice(0, 40).map((p) => <Chip key={p.key} label={p.label} color={trackColor(p.terminal?.track)} title={p.terminal?.track ? `tor ${p.terminal.track}` : undefined} />)}{ps.length > 40 && <span className="sw-hint">… (+{ps.length - 40})</span>}</div></div>))}
    <ul className="sw-list">{r.gen.summary.map((s) => <li key={s}>{s}</li>)}<li>szerokość {r.gen.dinModules} mod. ({Math.round(r.gen.dinModules * 17.5 * 10) / 10} mm) · {r.device.ports.length} portów</li></ul>
  </Panel>);
}

function Dlg({ ctx, onClose }: { ctx: ElectricalCtx; onClose(): void }) {
  const [st, setSt] = useState<State>(INITIAL);
  const set = <K extends keyof State>(k: K, v: State[K]) => setSt((s) => ({ ...s, [k]: v }));
  const [failure, setFailure] = useState('');
  const takenKeys = ctx.library.takenKeys?.() ?? catalogEntries.filter((e) => e.packId === MY_PACK_ID).map((e) => e.devKey);
  const r = useMemo(() => build(st, takenKeys), [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = EL_KINDS.find((k) => k.kind === st.kind)!, isEnc = st.kind === 'enclosure';
  const fitTags = useMemo(() => [...new Set(catalogEntries.flatMap((e) => e.device.ports.flatMap((p) => p.terminal?.fits ?? [])))], []);
  const manufacturers = useMemo(() => [...new Set(catalogEntries.map((e) => e.manufacturer))].sort(), []);
  const txt = (k: keyof State, id: string, label: string, opts: { required?: boolean; hint?: string; placeholder?: string; list?: string; minWidth?: number; grow?: number } = {}) => (
    <Field label={label} required={opts.required} hint={opts.hint} minWidth={opts.minWidth} grow={opts.grow}><Input id={id} value={String(st[k])} placeholder={opts.placeholder} list={opts.list} inputMode="decimal" onChange={(e) => set(k, e.target.value as never)} /></Field>);
  const txtPlain = (k: keyof State, id: string, label: string, opts: { required?: boolean; hint?: string; placeholder?: string; list?: string; minWidth?: number; grow?: number } = {}) => (
    <Field label={label} required={opts.required} hint={opts.hint} minWidth={opts.minWidth} grow={opts.grow}><Input id={id} value={String(st[k])} placeholder={opts.placeholder} list={opts.list} onChange={(e) => set(k, e.target.value as never)} /></Field>);
  const wireRow = <Row>{txt('wMin', 'el-wmin', 'Przewód od [mm²]', { hint: 'opcjonalnie' })}{txt('wMax', 'el-wmax', 'do [mm²]')}</Row>;
  const save = async (andAdd: boolean) => {
    if (r.error) return;
    try {
      if (r.enclosure) { const res = await ctx.library.saveEnclosure(r.enclosure); onClose(); ctx.say(res.replaced ? `Zaktualizowano obudowę „${r.enclosure.model}”` : `Zapisano obudowę „${r.enclosure.model}”: jest w oknie „Nowa szafa”`); return; }
      if (!r.device) return;
      const res = await ctx.library.saveDevices([r.device], () => 'replace'); onClose();
      ctx.say(res.skipped.length ? 'Taki element już jest w Moich urządzeniach' : `Zapisano „${r.device.model}” w Moich urządzeniach`);
      if (andAdd) ctx.addToProject?.(`${MY_PACK_ID}/${r.device.key}`, r.device.model);
    } catch (e) { setFailure(String((e as Error).message)); }
  };
  return (
    <Dialog id="elbuilder" title="Nowy element elektryczny" onClose={onClose} footer={<>
      <div className="sw-grow">{failure ? <Notice kind="error">{failure}</Notice> : <Notice id="el-check" kind={r.error ? 'error' : 'ok'}>{r.error ?? 'Dane poprawne.'}</Notice>}</div>
      <Button id="el-cancel" variant="ghost" onClick={onClose}>Anuluj</Button>
      {!isEnc && ctx.addToProject && <Button id="el-saveadd" disabled={!!r.error} onClick={() => void save(true)}>Zapisz i dodaj do projektu</Button>}
      <Button id="el-save" variant="primary" disabled={!!r.error || (!r.device && !r.enclosure)} onClick={() => void save(false)}>{isEnc ? 'Zapisz obudowę' : 'Zapisz w Moich urządzeniach'}</Button></>}>
      <ChoiceCards label="Rodzaj elementu" idPrefix="el-kind" value={st.kind} onChange={(v) => set('kind', v as ElKind)} options={EL_KINDS.map((k) => ({ value: k.kind, title: KIND_TITLE[k.kind], icon: KIND_ICON[k.kind], hint: k.hint }))} />
      <p className="sw-muted">{info.hint}</p>
      <div className="sw-cols"><div>
        <Row>{txtPlain('model', 'el-model', 'Model', { required: true, minWidth: 180 })}{txtPlain('manufacturer', 'el-manufacturer', 'Producent', { required: !isEnc, list: 'el-mf', minWidth: 150 })}</Row>
        <datalist id="el-mf">{manufacturers.map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="el-fits-l">{fitTags.map((f) => <option key={f} value={f} />)}</datalist>
        <Section>Parametry</Section>
        {st.kind === 'bar' && <><Row>
          <Field label="Tor" minWidth={150}><Select id="el-bartrack" value={['N', 'PE'].includes(st.barTrack) ? st.barTrack : 'inny'} options={[['N', 'N (neutralny)'], ['PE', 'PE (ochronny)'], ['inny', 'inny…']]} onChange={(e) => set('barTrack', e.target.value === 'inny' ? 'inny' : e.target.value)} /></Field>
          {!['N', 'PE'].includes(st.barTrack) && <Field label="Nazwa toru" minWidth={120}><Input id="el-bartrack-x" value={st.barTrack === 'inny' ? '' : st.barTrack} onChange={(e) => set('barTrack', e.target.value || 'inny')} /></Field>}
          {txt('barCount', 'el-barcount', 'Liczba zacisków')}{txt('barCap', 'el-barcap', 'Przewodów na zacisk')}{txt('barPer', 'el-barper', 'Zacisków na moduł')}</Row>{wireRow}</>}
        {st.kind === 'comb' && <><Row>
          <Field label="Bieguny" minWidth={160}><Select id="el-poles" value={st.poles} options={[['1', '1P'], ['2', '2P (L + N)'], ['3', '3P (L1 L2 L3)'], ['4', '4P (L1 L2 L3 N)']]} onChange={(e) => set('poles', e.target.value)} /></Field>
          {txt('teeth', 'el-teeth', 'Liczba zębów')}{txt('pitch', 'el-pitch', 'Rozstaw [moduły]')}
          {txtPlain('fits', 'el-fits', 'Tag zgodności', { required: true, placeholder: 'np. 1mod-16mm2', list: 'el-fits-l', minWidth: 170, hint: 'taki sam w grzebieniu i w aparatach, które mają się z nim stykać' })}</Row>
          <p className="sw-muted">Kolejność torów: {combTracks(num(st.poles) as 1 | 2 | 3 | 4)?.join(' ')}.</p></>}
        {st.kind === 'block' && <><Row>{txtPlain('blkTracks', 'el-blktracks', 'Tory (po przecinku)', { minWidth: 220 })}{txt('blkOut', 'el-blkout', 'Wyjść na tor')}</Row>{wireRow}</>}
        {st.kind === 'terminal' && <><Row>
          <Field label="Poziomy" minWidth={140}><Select id="el-levels" value={st.levels} options={[['1', '1 (przelotowa)'], ['2', '2'], ['3', '3'], ['4', '4']]} onChange={(e) => set('levels', e.target.value)} /></Field>
          {txtPlain('tbTrack', 'el-tbtrack', 'Tor', { hint: 'opcjonalnie' })}</Row>
          <Checkbox id="el-tbjump" label="Mostki konfigurowalne między poziomami" checked={st.tbJump} onChange={(e) => set('tbJump', e.target.checked)} />{wireRow}</>}
        {st.kind === 'apparatus' && <><Row>
          <Field label="Rodzaj aparatu" minWidth={200}><Select id="el-appkind" value={st.appKind} options={Object.entries(APPARATUS_LABEL).map(([k, v]) => [k, v.label] as [string, string])} onChange={(e) => set('appKind', e.target.value as ApparatusKind)} /></Field>
          <Field label="Bieguny" minWidth={90}><Select id="el-apppoles" value={st.appPoles} options={[['1', '1P'], ['2', '2P'], ['3', '3P'], ['4', '4P']]} onChange={(e) => set('appPoles', e.target.value)} /></Field>
          {txt('appMpp', 'el-appmpp', 'Moduły na biegun')}{txtPlain('appFits', 'el-appfits', 'Zgodność z grzebieniem', { list: 'el-fits-l', hint: 'tag; puste = bez wejść pod grzebień', minWidth: 170 })}</Row>
          {st.appKind === 'contactor' && <Checkbox id="el-appcoil" label="Zaciski cewki A1/A2" checked={st.appCoil} onChange={(e) => set('appCoil', e.target.checked)} />}{wireRow}</>}
        {st.kind === 'enclosure' && <><Row>{txt('eW', 'el-ew', 'Szerokość [mm]', { required: true })}{txt('eH', 'el-eh', 'Wysokość [mm]', { required: true })}{txt('eD', 'el-ed', 'Głębokość [mm]')}</Row>
          <Row>{txt('eRows', 'el-erows', 'Szyny DIN (rzędy)', { required: true })}{txt('eMods', 'el-emods', 'Moduły na szynie', { required: true })}{txtPlain('eIp', 'el-eip', 'Stopień ochrony', { placeholder: 'np. IP65' })}
            <Field label="Montaż"><Select id="el-emount" value={st.eMount} options={[['', '(nie podano)'], ['surface', 'natynkowa'], ['flush', 'podtynkowa'], ['wall', 'ścienna'], ['floor', 'wolnostojąca']]} onChange={(e) => set('eMount', e.target.value)} /></Field></Row></>}
        {!isEnc && <><Section>Opis i wymiary</Section><Row>{txtPlain('category', 'el-category', 'Kategoria', { placeholder: info.category, minWidth: 220 })}{txt('height', 'el-height', 'Wysokość [mm]')}{txt('depth', 'el-depth', 'Głębokość [mm]')}</Row></>}
        <Row>{txtPlain('description', 'el-desc', 'Opis (własnymi słowami, do 400 znaków)', { minWidth: 260 })}</Row>
        <Section>Skąd te dane</Section>
        <Row><Field label="Źródło" minWidth={200}><Select id="el-srckind" value={st.srcKind} options={(SOURCE_KINDS as readonly string[]).map((k) => [k, SRC_LABEL[k] ?? k] as [string, string])} onChange={(e) => set('srcKind', e.target.value as SourceKind)} /></Field>
          {txtPlain('srcRef', 'el-srcref', 'Dokument / odnośnik')}{txtPlain('srcVerified', 'el-srcver', 'Sprawdzone dnia', { placeholder: 'RRRR-MM-DD' })}</Row>
        <p className="sw-hint">Rozstaw, tory i zgodność przepisz z dokumentacji producenta; kreator niczego nie zgaduje. Bez daty sprawdzenia dane są oznaczone jako niezweryfikowane.</p>
      </div><div id="el-pv" style={{ position: 'sticky', top: 0 }}><Preview r={r} /></div></div>
    </Dialog>);
}

export function openElectricalBuilder(ctx: ElectricalCtx) {
  document.getElementById('elbuilder-root')?.remove();
  const host = document.createElement('div'); host.id = 'elbuilder-root'; document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(<Dlg ctx={ctx} onClose={close} />);
}
