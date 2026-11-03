// Generuje walidator schematu projektu jako gotowy kod (Ajv standalone), żeby aplikacja nie kompilowała go w locie przez `new Function`.
// Dzięki temu polityka CSP może być ścisła (bez 'unsafe-eval'). Uruchamiane przed testami i budową; test sprawdza aktualność pliku.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const standaloneCode = require('ajv/dist/standalone').default;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function generate() {
  const schema = JSON.parse(readFileSync(path.join(root, 'schema', 'project.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true } });
  const validate = ajv.compile(schema);
  // Standalone w trybie ESM nadal używa require() dla jednej funkcji pomocniczej; wstawiamy ją jako kod własny (działa w przeglądarce i w Node bez CJS).
  const UCS2 = '(function(str){const len=str.length;let length=0,pos=0,value;while(pos<len){length++;value=str.charCodeAt(pos++);if(value>=0xd800&&value<=0xdbff&&pos<len){value=str.charCodeAt(pos);if((value&0xfc00)===0xdc00)pos++}}return length})';
  const code = standaloneCode(ajv, validate).split('require("ajv/dist/runtime/ucs2length").default').join(UCS2);
  if (code.includes('require(')) throw new Error('Wygenerowany walidator nadal zawiera require(): zaktualizuj generator');
  return '// PLIK GENEROWANY (scripts/gen-validator.mjs) ze schema/project.schema.json: nie edytuj ręcznie.\n// @ts-nocheck\n' + code;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'src', 'generated', 'projectValidator.js'); mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, generate()); console.log('Zapisano', path.relative(root, out));
}
