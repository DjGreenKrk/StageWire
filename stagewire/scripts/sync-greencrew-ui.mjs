// Synchronizacja wspólnych komponentów i tokenów GreenCrew Tools do tej aplikacji.
// Źródło prawdy: repozytorium GreenCrew_Tools_Docs (ui/, tokens/, assets/fonts/; zob. development/UI_COMPONENTS.md).
// Skrypt kopiuje zbudowane `ui/dist` do `ui/greencrew/` (wersjonowana kopia, nie edytować ręcznie) i zapisuje `VERSION`.
// Użycie: node scripts/sync-greencrew-ui.mjs [ścieżka do GreenCrew_Tools_Docs]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] ?? path.join(here, '..', '..', '..', 'GreenCrew_Tools_Docs'));
const dst = path.join(here, '..', 'ui', 'greencrew');
const dist = path.join(src, 'ui', 'dist');
if (!existsSync(dist)) { console.error(`Brak ${dist}. Zbuduj źródło: (cd "${path.join(src, 'ui')}" && npm install && node build.mjs)`); process.exit(1); }

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
const pkg = JSON.parse(readFileSync(path.join(src, 'ui', 'package.json'), 'utf8'));
let sha = 'nieznany';
try { sha = execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch { /* brak gita */ }
writeFileSync(path.join(dst, 'VERSION'), `${pkg.name}@${pkg.version}\nźródło: GreenCrew_Tools_Docs ${sha}\nKopia generowana przez scripts/sync-greencrew-ui.mjs. Nie edytować ręcznie.\n`);
console.log(`Zsynchronizowano ${pkg.name}@${pkg.version} (${sha}) do ${path.relative(process.cwd(), dst)}${note}`);
