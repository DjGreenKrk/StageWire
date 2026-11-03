import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { addFromCatalog } from '../src/catalog/index.ts';
import { plan } from '../src/plan.ts';
import { routeCmd } from '../src/routes.ts';
import { cablePaths } from '../src/lengths.ts';
import { planDrawList, fitText } from '../src/render/drawlist.ts';
import { planConnection, usageOf } from '../src/editor/connect.ts';
import { validate } from '../src/validation.ts';
import { syntheticProject } from '../src/synthetic.ts';

const mk = () => {
  const p = syntheticProject(0, 0, 1, true); p.definitions = {}; p.registries = {}; p.spaces = {};
  const s = new Store(p);
  for (const [k, id] of [['camera_sdi', 'eqi_k'], ['video_switcher', 'eqi_m'], ['laptop', 'eqi_l'], ['camera_sdi', 'eqi_k2']] as const) s.dispatch('a', addFromCatalog(k, id, id));
  s.dispatch('s', plan.addSpace('spc_a', 'A', 20000, 10000));
  s.dispatch('p', plan.place('eqi_k', 'spc_a', 1000, 1000)); s.dispatch('p', plan.place('eqi_m', 'spc_a', 9000, 1000));
  return s;
};
const pl = (s: Store, a: string, p: string, b: string, q: string) => planConnection(s.state, { instanceId: a, portId: p }, { instanceId: b, portId: q }, usageOf(s.state));

describe('uwagi z pierwszych testów (projekt1)', () => {
  it('zajęty port blokuje połączenie, a drugi kabel do tego samego gniazda nie powstaje (#8)', () => {
    const s = mk(); const ok = pl(s, 'eqi_k', 'prt_sdiout', 'eqi_m', 'prt_sdiin1'); expect(ok.level).toBe('ok');
    s.dispatch('c', cmd.connect(ok.from, ok.to, ok.signalKey));
    const again = pl(s, 'eqi_k2', 'prt_sdiout', 'eqi_m', 'prt_sdiin1'); expect(again.level).toBe('no'); expect(again.reasons.join()).toContain('zajęty');
    expect(pl(s, 'eqi_k', 'prt_sdiout', 'eqi_m', 'prt_sdiin2').level).toBe('no'); // wyjście kamery już zajęte
  });
  it('różne złącza/sygnał = ostrzeżenie do potwierdzenia, a po potwierdzeniu uwaga walidacji dotyczy tego połączenia (#4)', () => {
    const s = mk(); const w = pl(s, 'eqi_l', 'prt_hdmiout', 'eqi_m', 'prt_sdiin1');
    expect(w.level).toBe('warn'); expect(w.reasons.join()).toContain('Różne złącza'); expect(w.reasons.join()).toContain('V-010');
    s.dispatch('c', cmd.connect(w.from, w.to, w.signalKey));
    const cid = Object.keys(s.state.connections)[0];
    expect(validate(s.state).some((i) => i.subject === cid || i.subject === s.state.connections[cid].cableId)).toBe(true);
  });
  it('typ kabla można zmienić; nieznany typ odrzucony; walidacja zgodności się aktualizuje (#7)', () => {
    const s = mk(); const w = pl(s, 'eqi_l', 'prt_hdmiout', 'eqi_m', 'prt_sdiin1'); s.dispatch('c', cmd.connect(w.from, w.to, w.signalKey));
    const cid = Object.keys(s.state.connections)[0];
    expect(s.state.connections[cid].cableId).toBeNull(); // brak typu kabla pasującego do obu złączy: połączenie bez kabla (nie da się wpisać długości)
    expect(validate(s.state).some((i) => i.ruleId === 'V-019')).toBe(true);
    expect(() => s.dispatch('t', cmd.assignCable(cid, 'std/nie-ma'))).toThrow();
    s.dispatch('t', cmd.assignCable(cid, 'std/cable-sdi'));
    const cab = s.state.connections[cid].cableId!; expect(s.state.cables[cab].cableTypeKey).toBe('std/cable-sdi');
    expect(() => s.dispatch('t', cmd.assignCable(cid, 'std/cable-sdi'))).toThrow();
    s.dispatch('t', cmd.setCableType(cab, 'std/cable-hdmi')); expect(s.state.cables[cab].cableTypeKey).toBe('std/cable-hdmi');
    expect(() => s.dispatch('t', cmd.setCableType(cab, 'std/nie-ma'))).toThrow();
  });
  it('przebieg kabla na planie biegnie po trasie, a bez trasy prosto (#1)', () => {
    const s = mk(); const ok = pl(s, 'eqi_k', 'prt_sdiout', 'eqi_m', 'prt_sdiin1'); s.dispatch('c', cmd.connect(ok.from, ok.to, ok.signalKey));
    expect(cablePaths(s.state)[0].method).toBe('direct');
    s.dispatch('r', routeCmd.addRoute('spc_a', 'rte_1', 'T', [[1000, 4000], [9000, 4000]]));
    const cp = cablePaths(s.state)[0]; expect(cp.method).toBe('route');
    expect(cp.pts).toEqual([1000, 1000, 1000, 4000, 1000, 4000, 9000, 4000, 9000, 4000, 9000, 1000]); // pion do trasy, trasa, pion do miksera
    const line = planDrawList(s.state, { cables: true }).prims.find((p) => p.t === 'line' && p.id === Object.keys(s.state.connections)[0]);
    expect(line && line.t === 'line' && line.stroke).not.toBe('#FFD54F'); // trasa: kolor zwykły, nie „prosto”
  });
  it('etykiety na planie można pominąć (rysowane osobno), a nazwy na schemacie są skracane (#5, #6)', () => {
    const s = mk(); const withL = planDrawList(s.state).prims.filter((p) => p.t === 'text').length, without = planDrawList(s.state, { labels: false }).prims.filter((p) => p.t === 'text').length;
    expect(withL).toBeGreaterThan(0); expect(without).toBe(0);
    expect(fitText('Konwerter SDI → HDMI 2', 170 - 16, 13).length).toBeLessThan('Konwerter SDI → HDMI 2'.length + 1);
    expect(fitText('Bardzo długa nazwa urządzenia testowego', 100, 13).endsWith('…')).toBe(true);
    expect(fitText('OK', 100, 13)).toBe('OK');
  });
});
