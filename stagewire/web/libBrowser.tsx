// Przeglądarka biblioteki urządzeń (React): wyszukiwarka, filtry z licznikami (kategoria, producent, wejścia, wyjścia, dane, pakiet),
// lista wyników i karta urządzenia z akcjami: dodaj do projektu, eksportuj jedno urządzenie, użyj jako wzoru, edytuj / usuń własne, importuj z pliku.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../ui/styles.css';
import { Button, Dialog, Field, Input, Notice, Select } from '../ui/index.ts';
import { catalogEntries, starterRegistries, type CatalogEntry } from '../src/catalog/index.ts';
import { buildFacets, filterEntries, sortEntries, toggleSelection, FACET_ORDER, type Selection } from '../src/libraryIndex.ts';
import { sourceTrust, TRUST_LABEL, type Pack, type PackDevice } from '../src/pack.ts';
import { MY_PACK_ID, type Conflict } from '../src/deviceBuild.ts';
import { openDeviceBuilder } from './deviceBuilder.tsx';
import { openElectricalBuilder } from './electricalBuilder.tsx';

export interface BrowserLib {
  saveDevices(d: PackDevice[], onConflict?: (d: PackDevice) => Conflict): Promise<{ added: string[]; replaced: string[]; skipped: string[]; renamed: [string, string][]; pack: Pack }>;
  removeMine(key: string): Promise<void>;
  exportDevice(d: PackDevice, meta: { author?: string; license: string }): Promise<string | undefined>;
  pickDevicesFile(): Promise<{ pack?: Pack; errors: string[]; warnings: string[] } | undefined>;
  checkDevicesFile(raw: unknown): { pack?: Pack; errors: string[]; warnings: string[] };
  myPack(): Pack | undefined;
  openDialogUi(): void;
}
export interface BrowserCtx { library: BrowserLib; say(m: string): void; addToProject(entryKey: string, model: string): void }
const LICENSES = ['CC0 (domena publiczna)', 'CC BY 4.0 (z podaniem autora)', 'własne (do użytku wewnętrznego)'];
const portsLine = (e: CatalogEntry) => { const ins = e.ports.filter((p) => p.direction === 'in').length, outs = e.ports.filter((p) => p.direction === 'out').length, io = e.ports.length - ins - outs; return `${ins} we · ${outs} wy${io ? ` · ${io} we/wy` : ''}`; };
const names = () => starterRegistries as Record<string, { name: string }>;
const errText = (e: unknown) => String((e as Error).message ?? e);
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

type ImportReq = { pack: Pack; warnings: string[] } | { error: string };

interface Memo { query: string; sel: Selection; current?: string }
function Browser({ c, onClose, initialImport, onReady, memo }: { c: BrowserCtx; onClose(): void; initialImport?: ImportReq; onReady(h: { importPack(r: ImportReq): void }): void; memo: Memo }) {
  const [query, setQuery] = useState(memo.query), [sel, setSel] = useState<Selection>(memo.sel), [current, setCurrent] = useState<string | undefined>(memo.current), [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState(0), [msg, setMsg] = useState<ReactNode>(null), [armed, setArmed] = useState(false);
  const [exporting, setExporting] = useState<CatalogEntry>(), [imp, setImp] = useState<{ pack: Pack; warnings: string[] }>(), [impKey, setImpKey] = useState(0);
  const q = useRef<HTMLInputElement>(null);
  memo.query = query; memo.sel = sel; memo.current = current; // filtry i wybór zostają po ponownym otwarciu
  const all = catalogEntries; void rev;
  const res = useMemo(() => sortEntries(filterEntries(all, query, sel)), [all, query, sel, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const facets = useMemo(() => buildFacets(all, query, sel, names()), [all, query, sel, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = current && res.some((e) => e.key === current) ? catalogEntries.find((e) => e.key === current) : undefined;
  const active = FACET_ORDER.some((f) => sel[f]?.length) || !!query.trim();
  const err = (m: string) => setMsg(<Notice kind="error">{m.split('\n').map((l, i) => <div key={i}>{l}</div>)}</Notice>);
  const ok = (m: string) => setMsg(<Notice kind="ok">{m}</Notice>);
  const add = (e: CatalogEntry) => { c.addToProject(e.key, e.model); ok(`Dodano „${e.model}” do projektu.`); };
  const showImport = (r: ImportReq) => { setExporting(undefined); if ('error' in r) err(r.error); else { setImp({ pack: r.pack, warnings: r.warnings }); setImpKey((k) => k + 1); setMsg(null); } };
  useEffect(() => { onReady({ importPack: showImport }); if (initialImport) showImport(initialImport); q.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const importFile = async () => {
    try {
      const r = await c.library.pickDevicesFile(); if (!r) return;
      if (!r.pack) { err(`Plik nie został wczytany:\n${r.errors.slice(0, 6).join('\n')}`); return; }
      showImport({ pack: r.pack, warnings: r.warnings });
    } catch (e) { err(errText(e)); }
  };
  const ctxB = { library: c.library as never, say: c.say, addToProject: c.addToProject };

  return (
    <Dialog id="browsedialog" title="Biblioteka urządzeń" onClose={onClose} width={1180}>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(86vh - 150px)', minHeight: 360 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <Input id="bw-q" ref={q} type="search" placeholder="Szukaj: model, producent, port…" aria-label="Szukaj w bibliotece" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
          <span id="bw-count" className="sw-hint" style={{ flex: 'none' }}>Wyników: {res.length} z {all.length}</span>
          <Button id="bw-clear" variant="ghost" size="sm" style={{ visibility: active ? 'visible' : 'hidden' }} onClick={() => { setQuery(''); setSel({}); }}>Wyczyść filtry</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Button id="bw-new" variant="primary" onClick={() => { onClose(); openDeviceBuilder(ctxB); }}>+ Nowe urządzenie…</Button>
          <Button id="bw-newel" onClick={() => { onClose(); openElectricalBuilder(ctxB); }}>+ Element elektryczny…</Button>
          <Button id="bw-import" onClick={() => void importFile()}>Importuj urządzenie z pliku…</Button>
          <Button id="bw-packs" onClick={() => { onClose(); c.library.openDialogUi(); }}>Pakiety…</Button>
          <span style={{ flex: 1 }} /><Button id="bw-close" variant="ghost" onClick={onClose}>Zamknij</Button>
        </div>
        <div className="sw-browse">
          <div id="bw-facets" style={{ paddingRight: 6 }}>{facets.map((f) => {
            const vals = expanded.has(f.id) ? f.values : f.values.filter((v, i) => i < 6 || v.selected);
            return (<div className="bw-f sw-facet" key={f.id}><div className="bw-fh sw-facet-h">{f.label}</div>
              {vals.map((v) => (<label key={v.value} className={`bw-v sw-fval${v.count ? '' : ' zero'}`}><input type="checkbox" checked={v.selected} onChange={() => setSel((s) => toggleSelection(s, f.id as never, v.value))} /><span>{v.label ?? v.value}</span><small>{v.count}</small></label>))}
              {f.values.length > 6 && <Button className="bw-more" variant="ghost" size="sm" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>{expanded.has(f.id) ? 'Pokaż mniej' : `Pokaż więcej (${f.values.length - vals.length})`}</Button>}
            </div>);
          })}</div>
          <div id="bw-list" className="sw-results" style={{ alignSelf: 'start' }}>{res.length ? res.map((e) => {
            const t = sourceTrust(e.device.source);
            return (<div key={e.key} className={`bw-r sw-result${e.key === current ? ' on' : ''}`} data-k={e.key} onClick={() => { setCurrent(e.key); setArmed(false); }} onDoubleClick={() => add(e)}>
              <div><b>{e.model}</b> <span className="sw-hint">{e.manufacturer}</span>{e.packId === MY_PACK_ID && <span className="sw-chip" style={{ marginLeft: 8, height: 18, color: 'var(--sw-accent)' }}>moje</span>}</div>
              <div className="sw-sub">{e.category} · {portsLine(e)}{t !== 'verified' && t !== 'generic' && <> · <span style={{ color: '#FFD54F' }}>{TRUST_LABEL[t]}</span></>}</div></div>);
          }) : <div className="sw-hint" style={{ padding: 14 }}>Brak urządzeń dla tych filtrów. Zmień filtry albo dodaj własne urządzenie („Nowe urządzenie…”).</div>}</div>
          <div id="bw-detail" className="sw-detail">{cur ? <Detail e={cur} armed={armed} onArm={() => setArmed(true)} onAdd={() => add(cur)} onExport={() => { setImp(undefined); setExporting(cur); setMsg(null); }}
            onCopy={() => { onClose(); openDeviceBuilder({ ...ctxB, prefill: { ...JSON.parse(JSON.stringify(cur.device)), model: cur.model + ' (kopia)' } }); }}
            onEdit={() => { onClose(); openDeviceBuilder({ ...ctxB, prefill: JSON.parse(JSON.stringify(cur.device)), editKey: cur.devKey }); }}
            onDelete={async () => { try { await c.library.removeMine(cur.devKey); setCurrent(undefined); setArmed(false); setRev((x) => x + 1); c.say(`Usunięto „${cur.model}” z moich urządzeń`); } catch (e) { err(errText(e)); } }} />
            : <div className="sw-hint" style={{ padding: 12 }}>Wybierz urządzenie z listy, aby zobaczyć porty i dane. Dwuklik dodaje je do projektu.</div>}</div>
        </div>
        <div id="bw-msg" style={{ flex: 'none', maxHeight: '34vh', overflow: 'auto', marginTop: 12 }}>
          {msg}
          {exporting && <ExportForm e={exporting} onGo={async (author, license) => { try { const t = await c.library.exportDevice(exporting.device, { author, license }); if (t) ok('Zapisano plik urządzenia.'); } catch (e) { err(errText(e)); } }} />}
          {imp && <ImportForm key={impKey} pack={imp.pack} warnings={imp.warnings} mine={c.library.myPack()?.devices ?? []} onGo={async (picked, pol) => {
            if (!picked.length) { setMsg(<Notice>Zaznacz co najmniej jedno urządzenie.</Notice>); return; }
            try { const r = await c.library.saveDevices(picked, () => pol); setRev((x) => x + 1); ok(`Dodano: ${r.added.length}, podmieniono: ${r.replaced.length}, pominięto: ${r.skipped.length}.`); } catch (e) { err(errText(e)); }
          }} />}
        </div>
      </div>
    </Dialog>);
}

function Detail({ e, armed, onArm, onAdd, onExport, onCopy, onEdit, onDelete }: { e: CatalogEntry; armed: boolean; onArm(): void; onAdd(): void; onExport(): void; onCopy(): void; onEdit(): void; onDelete(): void }) {
  const d = e.device, s = d.source, t = sourceTrust(s), mine = e.packId === MY_PACK_ID;
  const dim = d.dimensionsMm ? `${d.dimensionsMm.width} × ${d.dimensionsMm.depth} × ${d.dimensionsMm.height} mm` : 'brak wymiarów';
  const sn = (k: string) => names()[k]?.name ?? k;
  return (<>
    <h3>{e.model}</h3><div className="sw-hint">{e.manufacturer} · {e.category}</div>
    {d.description && <p style={{ margin: '8px 0', fontSize: 13 }}>{d.description}</p>}
    <div className="sw-kv">{dim}{d.weightKg !== undefined && ` · ${d.weightKg} kg`}{d.powerW !== undefined && ` · ${d.powerW} W`}{d.rackUnits && ` · rack ${d.rackUnits.heightU} U`}{d.dinModules && ` · ${d.dinModules} mod. DIN`}</div>
    <div className="sw-kv">Dane: {TRUST_LABEL[t]} ({s.kind}{s.ref ? `, ${s.ref}` : ''}{s.verified ? `, sprawdzono ${s.verified}` : ''})<br />Pakiet: {e.packName} {e.packVersion}</div>
    <div className="sw-hint" style={{ margin: '8px 0 2px' }}>Porty ({e.ports.length})</div>
    <div style={{ maxHeight: '22vh', overflow: 'auto' }}>{e.ports.map((p, i) => <div className="sw-portline" key={i}><span>{p.label}</span><span>{sn(p.signals[0])} · {p.direction === 'in' ? 'we' : p.direction === 'out' ? 'wy' : p.direction === 'io' ? 'we/wy' : 'przelot'}</span></div>)}</div>
    <div className="sw-actions">
      <Button id="bw-add" variant="primary" onClick={onAdd}>Dodaj do projektu</Button><Button id="bw-export" onClick={onExport}>Eksportuj to urządzenie…</Button>
      <Button id="bw-copy" title="Otwiera kreator z danymi tego urządzenia jako wzorem" onClick={onCopy}>Użyj jako wzoru…</Button>
      {mine && <><Button id="bw-edit" onClick={onEdit}>Edytuj…</Button><Button id="bw-del" variant="danger" onClick={() => (armed ? onDelete() : onArm())}>{armed ? 'Na pewno? Projekty zachowają swoje kopie' : 'Usuń z moich'}</Button></>}
    </div></>);
}

/** Autor i licencja trafiają do pliku (potrzebne, gdy urządzenie ma być udostępnione). */
function ExportForm({ e, onGo }: { e: CatalogEntry; onGo(author: string, license: string): void }) {
  const [author, setAuthor] = useState(''), [lic, setLic] = useState(LICENSES[0]);
  return (<div className="sw-panel bw-box"><b>Eksport: {e.model}</b>
    <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}><Field label="Autor (opcjonalnie)" grow={1}><Input id="bx-author" value={author} onChange={(x) => setAuthor(x.target.value)} /></Field>
      <Field label="Licencja danych" grow={1.4}><Select id="bx-lic" value={lic} options={LICENSES.map((l) => [l, l])} onChange={(x) => setLic(x.target.value)} /></Field></div>
    <div className="sw-hint" style={{ marginBottom: 8 }}>Plik zawiera tylko to jedno urządzenie wraz ze złączami i sygnałami, więc odbiorca importuje go przyciskiem „Importuj urządzenie z pliku…”.</div>
    <Button id="bx-go" variant="primary" onClick={() => onGo(author, lic)}>Zapisz plik…</Button></div>);
}

/** Lista z oceną (nowe / identyczne / inne niż moje) i wybór postępowania przy konflikcie. Dotyka tylko pakietu „Moje urządzenia”. */
function ImportForm({ pack, warnings, mine, onGo }: { pack: Pack; warnings: string[]; mine: PackDevice[]; onGo(picked: PackDevice[], pol: Conflict): void }) {
  const m = useMemo(() => new Map(mine.map((d) => [d.key, d])), [mine]);
  const rows = useMemo(() => pack.devices.map((d, i) => { const x = m.get(d.key); return { d, i, st: !x ? 'nowe' : canon(x) === canon(d) ? 'identyczne' : 'inne' }; }), [pack, m]);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(rows.filter((r) => r.st !== 'identyczne').map((r) => r.i))), [pol, setPol] = useState<Conflict>('keep-both');
  const color = (s: string) => (s === 'nowe' ? '#00C853' : s === 'inne' ? '#FFB74D' : '#8A8A8A');
  return (<div className="sw-panel bw-box"><b>Import z pliku: {pack.name}</b> <span className="sw-hint">({pack.license}{pack.author ? `, autor: ${pack.author}` : ''})</span>
    {warnings.length > 0 && <div style={{ color: '#FFD54F', fontSize: 12, margin: '4px 0' }}>{warnings.slice(0, 3).map((w) => <div key={w}>{w}</div>)}</div>}
    <div style={{ maxHeight: '26vh', overflow: 'auto', margin: '6px 0' }}>{rows.map((r) => (
      <label key={r.i} className="sw-check"><input type="checkbox" className="bi" data-i={r.i} checked={checked.has(r.i)} disabled={r.st === 'identyczne'} onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.i); else n.delete(r.i); return n; })} />
        {r.d.manufacturer} {r.d.model} <small style={{ color: color(r.st) }}>{r.st === 'nowe' ? 'nowe' : r.st === 'identyczne' ? 'już masz' : 'inne niż Twoje'}</small></label>))}</div>
    <Field label="Gdy urządzenie o tym kluczu już jest, ale jest inne"><Select id="bi-conf" value={pol} options={[['keep-both', 'zachowaj oba (nowe pod innym kluczem)'], ['replace', 'podmień moje'], ['skip', 'pomiń']]} onChange={(e) => setPol(e.target.value as Conflict)} /></Field>
    <div style={{ marginTop: 10 }}><Button id="bi-go" variant="primary" onClick={() => onGo(rows.filter((r) => checked.has(r.i)).map((r) => r.d), pol)}>Dodaj do Moich urządzeń</Button></div></div>);
}

export function createLibBrowser(c: BrowserCtx) {
  const memo: Memo = { query: '', sel: {} };
  let root: Root | undefined, host: HTMLElement | undefined, handle: { importPack(r: ImportReq): void } | undefined, open = false;
  function show(initialImport?: ImportReq) {
    if (open) return;
    host = document.createElement('div'); host.id = 'browsedialog-root'; document.body.appendChild(host); root = createRoot(host); open = true;
    root.render(<Browser c={c} onClose={close} initialImport={initialImport} onReady={(h) => { handle = h; }} memo={memo} />);
  }
  function close() { if (!open) return; root?.unmount(); host?.remove(); root = undefined; host = undefined; handle = undefined; open = false; }
  return {
    show: () => show(), close, toggle: () => (open ? close() : show()), isOpen: () => open,
    importDevicesPack: (raw: unknown) => { const r = c.library.checkDevicesFile(raw), req: ImportReq = r.pack ? { pack: r.pack, warnings: r.warnings } : { error: r.errors.join('\n') }; if (!open) show(req); else handle?.importPack(req); },
  };
}
