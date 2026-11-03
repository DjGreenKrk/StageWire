import { describe, it, expect } from 'vitest';
import { fixture, FIXTURES, clone } from './helpers.ts';
import { schemaErrors, packProject, openProject, canonicalStringify, migrate0to1 } from '../src/format.ts';
import { checkInvariants } from '../src/invariants.ts';
import { Store, CommandError, InvariantViolation } from '../src/store.ts';
import { cmd } from '../src/commands.ts';
import { validate } from '../src/validation.ts';
import { cableList, patchList, toCsv } from '../src/reports.ts';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';

const rules = (p: ReturnType<typeof fixture>) => validate(p);
const has = (issues: ReturnType<typeof validate>, rule: string, subject?: string) => issues.some((i) => i.ruleId === rule && (!subject || i.subject === subject));

describe('schemat JSON i niezmienniki', () => {
  for (const f of FIXTURES) {
    it(`${f}: zgodny ze schematem i niezmiennikami`, () => {
      const p = fixture(f);
      expect(schemaErrors(p)).toEqual([]);
      expect(checkInvariants(p)).toEqual([]);
    });
  }
  it('schemat odrzuca wireless z kablem i zły format ID', () => {
    const p = fixture('medium-variants.json');
    p.connections.cnx_w.cableId = 'cbl_1';
    expect(schemaErrors(p).length).toBeGreaterThan(0);
    const q = fixture('conference-mini.json');
    (q.equipment as any)['BAD ID'] = q.equipment.eqi_cam1;
    expect(schemaErrors(q).length).toBeGreaterThan(0);
  });
  it('Store odrzuca transakcję łamiącą niezmienniki i nie zmienia stanu', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    const before = s.state;
    expect(() => s.dispatch('zły', (d) => { d.connections.cnx_1.to.portId = 'prt_nie_ma'; })).toThrow(InvariantViolation);
    expect(s.state).toBe(before);
    expect(s.canUndo).toBe(false);
  });
});

describe('rewizje definicji (P0-01)', () => {
  it('dwie rewizje współistnieją; PortRef bez zmian po zapisie, odczycie i cofnięciu', () => {
    const p = fixture('revisions-two.json');
    expect(p.equipment.eqi_mix1.definitionRevision).toBe(1);
    expect(p.equipment.eqi_mix2.definitionRevision).toBe(2);
    const r = openProject(packProject(p));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.project.connections).toEqual(p.connections);
    expect(Object.keys(r.project.definitions.eqd_mixer.revisions)).toEqual(['1', '2']);
    const s = new Store(r.project);
    s.dispatch('zmiana', cmd.editDefinition('eqd_mixer', (rev) => { rev.ports.prt_in2.label = 'X'; }));
    s.undo();
    expect(s.state.connections).toEqual(p.connections);
  });
  it('edycja etykiety tworzy nową rewizję (cosmetic) i nie rusza połączeń ani przypięć', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    const conns = s.state.connections;
    s.dispatch('etykieta', cmd.editDefinition('eqd_mixer', (rev) => { rev.ports.prt_in1.label = 'PGM IN'; }));
    expect(s.state.definitions.eqd_mixer.latestRevision).toBe(2);
    expect(s.state.definitions.eqd_mixer.revisions['2'].changeClass).toBe('cosmetic');
    expect(s.state.definitions.eqd_mixer.revisions['1'].ports.prt_in1.label).toBe('SDI IN 1'); // rew. 1 niemutowalna
    expect(s.state.connections).toBe(conns);
    expect(s.state.equipment.eqi_mix1.definitionRevision).toBe(1);
    // upgrade kosmetyczny nie zmienia żadnego PortRef
    s.dispatch('upgrade', cmd.upgradeInstance('eqi_mix1', 2, 'cancel'));
    expect(s.state.connections).toEqual(conns);
  });
  it('usunięcie portu = nowa rewizja strukturalna; upgrade: cancel odrzuca, delete usuwa połączenia (+kabel) w jednym kroku', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('usuń port', cmd.editDefinition('eqd_mixer', (rev) => { delete rev.ports.prt_hdmiout; }));
    expect(s.state.definitions.eqd_mixer.revisions['2'].changeClass).toBe('structural');
    expect(() => s.dispatch('up', cmd.upgradeInstance('eqi_mix1', 2, 'cancel'))).toThrow(CommandError);
    expect(s.state.equipment.eqi_mix1.definitionRevision).toBe(1);
    const nBefore = Object.keys(s.state.connections).length;
    s.dispatch('up', cmd.upgradeInstance('eqi_mix1', 2, 'delete'));
    expect(Object.keys(s.state.connections).length).toBe(nBefore - 1);
    expect(s.state.cables.cbl_3).toBeUndefined();
    expect(checkInvariants(s.state)).toEqual([]);
    s.undo();
    expect(s.state.equipment.eqi_mix1.definitionRevision).toBe(1);
    expect(s.state.connections.cnx_3).toBeDefined();
  });
  it('upgrade → zapis → cofnij bez zamykania (N-06): zapis przycina tylko widok pliku', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('etykieta', cmd.editDefinition('eqd_mixer', (rev) => { rev.ports.prt_in1.label = 'PGM IN'; }));
    s.dispatch('upgrade', cmd.upgradeInstance('eqi_mix1', 2));
    const bytes = packProject(s.state); // rew. 1 nieprzypięta → pominięta w pliku
    const reopened = openProject(bytes);
    expect(reopened.status === 'ok' && Object.keys(reopened.project.definitions.eqd_mixer.revisions)).toEqual(['2']);
    expect(Object.keys(s.state.definitions.eqd_mixer.revisions)).toEqual(['1', '2']); // model w pamięci nietknięty
    expect(s.undo()).toBe(true); // cofnięcie upgrade po zapisie
    expect(s.state.equipment.eqi_mix1.definitionRevision).toBe(1);
    expect(checkInvariants(s.state)).toEqual([]);
  });
});

describe('medium i kable (P0-03, N-02)', () => {
  const p = fixture('medium-variants.json');
  const issues = rules(p);
  it('wireless/virtual: bez V-011, V-013, V-019', () => {
    for (const c of ['cnx_w', 'cnx_v']) for (const r of ['V-011', 'V-013', 'V-019']) expect(has(issues, r, c)).toBe(false);
  });
  it('physical bez kabla: V-019, ale bez V-011/V-013', () => {
    expect(has(issues, 'V-019', 'cnx_5')).toBe(true);
    expect(has(issues, 'V-011', 'cnx_5')).toBe(false);
    expect(has(issues, 'V-013', 'cnx_5')).toBe(false);
  });
  it('usunięcie kabla tworzy „kabel nieprzypisany”; wireless nie trafia do listy kabli, ale do patchlisty', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('rm', cmd.removeCable('cbl_1'));
    expect(s.state.connections.cnx_1.cableId).toBeNull();
    expect(has(validate(s.state), 'V-019', 'cnx_1')).toBe(true);
    expect(cableList(p).some((r) => r.medium !== 'physical')).toBe(false);
    expect(patchList(p).some((r) => r.medium === 'wireless')).toBe(true);
    expect(cableList(p).some((r) => r.fromDevice === 'LED1' && r.toDevice === 'NET1')).toBe(false); // kabel nieprzypisany
  });
});

describe('zgodność fizyczna i sygnałowa (P0-02)', () => {
  it('BNC gniazdo — kabel BNC/BNC — BNC gniazdo: bez ostrzeżeń V-011', () => {
    expect(rules(fixture('conference-mini.json')).filter((i) => i.ruleId === 'V-011' || i.ruleId === 'V-010')).toEqual([]);
  });
  it('kabel HDMI na połączeniu SDI→HDMI: V-010 (sygnał) i V-011 (końcówki) niezależnie', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    // CAM1 SDI OUT → LED1 HDMI IN bezpośrednio, kablem HDMI
    s.dispatch('zły tor', cmd.connect({ instanceId: 'eqi_cam1', portId: 'prt_sdiout' }, { instanceId: 'eqi_led1', portId: 'prt_hdmiin' }, 'std/sdi-3g', { cableTypeKey: 'std/cable-hdmi', id: 'cnx_x', cableId: 'cbl_x' }));
    const i = validate(s.state);
    expect(has(i, 'V-010', 'cnx_x')).toBe(true);
    expect(has(i, 'V-011', 'cnx_x')).toBe(true);
    expect(has(i, 'V-013', 'cnx_x')).toBe(true);
    expect(has(i, 'V-002')).toBe(true); // CAM1 SDI OUT ma już cnx_1, capacity 1
  });
  it('typ kabla bez endPairs: V-011 to info „nie da się ocenić”', () => {
    const p = fixture('conference-mini.json');
    delete (p.registries['std/cable-cat6'] as any).endPairs;
    const v = validate(p).filter((x) => x.ruleId === 'V-011');
    expect(v.length).toBe(2);
    expect(v.every((x) => x.level === 'info')).toBe(true);
  });
  it('V-001: out→out jest błędem z podpowiedzią „inny port”', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('out-out', cmd.connect({ instanceId: 'eqi_cam1', portId: 'prt_sdiout' }, { instanceId: 'eqi_cam2', portId: 'prt_sdiout' }, 'std/sdi-3g', { id: 'cnx_oo' }));
    const v = validate(s.state).find((x) => x.ruleId === 'V-001' && x.subject === 'cnx_oo');
    expect(v?.level).toBe('error');
    expect(v?.message).toMatch(/inny port/);
  });
});

describe('długości, numeracja, packlista (N-04, S-02)', () => {
  const p = fixture('lengths.json');
  it('V-026 tylko dla przydziału krótszego od wymaganej trasy (12000/10000)', () => {
    const v = validate(p).filter((i) => i.ruleId === 'V-026').map((i) => i.subject);
    expect(v).toEqual(['cbl_1']);
  });
  it('propozycja 15 m dla wymaganych 12 m bez przydziału; przydział ręczny 20 m i przycięty 12 m nie są „propozycją”', () => {
    const rows = patchList(p);
    const by = (n: string) => rows.find((r) => r.fromDevice + '>' + r.toDevice === n)!;
    const nobody = rows.find((r) => r.lengthState === 'suggested')!;
    expect(nobody.suggestedStockMm).toBe(15000);
    expect(rows.filter((r) => r.lengthState === 'allocated').map((r) => r.stockLengthMm).sort()).toEqual([10000, 12000, 15000, 20000]);
    expect(by('MIX1>LED1').stockLengthMm).toBe(20000);
  });
  it('CSV: BOM, średnik, polskie znaki bez uszkodzeń', () => {
    const csv = toCsv(cableList(p));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('Wymagana długość [mm]');
  });
  it('numeracja nadaje tylko brakujące i nie rusza istniejących; wzorzec z prefiksu sygnału', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('rm num', (d) => { delete d.cables.cbl_2.number; delete d.cables.cbl_5.number; });
    s.dispatch('numeruj', cmd.numberMissingCables());
    expect(s.state.cables.cbl_1.number).toBe('V001');
    expect(s.state.cables.cbl_2.number).toBe('V004'); // V001..V003 zajęte → następny wolny
    expect(s.state.cables.cbl_5.number).toBe('N002'); // N001 zajęty, N002 zwolniony przez usunięcie numeru
    expect(validate(s.state).some((i) => i.ruleId === 'V-004')).toBe(false);
  });
});

describe('polecenia i cofanie', () => {
  it('usunięcie urządzenia: kaskada (połączenia, kable, węzły, placement) w jednym kroku cofania', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    const prev = cmd.previewRemoveInstance(s.state, 'eqi_mix1');
    expect(prev).toEqual({ connections: 4, cables: 4 });
    const before = s.state;
    s.dispatch('usuń MIX1', cmd.removeInstance('eqi_mix1'));
    expect(Object.keys(s.state.connections)).toEqual(['cnx_5']);
    expect(s.state.views!.viw_diag.nodes.dgn_mix1).toBeUndefined();
    expect(s.state.views!.viw_diag.edgeLayouts.cnx_4).toBeUndefined();
    expect(s.state.placements!.plc_mix1).toBeUndefined();
    expect(checkInvariants(s.state)).toEqual([]);
    s.undo();
    expect(s.state).toEqual(before);
    s.redo();
    expect(s.state.equipment.eqi_mix1).toBeUndefined();
  });
  it('connect dobiera typ kabla z endPairs i sygnału', () => {
    const s = new Store(fixture('conference-mini.json'), { invariants: 'both' });
    s.dispatch('rm', cmd.disconnect('cnx_1'));
    expect(s.state.cables.cbl_1).toBeUndefined();
    s.dispatch('c', cmd.connect({ instanceId: 'eqi_cam1', portId: 'prt_sdiout' }, { instanceId: 'eqi_mix1', portId: 'prt_in1' }, 'std/sdi-3g', { id: 'cnx_n', cableId: 'cbl_n' }));
    expect(s.state.cables.cbl_n.cableTypeKey).toBe('std/cable-sdi');
  });
});

describe('plik: kontener ZIP, migracje, round-trip', () => {
  it('zapis jest deterministyczny i stabilny po ponownym zapisie (kanoniczny)', () => {
    const p = fixture('conference-mini.json');
    const a = packProject(p);
    const r = openProject(a);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(Buffer.from(packProject(r.project)).equals(Buffer.from(a))).toBe(true);
    expect(canonicalStringify(r.project)).toBe(canonicalStringify(p));
  });
  it('nieznane pola i ext są zachowane po odczycie i zapisie (Z8)', () => {
    const p = fixture('conference-mini.json') as any;
    p.ext = { plugin: { x: [1, 2, { y: 3 }] } };
    p.equipment.eqi_cam1.futureField = { a: 1 };
    p.definitions.eqd_cam.revisions['1'].ports.prt_sdiout.futurePortField = 'zzz';
    const r = openProject(packProject(p));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect((r.project as any).ext).toEqual(p.ext);
    expect((r.project.equipment.eqi_cam1 as any).futureField).toEqual({ a: 1 });
    expect((r.project.definitions.eqd_cam.revisions['1'].ports.prt_sdiout as any).futurePortField).toBe('zzz');
  });
  it('nowszy MAJOR: tylko metadane, bez migracji i zapisu', () => {
    const p = fixture('conference-mini.json');
    const body = canonicalStringify({ ...p, formatVersion: '2.0.0' });
    const manifest = canonicalStringify({ formatVersion: '2.0.0', appVersion: 'future', sha256: createHash('sha256').update(body).digest('hex') });
    const r = openProject(zipSync({ 'manifest.json': strToU8(manifest), 'project.json': strToU8(body) }));
    expect(r.status).toBe('newer-major');
  });
  it('suma kontrolna niezgodna → błąd; uszkodzone archiwum → błąd, nie wyjątek', () => {
    const files = unzipSync(packProject(fixture('conference-mini.json')));
    files['project.json'] = strToU8('{"zmienione":true}');
    expect(openProject(zipSync(files)).status).toBe('error');
    expect(openProject(new Uint8Array([1, 2, 3, 4])).status).toBe('error');
  });
  it('migracja v0 → v1: tablice → mapy, brak medium → physical; wynik zgodny ze schematem i niezmiennikami', () => {
    const legacy = JSON.parse(JSON.stringify(fixture('conference-mini.json')));
    const arr = (m: Record<string, object>) => Object.entries(m).map(([id, v]) => ({ id, ...v }));
    const old = { ...legacy, formatVersion: '0.9.0', equipment: arr(legacy.equipment), cables: arr(legacy.cables), connections: arr(legacy.connections).map(({ medium, ...c }: any) => c) };
    const migrated = migrate0to1(old);
    expect(schemaErrors(migrated)).toEqual([]);
    expect(checkInvariants(migrated)).toEqual([]);
    expect(migrated.connections.cnx_1.medium).toBe('physical');
    // przez kontener
    const body = canonicalStringify(old);
    const manifest = canonicalStringify({ formatVersion: '0.9.0', appVersion: 'old', sha256: createHash('sha256').update(body).digest('hex') });
    const r = openProject(zipSync({ 'manifest.json': strToU8(manifest), 'project.json': strToU8(body) }));
    expect(r.status === 'ok' && r.migratedFrom).toBe('0.9.0');
  });
});

describe('DMX mini (TS-15): ten sam model bez zmian', () => {
  it('walidacja czysta, lista kabli i kratownica jako StageObject', () => {
    const p = fixture('dmx-mini.json');
    expect(validate(p).filter((i) => i.level !== 'info' && (i.subject.startsWith('cnx_d') || i.subject.startsWith('cbl_d')))).toEqual([]);
    expect(cableList(p).filter((r) => r.signal === 'std/dmx').map((r) => r.number)).toEqual(['D001', 'D002']);
    expect(p.stageObjects!.stg_truss.kind).toBe('truss');
    expect(p.placements!.plc_fix1.position.z).toBeGreaterThan(p.placements!.plc_truss.position.z);
  });
});
