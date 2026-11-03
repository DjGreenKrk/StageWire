import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { plan } from '../src/plan.ts';
import { stageCmd } from '../src/stage.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => { const s = new Store((() => { const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {}; return p; })()); s.dispatch('s', plan.addSpace('spc_a', 'Sala', 20000, 12000)); s.dispatch('o', stageCmd.addObject('sob_a', { name: 'Scena', widthMm: 8000, depthMm: 5000, heightMm: 1000 })); s.dispatch('p', plan.placeRack('sob_a', 'spc_a', 5000, 3000)); return s; };

describe('blokada położenia', () => {
  it('zablokowany obiekt nie da się przesunąć, obrócić, zdjąć ani usunąć; po odblokowaniu znów można', () => {
    const s = mk();
    s.dispatch('l', plan.setLocked(['sob_a'], true));
    expect(() => s.dispatch('m', plan.placeRack('sob_a', 'spc_a', 6000, 3000))).toThrow(/zablokowany/);
    expect(() => s.dispatch('r', plan.rotateRack('sob_a', 90))).toThrow(/zablokowany/);
    expect(() => s.dispatch('u', plan.unplaceRack('sob_a'))).toThrow(/zablokowany/);
    expect(() => s.dispatch('d', stageCmd.removeObject('sob_a'))).toThrow(/zablokowany/);
    expect((Object.values(s.state.placements!)[0] as any).position.x).toBe(5000);
    s.dispatch('l', plan.setLocked(['sob_a'], false));
    s.dispatch('m', plan.placeRack('sob_a', 'spc_a', 6000, 3000));
    expect((Object.values(s.state.placements!)[0] as any).position.x).toBe(6000);
  });
  it('blokada przeżywa zapis i cofanie (Ctrl+Z odblokowuje)', () => {
    const s = mk(); s.dispatch('l', plan.setLocked(['sob_a'], true));
    expect((Object.values(s.state.placements!)[0] as any).locked).toBe(true);
    s.undo(); expect((Object.values(s.state.placements!)[0] as any).locked).toBeUndefined();
  });
});
