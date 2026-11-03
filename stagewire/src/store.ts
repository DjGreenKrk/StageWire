import { produceWithPatches, applyPatches, enablePatches, freeze, type Patch } from 'immer';
import type { Project } from './types.ts';
import { checkInvariants, checkInvariantsIncremental } from './invariants.ts';

enablePatches();

export class CommandError extends Error {}
export class InvariantViolation extends Error {
  violations: string[];
  constructor(violations: string[]) {
    super('Naruszenie niezmienników: ' + violations.slice(0, 3).join('; '));
    this.violations = violations;
  }
}

export type Mutator = (draft: Project) => void;
/** 'incremental' (domyślnie), 'full', albo 'both' (testy: pełne musi się zgadzać z przyrostowym). */
export type InvariantMode = 'incremental' | 'full' | 'both';
interface Tx { label: string; patches: Patch[]; inverse: Patch[] }

/**
 * Stan niemutowalny + transakcje jako łaty. Cofanie/ponawianie = zastosowanie łat odwrotnych/prostych.
 * Każda transakcja jest sprawdzana pod kątem niezmienników; naruszenie odrzuca ją w całości.
 */
export class Store {
  state: Project;
  #undo: Tx[] = [];
  #redo: Tx[] = [];

  #mode: InvariantMode;
  /** Licznik zmian stanu (dispatch/undo/redo); wykrywanie stanu niezapisanego (autozapis). */
  version = 0;

  constructor(initial: Project, opts: { invariants?: InvariantMode } = {}) {
    this.#mode = opts.invariants ?? 'incremental';
    const bad = checkInvariants(initial);
    if (bad.length) throw new InvariantViolation(bad);
    // jednorazowe głębokie zamrożenie przy wczytaniu zamiast przy pierwszym poleceniu (immer robi to leniwie, ok. 40-60 ms przy 14 000 obiektów)
    this.state = freeze(initial, true);
  }

  /** Jedyna droga zmiany modelu. Zwraca liczbę łat (0 = brak zmian, brak wpisu w historii). */
  dispatch(label: string, mutate: Mutator): number {
    const [next, patches, inverse] = produceWithPatches(this.state, mutate);
    if (patches.length === 0) return 0;
    const bad = this.#check(this.state, next, patches);
    if (bad.length) throw new InvariantViolation(bad);
    this.state = next; this.version++;
    this.#undo.push({ label, patches, inverse });
    this.#redo = [];
    return patches.length;
  }

  #check(prev: Project, next: Project, patches: Patch[]): string[] {
    if (this.#mode === 'full') return checkInvariants(next);
    const inc = checkInvariantsIncremental(prev, next, patches);
    if (this.#mode === 'both') {
      const full = checkInvariants(next);
      if (full.length && !inc.length) throw new Error('Niezmienniki przyrostowe pominęły naruszenie: ' + full[0]);
    }
    return inc;
  }

  get canUndo(): boolean { return this.#undo.length > 0; }
  get canRedo(): boolean { return this.#redo.length > 0; }
  get undoLabel(): string | undefined { return this.#undo.at(-1)?.label; }

  undo(): boolean {
    const tx = this.#undo.pop();
    if (!tx) return false;
    this.state = applyPatches(this.state, tx.inverse); this.version++;
    this.#redo.push(tx);
    return true;
  }

  redo(): boolean {
    const tx = this.#redo.pop();
    if (!tx) return false;
    this.state = applyPatches(this.state, tx.patches); this.version++;
    this.#undo.push(tx);
    return true;
  }
}
