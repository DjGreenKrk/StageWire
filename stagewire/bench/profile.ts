import { setAutoFreeze } from 'immer';
import { syntheticProject } from '../src/synthetic.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { checkInvariantsIncremental } from '../src/invariants.ts';

const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function trial(label: string, freeze: boolean, mode: 'incremental' | 'full') {
  setAutoFreeze(freeze);
  const p = syntheticProject(2000, 5000);
  const s = new Store(p, { invariants: mode });
  const ids = Object.keys(p.equipment);
  s.dispatch('warm', cmd.removeInstance(ids[0]));
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); s.dispatch('rm', cmd.removeInstance(ids[2 + i * 2])); xs.push(performance.now() - t); }
  console.log(label.padEnd(40), med(xs).toFixed(1), 'ms (mediana usuń urządzenie, 14 000 obiektów)');
}
trial('autoFreeze ON,  niezmienniki przyrostowe', true, 'incremental');
trial('autoFreeze OFF, niezmienniki przyrostowe', false, 'incremental');
trial('autoFreeze ON,  niezmienniki pełne', true, 'full');
trial('autoFreeze OFF, niezmienniki pełne', false, 'full');
