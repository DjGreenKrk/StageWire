import { readFileSync, writeFileSync } from 'node:fs';
import type { Project } from './types.ts';
import { openProject, packProject, schemaErrors } from './format.ts';
import { checkInvariants } from './invariants.ts';
import { validate } from './validation.ts';
import { cableList, patchList, toCsv } from './reports.ts';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { validatePack, sourceTrust, TRUST_LABEL, PACK_FORMAT, type Pack } from './pack.ts';
import { starterRegistries, installPack } from './catalog/index.ts';

function load(path: string): Project {
  const bytes = readFileSync(path);
  if (path.endsWith('.json')) {
    const json = JSON.parse(bytes.toString('utf8'));
    const errs = schemaErrors(json);
    if (errs.length) { console.error('Błędy schematu:\n' + errs.join('\n')); process.exit(2); }
    return json;
  }
  const r = openProject(new Uint8Array(bytes));
  if (r.status === 'newer-major') { console.error(`Plik w nowszym formacie ${r.manifest.formatVersion}: tylko metadane, bez zapisu i migracji.`); process.exit(3); }
  if (r.status === 'error') { console.error(r.errors.join('\n')); process.exit(2); }
  return r.project;
}

const [cmd, ...args] = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));

if (cmd === 'validate' && file) {
  const p = load(file);
  const inv = checkInvariants(p);
  if (inv.length) { console.error('NARUSZENIA NIEZMIENNIKÓW:\n' + inv.join('\n')); process.exit(1); }
  const issues = validate(p);
  for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.ruleId} ${i.subject}: ${i.message}`);
  const c = (l: string) => issues.filter((i) => i.level === l).length;
  console.log(`\n${c('error')} błędów, ${c('warning')} ostrzeżeń, ${c('info')} informacji. Niezmienniki: OK.`);
} else if (cmd === 'report' && args[0] === 'cables' && args[1]) {
  const p = load(args[1]);
  const rows = args.includes('--patch') ? patchList(p) : cableList(p);
  if (args.includes('--csv')) process.stdout.write(toCsv(rows));
  else console.table(rows);
} else if (cmd === 'pack' && args[0] && args[1]) {
  const p = load(args[0]);
  writeFileSync(args[1], packProject(p));
  console.log('Zapisano ' + args[1]);
} else if (cmd === 'packs' && args[0] === 'validate' && args[1]) {
  // pakiety z jednego katalogu są instalowane po kolei tak jak w programie: wykrywamy konflikty rejestrów i identyfikatorów między nimi;
  // pakiety zależne od rejestrów z innych plików czekają na kolejne przebiegi
  const target = args[1], files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.toLowerCase().endsWith('.swpack.json')).sort().map((f) => `${target}/${f}`) : [target];
  const pending = files.map((f) => { try { return { f, raw: JSON.parse(readFileSync(f, 'utf8')) as unknown, parse: '' }; } catch (e) { return { f, raw: undefined as unknown, parse: String((e as Error).message) }; } });
  let bad = 0, devices = 0, unverified = 0;
  const done = new Set<string>(), last = new Map<string, string[]>();
  for (let pass = 0; pass <= pending.length; pass++) {
    let progress = false;
    for (const r of pending) {
      if (done.has(r.f) || r.raw === undefined) continue;
      const plan = installPack(r.raw);
      if (plan.errors.length && plan.errors[0].startsWith('Brakujące wpisy rejestrów') && pass < pending.length) { last.set(r.f, plan.errors); continue; }
      done.add(r.f); progress = true;
      for (const w of plan.warnings) console.warn(`  uwaga ${r.f}: ${w}`);
      if (plan.errors.length) { bad++; console.error(`✗ ${r.f}`); for (const e of plan.errors) console.error(`    ${e}`); }
      else { const pk = plan.pack!; devices += pk.devices.length; unverified += pk.devices.filter((d) => sourceTrust(d.source) === 'unverified').length; console.log(`✓ ${r.f}: ${pk.id} ${pk.version}, ${pk.devices.length} urządzeń${plan.newRegistries.length ? `, nowe rejestry: ${plan.newRegistries.length}` : ''}`); }
    }
    if (!progress) break;
  }
  for (const r of pending) if (r.raw === undefined) { console.error(`✗ ${r.f}: nie jest poprawnym JSON (${r.parse})`); bad++; }
  console.log(`
${files.length} plików, ${devices} urządzeń, ${unverified} niezweryfikowanych, ${bad} z błędami.`);
  process.exit(bad ? 1 : 0);
} else if (cmd === 'packs' && args[0] === 'new' && args[1] && args[2]) {
  if (existsSync(args[2])) { console.error('Plik już istnieje: ' + args[2]); process.exit(1); }
  const skeleton: Pack = {
    format: PACK_FORMAT, id: args[1], name: 'Nazwa pakietu', version: '1.0.0', author: '', license: 'własne (do użytku wewnętrznego)', description: 'Krótki opis pakietu.',
    registries: {},
    devices: [{
      key: 'przykladowe-urzadzenie', manufacturer: 'Producent', model: 'Model', category: 'wideo / konwertery', tags: [], description: 'Opis własnymi słowami (do 400 znaków).',
      dimensionsMm: { width: 100, depth: 80, height: 25 },
      ports: [
        { key: 'sdi-in', label: 'SDI IN', connector: 'std/bnc-75', signals: ['std/sdi-3g'], direction: 'in' },
        { key: 'hdmi-out', label: 'HDMI OUT', connector: 'std/hdmi-a', signals: ['std/hdmi'], direction: 'out' },
      ],
      source: { kind: 'datasheet', ref: 'Nazwa i wersja dokumentu producenta', verified: new Date().toISOString().slice(0, 10) },
    }],
  };
  writeFileSync(args[2], JSON.stringify(skeleton, null, 2) + '\n'); console.log('Utworzono szkielet pakietu: ' + args[2]);
} else if (cmd === 'packs' && args[0] === 'list' && args[1]) {
  const rep = validatePack(JSON.parse(readFileSync(args[1], 'utf8')), starterRegistries);
  if (!rep.pack) { console.error(rep.errors.join('\n')); process.exit(1); }
  console.table(rep.pack.devices.map((d) => ({ klucz: d.key, producent: d.manufacturer, model: d.model, kategoria: d.category, porty: d.ports.length, zrodlo: d.source.kind, dane: TRUST_LABEL[sourceTrust(d.source)] })));
} else {
  console.error('Użycie:\n  cli validate <plik.json|.stagewire>\n  cli report cables <plik> [--csv] [--patch]\n  cli pack <plik.json> <wyjście.stagewire>\n  cli packs validate <plik.swpack.json|katalog>   (walidacja pakietów urządzeń)\n  cli packs new <id-pakietu> <plik.swpack.json>   (szkielet nowego pakietu)\n  cli packs list <plik.swpack.json>');
  process.exit(64);
}
