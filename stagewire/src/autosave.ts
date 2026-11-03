import type { Store } from './store.ts';
import type { Project } from './types.ts';
import { packProject, openProject, canonicalStringify } from './format.ts';

/**
 * Autozapis i odzyskiwanie (M1, ADR-036). Logika niezależna od platformy: wejście/wyjście wstrzyknięte
 * (w aplikacji: polecenie Tauri `save_project` do pliku `<projekt>.autosave`, zapisywanego atomowo).
 * Zasady: autozapis NIGDY nie nadpisuje pliku projektu; zapis użytkownika kasuje autozapis; po awarii oferujemy odzyskanie.
 */
export type Kind = 'main' | 'autosave';
export interface FileInfo { bytes: Uint8Array; mtimeMs: number }
export interface AutosaveIO {
  read(kind: Kind): Promise<FileInfo | undefined> | FileInfo | undefined;
  write(kind: Kind, bytes: Uint8Array): Promise<void> | void;
  remove(kind: Kind): Promise<void> | void;
}
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export interface Policy { idleMs: number; maxMs: number }
export const DEFAULT_POLICY: Policy = { idleMs: 5_000, maxMs: 30_000 };

const realClock: Clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as any) };

export class Autosaver {
  #savedVersion: number;      // wersja stanu zapisana przez użytkownika
  #autosavedVersion: number;  // wersja ostatniego autozapisu
  #timer: unknown;
  #firstDirtyAt: number | undefined;
  lastError: string | undefined;

  constructor(private store: Store, private io: AutosaveIO, private clock: Clock = realClock, private policy: Policy = DEFAULT_POLICY) {
    this.#savedVersion = this.#autosavedVersion = store.version;
  }

  get dirty(): boolean { return this.store.version !== this.#savedVersion; }

  /** Po przywróceniu autozapisu: stan różni się od pliku projektu, choć `version` jeszcze się nie zmienił. */
  forceDirty(): void { this.#savedVersion = -1; this.#autosavedVersion = -1; }

  /** Wołać po każdej zmianie modelu. Debounce: zapis po `idleMs` bezczynności, najpóźniej `maxMs` od pierwszej niezapisanej zmiany. */
  notify(): void {
    if (!this.dirty) return;
    const t = this.clock.now();
    this.#firstDirtyAt ??= t;
    if (this.#timer !== undefined) this.clock.clearTimeout(this.#timer);
    const wait = Math.max(0, Math.min(this.policy.idleMs, this.#firstDirtyAt + this.policy.maxMs - t));
    this.#timer = this.clock.setTimeout(() => { void this.flush(); }, wait);
  }

  /** Zapisuje autozapis, jeśli stan zmienił się od ostatniego zapisu. Błąd nie przerywa pracy (zapamiętany w `lastError`). */
  async flush(): Promise<boolean> {
    this.#timer = undefined; this.#firstDirtyAt = undefined;
    if (!this.dirty || this.store.version === this.#autosavedVersion) return false;
    try {
      const v = this.store.version;
      await this.io.write('autosave', packProject(this.store.state));
      this.#autosavedVersion = v; this.lastError = undefined;
      return true;
    } catch (e) { this.lastError = String((e as Error).message ?? e); return false; }
  }

  /** Po zapisie projektu przez użytkownika: autozapis przestaje być potrzebny. */
  async markSaved(): Promise<void> {
    if (this.#timer !== undefined) this.clock.clearTimeout(this.#timer);
    this.#timer = undefined; this.#firstDirtyAt = undefined;
    this.#savedVersion = this.#autosavedVersion = this.store.version;
    await this.io.remove('autosave');
  }
}

export type Recovery =
  | { kind: 'none' }
  | { kind: 'offer'; project: Project; autosaveMtimeMs: number; mainMissing: boolean }
  | { kind: 'discard'; reason: string }; // autozapis uszkodzony lub nieaktualny: pomijamy go (nie kasujemy bez zgody)

/** Decyzja przy otwieraniu projektu. Nic nie modyfikuje. */
export async function checkRecovery(io: AutosaveIO): Promise<Recovery> {
  const a = await io.read('autosave');
  if (!a) return { kind: 'none' };
  const ar = openProject(a.bytes);
  if (ar.status !== 'ok') return { kind: 'discard', reason: 'Autozapis uszkodzony lub w nieobsługiwanym formacie' };
  const m = await io.read('main');
  if (!m) return { kind: 'offer', project: ar.project, autosaveMtimeMs: a.mtimeMs, mainMissing: true };
  const mr = openProject(m.bytes);
  if (mr.status === 'ok' && canonicalStringify(mr.project) === canonicalStringify(ar.project)) return { kind: 'discard', reason: 'Autozapis identyczny z projektem' };
  if (a.mtimeMs <= m.mtimeMs) return { kind: 'discard', reason: 'Autozapis starszy niż zapisany projekt' };
  return { kind: 'offer', project: ar.project, autosaveMtimeMs: a.mtimeMs, mainMissing: false };
}
