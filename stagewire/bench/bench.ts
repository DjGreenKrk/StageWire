import { syntheticProject } from '../src/synthetic.ts';
import { packProject, openProject, canonicalStringify } from '../src/format.ts';
import { checkInvariants } from '../src/invariants.ts';
import { validate } from '../src/validation.ts';
import { cableList, toCsv } from '../src/reports.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';

const time = <T>(label: string, f: () => T): { r: T; ms: number } => {
  const t0 = performance.now();
  const r = f();
  const ms = performance.now() - t0;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(9)} ms`);
  return { r, ms };
};

for (const [devices, conns] of [[200, 300], [1000, 2500], [2000, 5000]] as const) {
  const p = syntheticProject(devices, conns);
  const n = Object.keys(p.equipment).length + Object.keys(p.connections).length + Object.keys(p.cables).length + Object.keys(p.placements ?? {}).length;
  console.log(`\n${devices} urządzeń, ${Object.keys(p.connections).length} połączeń, ${n} obiektów w modelu`);
  const text = time('serializacja kanoniczna', () => canonicalStringify(p)).r;
  const bytes = time('pakowanie ZIP + sha256', () => packProject(p)).r;
  console.log(`  rozmiar: JSON ${(text.length / 1024).toFixed(0)} KiB, ZIP ${(bytes.length / 1024).toFixed(0)} KiB`);
  time('otwarcie: unzip+schemat', () => openProject(bytes));
  time('niezmienniki', () => checkInvariants(p));
  const issues = time('walidacja pełna', () => validate(p)).r;
  time('lista kabli + CSV', () => toCsv(cableList(p)));
  const s = new Store(p);
  const first = Object.keys(p.equipment)[0];
  // koszt poleceń na dużym stanie; pierwsza transakcja zawiera jednorazowe zamrożenie drzewa przez immer (autoFreeze)
  const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const run = (f: () => void) => { const t0 = performance.now(); f(); return performance.now() - t0; };
  const ids = Object.keys(p.equipment);
  const first1 = run(() => s.dispatch('rm', cmd.removeInstance(ids[0])));
  console.log(`  ${'pierwsze polecenie (z zamrożeniem drzewa)'.padEnd(34)} ${first1.toFixed(1).padStart(9)} ms`);
  const rm = Array.from({ length: 15 }, (_, i) => run(() => s.dispatch('rm', cmd.removeInstance(ids[2 + i * 2]))));
  console.log(`  ${'usuń urządzenie (mediana z 15)'.padEnd(34)} ${med(rm).toFixed(1).padStart(9)} ms`);
  const cn = Array.from({ length: 15 }, (_, i) => run(() => s.dispatch('c', cmd.disconnect(Object.keys(s.state.connections)[i]))));
  console.log(`  ${'rozłącz (mediana z 15)'.padEnd(34)} ${med(cn).toFixed(1).padStart(9)} ms`);
  const ed = run(() => s.dispatch('e', cmd.editDefinition('eqd_src', (r) => { r.ports.prt_out0.label += '*'; })));
  console.log(`  ${'edycja definicji (nowa rewizja)'.padEnd(34)} ${ed.toFixed(1).padStart(9)} ms`);
  const up = run(() => s.dispatch('u', cmd.upgradeInstance(ids.findLast((i) => s.state.equipment[i]?.definitionId === 'eqd_src')!, 2, 'delete')));
  console.log(`  ${'upgrade 1 instancji'.padEnd(34)} ${up.toFixed(1).padStart(9)} ms`);
  const un = Array.from({ length: 15 }, () => run(() => { s.undo(); }));
  console.log(`  ${'cofnięcie (mediana z 15)'.padEnd(34)} ${med(un).toFixed(1).padStart(9)} ms`);
  console.log(`  problemów: ${issues.length}`);
}
