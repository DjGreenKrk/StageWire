import { describe, it, expect } from 'vitest';
import { syntheticProject } from '../src/synthetic.ts';
import { planConnection, bestPort, usageOf } from '../src/editor/connect.ts';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { validate } from '../src/validation.ts';
import { clone } from './helpers.ts';

// w syntetycznym projekcie: urządzenia parzyste = SRC (porty out0..7), nieparzyste = DST (porty in0..7)
const p = syntheticProject(4, 4, 1, true);
const src = Object.keys(p.equipment)[0], dst = Object.keys(p.equipment)[1];
const out = (i: number, id = src) => ({ instanceId: id, portId: `prt_out${i}` });
const inn = (i: number, id = dst) => ({ instanceId: id, portId: `prt_in${i}` });

describe('planConnection (gest port → port)', () => {
  const use = usageOf(p);
  it('wolne wyjście → wolne wejście = ok', () => {
    const pl = planConnection(p, out(7), inn(7), use);
    expect(pl.level).toBe('ok'); expect(pl.from).toEqual(out(7)); expect(pl.to).toEqual(inn(7)); expect(pl.signalKey).toBe('std/sdi-3g');
  });
  it('przeciągnięcie od wejścia do wyjścia odwraca kierunek (wyjście → wejście)', () => {
    const pl = planConnection(p, inn(7), out(7), use);
    expect(pl.level).toBe('ok'); expect(pl.from).toEqual(out(7)); expect(pl.to).toEqual(inn(7));
  });
  it('zajęty port = no (twarda blokada, ADR-046): jedno gniazdo, jeden kabel', () => {
    const pl = planConnection(p, out(0), inn(7), use);
    expect(pl.level).toBe('no'); expect(pl.reasons.join()).toContain('zajęty');
  });
  it('to samo urządzenie i duplikat pary = no', () => {
    expect(planConnection(p, out(7), { instanceId: src, portId: 'prt_out6' }, use).level).toBe('no');
    expect(planConnection(p, out(0), inn(0), use).level).toBe('no'); // para już połączona
  });
  it('dwa wyjścia = warn (V-001); brak wspólnego sygnału = warn (V-010)', () => {
    const q = clone(p);
    const src2 = Object.keys(q.equipment)[2];
    expect(planConnection(q, out(7), out(7, src2), usageOf(q)).reasons.join()).toContain('V-001');
    q.definitions.eqd_dst.revisions['1'].ports['prt_in7'].signalKeys = ['std/other'];
    const pl = planConnection(q, out(7), inn(7), usageOf(q));
    expect(pl.level).toBe('warn'); expect(pl.reasons.join()).toContain('V-010');
  });
  it('upuszczenie na korpus wybiera pierwszy wolny port zgodny', () => {
    const pl = bestPort(p, out(5), dst, use)!;
    expect(pl.level).toBe('ok'); expect(pl.to.portId).toBe('prt_in4');
  });
  it('plan ok po zatwierdzeniu nie tworzy nowych uwag walidacji; plan warn tworzy zapowiedzianą', () => {
    const s = new Store(clone(p));
    const before = validate(s.state).length;
    const ok = planConnection(s.state, out(7), inn(7), usageOf(s.state));
    s.dispatch('t', cmd.connect(ok.from, ok.to, ok.signalKey));
    expect(validate(s.state).length).toBe(before);
    const src2 = Object.keys(s.state.equipment)[2];
    const warn = planConnection(s.state, out(6), out(6, src2), usageOf(s.state)); // wyjście → wyjście: kierunek niezgodny, ale porty wolne
    expect(warn.level).toBe('warn');
    s.dispatch('t', cmd.connect(warn.from, warn.to, warn.signalKey));
    expect(validate(s.state).some((i) => i.ruleId === 'V-001')).toBe(true);
    // cofnięcie przywraca stan
    s.undo(); s.undo();
    expect(validate(s.state).length).toBe(before);
  });
});
