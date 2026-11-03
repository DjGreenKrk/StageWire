// Synchronizacja wspólnych komponentów i tokenów GreenCrew Tools do tej aplikacji.
// Źródło prawdy: repozytorium GreenCrew_Tools_Docs (ui/, tokens/, assets/fonts/; zob. development/UI_COMPONENTS.md).
// Skrypt buduje źródło (gdy są jego zależności), kopiuje `ui/dist` do `ui/greencrew/` (wersjonowana kopia, nie edytować ręcznie) i zapisuje `VERSION`.
// Uruchamia się automatycznie przed budową interfejsu i testami (`--soft`: bez źródła obok po cichu pomija, wtedy obowiązuje zatwierdzona kopia).
// Użycie: node scripts/sync-greencrew-ui.mjs [--soft] [--check] [ścieżka do GreenCrew_Tools_Docs]
//   --check  tylko sprawdza, czy kopia odpowiada źródłu (kod wyjścia 1, gdy jest nieaktualna)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), soft = args.includes('--soft'), check = args.includes('--check');
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(here, '..', '..', '..', 'GreenCrew_Tools_Docs'));
const dst = path.join(here, '..', 'ui', 'greencrew');
if (!existsSync(path.join(src, 'ui', 'package.json'))) {
  const msg = `Brak źródła GreenCrew_Tools_Docs (${src}): używam zatwierdzonej kopii ui/greencrew.`;
  if (soft) { console.log(msg); process.exit(0); }
  console.error(msg); process.exit(1);
}
const git = (...a) => { try { return execFileSync('git', ['-C', src, ...a]).toString().trim(); } catch { return ''; } };
const sha = git('rev-parse', '--short', 'HEAD') || 'nieznany', dirty = git('status', '--porcelain', '--', 'ui', 'tokens', 'assets') ? '+zmiany' : '';
const stamp = `${sha}${dirty}`;
const have = existsSync(path.join(dst, 'VERSION')) ? readFileSync(path.join(dst, 'VERSION'), 'utf8') : '';
if (check) {
  const ok = have.includes(`GreenCrew_Tools_Docs ${stamp}`);
  console.log(ok ? `Kopia ui/greencrew jest aktualna (${stamp}).` : `Kopia ui/greencrew jest NIEAKTUALNA (kopia: ${(have.match(/GreenCrew_Tools_Docs (\S+)/) ?? [])[1] ?? 'brak'}, źródło: ${stamp}). Uruchom: npm run sync:greencrew`);
  process.exit(ok ? 0 : 1);
}

// zbuduj źródło, jeśli ma zainstalowane zależności (inaczej użyj istniejącego ui/dist)
const uiDir = path.join(src, 'ui');
if (existsSync(path.join(uiDir, 'node_modules'))) execFileSync(process.execPath, [path.join(uiDir, 'build.mjs')], { cwd: uiDir, stdio: 'inherit' });
const dist = path.join(uiDir, 'dist');
if (!existsSync(dist)) { console.error(`Brak ${dist}. Zbuduj źródło: (cd "${uiDir}" && npm install && node build.mjs)`); process.exit(1); }

rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
cpSync(dist, dst, { recursive: true });

// Czcionka ikon bywa jeszcze nie dodana do źródła: wtedy jej @font-face jest wyłączony w kopii, żeby budowa nie szukała nieistniejącego pliku.
const iconFont = path.join(dst, 'assets', 'fonts', 'MaterialSymbolsRounded.woff2');
const fontsCss = path.join(dst, 'tokens', 'fonts.css');
let note = '';
if (!existsSync(iconFont) && existsSync(fontsCss)) {
  const css = readFileSync(fontsCss, 'utf8').split('\n').map((l) => (l.startsWith('@font-face') && l.includes('MaterialSymbolsRounded.woff2') ? `/* wyłączone w kopii: brak pliku MaterialSymbolsRounded.woff2 w źródle */ /* ${l} */` : l)).join('\n');
  writeFileSync(fontsCss, css); note = ' (bez czcionki ikon: brak pliku w źródle)';
}
const pkg = JSON.parse(readFileSync(path.join(uiDir, 'package.json'), 'utf8'));
writeFileSync(path.join(dst, 'VERSION'), `${pkg.name}@${pkg.version}\nźródło: GreenCrew_Tools_Docs ${stamp}\nKopia generowana przez scripts/sync-greencrew-ui.mjs. Nie edytować ręcznie.\n`);
console.log(`Zsynchronizowano ${pkg.name}@${pkg.version} (${stamp}) do ${path.relative(process.cwd(), dst)}${note}`);
