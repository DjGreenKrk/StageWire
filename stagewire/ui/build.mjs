// Buduje pakiet @stagewire/ui: dist/index.js (ESM, React jako zewnętrzna zależność), dist/index.d.ts i dist/styles.css.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, 'dist');
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist, { recursive: true });
await build({ entryPoints: [path.join(here, 'index.ts')], outfile: path.join(dist, 'index.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'], sourcemap: false, logLevel: 'warning' });
execFileSync(process.execPath, [path.join(here, '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(here, 'tsconfig.build.json')], { stdio: 'inherit' });
copyFileSync(path.join(here, 'styles.css'), path.join(dist, 'styles.css'));
// wspólne tokeny i czcionki GreenCrew (kopia z GreenCrew_Tools_Docs): dist/styles.css importuje ./greencrew/tokens/index.css
if (existsSync(path.join(here, 'greencrew'))) cpSync(path.join(here, 'greencrew'), path.join(dist, 'greencrew'), { recursive: true });
console.log('ui/dist gotowe');
