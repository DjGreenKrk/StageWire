import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Autosaver, checkRecovery, type AutosaveIO, type Clock, type FileInfo, type Kind } from '../src/autosave.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { packProject } from '../src/format.ts';
import { syntheticProject } from '../src/synthetic.ts';

function memIO() {
  const files: Partial<Record<Kind, FileInfo>> = {}; let t = 1000; const writes: Kind[] = [];
  const io: AutosaveIO = {
    read: (k) => files[k],
    write: (k, b) => { files[k] = { bytes: b, mtimeMs: (t += 10) }; writes.push(k); },
    remove: (k) => { delete files[k]; },
  };
  return { io, files, writes };
}

function fakeClock() {
  let now = 0, id = 0; const q: { at: number; fn: () => void; id: number }[] = [];
  const c: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => { q.push({ at: now + ms, fn, id: ++id }); return id; },
    clearTimeout: (h) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); now = n.at; n.fn(); }
    now = end;
  };
  return { c, advance };
}

const mk = () => new Store(syntheticProject(4, 4, 1, true));
// syntetyczny projekt: porty 0..3 zajęte, 4..7 wolne
const edit = (s: Store, k: number) => {
  const ids = Object.keys(s.state.equipment), p = 4 + (k % 4);
  s.dispatch('edycja ' + k, cmd.connect({ instanceId: ids[0], portId: `prt_out${p}` }, { instanceId: ids[1], portId: `prt_in${p}` }, 'std/sdi-3g'));
};

describe('Autosaver', () => {
  it('nie zapisuje nic, gdy nie ma zmian', async () => {
    const { io, writes } = memIO(), f = fakeClock(), a = new Autosaver(mk(), io, f.c);
    a.notify(); f.advance(60_000);
    expect(writes).toEqual([]);
  });

  it('zapisuje po bezczynności (debounce) jednym zapisem dla serii zmian', async () => {
    const { io, writes } = memIO(), f = fakeClock(), s = mk(), a = new Autosaver(s, io, f.c);
    for (let k = 0; k < 3; k++) { edit(s, k); a.notify(); f.advance(1000); }
    expect(writes).toEqual([]);
    f.advance(5000); await Promise.resolve();
    expect(writes).toEqual(['autosave']);
  });

  it('ciągła praca nie głodzi autozapisu: zapis najpóźniej po maxMs', async () => {
    const { io, writes } = memIO(), f = fakeClock(), s = mk(), a = new Autosaver(s, io, f.c);
    edit(s, 0);
    for (let k = 0; k < 40; k++) { a.notify(); f.advance(1000); await Promise.resolve(); } // sygnał co sekundę, nigdy 5 s ciszy
    expect(writes.length).toBeGreaterThanOrEqual(1);
  });

  it('zapis użytkownika kasuje autozapis i czyści stan brudny', async () => {
    const { io, files } = memIO(), f = fakeClock(), s = mk(), a = new Autosaver(s, io, f.c);
    edit(s, 0); a.notify(); f.advance(6000); await Promise.resolve();
    expect(files.autosave).toBeDefined(); expect(a.dirty).toBe(true);
    await a.markSaved();
    expect(files.autosave).toBeUndefined(); expect(a.dirty).toBe(false);
  });

  it('błąd zapisu nie rzuca i jest raportowany; kolejna próba może się udać', async () => {
    const m = memIO(); let fail = true;
    const io: AutosaveIO = { ...m.io, write: (k, b) => { if (fail) throw new Error('dysk pełny'); m.io.write(k, b); } };
    const s = mk(), a = new Autosaver(s, io, fakeClock().c);
    edit(s, 0);
    expect(await a.flush()).toBe(false); expect(a.lastError).toContain('dysk pełny');
    fail = false;
    expect(await a.flush()).toBe(true); expect(a.lastError).toBeUndefined();
  });

  it('cofnięcie też liczy się jako zmiana', async () => {
    const { io, writes } = memIO(), s = mk(), a = new Autosaver(s, io, fakeClock().c);
    edit(s, 0); await a.flush(); s.undo();
    expect(a.dirty).toBe(true); expect(await a.flush()).toBe(true); expect(writes.length).toBe(2);
  });
});

describe('checkRecovery', () => {
  it('brak autozapisu = none', async () => expect((await checkRecovery(memIO().io)).kind).toBe('none'));

  it('awaria po edycji: autozapis nowszy niż projekt = oferta odzyskania z edytowanym stanem', async () => {
    const m = memIO(), s = mk();
    m.io.write('main', packProject(s.state)); edit(s, 0); m.io.write('autosave', packProject(s.state));
    const r = await checkRecovery(m.io);
    expect(r.kind).toBe('offer');
    if (r.kind === 'offer') expect(Object.keys(r.project.connections).length).toBe(Object.keys(s.state.connections).length);
  });

  it('projekt usunięty, autozapis jest = oferta (mainMissing)', async () => {
    const m = memIO(), s = mk(); edit(s, 0); m.io.write('autosave', packProject(s.state));
    expect(await checkRecovery(m.io)).toMatchObject({ kind: 'offer', mainMissing: true });
  });

  it('autozapis uszkodzony (urwany zapis) = discard, projekt nietknięty', async () => {
    const m = memIO(), s = mk(); m.io.write('main', packProject(s.state)); edit(s, 0);
    const b = packProject(s.state); m.io.write('autosave', b.slice(0, Math.floor(b.length / 2)));
    expect((await checkRecovery(m.io)).kind).toBe('discard');
    expect(m.files.main).toBeDefined();
  });

  it('autozapis identyczny z projektem lub starszy = discard', async () => {
    const m = memIO(), s = mk();
    m.io.write('autosave', packProject(s.state)); m.io.write('main', packProject(s.state));
    expect((await checkRecovery(m.io)).kind).toBe('discard'); // identyczny
    edit(s, 0); m.io.write('autosave', packProject(s.state)); m.files.autosave!.mtimeMs = 1; // inny, ale starszy
    expect(await checkRecovery(m.io)).toMatchObject({ kind: 'discard' });
  });
});

describe('na prawdziwym systemie plików', () => {
  it('pełny cykl: edycja, autozapis, awaria, odzyskanie, zapis kasuje autozapis', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-as-')), main = path.join(dir, 'p.sw');
    const paths: Record<Kind, string> = { main, autosave: main + '.autosave' };
    const io: AutosaveIO = {
      read: (k) => fs.existsSync(paths[k]) ? { bytes: new Uint8Array(fs.readFileSync(paths[k])), mtimeMs: fs.statSync(paths[k]).mtimeMs } : undefined,
      write: (k, b) => fs.writeFileSync(paths[k], b),
      remove: (k) => fs.rmSync(paths[k], { force: true }),
    };
    const s = mk(); io.write('main', packProject(s.state));
    const f = fakeClock(), a = new Autosaver(s, io, f.c);
    edit(s, 0); edit(s, 1); a.notify(); f.advance(6000); await Promise.resolve();
    expect(fs.existsSync(paths.autosave)).toBe(true);
    // „awaria”: nowa sesja bez markSaved; autozapis jest nowszy niż projekt
    const later = new Date(Date.now() + 5000); fs.utimesSync(paths.autosave, later, later);
    const r = await checkRecovery(io);
    expect(r.kind).toBe('offer');
    const s2 = new Store((r as any).project);
    expect(Object.keys(s2.state.connections).length).toBe(Object.keys(s.state.connections).length);
    await new Autosaver(s2, io, f.c).markSaved();
    expect(fs.existsSync(paths.autosave)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});
