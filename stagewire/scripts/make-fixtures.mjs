// Generuje fixtures z przykładu w docs/mvp/DOMAIN-MODEL.md §12. Uruchom: npm run fixtures
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docPath = path.resolve(root, '../docs/mvp/DOMAIN-MODEL.md');
const md = fs.readFileSync(docPath, 'utf8');
const base = JSON.parse(md.match(/```json\n([\s\S]*?)\n```/)[1]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const out = (name, obj) => {
  fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fixtures', name), JSON.stringify(obj, null, 2) + '\n');
  console.log('fixtures/' + name);
};

// 1. przykład z dokumentacji (nietknięty)
out('conference-mini.json', base);

// 2. dwie rewizje tej samej definicji; A (MIX1) na rew. 1, B (MIX2) na rew. 2 (inny zestaw portów)
{
  const p = clone(base);
  const def = p.definitions.eqd_mixer;
  const rev2 = clone(def.revisions['1']);
  rev2.changeClass = 'structural';
  rev2.ports.prt_in3 = { label: 'SDI IN 3', group: 'SDI IN', order: 5, connectorKey: 'std/bnc-75', signalKeys: ['std/sdi-3g'], direction: 'in', side: 'auto', capacity: 1 };
  rev2.ports.prt_in1.label = 'PGM IN 1'; // zmiana etykiety: ten sam portId
  delete rev2.ports.prt_hdmiout; // port usunięty w rew. 2 (MIX1 nadal go używa na rew. 1)
  def.revisions['2'] = rev2;
  def.latestRevision = 2;
  p.equipment.eqi_mix2 = { definitionId: 'eqd_mixer', definitionRevision: 2, name: 'MIX2', zoneId: 'zon_foh', supply: 'owned', portOverrides: {} };
  p.equipment.eqi_cam3 = { definitionId: 'eqd_cam', definitionRevision: 1, name: 'CAM3', zoneId: 'zon_foh', supply: 'rental', portOverrides: {} };
  p.connections.cnx_6 = { from: { instanceId: 'eqi_cam3', portId: 'prt_sdiout' }, to: { instanceId: 'eqi_mix2', portId: 'prt_in3' }, signalKey: 'std/sdi-3g', medium: 'physical', cableId: 'cbl_6' };
  p.cables.cbl_6 = { cableTypeKey: 'std/cable-sdi', number: 'V004', lengthMm: 15000, lengthSource: 'manual' };
  out('revisions-two.json', p);
}

// 3. medium: physical z kablem, physical bez kabla (kabel nieprzypisany), wireless, virtual
{
  const p = clone(base);
  p.registries['std/wifi-antenna'] = { kind: 'connector', name: 'Antena Wi-Fi' };
  p.registries['std/wifi'] = { kind: 'signal', name: 'Wi-Fi', domain: 'network', color: '#a02fd1', prefix: 'W' };
  const wifiPort = { label: 'ANT', order: 1, connectorKey: 'std/wifi-antenna', signalKeys: ['std/wifi'], direction: 'io', side: 'auto', capacity: 4 };
  p.definitions.eqd_wifi = { latestRevision: 1, revisions: { 1: { manufacturer: 'Generic', model: 'Wi-Fi device', category: 'network', kind: 'physical', ports: { prt_ant: wifiPort } } } };
  p.definitions.eqd_cloud = { latestRevision: 1, revisions: { 1: { manufacturer: 'Generic', model: 'Cloud', category: 'virtual', kind: 'virtual', ports: { prt_ant: wifiPort } } } };
  for (const [id, name, d] of [['eqi_w1', 'WIFI1', 'eqd_wifi'], ['eqi_w2', 'WIFI2', 'eqd_wifi'], ['eqi_cloud', 'CLOUD1', 'eqd_cloud']]) {
    p.equipment[id] = { definitionId: d, definitionRevision: 1, name, supply: 'unknown', portOverrides: {} };
  }
  p.connections.cnx_w = { from: { instanceId: 'eqi_w1', portId: 'prt_ant' }, to: { instanceId: 'eqi_w2', portId: 'prt_ant' }, signalKey: 'std/wifi', medium: 'wireless', cableId: null };
  p.connections.cnx_v = { from: { instanceId: 'eqi_w1', portId: 'prt_ant' }, to: { instanceId: 'eqi_cloud', portId: 'prt_ant' }, signalKey: 'std/wifi', medium: 'virtual', cableId: null };
  // physical bez kabla: usuń kabel cbl_5
  p.connections.cnx_5.cableId = null;
  delete p.cables.cbl_5;
  out('medium-variants.json', p);
}

// 4. mini-DMX: konsola → splitter → oprawa, kratownica jako StageObject z oprawą na jej wysokości
{
  const p = clone(base);
  p.registries['std/xlr-5'] = { kind: 'connector', name: 'XLR 5-pin' };
  p.registries['std/dmx'] = { kind: 'signal', name: 'DMX512', domain: 'lighting', color: '#d1a12f', prefix: 'D' };
  p.registries['std/cable-dmx'] = { kind: 'cable', name: 'Kabel DMX', endPairs: [['std/xlr-5', 'std/xlr-5']], carriesSignals: ['std/dmx'] };
  const dmx = (label, order, direction) => ({ label, order, connectorKey: 'std/xlr-5', signalKeys: ['std/dmx'], direction, side: 'auto', capacity: 1 });
  const mk = (model, category, ports) => ({ latestRevision: 1, revisions: { 1: { manufacturer: 'Generic', model, category, kind: 'physical', ports } } });
  p.definitions.eqd_dmxcon = mk('DMX Console', 'lighting-console', { prt_out: dmx('DMX OUT', 1, 'out') });
  p.definitions.eqd_dmxspl = mk('DMX Splitter 1x2', 'dmx-splitter', { prt_in: dmx('IN', 1, 'in'), prt_o1: dmx('OUT 1', 2, 'out'), prt_o2: dmx('OUT 2', 3, 'out') });
  p.definitions.eqd_fix = mk('LED Fixture', 'lighting', { prt_in: dmx('DMX IN', 1, 'in') });
  for (const [id, name, d] of [['eqi_dcon', 'LCON1', 'eqd_dmxcon'], ['eqi_dspl', 'SPL1', 'eqd_dmxspl'], ['eqi_fix1', 'FIX1', 'eqd_fix']]) {
    p.equipment[id] = { definitionId: d, definitionRevision: 1, name, supply: 'rental', portOverrides: {} };
  }
  p.stageObjects.stg_truss = { name: 'Kratownica FOH', kind: 'truss', footprint: { shape: 'rect', widthMm: 6000, depthMm: 300 }, heightMm: 300 };
  p.placements.plc_truss = { spaceId: 'spc_hall', targetKind: 'stageObject', targetId: 'stg_truss', position: { x: 10000, y: 9000, z: 5000 }, rotationDeg: 0 };
  p.placements.plc_fix1 = { spaceId: 'spc_hall', targetKind: 'equipment', targetId: 'eqi_fix1', position: { x: 8000, y: 9000, z: 5300 }, rotationDeg: 0 };
  const link = (id, from, fp, to, tp, cable, num) => {
    p.connections[id] = { from: { instanceId: from, portId: fp }, to: { instanceId: to, portId: tp }, signalKey: 'std/dmx', medium: 'physical', cableId: cable };
    p.cables[cable] = { cableTypeKey: 'std/cable-dmx', number: num, lengthSource: 'unknown' };
  };
  link('cnx_d1', 'eqi_dcon', 'prt_out', 'eqi_dspl', 'prt_in', 'cbl_d1', 'D001');
  link('cnx_d2', 'eqi_dspl', 'prt_o1', 'eqi_fix1', 'prt_in', 'cbl_d2', 'D002');
  out('dmx-mini.json', p);
}

// 5. długości: wymagane 12 m; przydział 10 / 15 / 20 m (V-026 tylko dla 10 m); magazyn 10/15/20
{
  const p = clone(base);
  p.settings.stockCableLengthsMm = [10000, 15000, 20000];
  const set = (id, len, stock) => { p.cables[id].lengthMm = len; p.cables[id].lengthSource = 'manual'; if (stock) p.cables[id].stockLengthMm = stock; else delete p.cables[id].stockLengthMm; };
  set('cbl_1', 12000, 10000);
  set('cbl_2', 12000, 15000);
  set('cbl_3', 12000, 20000);
  set('cbl_4', 12000, undefined); // bez przydziału → propozycja 15000
  set('cbl_5', 12000, 12000); // przycięty na wymiar
  out('lengths.json', p);
}

// 6. legacy v0 (tablice, bez medium) do testu migracji
{
  const p = clone(base);
  const arr = (m) => Object.entries(m).map(([id, v]) => ({ id, ...v }));
  const legacy = { ...p, formatVersion: '0.9.0', equipment: arr(p.equipment), cables: arr(p.cables) };
  legacy.connections = arr(p.connections).map(({ medium, ...c }) => c);
  out('legacy-v0.json', legacy);
}
